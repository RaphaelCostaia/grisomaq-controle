import { describe, expect, it } from 'vitest'
import {
  pendenciasParaFechar,
  validarApontamento,
  validarItem,
  type ContextoApontamento,
  type ContextoItem,
  type RascunhoApontamento,
  type RascunhoItem,
} from './regras'
import { PARAMETROS_PADRAO } from '@/dominio/parametros'
import type { Frota, Turno, UltimaLeitura } from '@/dominio/tipos'
import { hojeOperacional, somarDias } from '@/utilitarios/datas'

const HOJE = hojeOperacional()

const colhedora: Frota = {
  id: 'f-1204',
  numero: '1204',
  descricao: 'Colhedora CH570',
  tipo: 'colhedora',
  tem_odometro: true,
  tem_horimetro_motor: true,
  tem_horimetro_elevador: true,
  capacidade_tanque_litros: 650,
  consumo_esperado_litros_hora: 32,
  consumo_esperado_km_litro: null,
  frente_id: null,
  ativo: true,
}

const turno: Turno = {
  id: 't-1',
  codigo: '1',
  nome: '1º Turno',
  escala: '3_turnos',
  hora_inicio: '06:00',
  hora_fim: '14:00',
  duracao_horas: 8,
  vira_dia: false,
  ativo: true,
}

const ultima = (tipo: UltimaLeitura['tipo'], valor: number): UltimaLeitura => ({
  frota_id: 'f-1204',
  tipo,
  valor,
  momento: new Date('2026-08-20T20:40:00Z').toISOString(),
  origem_tabela: 'apontamento_itens',
  origem_id: 'anterior',
})

function ctxItem(sobrescreve: Partial<ContextoItem> = {}): ContextoItem {
  return {
    parametros: PARAMETROS_PADRAO,
    frota: colhedora,
    turno,
    ultimasLeituras: {},
    funcionariosNaFicha: [],
    frotasNaFicha: [],
    ...sobrescreve,
  }
}

function item(sobrescreve: Partial<RascunhoItem> = {}): RascunhoItem {
  return {
    id: 'i-1',
    seq: 1,
    funcionario_id: 'u-1001',
    frota_id: 'f-1204',
    odometro_inicial: 1000,
    odometro_final: 1080,
    elevador_inicial: 8112.5,
    elevador_final: 8119,
    justificativa_leitura: null,
    assinado: true,
    avisos_confirmados: [],
    ...sobrescreve,
  }
}

const codigos = (r: { achados: Array<{ codigo: string }> }) => r.achados.map((a) => a.codigo)

describe('cabeçalho da ficha', () => {
  function cabecalho(s: Partial<RascunhoApontamento> = {}): RascunhoApontamento {
    return {
      id: 'ap-1',
      data: HOJE,
      frente_id: 'fr-1',
      turno_id: 't-1',
      responsavel_funcionario_id: 'u-9001',
      observacao: null,
      ...s,
    }
  }
  const ctx = (existentes: ContextoApontamento['existentes'] = []): ContextoApontamento => ({
    parametros: PARAMETROS_PADRAO,
    existentes,
  })

  it('aceita um cabeçalho completo', () => {
    expect(validarApontamento(cabecalho(), ctx()).podeSalvar).toBe(true)
  })

  it('exige frente, turno e responsável', () => {
    const r = validarApontamento(
      cabecalho({ frente_id: null, turno_id: null, responsavel_funcionario_id: null }),
      ctx(),
    )
    expect(codigos(r)).toEqual(
      expect.arrayContaining(['FRENTE_AUSENTE', 'TURNO_AUSENTE', 'RESPONSAVEL_AUSENTE']),
    )
  })

  // Duas fichas do mesmo turno dividiriam o turno em dois documentos e ninguém
  // saberia qual vale.
  it('bloqueia uma segunda ficha da mesma frente e turno no mesmo dia', () => {
    const r = validarApontamento(
      cabecalho({ id: 'ap-2' }),
      ctx([{ id: 'ap-1', data: HOJE, frente_id: 'fr-1', turno_id: 't-1' }]),
    )
    expect(codigos(r)).toContain('FICHA_JA_EXISTE')
  })

  it('não se acusa de duplicar quando é a própria ficha', () => {
    const r = validarApontamento(
      cabecalho(),
      ctx([{ id: 'ap-1', data: HOJE, frente_id: 'fr-1', turno_id: 't-1' }]),
    )
    expect(codigos(r)).not.toContain('FICHA_JA_EXISTE')
  })

  it('recusa data futura e aceita ontem', () => {
    expect(codigos(validarApontamento(cabecalho({ data: somarDias(HOJE, 1) }), ctx()))).toContain('DATA_FUTURA')
    expect(codigos(validarApontamento(cabecalho({ data: somarDias(HOJE, -1) }), ctx()))).not.toContain('DATA_ANTIGA')
  })
})

describe('linha da grade', () => {
  it('aceita uma linha completa', () => {
    const r = validarItem(item(), ctxItem())
    expect(codigos(r)).toEqual([])
    expect(r.podeSalvar).toBe(true)
  })

  it('bloqueia o mesmo funcionário duas vezes na ficha', () => {
    const r = validarItem(
      item({ id: 'i-2' }),
      ctxItem({ funcionariosNaFicha: [{ itemId: 'i-1', funcionario_id: 'u-1001' }] }),
    )
    expect(codigos(r)).toContain('FUNCIONARIO_REPETIDO')
    expect(r.podeSalvar).toBe(false)
  })

  it('apenas avisa quando a frota se repete, porque troca de operador acontece', () => {
    const r = validarItem(item({ id: 'i-2' }), ctxItem({ frotasNaFicha: [{ itemId: 'i-1', frota_id: 'f-1204' }] }))
    expect(codigos(r)).toContain('FROTA_REPETIDA')
    expect(r.achados.find((a) => a.codigo === 'FROTA_REPETIDA')?.severidade).toBe('aviso')
  })

  it('exige justificativa quando a leitura final é menor que a inicial', () => {
    const r = validarItem(item({ elevador_final: 8100 }), ctxItem())
    expect(codigos(r)).toContain('ELEVADOR_REGREDIU')
    expect(r.justificativasExigidas).toContain('justificativa_leitura')

    const comMotivo = validarItem(
      item({ elevador_final: 8100, justificativa_leitura: 'Horímetro trocado na manutenção.' }),
      ctxItem(),
    )
    expect(comMotivo.podeSalvar).toBe(true)
  })

  it('bloqueia leitura de elevador em frota sem elevador', () => {
    const semElevador = { ...colhedora, tem_horimetro_elevador: false }
    const r = validarItem(item(), ctxItem({ frota: semElevador }))
    expect(codigos(r)).toContain('SEM_ELEVADOR')
  })

  it('oferece a última leitura conhecida quando a inicial está longe dela', () => {
    const r = validarItem(item(), ctxItem({ ultimasLeituras: { horimetro_elevador: ultima('horimetro_elevador', 8200) } }))
    const achado = r.achados.find((a) => a.codigo === 'ELEVADOR_INICIAL_LONGE_DA_ULTIMA')
    expect(achado?.sugestao?.valor).toBe(8200)
  })

  it('fica calado quando a inicial casa com a última conhecida', () => {
    const r = validarItem(item(), ctxItem({ ultimasLeituras: { horimetro_elevador: ultima('horimetro_elevador', 8112.5) } }))
    expect(codigos(r)).not.toContain('ELEVADOR_INICIAL_LONGE_DA_ULTIMA')
  })

  it('avisa quilometragem impossível para um turno', () => {
    const r = validarItem(item({ odometro_final: 1000 + 500 }), ctxItem())
    expect(codigos(r)).toContain('KM_ALTO')
  })

  it('avisa horas de elevador acima da duração do turno', () => {
    const r = validarItem(item({ elevador_final: 8112.5 + 10 }), ctxItem())
    expect(codigos(r)).toContain('ELEVADOR_ALTO')
  })

  // Colhedora que andou mas não moveu o elevador não colheu nada.
  it('avisa colhedora que andou sem rodar o elevador', () => {
    const r = validarItem(item({ elevador_final: 8112.5 }), ctxItem())
    expect(codigos(r)).toContain('ELEVADOR_PARADO')
  })
})

describe('fechamento da ficha', () => {
  it('não fecha ficha vazia', () => {
    expect(pendenciasParaFechar([])).toContain('A ficha não tem nenhum funcionário lançado.')
  })

  it('cobra as assinaturas que faltam', () => {
    const pendencias = pendenciasParaFechar([item({ assinado: false }), item({ id: 'i-2', assinado: false })])
    expect(pendencias).toContain('2 funcionários ainda não assinaram.')
  })

  it('cobra leitura final começada e não terminada', () => {
    const pendencias = pendenciasParaFechar([item({ elevador_final: null })])
    expect(pendencias).toContain('1 linha está sem a leitura final.')
  })

  it('libera quando está tudo completo', () => {
    expect(pendenciasParaFechar([item()])).toEqual([])
  })
})
