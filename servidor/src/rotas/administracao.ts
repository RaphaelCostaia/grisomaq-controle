import { webcrypto } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { comoServico, type Consultavel } from '../banco.ts'
import { config } from '../config.ts'

/** O tipo global `CryptoKey` é do DOM; no Node ele vem do próprio webcrypto. */
type ChaveCripto = Awaited<ReturnType<typeof webcrypto.subtle.importKey>>

export async function rotasDeAdministracao(app: FastifyInstance): Promise<void> {
  /**
   * Cria ou refaz o acesso de um funcionário. Só o escritório chama.
   *
   * Devolve o PIN inicial UMA vez, em texto, para ser impresso e entregue em
   * mãos. Ele não fica recuperável depois: se o funcionário esquecer, o caminho
   * é gerar outro, não consultar o antigo.
   */
  app.post('/admin/provisionar-funcionario', async (requisicao, resposta) => {
    const identidade = requisicao.identidade
    if (!identidade) return resposta.code(401).send({ erro: 'SEM_SESSAO' })
    if (identidade.papel !== 'admin') return resposta.code(403).send({ erro: 'SEM_PERMISSAO' })

    const corpo = requisicao.body as { funcionario_id?: string }
    if (!corpo?.funcionario_id) return resposta.code(400).send({ erro: 'CORPO_INVALIDO' })

    return comoServico(async (cliente) => {
      const { rows } = await cliente.query<{ id: string; codigo: string; nome: string }>(
        'select id, codigo, nome from public.funcionarios where id = $1',
        [corpo.funcionario_id],
      )
      const funcionario = rows[0]
      if (!funcionario) return resposta.code(404).send({ erro: 'FUNCIONARIO_NAO_ENCONTRADO' })

      const pinInicial = gerarPinAceitavel()
      await cliente.query('select public.fn_definir_pin($1, $2, null, true)', [
        funcionario.id,
        pinInicial,
      ])

      // Reprovisionar encerra as sessões antigas: o motivo mais comum de gerar
      // um PIN novo é o aparelho ter sumido.
      await cliente.query(
        'update public.sessoes set revogada_em = now() where funcionario_id = $1 and revogada_em is null',
        [funcionario.id],
      )

      return {
        funcionario: { id: funcionario.id, codigo: funcionario.codigo, nome: funcionario.nome },
        pin_inicial: pinInicial,
        aviso: 'Anote e entregue em mãos. Este PIN não poderá ser consultado depois.',
      }
    })
  })

  /**
   * Revalidação das assinaturas no servidor. É ela que dá valor probatório ao
   * aceite: a conferência feita no celular serve à experiência, mas um aparelho
   * adulterado consegue burlá-la. Aqui o PIN é conferido contra o hash
   * autoritativo, que nunca sai do Postgres.
   */
  app.post('/assinaturas/verificar', async (requisicao, resposta) => {
    const identidade = requisicao.identidade
    if (!identidade) return resposta.code(401).send({ erro: 'SEM_SESSAO' })

    const corpo = requisicao.body as {
      assinaturas?: Array<{ assinatura_id: string; pin_cifrado: string }>
    }
    const pendentes = corpo?.assinaturas ?? []
    if (pendentes.length === 0) return { resultados: [] }
    if (pendentes.length > 50) return resposta.code(413).send({ erro: 'LOTE_GRANDE' })

    if (!config.chavePrivadaAssinatura) {
      // Sem chave configurada não dá para revalidar. Isso não é erro do
      // operador: a assinatura fica pendente e o painel mostra a pendência.
      return { resultados: [], aviso: 'CHAVE_NAO_CONFIGURADA' }
    }

    const chave = await carregarChavePrivada()

    return comoServico(async (cliente) => {
      const resultados: Array<{ assinatura_id: string; validacao: string }> = []

      for (const item of pendentes) {
        const veredito = await julgar(cliente, chave, item)
        resultados.push({ assinatura_id: item.assinatura_id, validacao: veredito })
      }

      return { resultados }
    })
  })
}

async function julgar(
  cliente: Consultavel,
  chave: ChaveCripto,
  item: { assinatura_id: string; pin_cifrado: string },
): Promise<string> {
  const { rows } = await cliente.query<{
    id: string
    funcionario_id: string
    validacao_pin: string
  }>('select id, funcionario_id, validacao_pin from public.assinaturas_aceite where id = $1', [
    item.assinatura_id,
  ])

  const assinatura = rows[0]
  if (!assinatura) return 'nao_encontrada'

  // Já julgada antes: não reprocessa. A trilha é append-only, e revalidar uma
  // assinatura já decidida só criaria chance de mudar o veredito.
  if (assinatura.validacao_pin === 'validado_servidor' || assinatura.validacao_pin === 'invalida') {
    return assinatura.validacao_pin
  }

  let pin: string
  try {
    pin = await decifrar(chave, item.pin_cifrado)
  } catch {
    await marcar(cliente, assinatura.id, 'invalida')
    return 'invalida'
  }

  const { rows: conferencia } = await cliente.query<{ fn_verificar_pin: boolean }>(
    'select public.fn_verificar_pin($1, $2)',
    [assinatura.funcionario_id, pin],
  )

  const veredito = conferencia[0]?.fn_verificar_pin ? 'validado_servidor' : 'invalida'
  await marcar(cliente, assinatura.id, veredito)
  return veredito
}

async function marcar(cliente: Consultavel, id: string, validacao: string): Promise<void> {
  await cliente.query(
    'update public.assinaturas_aceite set validacao_pin = $2, validado_em = now() where id = $1',
    [id, validacao],
  )
}

async function carregarChavePrivada(): Promise<ChaveCripto> {
  const pkcs8 = Buffer.from(config.chavePrivadaAssinatura, 'base64')
  return webcrypto.subtle.importKey('pkcs8', pkcs8, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, [
    'decrypt',
  ])
}

async function decifrar(chave: ChaveCripto, cifradoBase64: string): Promise<string> {
  const cifrado = Buffer.from(cifradoBase64, 'base64')
  const claro = await webcrypto.subtle.decrypt({ name: 'RSA-OAEP' }, chave, cifrado)
  return new TextDecoder().decode(claro)
}

/**
 * PIN aleatório que passa nas regras de `fn_pin_fraco`. Sortear até passar é o
 * caminho honesto: a lista de proibidos vive no banco e é a mesma que valida a
 * troca feita pelo funcionário — duplicá-la aqui deixaria as duas divergirem.
 */
function gerarPinAceitavel(): string {
  for (let tentativa = 0; tentativa < 50; tentativa++) {
    const bytes = new Uint32Array(1)
    webcrypto.getRandomValues(bytes)
    const pin = String(bytes[0]! % 10000).padStart(4, '0')
    if (!ehPrevisivel(pin)) return pin
  }
  return '2748'
}

function ehPrevisivel(pin: string): boolean {
  if (/^(.)\1{3}$/.test(pin)) return true
  if ('01234567890'.includes(pin) || '09876543210'.includes(pin)) return true
  if (/^(19[3-9][0-9]|20[0-2][0-9])$/.test(pin)) return true
  return false
}
