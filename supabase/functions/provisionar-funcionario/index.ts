import { clienteAdmin, emailDoFuncionario, senhaDerivada } from '../_compartilhado/cliente.ts'
import { preflight, responderErro, responderJson } from '../_compartilhado/cors.ts'

/**
 * Cria (ou recria) o acesso de um funcionário. Só o escritório chama.
 *
 * Devolve o PIN inicial UMA vez, em texto, para ser impresso e entregue em
 * mãos. Ele não fica recuperável depois: se o funcionário esquecer, o caminho é
 * gerar outro, não consultar o antigo.
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

  const { data: solicitante } = await admin
    .from('funcionarios')
    .select('papel')
    .eq('auth_user_id', usuario.user.id)
    .maybeSingle()

  if (solicitante?.papel !== 'admin') return responderErro('SEM_PERMISSAO', 403, origem)

  let corpo: { funcionario_id?: string }
  try {
    corpo = await req.json()
  } catch {
    return responderErro('CORPO_INVALIDO', 400, origem)
  }
  if (!corpo.funcionario_id) return responderErro('CORPO_INVALIDO', 400, origem)

  const { data: funcionario } = await admin
    .from('funcionarios')
    .select('id, codigo, nome, auth_user_id')
    .eq('id', corpo.funcionario_id)
    .maybeSingle()

  if (!funcionario) return responderErro('FUNCIONARIO_NAO_ENCONTRADO', 404, origem)

  const email = emailDoFuncionario(funcionario.codigo)
  const senha = await senhaDerivada(funcionario.id)

  let authUserId = funcionario.auth_user_id as string | null

  if (authUserId) {
    // Reprovisionamento: a senha derivada é a mesma, mas reafirmá-la conserta o
    // caso em que o segredo de derivação foi rotacionado.
    await admin.auth.admin.updateUserById(authUserId, { password: senha })
  } else {
    const { data: criado, error: erroCriacao } = await admin.auth.admin.createUser({
      email,
      password: senha,
      email_confirm: true,
      app_metadata: { origem: 'campo' },
    })
    if (erroCriacao || !criado.user) return responderErro('FALHA_CRIAR_USUARIO', 500, origem)
    authUserId = criado.user.id

    await admin.from('funcionarios').update({ auth_user_id: authUserId }).eq('id', funcionario.id)
  }

  const pinInicial = gerarPinAceitavel()

  const { error: erroPin } = await admin.rpc('fn_definir_pin', {
    p_funcionario_id: funcionario.id,
    p_pin: pinInicial,
    p_verificador_offline: null,
    p_exigir_troca: true,
  })
  if (erroPin) return responderErro('FALHA_DEFINIR_PIN', 500, origem)

  return responderJson(
    {
      funcionario: { id: funcionario.id, codigo: funcionario.codigo, nome: funcionario.nome },
      pin_inicial: pinInicial,
      aviso: 'Anote e entregue em mãos. Este PIN não poderá ser consultado depois.',
    },
    200,
    origem,
  )
})

/**
 * PIN aleatório que passa nas regras de `fn_pin_fraco`. Sortear até passar é o
 * caminho honesto: a lista de proibidos vive no banco e é a mesma que valida a
 * troca feita pelo funcionário — duplicá-la aqui deixaria as duas divergirem.
 */
function gerarPinAceitavel(): string {
  for (let tentativa = 0; tentativa < 50; tentativa++) {
    const bytes = new Uint32Array(1)
    crypto.getRandomValues(bytes)
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
