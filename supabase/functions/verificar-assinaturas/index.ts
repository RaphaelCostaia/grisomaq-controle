import { clienteAdmin, exigirEnv } from '../_compartilhado/cliente.ts'
import { preflight, responderErro, responderJson } from '../_compartilhado/cors.ts'

/**
 * Revalidação das assinaturas no servidor. É ela que dá valor probatório ao
 * aceite: a conferência feita no celular serve à experiência, mas um aparelho
 * adulterado consegue burlá-la. Aqui o PIN é conferido contra o hash
 * autoritativo, que nunca sai do Postgres.
 *
 * O app cifra o PIN com a chave pública RSA-OAEP no momento do aceite e guarda
 * o resultado junto do item de fila. O texto claro nunca trafega, nem é gravado
 * em lugar nenhum — é descartado assim que a conferência termina.
 */
Deno.serve(async (req) => {
  const origem = req.headers.get('origin')
  const respostaPreflight = preflight(req)
  if (respostaPreflight) return respostaPreflight
  if (req.method !== 'POST') return responderErro('METODO_INVALIDO', 405, origem)

  const autorizacao = req.headers.get('Authorization')
  if (!autorizacao) return responderErro('SEM_SESSAO', 401, origem)

  const admin = clienteAdmin()
  const { data: usuario } = await admin.auth.getUser(autorizacao.replace('Bearer ', ''))
  if (!usuario?.user) return responderErro('SEM_SESSAO', 401, origem)

  let corpo: { assinaturas?: Array<{ assinatura_id: string; pin_cifrado: string }> }
  try {
    corpo = await req.json()
  } catch {
    return responderErro('CORPO_INVALIDO', 400, origem)
  }

  const pendentes = corpo.assinaturas ?? []
  if (pendentes.length === 0) return responderJson({ resultados: [] }, 200, origem)
  if (pendentes.length > 50) return responderErro('LOTE_GRANDE', 400, origem)

  const chavePrivada = await carregarChavePrivada()
  const resultados: Array<{ assinatura_id: string; validacao: string }> = []

  for (const item of pendentes) {
    const { data: assinatura } = await admin
      .from('assinaturas_aceite')
      .select('id, funcionario_id, validacao_pin')
      .eq('id', item.assinatura_id)
      .maybeSingle()

    if (!assinatura) {
      resultados.push({ assinatura_id: item.assinatura_id, validacao: 'nao_encontrada' })
      continue
    }

    // Já decidida antes: não reprocessa. A trilha é append-only, e revalidar
    // uma assinatura já julgada só criaria chance de mudar o veredito.
    if (assinatura.validacao_pin === 'validado_servidor' || assinatura.validacao_pin === 'invalida') {
      resultados.push({ assinatura_id: assinatura.id, validacao: assinatura.validacao_pin })
      continue
    }

    let pin: string
    try {
      pin = await decifrar(chavePrivada, item.pin_cifrado)
    } catch {
      await marcar(admin, assinatura.id, 'invalida')
      resultados.push({ assinatura_id: assinatura.id, validacao: 'invalida' })
      continue
    }

    const { data: confere } = await admin.rpc('fn_verificar_pin', {
      p_funcionario_id: assinatura.funcionario_id,
      p_pin: pin,
    })

    const veredito = confere ? 'validado_servidor' : 'invalida'
    await marcar(admin, assinatura.id, veredito)
    resultados.push({ assinatura_id: assinatura.id, validacao: veredito })
  }

  return responderJson({ resultados }, 200, origem)
})

async function marcar(
  admin: ReturnType<typeof clienteAdmin>,
  id: string,
  validacao: string,
): Promise<void> {
  await admin
    .from('assinaturas_aceite')
    .update({ validacao_pin: validacao, validado_em: new Date().toISOString() })
    .eq('id', id)
}

async function carregarChavePrivada(): Promise<CryptoKey> {
  const pkcs8 = Uint8Array.from(atob(exigirEnv('CHAVE_PRIVADA_ASSINATURA')), (c) => c.charCodeAt(0))
  return crypto.subtle.importKey('pkcs8', pkcs8, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, [
    'decrypt',
  ])
}

async function decifrar(chave: CryptoKey, cifradoBase64: string): Promise<string> {
  const cifrado = Uint8Array.from(atob(cifradoBase64), (c) => c.charCodeAt(0))
  const claro = await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, chave, cifrado)
  return new TextDecoder().decode(claro)
}
