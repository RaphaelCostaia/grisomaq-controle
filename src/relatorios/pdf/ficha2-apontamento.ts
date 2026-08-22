import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces'
import type { CabecalhoApontamento, LinhaApontamento, OpcoesRelatorio } from '../tipos'
import { VERDE_CABECALHO, cabecalho, campo, documentoBase, layoutGrade } from './base'
import { dataBr } from '@/utilitarios/datas'
import { formatarLeitura } from '@/utilitarios/numeros'

const LINHAS_POR_PAGINA = 25

const TITULOS = [
  'Seq.',
  'Cód.',
  'Funcionário',
  'Frota',
  'Odom. Inicial',
  'Elev. Inicial',
  'Odom. Final',
  'Elev. Final',
  'Assinatura do Funcionário',
]

/**
 * A ficha de apontamento em PDF.
 *
 * É a via que vai para o arquivo do escritório e, quando preciso, para a
 * conferência de folha. Por isso ela mantém as 25 linhas numeradas do papel e a
 * coluna de assinatura ocupada pelo registro do aceite — é ali que estava a
 * rubrica a caneta, e é ali que a prova precisa continuar aparecendo.
 */
export function montarPdfApontamento(
  cabecalhoFicha: CabecalhoApontamento,
  linhas: LinhaApontamento[],
  opcoes: OpcoesRelatorio,
): TDocumentDefinitions {
  const corpo: Content[] = [
    ...cabecalho('FICHA DE APONTAMENTO E ASSINATURA'),

    {
      columns: [
        campo('Data', dataBr(cabecalhoFicha.data)),
        campo('Frente', cabecalhoFicha.frente),
        campo('Turno', cabecalhoFicha.turno),
        campo('Responsável', cabecalhoFicha.responsavel),
      ],
      columnGap: 12,
      margin: [0, 0, 0, 6],
    },

    cabecalhoFicha.observacao
      ? ({ stack: [campo('Observação', cabecalhoFicha.observacao)], margin: [0, 0, 0, 8] } as Content)
      : ({ text: '', margin: [0, 0, 0, 4] } as Content),

    {
      table: {
        headerRows: 1,
        widths: [16, 26, '*', 30, 42, 40, 42, 40, 120],
        body: [
          TITULOS.map((t) => ({ text: t, style: 'cabecalhoTabela', fillColor: VERDE_CABECALHO })),
          // As 25 linhas saem sempre, mesmo com oito pessoas no turno: é assim
          // que a via de papel é, e é assim que a conferência lê.
          ...Array.from({ length: LINHAS_POR_PAGINA }, (_, i) => linhaDaGrade(linhas[i], i + 1)),
        ],
      },
      layout: layoutGrade,
    },

    totais(linhas),
  ]

  return documentoBase(corpo, opcoes.versaoApp)
}

function linhaDaGrade(linha: LinhaApontamento | undefined, seq: number): Content[] {
  if (!linha) {
    return [
      { text: String(seq), style: 'celula', alignment: 'center', fillColor: '#F5F5F5' },
      ...Array.from({ length: 8 }, () => ({ text: ' ', style: 'celula' })),
    ]
  }

  return [
    { text: String(linha.seq), style: 'celula', alignment: 'center', fillColor: '#F5F5F5' },
    { text: linha.funcionario_codigo, style: 'celula', alignment: 'center' },
    { text: linha.funcionario_nome, style: 'celula' },
    { text: linha.frota_numero, style: 'celula', alignment: 'center' },
    { text: formatarLeitura(linha.odometro_inicial), style: 'celulaNumero' },
    { text: formatarLeitura(linha.elevador_inicial), style: 'celulaNumero' },
    { text: formatarLeitura(linha.odometro_final), style: 'celulaNumero' },
    { text: formatarLeitura(linha.elevador_final), style: 'celulaNumero' },
    { text: linha.assinatura, style: 'celula', fontSize: 6 },
  ]
}

function totais(linhas: LinhaApontamento[]): Content {
  const soma = (pegar: (l: LinhaApontamento) => number) => linhas.reduce((s, l) => s + pegar(l), 0)
  const horas = soma((l) =>
    l.elevador_final !== null && l.elevador_inicial !== null ? l.elevador_final - l.elevador_inicial : 0,
  )
  const km = soma((l) =>
    l.odometro_final !== null && l.odometro_inicial !== null ? l.odometro_final - l.odometro_inicial : 0,
  )

  return {
    columns: [
      { width: '*', text: 'Funcionários: ' + linhas.length, style: 'total' },
      { width: 'auto', text: 'Horas de elevador: ' + formatarLeitura(horas), style: 'total' },
      ...(km > 0
        ? [{ width: 'auto', text: 'Quilômetros: ' + formatarLeitura(km), style: 'total' } as Content]
        : []),
    ],
    columnGap: 16,
    margin: [0, 8, 0, 0],
  }
}
