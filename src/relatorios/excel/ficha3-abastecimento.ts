import type { Workbook, Worksheet } from 'exceljs'
import type { LinhaAbastecimento, OpcoesRelatorio } from '../tipos'
import {
  CARMIM,
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

const LINHA_CABECALHO = 3
const LINHA_INICIAL_DADOS = 4

/**
 * Reproduz o `CONTROLE DIÁRIO DE ABASTECIMENTO`, que nunca teve versão digital.
 *
 * As colunas seguem a ordem física do bloco carbonado — é a ordem em que o
 * abastecedor lê os mostradores, e mudá-la obrigaria a reaprender um documento
 * que já é lido há anos. O número do documento vai em carmim, como vem impresso
 * na via.
 *
 * A única coluna que o papel não tinha é a divergência entre os litros
 * informados e o registrador da bomba. Ela existe porque é o que o papel nunca
 * conferiu: no fechamento do mês, um lançamento esquecido não aparecia.
 */
const COLUNAS: Array<{ rotulo: string; largura: number }> = [
  { rotulo: 'Nº FICHA', largura: 11 },
  { rotulo: 'HORA', largura: 8 },
  { rotulo: 'DATA', largura: 12 },
  { rotulo: 'FROTA', largura: 10 },
  { rotulo: 'HORÍMETRO MOTOR', largura: 14 },
  { rotulo: 'HORÍMETRO ELEVADOR', largura: 14 },
  { rotulo: 'HODÔMETRO', largura: 13 },
  { rotulo: 'INÍCIO REG.', largura: 13 },
  { rotulo: 'FINAL REG.', largura: 13 },
  { rotulo: 'LITROS', largura: 11 },
  { rotulo: 'DIFERENÇA', largura: 11 },
  { rotulo: 'ASSINATURA', largura: 30 },
]

export function montarFichaAbastecimento(
  wb: Workbook,
  linhas: LinhaAbastecimento[],
  opcoes: OpcoesRelatorio,
): Worksheet {
  const ws = wb.addWorksheet('Abastecimento', {
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  })

  COLUNAS.forEach((coluna, indice) => {
    ws.getColumn(indice + 1).width = coluna.largura
  })

  ws.mergeCells(1, 1, 1, COLUNAS.length)
  const titulo = ws.getCell(1, 1)
  titulo.value = 'CONTROLE DIÁRIO DE ABASTECIMENTO'
  titulo.font = fonteTitulo(16)
  titulo.fill = preenchimento(VERDE_ESCURO)
  titulo.alignment = centralizado
  ws.getRow(1).height = 26

  if (opcoes.periodo) {
    ws.mergeCells(2, 1, 2, COLUNAS.length)
    const periodo = ws.getCell(2, 1)
    periodo.value = 'Período: ' + opcoes.periodo
    periodo.font = { bold: true, size: 10 }
    periodo.alignment = { horizontal: 'left', vertical: 'middle' }
    ws.getRow(2).height = 18
  }

  COLUNAS.forEach((coluna, indice) => {
    const celula = ws.getCell(LINHA_CABECALHO, indice + 1)
    celula.value = coluna.rotulo
    celula.font = fonteCabecalho()
    celula.fill = preenchimento(VERDE_CABECALHO)
    celula.alignment = { ...centralizado, wrapText: true }
    celula.border = bordaFina
  })
  ws.getRow(LINHA_CABECALHO).height = 28

  linhas.forEach((linha, indice) => {
    const l = LINHA_INICIAL_DADOS + indice
    ws.getRow(l).height = 18

    const numero = ws.getCell(l, 1)
    numero.value = linha.numero_documento
    numero.font = { bold: true, color: { argb: CARMIM } }
    numero.alignment = centralizado

    ws.getCell(l, 2).value = linha.hora
    ws.getCell(l, 3).value = dataBr(linha.data)
    ws.getCell(l, 4).value = linha.frota_numero
    ws.getCell(l, 5).value = linha.horimetro_motor
    ws.getCell(l, 6).value = linha.horimetro_elevador
    ws.getCell(l, 7).value = linha.odometro
    ws.getCell(l, 8).value = linha.registrador_inicio
    ws.getCell(l, 9).value = linha.registrador_fim
    ws.getCell(l, 10).value = linha.litros
    ws.getCell(l, 11).value = linha.divergencia
    ws.getCell(l, 12).value = linha.assinatura

    for (const coluna of [2, 3, 4]) ws.getCell(l, coluna).alignment = centralizado
    for (const coluna of [5, 6, 7, 8, 9, 10, 11]) {
      ws.getCell(l, coluna).numFmt = '#,##0.0'
      ws.getCell(l, coluna).alignment = { horizontal: 'right', vertical: 'middle' }
    }

    // Divergência é o assunto desta planilha: quando existe, ela precisa saltar
    // aos olhos de quem confere, não ficar mais um número numa coluna.
    if (Math.abs(linha.divergencia) > 0.5) {
      const celula = ws.getCell(l, 11)
      celula.font = { bold: true, color: { argb: CARMIM } }
      celula.fill = preenchimento('FFFDF0F2')
    }

    ws.getCell(l, 12).font = { size: 8 }
    ws.getCell(l, 12).alignment = { horizontal: 'left', vertical: 'middle', wrapText: true }
  })

  const ultimaLinha = LINHA_INICIAL_DADOS + Math.max(linhas.length, 1) - 1
  contornar(ws, LINHA_CABECALHO, ultimaLinha, COLUNAS.length)

  const linhaTotal = ultimaLinha + 2
  const totalLitros = linhas.reduce((s, l) => s + l.litros, 0)
  const divergentes = linhas.filter((l) => Math.abs(l.divergencia) > 0.5)

  ws.getCell(linhaTotal, 1).value = 'Fichas: ' + linhas.length
  ws.getCell(linhaTotal, 1).font = { bold: true, size: 10 }
  ws.getCell(linhaTotal, 9).value = 'Total de litros:'
  ws.getCell(linhaTotal, 9).font = { bold: true, size: 10 }
  ws.getCell(linhaTotal, 10).value = totalLitros
  ws.getCell(linhaTotal, 10).numFmt = '#,##0.0'
  ws.getCell(linhaTotal, 10).font = { bold: true, size: 10 }

  if (divergentes.length > 0) {
    const celula = ws.getCell(linhaTotal + 1, 1)
    celula.value =
      divergentes.length === 1
        ? '1 ficha com diferença entre os litros informados e o registrador da bomba.'
        : divergentes.length + ' fichas com diferença entre os litros informados e o registrador da bomba.'
    celula.font = { bold: true, size: 10, color: { argb: CARMIM } }
    ws.mergeCells(linhaTotal + 1, 1, linhaTotal + 1, COLUNAS.length)
  }

  rodapeEletronico(ws, linhaTotal + 3, COLUNAS.length, opcoes.versaoApp)
  return ws
}
