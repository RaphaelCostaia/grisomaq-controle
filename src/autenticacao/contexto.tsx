import { createContext, use, useEffect, useState, type ReactNode } from 'react'
import { CHAVES_META, lerMeta } from '@/dados/db'
import { iniciarMotorDeSync } from '@/dados/sincronizacao/motor'
import type { SessaoCampo } from './login'

interface ValorContexto {
  sessao: SessaoCampo | null
  carregando: boolean
  definirSessao: (s: SessaoCampo | null) => void
}

const Contexto = createContext<ValorContexto | null>(null)

export function ProvedorAutenticacao({ children }: { children: ReactNode }) {
  const [sessao, definirSessao] = useState<SessaoCampo | null>(null)
  const [carregando, setCarregando] = useState(true)

  useEffect(() => {
    // A sessão de campo vive no Dexie, independente do JWT: se o token expirar
    // depois de dias offline, o app continua funcionando e só o envio espera.
    void lerMeta<SessaoCampo>(CHAVES_META.sessaoCampo).then((s) => {
      definirSessao(s ?? null)
      setCarregando(false)
    })
  }, [])

  useEffect(() => {
    if (!sessao) return
    return iniciarMotorDeSync()
  }, [sessao])

  return <Contexto value={{ sessao, carregando, definirSessao }}>{children}</Contexto>
}

export function useAutenticacao(): ValorContexto {
  const valor = use(Contexto)
  if (!valor) throw new Error('useAutenticacao precisa estar dentro de ProvedorAutenticacao')
  return valor
}

/** Sessão garantida — para telas que só existem depois do login. */
export function useSessao(): SessaoCampo {
  const { sessao } = useAutenticacao()
  if (!sessao) throw new Error('Tela de campo aberta sem sessão')
  return sessao
}
