import type { Borders, Fill, Font, Worksheet } from 'exceljs'

/**
 * Estilos copiados das planilhas originais da GrisoMaq.
 *
 * A fidelidade não é capricho: o escritório confere o relatório ao lado da via
 * de papel, e uma coluna fora de ordem ou um cabeçalho diferente obriga a
 * reaprender a leitura de um documento que já é lido há anos.
 */

export const VERDE_ESCURO = 'FF1F362C'
export const VERDE_CABECALHO = 'FF648838'
export const CINZA_SEQ = 'FFF5F5F5'
export const CARMIM = 'FFC8102E'

export const fonteTitulo = (tamanho: number, branco = true): Partial<Font> => ({
  bold: true,
  size: tamanho,
  ...(branco ? { color: { argb: 'FFFFFFFF' } } : {}),
})

export const fonteCabecalho = (tamanho = 10): Partial<Font> => ({
  bold: true,
  size: tamanho,
  color: { argb: 'FFFFFFFF' },
})

export const preenchimento = (argb: string): Fill => ({
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb },
})

export const bordaFina: Partial<Borders> = {
  top: { style: 'thin' },
  left: { style: 'thin' },
  bottom: { style: 'thin' },
  right: { style: 'thin' },
}

export const centralizado = { horizontal: 'center', vertical: 'middle' } as const

/** Aplica borda a um retângulo inteiro, inclusive nas células vazias da grade. */
export function contornar(ws: Worksheet, linhaInicial: number, linhaFinal: number, colunas: number): void {
  for (let l = linhaInicial; l <= linhaFinal; l++) {
    for (let c = 1; c <= colunas; c++) {
      ws.getCell(l, c).border = bordaFina
    }
  }
}

/**
 * Rodapé de documento eletrônico. Substitui a via de carbono: quem recebe
 * precisa saber que aquilo saiu de um sistema, quando, e de qual versão.
 */
export function rodapeEletronico(ws: Worksheet, linha: number, colunas: number, versaoApp: string): void {
  ws.mergeCells(linha, 1, linha, colunas)
  const celula = ws.getCell(linha, 1)
  celula.value =
    'Documento gerado eletronicamente pelo GRISOMAQ CONTROLE v' + versaoApp +
    ' em ' + new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) +
    '. As assinaturas foram registradas por PIN, com trilha de auditoria no sistema.'
  celula.font = { size: 8, italic: true, color: { argb: 'FF56605A' } }
  celula.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true }
  ws.getRow(linha).height = 24
}
