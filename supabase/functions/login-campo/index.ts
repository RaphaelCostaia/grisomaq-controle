import { clienteAdmin, clienteAnonimo, emailDoFuncionario, esperar, senhaDerivada } from '../_compartilhado/cliente.ts'
import { preflight, responderErro, responderJson } from '../_compartilhado/cors.ts'

/**
 * Entrada de campo: código do funcionário + PIN de 4 dígitos.
 *
 * O PIN nunca é comparado aqui. Ele vai para `fn_verificar_pin`, que faz a
 * conferência dentro do Postgres e devolve apenas verdadeiro ou falso — o hash
 * não sai do banco, então nem um log desta função nem uma resposta interceptada
 * entregam material para ataque offline.
 */
Deno.serve(async (req) => {
  const origem = req.headers.get('origin')
  const respostaPreflight = preflight(req)
  if (respostaPreflight) return respostaPreflight

  if (req.method !== 'POST') return responderErro('METODO_INVALIDO', 405, origem)

  let corpo: { codigo?: string; pin?: string; dispositivo_id?: string; app_versao?: string }
  try {
    corpo = await req.json()
  } catch {
    return responderErro('CORPO_INVALIDO', 400, origem)
  }

  const codigo = String(corpo.codigo ?? '').trim()
  const pin = String(corpo.pin ?? '')

  if (!/^[0-9]{1,8}$/.test(codigo) || !/^[0-9]{4}$/.test(pin)) {
    await esperar(400)
    return responderErro('CREDENCIAL', 401, origem)
  }

  const admin = clienteAdmin()

  const { data: encontrados, error: erroBusca } = await admin.rpc('fn_funcionario_para_login', {
    p_codigo: codigo,
  })
  if (erroBusca) return responderErro('FALHA_INTERNA', 500, origem)

  const funcionario = Array.isArray(encontrados) ? encontrados[0] : null

  // Código inexistente responde igual a PIN errado, e com o mesmo atraso:
  // distinguir os dois entregaria a lista de códigos válidos a quem estivesse
  // tentando adivinhar.
  if (!funcionario) {
    await esperar(400)
    return responderErro('CREDENCIAL', 401, origem)
  }

  if (!funcionario.ativo) return responderErro('INATIVO', 403, origem)

  if (funcionario.bloqueado_ate && new Date(funcionario.bloqueado_ate) > new Date()) {
    return responderErro('BLOQUEADO', 429, origem)
  }

  if (!funcionario.pin_definido || !funcionario.auth_user_id) {
    return responderErro('NAO_PROVISIONADO', 403, origem)
  }

  const { data: pinConfere, error: erroPin } = await admin.rpc('fn_verificar_pin', {
    p_funcionario_id: funcionario.id,
    p_pin: pin,
  })
  if (erroPin) return responderErro('FALHA_INTERNA', 500, origem)

  if (!pinConfere) {
    // O contador de tentativas vive no servidor. Bloqueio guardado no celular
    // se resolve reinstalando o app.
    await admin.rpc('fn_registrar_falha_pin', { p_funcionario_id: funcionario.id })
    await esperar(400)
    return responderErro('CREDENCIAL', 401, origem)
  }

  await admin.rpc('fn_zerar_falhas_pin', { p_funcionario_id: funcionario.id })

  const { data: sessao, error: erroSessao } = await clienteAnonimo().auth.signInWithPassword({
    email: emailDoFuncionario(funcionario.codigo),
    password: await senhaDerivada(funcionario.id),
  })

  if (erroSessao || !sessao.session) return responderErro('FALHA_SESSAO', 500, origem)

  if (corpo.dispositivo_id) {
    await admin.from('dispositivos').upsert(
      {
        id: corpo.dispositivo_id,
        funcionario_id: funcionario.id,
        app_versao: corpo.app_versao ?? null,
        user_agent: req.headers.get('user-agent'),
      },
      { onConflict: 'id' },
    )
  }

  return responderJson(
    {
      access_token: sessao.session.access_token,
      refresh_token: sessao.session.refresh_token,
      expires_at: sessao.session.expires_at,
      funcionario: {
        funcionario_id: funcionario.id,
        codigo: funcionario.codigo,
        nome: funcionario.nome,
        papel: funcionario.papel,
        frente_padrao_id: funcionario.frente_padrao_id,
        trocar_pin: funcionario.pin_trocar,
      },
    },
    200,
    origem,
  )
})
