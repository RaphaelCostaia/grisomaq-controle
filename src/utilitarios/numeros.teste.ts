import { describe, expect, it } from 'vitest'
import { contar, formatarHoras, formatarLitros, formatarNumero, paraNumero } from './numeros'

describe('formatarNumero', () => {
  it('formata em pt-BR com casas fixas', () => {
    expect(formatarNumero(1234.5, 1)).toBe('1.234,5')
    expect(formatarNumero(0, 1)).toBe('0,0')
  })

  /**
   * NUMERIC do Postgres chega como texto quando a origem não passa pelos type
   * parsers do driver. Recusar a string fazia a tela mostrar "—" num número que
   * existe — e o pior é que aparecia só num ambiente, então validar localmente
   * não dizia nada sobre produção.
   */
  it('aceita o número que chega como texto', () => {
    expect(formatarNumero('31.1', 1)).toBe('31,1')
    expect(formatarNumero('0', 1)).toBe('0,0')
  })

  it('mostra travessão quando não há número', () => {
    expect(formatarNumero(null)).toBe('—')
    expect(formatarNumero(undefined)).toBe('—')
    expect(formatarNumero('')).toBe('—')
    expect(formatarNumero('abc')).toBe('—')
    expect(formatarNumero(Number.NaN)).toBe('—')
  })
})

// Unidade pendurada em travessão não quer dizer nada: "— h" não informa que o
// dado falta, informa que alguém concatenou sem olhar.
describe('unidades', () => {
  it('não pendura unidade em valor desconhecido', () => {
    expect(formatarHoras(null)).toBe('—')
    expect(formatarLitros(null)).toBe('—')
    expect(formatarLitros(undefined)).toBe('—')
  })

  it('escreve a unidade quando há valor', () => {
    expect(formatarHoras('31.1')).toBe('31,1 h')
    expect(formatarLitros(180)).toBe('180,0 L')
  })
})

describe('contar', () => {
  it('concorda singular e plural', () => {
    expect(contar(1, 'ficha hoje', 'fichas hoje')).toBe('1 ficha hoje')
    expect(contar(2, 'ficha hoje', 'fichas hoje')).toBe('2 fichas hoje')
    expect(contar(0, 'lançamento', 'lançamentos')).toBe('0 lançamentos')
  })
})

describe('paraNumero', () => {
  it('lê a vírgula decimal do painel da máquina', () => {
    expect(paraNumero('12.345,7')).toBe(12345.7)
    expect(paraNumero('')).toBeNull()
  })
})
