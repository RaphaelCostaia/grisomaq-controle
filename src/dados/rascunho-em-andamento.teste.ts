import { beforeEach, describe, expect, it, vi } from 'vitest'
import { hojeOperacional, somarDias } from '@/utilitarios/datas'
import {
  CHAVE_RASCUNHO_ABASTECIMENTO,
  comeceiAPreencher,
  descartarRascunho,
  guardarRascunho,
  recuperarRascunho,
} from './rascunho-em-andamento'
import { gravarMeta } from './db'

const vazio: {
  frota_id: string | null
  horimetro_motor: number | null
  horimetro_elevador: number | null
  odometro: number | null
  registrador_fim: number | null
  litros: number | null
  operador_funcionario_id: string | null
} = {
  frota_id: null,
  horimetro_motor: null,
  horimetro_elevador: null,
  odometro: null,
  registrador_fim: null,
  litros: null,
  operador_funcionario_id: null,
}

describe('rascunho em andamento', () => {
  beforeEach(async () => {
    await descartarRascunho(CHAVE_RASCUNHO_ABASTECIMENTO)
    vi.useRealTimers()
  })

  it('devolve o que foi guardado hoje', async () => {
    await guardarRascunho(CHAVE_RASCUNHO_ABASTECIMENTO, { ...vazio, litros: 90 })
    const voltou = await recuperarRascunho<typeof vazio>(CHAVE_RASCUNHO_ABASTECIMENTO)
    expect(voltou?.litros).toBe(90)
  })

  it('não devolve nada quando não há rascunho', async () => {
    expect(await recuperarRascunho(CHAVE_RASCUNHO_ABASTECIMENTO)).toBeNull()
  })

  /**
   * Rascunho de ontem carrega hora, número de ficha e leituras de um turno que
   * já fechou. Ressuscitá-lo em silêncio é pior que perdê-lo: o operador
   * continuaria preenchendo uma ficha com a data errada.
   */
  it('descarta rascunho de outro dia operacional', async () => {
    await gravarMeta(CHAVE_RASCUNHO_ABASTECIMENTO, {
      data: somarDias(hojeOperacional(), -1),
      rascunho: { ...vazio, litros: 90 },
    })
    expect(await recuperarRascunho(CHAVE_RASCUNHO_ABASTECIMENTO)).toBeNull()
    // E some de vez, para não ficar sendo reavaliado a cada abertura de tela.
    expect(await recuperarRascunho(CHAVE_RASCUNHO_ABASTECIMENTO)).toBeNull()
  })
})

describe('começou a preencher', () => {
  it('ignora a ficha que só tem o que o app preencheu sozinho', () => {
    expect(comeceiAPreencher(vazio)).toBe(false)
  })

  it('reconhece qualquer campo de mão', () => {
    expect(comeceiAPreencher({ ...vazio, frota_id: 'f1' })).toBe(true)
    expect(comeceiAPreencher({ ...vazio, litros: 10 })).toBe(true)
    expect(comeceiAPreencher({ ...vazio, registrador_fim: 40280 })).toBe(true)
    expect(comeceiAPreencher({ ...vazio, operador_funcionario_id: 'p1' })).toBe(true)
  })

  // Zero é valor digitado, não ausência: um horímetro zerado é justamente o
  // caso raro que a ficha precisa registrar.
  it('trata zero como preenchido', () => {
    expect(comeceiAPreencher({ ...vazio, horimetro_motor: 0 })).toBe(true)
  })
})
