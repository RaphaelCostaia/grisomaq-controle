import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces'
import type { LinhaCaminhao, OpcoesRelatorio } from '../tipos'
import { VERDE_CABECALHO, cabecalho, documentoBase, layoutGrade } from './base'
import { dataBr, duracaoCurta } from '@/utilitarios/datas'

/**
 * O controle de caminhões em PDF.
 *
 * O cabeçalho de duas alturas do papel — "HORÁRIO CAMPO" abrindo em CHEGADA e
 * SAÍDA — é reproduzido com uma célula mesclada, porque é a única coluna
 * composta da ficha e é justamente a que carrega o número que interessa.
 *
 * A permanência entra como coluna extra, à direita do layout original. Ela não
 * existia no papel porque ninguém a calculava; é a razão de digitalizar esta
 * ficha.
 */
export function montarPdfCaminhoes(
  linhas: LinhaCaminhao[],
  opcoes: OpcoesRelatorio & { safra?: string },
): TDocumentDefinitions {
  const concluidos = linhas.filter((l) => l.permanencia_minutos !== null)
  const media =
    concluidos.length > 0
      ? Math.round(concluidos.reduce((s, l) => s + l.permanencia_minutos!, 0) / concluidos.length)
      : null

  const corpo: Content[] = [
    ...cabecalho(
      'CONTROLE DE CAMINHÕES - SAFRA ' + (opcoes.safra ?? new Date().getFullYear()),
      opcoes.periodo ? 'Período: ' + opcoes.periodo : undefined,
    ),

    {
      table: {
        headerRows: 2,
        widths: [58, 40, 52, 52, 52, 42, 42, '*', 52],
        body: [
          [
            { text: 'DATA', style: 'cabecalhoTabela', fillColor: VERDE_CABECALHO, rowSpan: 2 },
            { text: 'CÓDIGO', style: 'cabecalhoTabela', fillColor: VERDE_CABECALHO, rowSpan: 2 },
            { text: 'Nº CAMINHÃO', style: 'cabecalhoTabela', fillColor: VERDE_CABECALHO, rowSpan: 2 },
            { text: 'Nº 1ª CARRETA', style: 'cabecalhoTabela', fillColor: VERDE_CABECALHO, rowSpan: 2 },
            { text: 'Nº 2ª CARRETA', style: 'cabecalhoTabela', fillColor: VERDE_CABECALHO, rowSpan: 2 },
            { text: 'HORÁRIO CAMPO', style: 'cabecalhoTabela', fillColor: VERDE_CABECALHO, colSpan: 2 },
            {},
            { text: 'LÍDER DO MALHADOR', style: 'cabecalhoTabela', fillColor: VERDE_CABECALHO, rowSpan: 2 },
            { text: 'PERMANÊNCIA', style: 'cabecalhoTabela', fillColor: VERDE_CABECALHO, rowSpan: 2 },
          ],
          [
            {},
            {},
            {},
            {},
            {},
            { text: 'CHEGADA', style: 'cabecalhoTabela', fillColor: VERDE_CABECALHO },
            { text: 'SAÍDA', style: 'cabecalhoTabela', fillColor: VERDE_CABECALHO },
            {},
            {},
          ],
          ...linhas.map(linhaDaGrade),
        ],
      },
      layout: layoutGrade,
    },

    {
      columns: [
        { width: '*', text: 'Ciclos concluídos: ' + concluidos.length, style: 'total' },
        ...(media !== null
          ? [{ width: 'auto', text: 'Permanência média: ' + duracaoCurta(media), style: 'total' } as Content]
          : []),
      ],
      margin: [0, 8, 0, 0],
    },
  ]

  return documentoBase(corpo, opcoes.versaoApp, true)
}

function linhaDaGrade(linha: LinhaCaminhao): Content[] {
  const centro = { alignment: 'center' as const, style: 'celula' }
  return [
    { text: dataBr(linha.data), ...centro },
    { text: linha.fazenda_codigo ?? '—', ...centro },
    { text: linha.caminhao_numero, ...centro },
    { text: linha.carreta1_numero ?? '—', ...centro },
    { text: linha.carreta2_numero ?? '—', ...centro },
    { text: linha.chegada, ...centro },
    // Ciclo ainda aberto sai com a saída em branco, e sem permanência
    // inventada: o caminhão continua no campo enquanto o relatório é impresso.
    { text: linha.saida ?? '', ...centro },
    { text: linha.lider_nome ?? '—', style: 'celula' },
    {
      text: linha.permanencia_minutos === null ? 'no campo' : duracaoCurta(linha.permanencia_minutos),
      ...centro,
    },
  ]
}
