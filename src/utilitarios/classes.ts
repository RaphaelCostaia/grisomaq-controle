/** Junta classes ignorando falsos. Suficiente para o tamanho deste app. */
export function cls(...partes: Array<string | false | null | undefined>): string {
  return partes.filter(Boolean).join(' ')
}
