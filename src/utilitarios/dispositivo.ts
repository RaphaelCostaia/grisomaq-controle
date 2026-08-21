import { novoId } from './id'

const CHAVE_DISPOSITIVO = 'grisomaq.dispositivo_id'

/**
 * Identidade estavel do aparelho. Amarra a faixa de numeracao dos blocos de
 * abastecimento, a trilha de assinatura e o relatorio "dispositivos sem sync".
 * Fica em localStorage (e nao no IndexedDB) para sobreviver a uma limpeza de
 * base local e continuar reconhecendo o mesmo celular.
 */
export function idDoDispositivo(): string {
  let id = localStorage.getItem(CHAVE_DISPOSITIVO)
  if (!id) {
    id = novoId()
    localStorage.setItem(CHAVE_DISPOSITIVO, id)
  }
  return id
}

export const versaoDoApp: string = import.meta.env.VITE_APP_VERSAO ?? '0.0.0'

/** Rodando como PWA instalado (e nao como aba do navegador). */
export function estaInstalado(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // iOS Safari nao implementa display-mode: standalone no matchMedia antigo.
    (navigator as unknown as { standalone?: boolean }).standalone === true
  )
}

export function ehIOS(): boolean {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    // iPadOS 13+ se apresenta como Mac; o toque denuncia.
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  )
}

/**
 * Pede ao navegador para nao despejar o IndexedDB sob pressao de espaco.
 * Critico no iOS: sem isso, a base de um PWA nao instalado e apagada apos
 * 7 dias sem uso - junto com a fila de lancamentos ainda nao sincronizados.
 */
export async function pedirArmazenamentoPersistente(): Promise<boolean> {
  if (!navigator.storage?.persist) return false
  if (await navigator.storage.persisted()) return true
  return navigator.storage.persist()
}

/** Vibracao curta ao salvar, dupla longa em erro bloqueante. */
export function vibrar(tipo: 'ok' | 'erro'): void {
  if (!navigator.vibrate) return
  navigator.vibrate(tipo === 'ok' ? 25 : [90, 60, 90])
}

/** Mantem a tela acesa enquanto um formulario esta aberto. */
export async function manterTelaAcesa(): Promise<WakeLockSentinel | null> {
  try {
    return await navigator.wakeLock?.request('screen') ?? null
  } catch {
    // Bateria fraca ou aba em segundo plano: seguir sem trava de tela.
    return null
  }
}
