import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const chaveAnon = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabaseConfigurado = Boolean(url && chaveAnon)

/**
 * Cliente unico. So o motor de sincronizacao e a autenticacao falam com ele -
 * nenhuma tela importa este modulo, porque toda tela le do Dexie.
 *
 * `persistSession` em localStorage (e nao no IndexedDB) para a sessao sobreviver
 * a uma limpeza da base local; `autoRefreshToken` cuida da renovacao quando o
 * sinal volta.
 */
export const supabase = createClient(url ?? 'http://localhost:54321', chaveAnon ?? 'anon-ausente', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    flowType: 'pkce',
    storage: window.localStorage,
    storageKey: 'grisomaq.sessao',
  },
  global: {
    headers: { 'x-app-versao': import.meta.env.VITE_APP_VERSAO ?? '0.0.0' },
  },
})
