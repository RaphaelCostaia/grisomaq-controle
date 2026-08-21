/** Tentativas antes de escalar o item para "erro" e pedir ajuda ao escritorio. */
export const MAX_TENTATIVAS = 8

const BASE_MS = 5_000
const TETO_MS = 15 * 60_000

/**
 * Espera exponencial com jitter.
 *
 * O jitter nao e detalhe: quando o comboio volta para a sede, dez celulares
 * reencontram sinal no mesmo minuto. Sem a dispersao, os dez tentariam de novo
 * exatamente juntos, e cada rodada de falha os manteria sincronizados em
 * rebanho batendo no servidor ao mesmo tempo.
 */
export function proximaEspera(tentativas: number): number {
  const cheia = BASE_MS * 2 ** tentativas
  // O teto vem DEPOIS do jitter, senao ele nao e um teto: um jitter de ate
  // 1,25x aplicado sobre 15 min daria 18min45 de espera.
  return Math.min(Math.round(cheia * (0.75 + Math.random() * 0.5)), TETO_MS)
}

export function momentoDaProximaTentativa(tentativas: number): string {
  return new Date(Date.now() + proximaEspera(tentativas)).toISOString()
}
