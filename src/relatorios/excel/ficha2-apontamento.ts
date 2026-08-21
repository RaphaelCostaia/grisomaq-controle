import type { Workbook, Worksheet } from 'exceljs'
import type { CabecalhoApontamento, LinhaApontamento, OpcoesRelatorio } from '../tipos'
import {
  CINZA_SEQ,
  VERDE_CABECALHO,
  VERDE_ESCURO,
  bordaFina,
  centralizado,
  contornar,
  fonteCabecalho,
  fonteTitulo,
  preenchimento,
  rodapeEletronico,
} from './estilos'
import { dataBr } from '@/utilitarios/datas'

const COLUNAS = 9
const LINHAS_POR_PAGINA = 25
const LINHA_CABECALHO_GRADE = 4
const LINHA_INICIAL_DADOS = 5

const LARGURAS = [8, 12, 20, 18, 15, 15, 15, 15, 20]

const TITULOS_GRADE = [
  'Seq.',
  'Cód. Func.',
  'Funcionário',
  'Frota',
  'Odom. Inicial',
  'Elevador Inicial',
  'Odom. Final',
  'Elevador Final',
  'Assinatura do Funcionário',
]

/**
 * Reproduz `FICHA_APONTAMENTO.xlsx`, inclusive as 25 linhas numeradas.
 *
 * A grade sai sempre com 25 linhas mesmo que o turno tenha tido oito pessoas:
 * é assim que a via de papel é, e é assim que o escritório confere. As linhas
 * excedentes ficam vazias, prontas para anotação a caneta se alguém precisar.
 */
export function montarFichaApontamento(
  wb: Workbook,
  cabecalho: CabecalhoApontamento,
  linhas: LinhaApontamento[],
  opcoes: OpcoesRelatorio,
): Worksheet {
  const ws = wb.addWorksheet('Apontamento', {
    pageSetup: { orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  })

  LARGURAS.forEach((largura, indice) => {
    ws.getColumn(indice + 1).width = largura
  })

  // Título
  ws.mergeCells(1, 1, 1, COLUNAS)
  const titulo = ws.getCell(1, 1)
  titulo.value = 'FICHA DE APONTAMENTO E ASSINATURA'
  titulo.font = fonteTitulo(14)
  titulo.fill = preenchimento(VERDE_ESCURO)
  titulo.alignment = centralizado
  ws.getRow(1).height = 25

  // Cabeçalho do documento: rótulo verde à esquerda, valor ao lado.
  campo(ws, 2, 1, 'Data', dataBr(cabecalho.data), 2, 3)
  campo(ws, 2, 4, 'Frente', cabecalho.frente, 5, 6)
  campo(ws, 2, 7, 'Turno', cabecalho.turno, 8, 9)
  campo(ws, 3, 1, 'Responsável', cabecalho.responsavel, 2, 3)
  campo(ws, 3, 4, 'Observação', cabecalho.observacao ?? '', 5, 9)
  ws.getRow(2).height = 18
  ws.getRow(3).height = 18

  // Cabeçalho da grade
  TITULOS_GRADE.forEach((rotulo, indice) => {
    const celula = ws.getCell(LINHA_CABECALHO_GRADE, indice + 1)
    celula.value = rotulo
    celula.font = fonteCabecalho()
    celula.fill = preenchimento(VERDE_CABECALHO)
    celula.alignment = { ...centralizado, wrapText: true }
    celula.border = bordaFina
  })
  ws.getRow(LINHA_CABECALHO_GRADE).height = 25

  for (let i = 0; i < LINHAS_POR_PAGINA; i++) {
    const l = LINHA_INICIAL_DADOS + i
    const linha = linhas[i]
    ws.getRow(l).height = 20

    const seq = ws.getCell(l, 1)
    seq.value = i + 1
    seq.font = { bold: true, color: { argb: VERDE_ESCURO } }
    seq.fill = preenchimento(CINZA_SEQ)
    seq.alignment = centralizado

    if (linha) {
      ws.getCell(l, 2).value = linha.funcionario_codigo
      ws.getCell(l, 3).value = linha.funcionario_nome
      ws.getCell(l, 4).value = linha.frota_numero
      ws.getCell(l, 5).value = linha.odometro_inicial
      ws.getCell(l, 6).value = linha.elevador_inicial
      ws.getCell(l, 7).value = linha.odometro_final
      ws.getCell(l, 8).value = linha.elevador_final
      ws.getCell(l, 9).value = linha.assinatura

      for (const coluna of [5, 6, 7, 8]) {
        ws.getCell(l, coluna).numFmt = '#,##0.0'
        ws.getCell(l, coluna).alignment = { horizontal: 'right', vertical: 'middle' }
      }
      ws.getCell(l, 2).alignment = centralizado
      ws.getCell(l, 4).alignment = centralizado
      // A assinatura eletrônica é longa; sem fonte menor ela estoura a coluna.
      ws.getCell(l, 9).font = { size: 8 }
      ws.getCell(l, 9).alignment = { horizontal: 'left', vertical: 'middle', wrapText: true }
    }
  }

  const ultimaLinha = LINHA_INICIAL_DADOS + LINHAS_POR_PAGINA - 1
  contornar(ws, LINHA_CABECALHO_GRADE, ultimaLinha, COLUNAS)

  // Totais do turno, que no papel ninguém somava.
  const linhaTotal = ultimaLinha + 2
  const horas = linhas.reduce(
    (s, l) => s + (l.elevador_final !== null && l.elevador_inicial !== null ? l.elevador_final - l.elevador_inicial : 0),
    0,
  )
  const km = linhas.reduce(
    (s, l) => s + (l.odometro_final !== null && l.odometro_inicial !== null ? l.odometro_final - l.odometro_inicial : 0),
    0,
  )

  ws.getCell(linhaTotal, 1).value = 'Funcionários: ' + linhas.length
  ws.getCell(linhaTotal, 1).font = { bold: true, size: 10 }
  ws.getCell(linhaTotal, 5).value = 'Total de horas de elevador:'
  ws.getCell(linhaTotal, 5).font = { bold: true, size: 10 }
  ws.getCell(linhaTotal, 7).value = horas
  ws.getCell(linhaTotal, 7).numFmt = '#,##0.0'
  ws.getCell(linhaTotal, 7).font = { bold: true, size: 10 }
  if (km > 0) {
    ws.getCell(linhaTotal + 1, 5).value = 'Total de quilômetros:'
    ws.getCell(linhaTotal + 1, 5).font = { bold: true, size: 10 }
    ws.getCell(linhaTotal + 1, 7).value = km
    ws.getCell(linhaTotal + 1, 7).numFmt = '#,##0.0'
    ws.getCell(linhaTotal + 1, 7).font = { bold: true, size: 10 }
  }

  rodapeEletronico(ws, linhaTotal + 3, COLUNAS, opcoes.versaoApp)
  return ws
}

/** Rótulo verde do cabeçalho, com o valor numa faixa mesclada ao lado. */
function campo(
  ws: Worksheet,
  linha: number,
  colunaRotulo: number,
  rotulo: string,
  valor: string,
  colunaValorInicial: number,
  colunaValorFinal: number,
): void {
  const celulaRotulo = ws.getCell(linha, colunaRotulo)
  celulaRotulo.value = rotulo
  celulaRotulo.font = fonteCabecalho(11)
  celulaRotulo.fill = preenchimento(VERDE_CABECALHO)
  celulaRotulo.alignment = centralizado
  celulaRotulo.border = bordaFina

  ws.mergeCells(linha, colunaValorInicial, linha, colunaValorFinal)
  const celulaValor = ws.getCell(linha, colunaValorInicial)
  celulaValor.value = valor
  celulaValor.alignment = { horizontal: 'left', vertical: 'middle' }
  celulaValor.border = bordaFina
}
