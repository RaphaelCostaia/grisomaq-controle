/**
 * Leituras de campo sao digitadas com virgula decimal (o operador escreve
 * "12345,7" porque e assim que esta no painel). Toda entrada passa por aqui.
 */
export function paraNumero(texto: string | number | null | undefined): number | null {
  if (texto === null || texto === undefined || texto === '') return null
  if (typeof texto === 'number') return Number.isFinite(texto) ? texto : null
  const limpo = texto.trim().replace(/\./g, '').replace(',', '.')
  const n = Number(limpo)
  return Number.isFinite(n) ? n : null
}

/** Formata para exibicao em pt-BR, com casas decimais fixas. */
export function formatarNumero(valor: number | null | undefined, casas = 1): string {
  if (valor === null || valor === undefined || !Number.isFinite(valor)) return '—'
  return valor.toLocaleString('pt-BR', {
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  })
}

/** `1.234,5 L` */
export function formatarLitros(valor: number | null | undefined): string {
  return valor === null || valor === undefined ? '—' : `${formatarNumero(valor, 1)} L`
}

/** Leitura de horimetro/odometro: sempre uma casa, sempre tabular. */
export function formatarLeitura(valor: number | null | undefined): string {
  return formatarNumero(valor, 1)
}

/**
 * Comparacao de valores monetarios/volumetricos com tolerancia.
 * Usada na conferencia "litros x registrador da bomba", onde arredondamento
 * de display nao pode virar divergencia.
 */
export function praticamenteIguais(a: number, b: number, toleranciaAbs = 0.5, toleranciaPct = 0.005): boolean {
  const diferenca = Math.abs(a - b)
  return diferenca <= Math.max(toleranciaAbs, Math.abs(b) * toleranciaPct)
}
