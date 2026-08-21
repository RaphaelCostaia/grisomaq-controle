import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import { montarFichaCaminhoes } from './ficha1-caminhoes'
import { montarFichaApontamento } from './ficha2-apontamento'
import { montarFichaAbastecimento } from './ficha3-abastecimento'
import type { CabecalhoApontamento, LinhaAbastecimento, LinhaApontamento, LinhaCaminhao } from '../tipos'

/**
 * Verifica que os relatórios saem no layout das fichas originais.
 *
 * Layout de planilha não se confere lendo código: mesclagem errada, largura
 * fora e coluna trocada só aparecem no arquivo. Estes testes comparam a
 * estrutura gerada com a das planilhas que a GrisoMaq já usa, e de quebra
 * gravam exemplos em `exemplos-relatorio/` para conferência a olho.
 */

const OPCOES = { versaoApp: '0.1.0', periodo: '01/08/2026 a 21/08/2026' }
const HOJE = '2026-08-21'
const PASTA_EXEMPLOS = join(process.cwd(), 'exemplos-relatorio')

const CAMINHOES: LinhaCaminhao[] = [
  { data: HOJE, fazenda_codigo: 'FZ01', caminhao_numero: '77', carreta1_numero: '101', carreta2_numero: '102', chegada: '08:14', saida: '09:02', permanencia_minutos: 48, lider_nome: 'Marcos Pereira' },
  { data: HOJE, fazenda_codigo: 'FZ01', caminhao_numero: '82', carreta1_numero: '103', carreta2_numero: '104', chegada: '09:20', saida: '10:05', permanencia_minutos: 45, lider_nome: 'Marcos Pereira' },
  { data: HOJE, fazenda_codigo: 'FZ02', caminhao_numero: '90', carreta1_numero: '101', carreta2_numero: null, chegada: '11:40', saida: '15:55', permanencia_minutos: 255, lider_nome: 'Edson Ribeiro' },
  { data: HOJE, fazenda_codigo: 'FZ02', caminhao_numero: '77', carreta1_numero: '102', carreta2_numero: '104', chegada: '16:30', saida: null, permanencia_minutos: null, lider_nome: 'Edson Ribeiro' },
]

const CABECALHO: CabecalhoApontamento = {
  data: HOJE,
  frente: 'Frente 1 · Santa Rita',
  turno: '1º Turno',
  responsavel: 'Antônio Carlos Souza',
  observacao: 'Chuva das 10h às 11h30.',
}

const APONTAMENTO: LinhaApontamento[] = [
  { seq: 1, funcionario_codigo: '1003', funcionario_nome: 'Marcos Vinícius Alves', frota_numero: '1204', odometro_inicial: null, elevador_inicial: 8112.5, odometro_final: null, elevador_final: 8119.5, assinatura: 'Assinado por PIN — 21/08/2026 10:31 — disp. 01A0' },
  { seq: 2, funcionario_codigo: '1004', funcionario_nome: 'Rodrigo Nunes', frota_numero: '3120', odometro_inicial: 45210, elevador_inicial: null, odometro_final: 45298, elevador_final: null, assinatura: 'Assinado por PIN — 21/08/2026 10:33 — disp. 01A0' },
  { seq: 3, funcionario_codigo: '1001', funcionario_nome: 'José Ferreira da Silva', frota_numero: '1204', odometro_inicial: null, elevador_inicial: 8119.5, odometro_final: null, elevador_final: 8126, assinatura: 'Assinado por PIN — 21/08/2026 10:35 — disp. 01A0' },
]

const ABASTECIMENTO: LinhaAbastecimento[] = [
  { numero_documento: 6900, hora: '08:15', data: HOJE, frota_numero: '3120', horimetro_motor: 5400, horimetro_elevador: null, odometro: null, registrador_inicio: 45180, registrador_fim: 45265, litros: 85, divergencia: 0, assinatura: 'Assinado por PIN — 21/08/2026 08:16 — disp. 01A0' },
  { numero_documento: 6901, hora: '10:01', data: HOJE, frota_numero: '1204', horimetro_motor: 12345.7, horimetro_elevador: 8112.5, odometro: null, registrador_inicio: 45265, registrador_fim: 45310, litros: 90, divergencia: 45, assinatura: 'Assinado por PIN — 21/08/2026 10:02 — disp. 01A0' },
  { numero_documento: 6902, hora: '14:22', data: HOJE, frota_numero: '1204', horimetro_motor: 12352.4, horimetro_elevador: 8119.5, odometro: null, registrador_inicio: 45310, registrador_fim: 45372, litros: 62, divergencia: 0, assinatura: 'Assinado por PIN — 21/08/2026 14:23 — disp. 01A0' },
]

let wbCaminhoes: ExcelJS.Workbook
let wbApontamento: ExcelJS.Workbook
let wbAbastecimento: ExcelJS.Workbook

beforeAll(async () => {
  mkdirSync(PASTA_EXEMPLOS, { recursive: true })

  wbCaminhoes = new ExcelJS.Workbook()
  montarFichaCaminhoes(wbCaminhoes, CAMINHOES, { ...OPCOES, safra: '2026' })
  await wbCaminhoes.xlsx.writeFile(join(PASTA_EXEMPLOS, 'CONTROLE DE CAMINHOES.xlsx'))

  wbApontamento = new ExcelJS.Workbook()
  montarFichaApontamento(wbApontamento, CABECALHO, APONTAMENTO, OPCOES)
  await wbApontamento.xlsx.writeFile(join(PASTA_EXEMPLOS, 'FICHA_APONTAMENTO.xlsx'))

  wbAbastecimento = new ExcelJS.Workbook()
  montarFichaAbastecimento(wbAbastecimento, ABASTECIMENTO, OPCOES)
  await wbAbastecimento.xlsx.writeFile(join(PASTA_EXEMPLOS, 'CONTROLE DIARIO DE ABASTECIMENTO.xlsx'))
})

const texto = (ws: ExcelJS.Worksheet, l: number, c: number) => String(ws.getCell(l, c).value ?? '')

describe('ficha de caminhões', () => {
  it('mantém o título e o cabeçalho de duas linhas do original', () => {
    const ws = wbCaminhoes.getWorksheet('Caminhões')!
    expect(texto(ws, 1, 1)).toBe('CONTROLE DE CAMINHÕES - SAFRA 2026')

    // A ordem das colunas é a da via de papel; trocá-la obrigaria o escritório
    // a reaprender a leitura de um documento que já usa há anos.
    expect([1, 2, 3, 4, 5].map((c) => texto(ws, 2, c))).toEqual([
      'DATA', 'CÓDIGO', 'Nº CAMINHÃO', 'Nº 1ª CARRETA', 'Nº 2ª CARRETA',
    ])
    expect(texto(ws, 2, 6)).toBe('HORÁRIO CAMPO')
    expect(texto(ws, 3, 6)).toBe('CHEGADA')
    expect(texto(ws, 3, 7)).toBe('SAÍDA')
    expect(texto(ws, 2, 8)).toBe('LÍDER DO MALHADOR')
  })

  it('preserva as larguras de coluna do original', () => {
    const ws = wbCaminhoes.getWorksheet('Caminhões')!
    expect(ws.getColumn(1).width).toBeCloseTo(18.78, 1)
    expect(ws.getColumn(8).width).toBe(21)
  })

  it('acrescenta a permanência, que o papel não tinha', () => {
    const ws = wbCaminhoes.getWorksheet('Caminhões')!
    expect(texto(ws, 2, 9)).toBe('PERMANÊNCIA')
    expect(texto(ws, 4, 9)).toBe('48min')
    expect(texto(ws, 6, 9)).toBe('4h 15min')
  })

  it('deixa a saída em branco no ciclo ainda aberto, sem inventar permanência', () => {
    const ws = wbCaminhoes.getWorksheet('Caminhões')!
    expect(texto(ws, 7, 7)).toBe('')
    expect(texto(ws, 7, 9)).toBe('')
  })

  it('fecha com a permanência média, que ninguém somava à mão', () => {
    const ws = wbCaminhoes.getWorksheet('Caminhões')!
    const linhaTotal = 4 + CAMINHOES.length + 1
    expect(texto(ws, linhaTotal, 1)).toBe('Ciclos concluídos: 3')
    expect(texto(ws, linhaTotal, 9)).toBe('1h 56min')
  })
})

describe('ficha de apontamento', () => {
  it('mantém as nove colunas da grade original, na ordem', () => {
    const ws = wbApontamento.getWorksheet('Apontamento')!
    expect(Array.from({ length: 9 }, (_, i) => texto(ws, 4, i + 1))).toEqual([
      'Seq.', 'Cód. Func.', 'Funcionário', 'Frota',
      'Odom. Inicial', 'Elevador Inicial', 'Odom. Final', 'Elevador Final',
      'Assinatura do Funcionário',
    ])
  })

  // Ao abrir o arquivo com outra ferramenta, as colunas E a H aparecem como uma
  // faixa só (`<col min="5" max="8" width="15">`). Isso é o ExcelJS agrupando
  // larguras idênticas — OOXML válido, e o que o próprio Excel escreve. As
  // larguras estão corretas; não há nada a "consertar" aí.
  it('preserva as larguras de coluna do original', () => {
    const ws = wbApontamento.getWorksheet('Apontamento')!
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9].map((c) => ws.getColumn(c).width)).toEqual([
      8, 12, 20, 18, 15, 15, 15, 15, 20,
    ])
  })

  // A via de papel tem 25 linhas numeradas. Sair com menos obrigaria a
  // conferência a contar linha por linha em vez de comparar de relance.
  it('sai sempre com as 25 linhas numeradas, mesmo com o turno menor', () => {
    const ws = wbApontamento.getWorksheet('Apontamento')!
    expect(ws.getCell(5, 1).value).toBe(1)
    expect(ws.getCell(29, 1).value).toBe(25)
    // Linha 4 da grade (índice 8) está vazia porque o turno teve 3 funcionários.
    expect(texto(ws, 8, 3)).toBe('')
  })

  it('preenche a coluna de assinatura com o registro eletrônico', () => {
    const ws = wbApontamento.getWorksheet('Apontamento')!
    expect(texto(ws, 5, 9)).toContain('Assinado por PIN')
  })

  it('leva o cabeçalho do documento com data, frente, turno e responsável', () => {
    const ws = wbApontamento.getWorksheet('Apontamento')!
    expect(texto(ws, 2, 1)).toBe('Data')
    expect(texto(ws, 2, 2)).toBe('21/08/2026')
    expect(texto(ws, 2, 4)).toBe('Frente')
    expect(texto(ws, 2, 7)).toBe('Turno')
    expect(texto(ws, 3, 2)).toBe('Antônio Carlos Souza')
  })

  it('soma as horas de elevador do turno', () => {
    const ws = wbApontamento.getWorksheet('Apontamento')!
    // 7,0 + 6,5 = 13,5 h
    expect(ws.getCell(31, 7).value).toBeCloseTo(13.5, 1)
  })
})

describe('ficha de abastecimento', () => {
  it('segue a ordem física das colunas do bloco carbonado', () => {
    const ws = wbAbastecimento.getWorksheet('Abastecimento')!
    expect(Array.from({ length: 12 }, (_, i) => texto(ws, 3, i + 1))).toEqual([
      'Nº FICHA', 'HORA', 'DATA', 'FROTA',
      'HORÍMETRO MOTOR', 'HORÍMETRO ELEVADOR', 'HODÔMETRO',
      'INÍCIO REG.', 'FINAL REG.', 'LITROS',
      'DIFERENÇA', 'ASSINATURA',
    ])
  })

  it('mostra o número da ficha em carmim, como vem impresso na via', () => {
    const ws = wbAbastecimento.getWorksheet('Abastecimento')!
    const celula = ws.getCell(4, 1)
    expect(celula.value).toBe(6900)
    expect((celula.font?.color as { argb?: string })?.argb).toBe('FFC8102E')
  })

  // A divergência é o assunto desta planilha: é ela que denuncia diesel saindo
  // sem lançamento. Precisa saltar aos olhos, não virar mais um número.
  it('destaca a linha cuja divergência passa da tolerância', () => {
    const ws = wbAbastecimento.getWorksheet('Abastecimento')!
    const divergente = ws.getCell(5, 11)
    expect(divergente.value).toBe(45)
    expect((divergente.font?.color as { argb?: string })?.argb).toBe('FFC8102E')

    const correta = ws.getCell(4, 11)
    expect(correta.font?.bold).not.toBe(true)
  })

  it('fecha com o total de litros e a contagem de divergências', () => {
    const ws = wbAbastecimento.getWorksheet('Abastecimento')!
    const linhaTotal = 4 + ABASTECIMENTO.length + 1
    expect(ws.getCell(linhaTotal, 10).value).toBe(237)
    expect(texto(ws, linhaTotal + 1, 1)).toContain('1 ficha com diferença')
  })
})

describe('rodapé de documento eletrônico', () => {
  it('declara a origem em todas as fichas', () => {
    for (const wb of [wbCaminhoes, wbApontamento, wbAbastecimento]) {
      const ws = wb.worksheets[0]!
      const textos: string[] = []
      ws.eachRow((linha) => {
        linha.eachCell((celula) => textos.push(String(celula.value ?? '')))
      })
      expect(textos.some((t) => t.includes('gerado eletronicamente pelo GRISOMAQ CONTROLE'))).toBe(true)
    }
  })
})
