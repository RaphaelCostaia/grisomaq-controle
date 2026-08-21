import { useSyncExternalStore } from 'react'

export type SituacaoSync = 'ocioso' | 'sincronizando' | 'sem_sinal' | 'erro'

export interface EstadoSync {
  situacao: SituacaoSync
  pendentes: number
  conflitos: number
  ultimoSyncOk: string | null
  /** Diferenca entre o relogio deste celular e o do servidor, em ms. */
  desvioRelogioMs: number | null
  ultimoErro: string | null
}

let estado: EstadoSync = {
  situacao: navigator.onLine ? 'ocioso' : 'sem_sinal',
  pendentes: 0,
  conflitos: 0,
  ultimoSyncOk: null,
  desvioRelogioMs: null,
  ultimoErro: null,
}

const ouvintes = new Set<() => void>()

export function atualizarEstadoSync(parcial: Partial<EstadoSync>): void {
  estado = { ...estado, ...parcial }
  for (const ouvinte of ouvintes) ouvinte()
}

export function lerEstadoSync(): EstadoSync {
  return estado
}

function assinar(ouvinte: () => void): () => void {
  ouvintes.add(ouvinte)
  return () => ouvintes.delete(ouvinte)
}

/** A barra de status da tela le daqui. */
export function useEstadoSync(): EstadoSync {
  return useSyncExternalStore(assinar, lerEstadoSync, lerEstadoSync)
}
