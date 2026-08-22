import { apiConfigurada, chamar, ErroApi, gravarSessao, limparSessao, lerSessao } from '@/dados/api'
import { CHAVES_META, gravarMeta } from '@/dados/db'
import { idDoDispositivo, pedirArmazenamentoPersistente, versaoDoApp } from '@/utilitarios/dispositivo'
import type { PapelUsuario } from '@/dominio/tipos'

export interface SessaoCampo {
  funcionario_id: string
  codigo: string
  nome: string
  papel: PapelUsuario
  frente_padrao_id: string | null
  trocar_pin: boolean
}

export type ResultadoLogin =
  | { ok: true; sessao: SessaoCampo }
  | { ok: false; mensagem: string; codigoErro: string }

interface RespostaLogin {
  access_token: string
  refresh_token: string
  expira_em_segundos: number
  funcionario: SessaoCampo
}

/**
 * Entrada de campo. O PIN nunca é conferido no cliente: vai para a API, que
 * compara o hash dentro do Postgres e devolve uma sessão. Dai em diante a
 * renovação é automática e o app sobrevive dias offline sem pedir o PIN de novo.
 */
export async function entrarComCodigoEPin(codigo: string, pin: string): Promise<ResultadoLogin> {
  if (!apiConfigurada) {
    return {
      ok: false,
      codigoErro: 'NAO_CONFIGURADO',
      mensagem: 'Este aparelho ainda não foi configurado. Procure o escritório.',
    }
  }

  if (!navigator.onLine) {
    return {
      ok: false,
      codigoErro: 'SEM_SINAL',
      mensagem:
        'Sem sinal para entrar. Procure um ponto com internet — depois da primeira entrada o app funciona offline.',
    }
  }

  try {
    const dados = await chamar<RespostaLogin>('/auth/login-campo', {
      autenticada: false,
      corpo: {
        codigo,
        pin,
        dispositivo_id: idDoDispositivo(),
        app_versao: versaoDoApp,
      },
    })

    gravarSessao(dados)
    await gravarMeta(CHAVES_META.sessaoCampo, dados.funcionario)
    // A partir daqui existe fila local a proteger: pedir persistência ao navegador.
    await pedirArmazenamentoPersistente()

    return { ok: true, sessao: dados.funcionario }
  } catch (erro) {
    return traduzirErro(erro)
  }
}

/**
 * Mensagens em português do dia a dia, sem jargão de sistema.
 *
 * Código e PIN errados dão a MESMA resposta, porque o servidor também não
 * distingue os dois: dizer qual dos dois falhou entregaria a lista de códigos
 * válidos a quem estivesse tentando adivinhar.
 */
function traduzirErro(erro: unknown): ResultadoLogin {
  const codigo = erro instanceof ErroApi ? erro.codigo : 'FALHA_REDE'

  switch (codigo) {
    case 'BLOQUEADO':
      return {
        ok: false,
        codigoErro: codigo,
        mensagem: 'Muitas tentativas. Espere 15 minutos ou peça ao escritório para liberar.',
      }
    case 'INATIVO':
      return { ok: false, codigoErro: codigo, mensagem: 'Este código está inativo. Procure o escritório.' }
    case 'NAO_PROVISIONADO':
      return {
        ok: false,
        codigoErro: codigo,
        mensagem: 'Este código ainda não tem PIN. Peça ao escritório para liberar seu acesso.',
      }
    case 'CREDENCIAL':
      return { ok: false, codigoErro: codigo, mensagem: 'Código ou PIN inválido.' }
    default:
      return {
        ok: false,
        codigoErro: codigo,
        mensagem: 'Não foi possível falar com o servidor. Tente de novo num ponto com sinal melhor.',
      }
  }
}

export async function trocarPin(
  pinAtual: string,
  pinNovo: string,
): Promise<{ ok: true } | { ok: false; codigoErro: string; mensagem: string }> {
  try {
    const dados = await chamar<{ ok: boolean; access_token: string; refresh_token: string; expira_em_segundos: number }>(
      '/auth/trocar-pin',
      { corpo: { pin_atual: pinAtual, pin_novo: pinNovo } },
    )
    // A troca encerra as outras sessões, então a resposta traz uma nova.
    gravarSessao(dados)
    return { ok: true }
  } catch (erro) {
    const codigo = erro instanceof ErroApi ? erro.codigo : 'FALHA_REDE'
    if (codigo === 'PIN_FRACO') {
      return {
        ok: false,
        codigoErro: codigo,
        mensagem: 'Escolha outro PIN: evite números repetidos, sequências e ano de nascimento.',
      }
    }
    if (codigo === 'CREDENCIAL') {
      return { ok: false, codigoErro: codigo, mensagem: 'PIN atual incorreto.' }
    }
    return { ok: false, codigoErro: codigo, mensagem: 'Não foi possível trocar o PIN agora.' }
  }
}

export async function sair(): Promise<void> {
  const sessao = lerSessao()
  if (sessao?.refresh_token) {
    // Avisar o servidor é o que revoga a sessão de verdade; falhar aqui (sem
    // sinal) não pode impedir o operador de sair do app.
    await chamar('/auth/sair', {
      autenticada: false,
      corpo: { refresh_token: sessao.refresh_token },
    }).catch(() => {})
  }
  limparSessao()
}
