import { clienteAdmin, esperar } from '../_compartilhado/cliente.ts'
import { preflight, responderErro, responderJson } from '../_compartilhado/cors.ts'

/**
 * Troca do PIN pelo próprio funcionário. Exige o PIN atual mesmo já havendo
 * sessão: o celular fica largado no comboio, e sessão aberta não deve bastar
 * para trocar a credencial que vale como assinatura de outra pessoa.
 */
Deno.serve(async (req) => {
  const origem = req.headers.get('origin')
  const respostaPreflight = preflight(req)
  if (respostaPreflight) return respostaPreflight
  if (req.method !== 'POST') return responderErro('METODO_INVALIDO', 405, origem)

  const autorizacao = req.headers.get('Authorization')
  if (!autorizacao) return responderErro('SEM_SESSAO', 401, origem)

  let corpo: { pin_atual?: string; pin_novo?: string; verificador_offline?: unknown }
  try {
    corpo = await req.json()
  } catch {
    return responderErro('CORPO_INVALIDO', 400, origem)
  }

  const pinAtual = String(corpo.pin_atual ?? '')
  const pinNovo = String(corpo.pin_novo ?? '')

  if (!/^[0-9]{4}$/.test(pinNovo)) return responderErro('PIN_FORMATO', 400, origem)
  if (pinAtual === pinNovo) return responderErro('PIN_REPETIDO', 400, origem)

  const admin = clienteAdmin()

  const { data: usuario, error: erroUsuario } = await admin.auth.getUser(
    autorizacao.replace('Bearer ', ''),
  )
  if (erroUsuario || !usuario.user) return responderErro('SEM_SESSAO', 401, origem)

  const { data: funcionario, error: erroFunc } = await admin
    .from('funcionarios')
    .select('id, pin_trocar_no_proximo_acesso')
    .eq('auth_user_id', usuario.user.id)
    .maybeSingle()

  if (erroFunc || !funcionario) return responderErro('FUNCIONARIO_NAO_ENCONTRADO', 403, origem)

  const { data: confere } = await admin.rpc('fn_verificar_pin', {
    p_funcionario_id: funcionario.id,
    p_pin: pinAtual,
  })

  if (!confere) {
    await admin.rpc('fn_registrar_falha_pin', { p_funcionario_id: funcionario.id })
    await esperar(400)
    return responderErro('CREDENCIAL', 401, origem)
  }

  const { error: erroDefinir } = await admin.rpc('fn_definir_pin', {
    p_funcionario_id: funcionario.id,
    p_pin: pinNovo,
    p_verificador_offline: corpo.verificador_offline ?? null,
    p_exigir_troca: false,
  })

  // fn_definir_pin recusa PIN previsível (repetição, sequência, ano de
  // nascimento). O motivo volta para a tela poder explicar o que fazer.
  if (erroDefinir) {
    const fraco = erroDefinir.message?.includes('PIN_FRACO')
    return responderErro(fraco ? 'PIN_FRACO' : 'FALHA_INTERNA', fraco ? 400 : 500, origem)
  }

  return responderJson({ ok: true }, 200, origem)
})
