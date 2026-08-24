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

/**
 * Formata para exibicao em pt-BR, com casas decimais fixas.
 *
 * Aceita texto porque NUMERIC do Postgres chega como string: o driver de
 * producao converte por type parser, mas o PGlite do ambiente de
 * desenvolvimento nao passa por ele. Recusar a string faria a tela mostrar "—"
 * num numero que existe — falha silenciosa, e que so aparece num ambiente.
 */
export function formatarNumero(valor: number | string | null | undefined, casas = 1): string {
  // `Number('')` e zero, e zero na tela e um numero ERRADO — pior que dizer
  // que o dado falta. Texto vazio e ausencia, nao valor.
  const n = typeof valor === 'string' ? (valor.trim() === '' ? null : Number(valor)) : valor
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  return n.toLocaleString('pt-BR', {
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  })
}

/** `1.234,5 L` — sem valor nao existe unidade: "— L" nao quer dizer nada. */
export function formatarLitros(valor: number | string | null | undefined): string {
  const texto = formatarNumero(valor, 1)
  return texto === '—' ? texto : texto + ' L'
}

/** Leitura de horimetro/odometro: sempre uma casa, sempre tabular. */
export function formatarLeitura(valor: number | string | null | undefined): string {
  return formatarNumero(valor, 1)
}

/** `31,1 h`, e so o travessao quando nao se sabe ha quanto tempo. */
export function formatarHoras(valor: number | string | null | undefined): string {
  const texto = formatarNumero(valor, 1)
  return texto === '—' ? texto : texto + ' h'
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

/**
 * Conta e substantivo concordando.
 *
 * O "(s)" resolve o problema de quem escreve, não o de quem lê — e numa tela
 * que o operador confere de relance, sob sol, cada palavra torta custa um
 * segundo de leitura.
 */
export function contar(quantidade: number, singular: string, plural: string): string {
  return quantidade + ' ' + (quantidade === 1 ? singular : plural)
}
