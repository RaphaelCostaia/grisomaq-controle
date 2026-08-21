import { supabase, supabaseConfigurado } from '@/dados/supabase'
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

interface RespostaLoginCampo {
  access_token: string
  refresh_token: string
  funcionario: SessaoCampo
}

/**
 * Entrada de campo. O PIN nunca e conferido no cliente: vai para a Edge Function
 * `login-campo`, que compara o hash dentro do Postgres e devolve uma sessao
 * Supabase de verdade. Dai em diante o refresh e automatico e o app sobrevive
 * dias offline sem pedir o PIN outra vez.
 */
export async function entrarComCodigoEPin(codigo: string, pin: string): Promise<ResultadoLogin> {
  if (!supabaseConfigurado) {
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
      mensagem: 'Sem sinal para entrar. Procure um ponto com internet — depois da primeira entrada o app funciona offline.',
    }
  }

  try {
    const { data, error } = await supabase.functions.invoke<RespostaLoginCampo>('login-campo', {
      body: { codigo, pin, dispositivo_id: idDoDispositivo(), app_versao: versaoDoApp },
    })

    if (error || !data) return traduzirErro(error)

    await supabase.auth.setSession({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
    })

    await gravarMeta(CHAVES_META.sessaoCampo, data.funcionario)
    // A partir daqui existe fila local a proteger: pedir persistencia ao navegador.
    await pedirArmazenamentoPersistente()

    return { ok: true, sessao: data.funcionario }
  } catch {
    return {
      ok: false,
      codigoErro: 'FALHA_REDE',
      mensagem: 'Não foi possível falar com o servidor. Tente de novo em um ponto com sinal melhor.',
    }
  }
}

/**
 * Mensagens em portugues do dia a dia, sem jargao de sistema.
 * Codigo e PIN errados dao a MESMA resposta: dizer qual dos dois errou
 * entregaria a lista de codigos validos a quem estivesse tentando adivinhar.
 */
function traduzirErro(error: unknown): ResultadoLogin {
  const bruto = error instanceof Error ? error.message : String(error ?? '')

  if (bruto.includes('BLOQUEADO')) {
    return {
      ok: false,
      codigoErro: 'BLOQUEADO',
      mensagem: 'Muitas tentativas. Espere 15 minutos ou peça ao escritório para liberar.',
    }
  }
  if (bruto.includes('INATIVO')) {
    return {
      ok: false,
      codigoErro: 'INATIVO',
      mensagem: 'Este código está inativo. Procure o escritório.',
    }
  }
  return { ok: false, codigoErro: 'CREDENCIAL', mensagem: 'Código ou PIN inválido.' }
}

export async function sair(): Promise<void> {
  await supabase.auth.signOut()
}
