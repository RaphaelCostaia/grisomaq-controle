import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'

export function exigirEnv(nome: string): string {
  const valor = Deno.env.get(nome)
  if (!valor) throw new Error('Variável de ambiente ausente: ' + nome)
  return valor
}

/** Cliente com service role: passa por fora da RLS. Nunca exposto ao navegador. */
export function clienteAdmin(): SupabaseClient {
  return createClient(exigirEnv('SUPABASE_URL'), exigirEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/** Cliente anônimo, usado só para trocar credencial por sessão. */
export function clienteAnonimo(): SupabaseClient {
  return createClient(exigirEnv('SUPABASE_URL'), exigirEnv('SUPABASE_ANON_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/**
 * E-mail sintético do funcionário de campo. Ninguém tem e-mail na frente de
 * colheita, mas o GoTrue precisa de um identificador — então ele é derivado do
 * código que já existe na ficha de papel. O domínio `.local` é reservado e
 * jamais roteável, para nenhuma mensagem sair por engano.
 */
export function emailDoFuncionario(codigo: string): string {
  return codigo + '@campo.grisomaq.local'
}

/**
 * Senha da conta do GoTrue, derivada do id do funcionário.
 *
 * Ela não é armazenada em lugar nenhum e o funcionário nunca a vê: só quem tem
 * o segredo no ambiente da função consegue recalculá-la. O que autentica o
 * operador é o PIN, conferido dentro do Postgres; esta senha é o mecanismo
 * interno de emitir a sessão.
 */
export async function senhaDerivada(funcionarioId: string): Promise<string> {
  const chave = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(exigirEnv('AUTH_DERIVACAO_SECRET')),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const assinatura = await crypto.subtle.sign('HMAC', chave, new TextEncoder().encode(funcionarioId))
  return base64Url(new Uint8Array(assinatura))
}

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Atraso constante para o tempo de resposta não denunciar se o código existe. */
export function esperar(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
