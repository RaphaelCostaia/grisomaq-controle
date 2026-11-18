import { createHash } from 'node:crypto'
import type { FastifyInstance, FastifyReply } from 'fastify'
import { comoFuncionario, comoServico } from '../banco.ts'
import { leituraDisponivel, lerRegistrador } from '../leitura-registrador.ts'

const PAPEIS = ['horimetro', 'registrador_inicio', 'registrador_fim'] as const
type Papel = (typeof PAPEIS)[number]

/** Decodifica a imagem do corpo, ou responde o erro e devolve null. */
function imagemDoCorpo(
  corpo: { tipo?: string; dados?: string } | undefined,
  resposta: FastifyReply,
): { bytes: Buffer; tipo: 'image/jpeg' | 'image/png' } | null {
  const { tipo, dados } = corpo ?? {}
  if (!dados || typeof dados !== 'string') {
    void resposta.code(400).send({ erro: 'DADOS_AUSENTES' })
    return null
  }
  // Só JPEG e PNG — os únicos que uma câmera de celular produz depois de
  // recomprimir. Deixar aberto convida arquivo grande de outro app.
  const tipoLimpo = tipo === 'image/png' ? 'image/png' : 'image/jpeg'
  const bytes = Buffer.from(dados, 'base64')
  if (bytes.length === 0) {
    void resposta.code(400).send({ erro: 'ARQUIVO_VAZIO' })
    return null
  }
  // 2 MB parecem muitos para foto de horímetro; num JPEG bem comprimido é
  // folga confortável. Acima disso é bug de compressão no cliente.
  if (bytes.length > 2 * 1024 * 1024) {
    void resposta.code(413).send({ erro: 'ARQUIVO_GRANDE' })
    return null
  }
  return { bytes, tipo: tipoLimpo }
}

/**
 * Anexos do abastecimento: foto do horímetro e fotos da registradora da bomba
 * (início e fim), identificadas pela coluna `papel`.
 *
 * A foto entra como sistema DESACOPLADO do sync: o motor de sync trata os
 * lançamentos, e a foto tem sua própria fila e seu próprio endpoint. Duas
 * consequências desse desenho, ambas propositais:
 *
 *  - Uma falha ao enviar a foto (rede caindo no meio, arquivo corrompido)
 *    não empurra o abastecimento para "conflito". Ele sobe normalmente e a
 *    foto tenta de novo mais tarde.
 *  - O escritório vê o abastecimento antes da foto chegar — o que é o
 *    correto: os números não podem esperar por uma imagem opcional.
 */
export async function rotasDeAnexos(app: FastifyInstance): Promise<void> {
  /**
   * Lê o totalizador da registradora numa foto, para o celular preencher o
   * número na hora. Só funciona com sinal; sem ele o comboista digita, e a foto
   * é lida de novo quando chegar pelo upload.
   */
  app.post<{ Body: { tipo?: string; dados?: string } }>(
    '/abastecimento/ler-registrador',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (requisicao, resposta) => {
      if (!requisicao.identidade) return resposta.code(401).send({ erro: 'SEM_SESSAO' })
      if (!leituraDisponivel()) return resposta.code(503).send({ erro: 'LEITURA_INDISPONIVEL' })

      const imagem = imagemDoCorpo(requisicao.body, resposta)
      if (!imagem) return

      return lerRegistrador(imagem.bytes.toString('base64'), imagem.tipo)
    },
  )

  /**
   * Upload da foto de um abastecimento. Idempotente por hash: o mesmo arquivo
   * chegando duas vezes (retransmissão em rede ruim) gera um anexo só.
   */
  app.put<{ Params: { id: string }; Body: { tipo?: string; dados?: string; papel?: string } }>(
    '/abastecimento/:id/foto',
    {
      // Quota específica: 30 uploads por minuto por dispositivo (chave do
      // rate-limit vem do header `x-dispositivo-id`). Até três fotos por
      // lançamento e um lançamento a cada ~5 minutos no ritmo real; 30/min é
      // folga para retentativa em rede ruim sem virar canal para inundação.
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (requisicao, resposta) => {
      const identidade = requisicao.identidade
      if (!identidade) return resposta.code(401).send({ erro: 'SEM_SESSAO' })

      const { id } = requisicao.params
      const papelPedido = requisicao.body?.papel ?? 'horimetro'
      if (!PAPEIS.includes(papelPedido as Papel)) return resposta.code(400).send({ erro: 'PAPEL_INVALIDO' })
      const papel = papelPedido as Papel

      const imagem = imagemDoCorpo(requisicao.body, resposta)
      if (!imagem) return
      const { bytes, tipo: tipoLimpo } = imagem

      const hash = createHash('sha256').update(bytes).digest('hex')

      // A ficha tem que existir e ser do próprio operador (ou ele ser admin).
      // A conferência roda fora da RLS de propósito: a RLS de campo só mostra
      // fichas de hoje e de ontem, e a foto de um celular que passou dias sem
      // sinal chega depois disso — sem isto ela daria 404 e se perderia.
      const { rowCount: existe } = await comoServico((cliente) =>
        cliente.query(
          `select 1 from public.abastecimentos
            where id = $1 and not excluido and (criado_por = $2 or $3)`,
          [id, identidade.funcionario_id, identidade.papel === 'admin'],
        ),
      )
      if (existe === 0) return resposta.code(404).send({ erro: 'ABASTECIMENTO_INEXISTENTE' })

      const resultado = await comoFuncionario(identidade, async (cliente) => {
        // Idempotência por hash: se já existe um anexo com esse conteúdo para
        // esta ficha, devolve o mesmo id em vez de duplicar.
        const { rows: existente } = await cliente.query<{ id: string }>(
          `select id from public.anexos
            where tabela = 'abastecimentos' and registro_id = $1 and hash_sha256 = $2
            limit 1`,
          [id, hash],
        )
        if (existente[0]) return { anexo_id: existente[0].id, duplicada: true }

        const { rows } = await cliente.query<{ id: string }>(
          `insert into public.anexos
             (id, tabela, registro_id, dados, tipo_mime, tamanho_bytes, hash_sha256, criado_por, papel)
           values (gen_random_uuid(), 'abastecimentos', $1, $2, $3, $4, $5,
                   (select public.fn_funcionario_atual()), $6)
           returning id`,
          [id, bytes, tipoLimpo, bytes.length, hash, papel],
        )
        return { anexo_id: rows[0]!.id, duplicada: false }
      })

      // A foto da registradora é lida de novo aqui, fora da transação (a
      // leitura leva segundos). O valor lido fica no anexo para o escritório
      // comparar com o que foi digitado — inclusive quando o comboista estava
      // sem sinal e digitou. Falha na leitura não desfaz o upload.
      if (!resultado.duplicada && papel !== 'horimetro' && leituraDisponivel()) {
        try {
          const leitura = await lerRegistrador(bytes.toString('base64'), tipoLimpo)
          if (leitura.valor !== null) {
            await comoServico((cliente) =>
              cliente.query(
                `update public.anexos
                    set leitura_ia = $2, leitura_ia_confianca = $3, leitura_ia_em = now()
                  where id = $1`,
                [resultado.anexo_id, leitura.valor, leitura.confianca],
              ),
            )
          }
        } catch (erro) {
          requisicao.log.warn({ erro: erro instanceof Error ? erro.message : String(erro) }, 'leitura da foto falhou')
        }
      }

      return resultado
    },
  )

  /**
   * Serve a foto para o painel. Não usa `/painel/` no prefixo porque o
   * navegador pode abrir a URL direto (em uma aba nova, um `<img src>`), e
   * exigir POST-com-token no `<img>` complica a UI para nada.
   */
  app.get<{ Params: { id: string } }>('/anexos/:id/arquivo', async (requisicao, resposta) => {
    const identidade = requisicao.identidade
    if (!identidade) return resposta.code(401).send({ erro: 'SEM_SESSAO' })

    const { id } = requisicao.params

    return comoFuncionario(identidade, async (cliente) => {
      const { rows } = await cliente.query<{
        dados: Buffer
        tipo_mime: string | null
      }>('select dados, tipo_mime from public.anexos where id = $1', [id])

      const alvo = rows[0]
      if (!alvo || !alvo.dados) return resposta.code(404).send({ erro: 'ANEXO_INEXISTENTE' })

      // Cache curto: o conteúdo é imutável (hash na tabela), mas o vínculo
      // com o operador pode mudar por movimentação no cadastro.
      return resposta
        .header('content-type', alvo.tipo_mime ?? 'application/octet-stream')
        .header('cache-control', 'private, max-age=300')
        .send(alvo.dados)
    })
  })
}
