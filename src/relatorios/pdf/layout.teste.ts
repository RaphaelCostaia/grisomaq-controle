import { describe, expect, it } from 'vitest'
import type { Content, ContentTable, TDocumentDefinitions } from 'pdfmake/interfaces'
import { montarPdfCaminhoes } from './ficha1-caminhoes'
import { montarPdfApontamento } from './ficha2-apontamento'
import { montarPdfAbastecimento } from './ficha3-abastecimento'
import type {
  CabecalhoApontamento,
  LinhaAbastecimento,
  LinhaApontamento,
  LinhaCaminhao,
} from '../tipos'

/**
 * Verifica a estrutura do PDF sem renderizá-lo.
 *
 * O binário depende das fontes virtuais do pdfmake, que só carregam no
 * navegador — mas o que importa aqui é o que o documento DIZ: as colunas na
 * ordem do papel, as 25 linhas numeradas, a trilha de assinatura e a declaração
 * de origem. Tudo isso está na definição, e é o que estes testes leem.
 */

const OPCOES = { versaoApp: '0.1.0', periodo: '01/08/2026 a 22/08/2026' }

const CABECALHO: CabecalhoApontamento = {
  data: '2026-08-22',
  frente: 'Frente 1 · Santa Rita',
  turno: '1º Turno',
  responsavel: 'Antônio Carlos Souza',
  observacao: 'Chuva das 10h às 11h30.',
}

const APONTAMENTO: LinhaApontamento[] = [
  {
    seq: 1,
    funcionario_codigo: '1003',
    funcionario_nome: 'Marcos Vinícius Alves',
    frota_numero: '1204',
    odometro_inicial: null,
    elevador_inicial: 8112.5,
    odometro_final: null,
    elevador_final: 8119.5,
    assinatura: 'Assinado por PIN — 22/08/2026 10:31 — disp. 01A0',
  },
  {
    seq: 2,
    funcionario_codigo: '1004',
    funcionario_nome: 'Rodrigo Nunes',
    frota_numero: '3120',
    odometro_inicial: 45210,
    elevador_inicial: null,
    odometro_final: 45298,
    elevador_final: null,
    assinatura: 'Pendente',
  },
]

const ABASTECIMENTO: LinhaAbastecimento[] = [
  {
    numero_documento: 6900,
    hora: '08:15',
    data: '2026-08-22',
    frota_numero: '3120',
    horimetro_motor: 5400,
    horimetro_elevador: null,
    odometro: null,
    registrador_inicio: 45180,
    registrador_fim: 45265,
    litros: 85,
    divergencia: 0,
    assinatura: 'Assinado por PIN — 22/08/2026 08:16 — disp. 01A0',
  },
  {
    numero_documento: 6901,
    hora: '10:01',
    data: '2026-08-22',
    frota_numero: '1204',
    horimetro_motor: 12345.7,
    horimetro_elevador: 8112.5,
    odometro: null,
    registrador_inicio: 45265,
    registrador_fim: 45310,
    litros: 90,
    divergencia: 45,
    assinatura: 'Assinado por PIN — 22/08/2026 10:02 — disp. 01A0',
  },
]

/** Achata a definição para procurar textos onde quer que estejam. */
function textos(doc: TDocumentDefinitions): string[] {
  const encontrados: string[] = []
  const caminhar = (no: unknown): void => {
    if (no === null || no === undefined) return
    if (Array.isArray(no)) {
      no.forEach(caminhar)
      return
    }
    if (typeof no === 'object') {
      const obj = no as Record<string, unknown>
      if (typeof obj.text === 'string') encontrados.push(obj.text)
      Object.values(obj).forEach(caminhar)
    }
  }
  caminhar(doc.content)
  return encontrados
}

function gradeDe(doc: TDocumentDefinitions): ContentTable {
  const achar = (no: unknown): ContentTable | null => {
    if (Array.isArray(no)) {
      for (const item of no) {
        const achado = achar(item)
        if (achado) return achado
      }
      return null
    }
    if (no && typeof no === 'object') {
      const obj = no as Record<string, unknown>
      const tabela = obj.table as { body?: unknown[] } | undefined
      // A faixa do título também é uma tabela, de uma célula só; a grade é a
      // que tem mais de uma linha.
      if (Array.isArray(tabela?.body) && tabela.body.length > 1) {
        return obj as unknown as ContentTable
      }
      for (const valor of Object.values(obj)) {
        const achado = achar(valor)
        if (achado) return achado
      }
    }
    return null
  }

  const grade = achar(doc.content as Content[])
  if (!grade) throw new Error('nenhuma tabela de grade encontrada')
  return grade
}

const linha = (doc: TDocumentDefinitions, i: number) =>
  gradeDe(doc).table.body[i] as Array<{ text: string; color?: string }>

describe('PDF do apontamento', () => {
  const doc = montarPdfApontamento(CABECALHO, APONTAMENTO, OPCOES)

  it('mantém as nove colunas da grade original, na ordem', () => {
    expect(linha(doc, 0).map((c) => c.text)).toEqual([
      'Seq.',
      'Cód.',
      'Funcionário',
      'Frota',
      'Odom. Inicial',
      'Elev. Inicial',
      'Odom. Final',
      'Elev. Final',
      'Assinatura do Funcionário',
    ])
  })

  // A via de papel tem 25 linhas numeradas. Sair com menos obrigaria a
  // conferência a contar linha por linha em vez de comparar de relance.
  it('sai sempre com 25 linhas, mesmo com o turno menor', () => {
    expect(gradeDe(doc).table.body).toHaveLength(26)
    expect(linha(doc, 1)[0]?.text).toBe('1')
    expect(linha(doc, 25)[0]?.text).toBe('25')
  })

  it('leva o cabeçalho do documento e a observação', () => {
    const t = textos(doc)
    expect(t).toContain('FICHA DE APONTAMENTO E ASSINATURA')
    expect(t).toContain('22/08/2026')
    expect(t).toContain('Antônio Carlos Souza')
    expect(t).toContain('Chuva das 10h às 11h30.')
  })

  // É o PDF que vai para o arquivo. A coluna de assinatura é onde estava a
  // rubrica a caneta, e é onde a prova precisa continuar aparecendo.
  it('preserva a trilha de assinatura, inclusive a pendente', () => {
    const t = textos(doc)
    expect(t.some((x) => x.includes('Assinado por PIN'))).toBe(true)
    expect(t).toContain('Pendente')
  })

  it('soma as horas de elevador do turno', () => {
    expect(textos(doc).some((x) => x.includes('Horas de elevador: 7,0'))).toBe(true)
  })

  it('declara a origem no rodapé de toda página', () => {
    expect(typeof doc.footer).toBe('function')
    const rodape = JSON.stringify((doc.footer as (p: number, t: number) => Content)(1, 2))
    expect(rodape).toContain('gerado eletronicamente pelo GRISOMAQ CONTROLE')
    expect(rodape).toContain('1/2')
  })
})

describe('PDF do abastecimento', () => {
  const doc = montarPdfAbastecimento(ABASTECIMENTO, OPCOES)

  it('segue a ordem física das colunas do bloco carbonado', () => {
    expect(linha(doc, 0).map((c) => c.text)).toEqual([
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
    ])
  })

  it('sai em paisagem, porque são doze colunas', () => {
    expect(doc.pageOrientation).toBe('landscape')
  })

  it('mostra o número da ficha em carmim, como vem impresso na via', () => {
    const primeira = linha(doc, 1)
    expect(primeira[0]?.text).toBe('6900')
    expect(primeira[0]?.color).toBe('#C8102E')
  })

  // A divergência é o assunto deste documento: é ela que denuncia diesel saindo
  // sem lançamento. Fica declarada no fim, não escondida numa coluna.
  it('nomeia as fichas divergentes no fim do documento', () => {
    expect(textos(doc).some((x) => x.includes('1 ficha com diferença') && x.includes('6901'))).toBe(true)
  })

  it('não inventa aviso quando está tudo conferindo', () => {
    const semDivergencia = montarPdfAbastecimento([ABASTECIMENTO[0]!], OPCOES)
    expect(textos(semDivergencia).some((x) => x.includes('com diferença'))).toBe(false)
  })

  it('traz o período no cabeçalho', () => {
    expect(textos(doc).some((x) => x.includes('01/08/2026 a 22/08/2026'))).toBe(true)
  })
})

const CAMINHOES: LinhaCaminhao[] = [
  {
    data: '2026-08-22',
    fazenda_codigo: 'FZ01',
    caminhao_numero: '77',
    carreta1_numero: '101',
    carreta2_numero: '102',
    chegada: '08:14',
    saida: '09:02',
    permanencia_minutos: 48,
    lider_nome: 'Marcos Pereira',
  },
  {
    data: '2026-08-22',
    fazenda_codigo: 'FZ02',
    caminhao_numero: '82',
    carreta1_numero: '103',
    carreta2_numero: null,
    chegada: '16:30',
    saida: null,
    permanencia_minutos: null,
    lider_nome: null,
  },
]

describe('PDF de caminhões', () => {
  const doc = montarPdfCaminhoes(CAMINHOES, { ...OPCOES, safra: '2026' })

  // "HORÁRIO CAMPO" é a única coluna composta da ficha, e é justamente a que
  // carrega o número que interessa. O cabeçalho de duas alturas do papel é
  // reproduzido com célula mesclada.
  it('reproduz o cabeçalho de duas alturas do original', () => {
    const primeira = linha(doc, 0) as unknown as Array<{ text?: string; colSpan?: number; rowSpan?: number }>
    const segunda = linha(doc, 1) as unknown as Array<{ text?: string }>

    expect(primeira.map((c) => c.text).filter(Boolean)).toEqual([
      'DATA',
      'CÓDIGO',
      'Nº CAMINHÃO',
      'Nº 1ª CARRETA',
      'Nº 2ª CARRETA',
      'HORÁRIO CAMPO',
      'LÍDER DO MALHADOR',
      'PERMANÊNCIA',
    ])
    expect(primeira.find((c) => c.text === 'HORÁRIO CAMPO')?.colSpan).toBe(2)
    expect(segunda.map((c) => c.text).filter(Boolean)).toEqual(['CHEGADA', 'SAÍDA'])
  })

  it('sai em paisagem', () => {
    expect(doc.pageOrientation).toBe('landscape')
  })

  // O caminhão continua no campo enquanto o relatório é impresso: inventar uma
  // permanência ali seria afirmar um número que ainda não existe.
  it('não inventa saída nem permanência para o ciclo ainda aberto', () => {
    const aberto = linha(doc, 3)
    expect(aberto[6]?.text).toBe('')
    expect(aberto[8]?.text).toBe('no campo')
  })

  it('fecha com a permanência média, que ninguém somava à mão', () => {
    const t = textos(doc)
    expect(t.some((x) => x.includes('Ciclos concluídos: 1'))).toBe(true)
    expect(t.some((x) => x.includes('Permanência média: 48min'))).toBe(true)
  })

  it('leva a safra no título', () => {
    expect(textos(doc).some((x) => x.includes('CONTROLE DE CAMINHÕES - SAFRA 2026'))).toBe(true)
  })
})
