import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces'
import type { LinhaAbastecimento, OpcoesRelatorio } from '../tipos'
import { CARMIM, VERDE_CABECALHO, cabecalho, documentoBase, layoutGrade } from './base'
import { dataBr } from '@/utilitarios/datas'
import { formatarLeitura, formatarNumero } from '@/utilitarios/numeros'

const TITULOS = [
  'Nº Ficha',
  'Hora',
  'Data',
  'Frota',
  'Horím. Motor',
  'Horím. Elev.',
  'Hodômetro',
  'Início Reg.',
  'Final Reg.',
  'Litros',
  'Diferença',
  'Assinatura',
]

/**
 * O controle diário de abastecimento em PDF.
 *
 * Paisagem porque são doze colunas na ordem física do bloco carbonado — é a
 * ordem em que o abastecedor lê os mostradores, e mudá-la obrigaria a reaprender
 * um documento que já é lido há anos.
 */
export function montarPdfAbastecimento(
  linhas: LinhaAbastecimento[],
  opcoes: OpcoesRelatorio,
): TDocumentDefinitions {
  const divergentes = linhas.filter((l) => Math.abs(l.divergencia) > 0.5)

  const corpo: Content[] = [
    ...cabecalho('CONTROLE DIÁRIO DE ABASTECIMENTO', opcoes.periodo ? 'Período: ' + opcoes.periodo : undefined),

    {
      table: {
        headerRows: 1,
        widths: [34, 26, 42, 30, 48, 48, 45, 48, 48, 42, 42, '*'],
        body: [
          TITULOS.map((t) => ({ text: t, style: 'cabecalhoTabela', fillColor: VERDE_CABECALHO })),
          ...linhas.map(linhaDaGrade),
        ],
      },
      layout: layoutGrade,
    },

    {
      columns: [
        { width: '*', text: 'Fichas: ' + linhas.length, style: 'total' },
        {
          width: 'auto',
          text: 'Total de litros: ' + formatarNumero(linhas.reduce((s, l) => s + l.litros, 0), 1) + ' L',
          style: 'total',
        },
      ],
      margin: [0, 8, 0, 0],
    },

    // A divergência é o assunto deste documento: é ela que denuncia diesel
    // saindo sem lançamento. Fica declarada no fim, não escondida numa coluna.
    ...(divergentes.length > 0
      ? [
          {
            text:
              divergentes.length === 1
                ? '1 ficha com diferença entre os litros informados e o registrador da bomba: nº ' +
                  divergentes[0]!.numero_documento + '.'
                : divergentes.length +
                  ' fichas com diferença entre os litros informados e o registrador da bomba: nº ' +
                  divergentes.map((d) => d.numero_documento).join(', ') + '.',
            style: 'total',
            color: CARMIM,
            margin: [0, 6, 0, 0],
          } as Content,
        ]
      : []),
  ]

  return documentoBase(corpo, opcoes.versaoApp, true)
}

function linhaDaGrade(linha: LinhaAbastecimento): Content[] {
  const divergente = Math.abs(linha.divergencia) > 0.5
  return [
    { text: String(linha.numero_documento), style: 'celula', alignment: 'center', bold: true, color: CARMIM },
    { text: linha.hora, style: 'celula', alignment: 'center' },
    { text: dataBr(linha.data), style: 'celula', alignment: 'center' },
    { text: linha.frota_numero, style: 'celula', alignment: 'center' },
    { text: formatarLeitura(linha.horimetro_motor), style: 'celulaNumero' },
    { text: formatarLeitura(linha.horimetro_elevador), style: 'celulaNumero' },
    { text: formatarLeitura(linha.odometro), style: 'celulaNumero' },
    { text: formatarLeitura(linha.registrador_inicio), style: 'celulaNumero' },
    { text: formatarLeitura(linha.registrador_fim), style: 'celulaNumero' },
    { text: formatarLeitura(linha.litros), style: 'celulaNumero' },
    {
      text: formatarLeitura(linha.divergencia),
      style: divergente ? 'celulaDestaque' : 'celulaNumero',
      ...(divergente ? { fillColor: '#FDF0F2' } : {}),
    },
    { text: linha.assinatura, style: 'celula', fontSize: 6 },
  ]
}
