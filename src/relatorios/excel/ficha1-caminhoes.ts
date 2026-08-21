import type { Workbook, Worksheet } from 'exceljs'
import type { LinhaCaminhao, OpcoesRelatorio } from '../tipos'
import { bordaFina, centralizado, contornar, rodapeEletronico } from './estilos'
import { dataBr, duracaoCurta } from '@/utilitarios/datas'

const COLUNAS = 8
const LINHA_INICIAL_DADOS = 4

/**
 * Reproduz `CONTROLE DE CAMINHÕES.xlsx`.
 *
 * O cabeçalho tem duas alturas porque "HORÁRIO CAMPO" se abre em CHEGADA e
 * SAÍDA — é a única coluna composta da ficha, e é justamente a que carrega o
 * número que interessa. Por isso a permanência entra como coluna extra, à
 * direita do layout original: ela não existia no papel porque ninguém a
 * calculava, mas é a razão de digitalizar esta ficha.
 */
export function montarFichaCaminhoes(
  wb: Workbook,
  linhas: LinhaCaminhao[],
  opcoes: OpcoesRelatorio & { safra?: string },
): Worksheet {
  const ws = wb.addWorksheet('Caminhões', {
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  })

  ws.getColumn(1).width = 18.78
  ws.getColumn(8).width = 21
  ws.getColumn(9).width = 14

  // Título
  ws.mergeCells(1, 1, 1, COLUNAS)
  const titulo = ws.getCell(1, 1)
  titulo.value = 'CONTROLE DE CAMINHÕES - SAFRA ' + (opcoes.safra ?? new Date().getFullYear())
  titulo.font = { bold: true, size: 25 }
  titulo.alignment = centralizado
  titulo.border = bordaFina
  ws.getRow(1).height = 25.2

  // Cabeçalho de duas linhas, com as mesmas mesclagens do original.
  for (const [coluna, rotulo] of [
    [1, 'DATA'],
    [2, 'CÓDIGO'],
    [3, 'Nº CAMINHÃO'],
    [4, 'Nº 1ª CARRETA'],
    [5, 'Nº 2ª CARRETA'],
    [8, 'LÍDER DO MALHADOR'],
  ] as const) {
    ws.mergeCells(2, coluna, 3, coluna)
    const celula = ws.getCell(2, coluna)
    celula.value = rotulo
    celula.font = { bold: true, size: 10 }
    celula.alignment = centralizado
  }

  ws.mergeCells(2, 6, 2, 7)
  const horario = ws.getCell(2, 6)
  horario.value = 'HORÁRIO CAMPO'
  horario.font = { bold: true, size: 10 }
  horario.alignment = centralizado

  for (const [coluna, rotulo] of [
    [6, 'CHEGADA'],
    [7, 'SAÍDA'],
  ] as const) {
    const celula = ws.getCell(3, coluna)
    celula.value = rotulo
    celula.font = { bold: true, size: 10 }
    celula.alignment = centralizado
  }

  // Coluna a mais que o papel não tinha: o KPI que a ficha escondia.
  ws.mergeCells(2, 9, 3, 9)
  const permanencia = ws.getCell(2, 9)
  permanencia.value = 'PERMANÊNCIA'
  permanencia.font = { bold: true, size: 10 }
  permanencia.alignment = centralizado

  ws.getRow(2).height = 15
  ws.getRow(3).height = 15
  contornar(ws, 2, 3, COLUNAS + 1)

  linhas.forEach((linha, indice) => {
    const l = LINHA_INICIAL_DADOS + indice
    ws.getRow(l).height = 19.95
    ws.getRow(l).values = [
      dataBr(linha.data),
      linha.fazenda_codigo ?? '',
      linha.caminhao_numero,
      linha.carreta1_numero ?? '',
      linha.carreta2_numero ?? '',
      linha.chegada,
      linha.saida ?? '',
      linha.lider_nome ?? '',
      linha.permanencia_minutos !== null ? duracaoCurta(linha.permanencia_minutos) : '',
    ]
    for (let c = 1; c <= COLUNAS + 1; c++) {
      ws.getCell(l, c).alignment = centralizado
    }
  })

  const ultimaLinha = LINHA_INICIAL_DADOS + Math.max(linhas.length, 1) - 1
  contornar(ws, LINHA_INICIAL_DADOS, ultimaLinha, COLUNAS + 1)

  // Total, que no papel dependia de alguém somar à mão.
  const linhaTotal = ultimaLinha + 2
  const concluidos = linhas.filter((l) => l.permanencia_minutos !== null)
  if (concluidos.length > 0) {
    const media = concluidos.reduce((s, l) => s + l.permanencia_minutos!, 0) / concluidos.length
    ws.getCell(linhaTotal, 1).value = 'Ciclos concluídos: ' + concluidos.length
    ws.getCell(linhaTotal, 1).font = { bold: true, size: 10 }
    ws.getCell(linhaTotal, 6).value = 'Permanência média:'
    ws.getCell(linhaTotal, 6).font = { bold: true, size: 10 }
    ws.getCell(linhaTotal, 9).value = duracaoCurta(Math.round(media))
    ws.getCell(linhaTotal, 9).font = { bold: true, size: 10 }
    ws.getCell(linhaTotal, 9).alignment = centralizado
  }

  rodapeEletronico(ws, linhaTotal + 2, COLUNAS + 1, opcoes.versaoApp)
  return ws
}
