import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './db'
import { enfileirarFoto, fotoDoAbastecimento, fotosPendentesDoDispositivo } from './fotos'

/**
 * Estes testes exercitam a FILA — a lógica de deduplicar por abastecimento e
 * cachear a próxima tentativa. Não conferem o conteúdo do Blob porque o
 * `fake-indexeddb` do jsdom não preserva Blob no structured clone; devolve um
 * Object vazio. No navegador de verdade o Blob é gravado e recuperado
 * intacto — isso é conferido no teste manual do celular.
 */
describe('fila de fotos', () => {
  beforeEach(async () => {
    await db.foto_pendentes.clear()
  })

  it('guarda uma foto para o abastecimento', async () => {
    await enfileirarFoto('abast-1', new Blob(['abc'], { type: 'image/jpeg' }))
    expect(await fotosPendentesDoDispositivo()).toBe(1)
    expect(await fotoDoAbastecimento('abast-1')).not.toBeNull()
  })

  /**
   * Refazer é frequente: o operador tira, sai ruim, tenta de novo. Se a fila
   * acumulasse, o servidor receberia duas — e a de menor qualidade poderia
   * ser a que chegasse primeiro e virasse a "definitiva" no escritório. Uma
   * foto por abastecimento, sempre a mais recente.
   */
  it('substitui a foto anterior em vez de somar', async () => {
    await enfileirarFoto('abast-1', new Blob(['antiga'], { type: 'image/jpeg' }))
    await enfileirarFoto('abast-1', new Blob(['nova'], { type: 'image/jpeg' }))
    expect(await fotosPendentesDoDispositivo()).toBe(1)
  })

  it('mantém fotos de abastecimentos diferentes em paralelo', async () => {
    await enfileirarFoto('a', new Blob(['x'], { type: 'image/jpeg' }))
    await enfileirarFoto('b', new Blob(['yy'], { type: 'image/jpeg' }))
    expect(await fotosPendentesDoDispositivo()).toBe(2)
    expect(await fotoDoAbastecimento('a')).not.toBeNull()
    expect(await fotoDoAbastecimento('b')).not.toBeNull()
  })

  it('devolve nulo quando não há foto para o abastecimento', async () => {
    expect(await fotoDoAbastecimento('inexistente')).toBeNull()
  })
})
