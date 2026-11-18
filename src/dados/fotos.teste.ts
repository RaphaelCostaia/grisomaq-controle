import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from './db'
import { ErroApi } from './api'

const chamarFalso = vi.hoisted(() => vi.fn())
vi.mock('./api', async (original) => ({
  ...(await original<typeof import('./api')>()),
  chamar: chamarFalso,
}))
// O fake-indexeddb devolve o Blob como objeto vazio (ver abaixo); a conversão
// para base64 é simulada para o teste chegar até a resposta do servidor.
vi.mock('@/utilitarios/base64', () => ({ blobParaBase64: async () => 'AAAA' }))
import {
  confirmarFotosDoRascunho,
  enfileirarFoto,
  enviarFotosPendentes,
  fotoDoAbastecimento,
  fotosPendentesDoDispositivo,
  removerFoto,
} from './fotos'

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

  /**
   * Horímetro, início e fim da registradora são fotos diferentes da mesma
   * ficha. Refotografar uma não pode apagar as outras.
   */
  it('guarda uma foto de cada papel na mesma ficha', async () => {
    await enfileirarFoto('abast-1', new Blob(['h'], { type: 'image/jpeg' }), 'horimetro')
    await enfileirarFoto('abast-1', new Blob(['i'], { type: 'image/jpeg' }), 'registrador_inicio')
    await enfileirarFoto('abast-1', new Blob(['f'], { type: 'image/jpeg' }), 'registrador_fim')
    await enfileirarFoto('abast-1', new Blob(['f2'], { type: 'image/jpeg' }), 'registrador_fim')
    expect(await fotosPendentesDoDispositivo()).toBe(3)
    expect(await fotoDoAbastecimento('abast-1', 'registrador_inicio')).not.toBeNull()
  })

  /** Foto de ficha ainda em preenchimento não sobe: a ficha não existe no servidor. */
  it('foto de rascunho só entra na fila quando a ficha é salva', async () => {
    await enfileirarFoto('abast-1', new Blob(['i'], { type: 'image/jpeg' }), 'registrador_inicio', { rascunho: true })
    expect(await fotosPendentesDoDispositivo()).toBe(0)
    expect(await fotoDoAbastecimento('abast-1', 'registrador_inicio')).not.toBeNull()

    await confirmarFotosDoRascunho('abast-1')
    expect(await fotosPendentesDoDispositivo()).toBe(1)
  })

  /**
   * "Abastecimento inexistente" quase sempre é a ficha que ainda não subiu
   * neste ciclo. Apagar a foto aqui perderia a prova do número da bomba.
   */
  it('mantém a foto na fila quando a ficha ainda não chegou ao servidor', async () => {
    chamarFalso.mockRejectedValueOnce(new ErroApi(404, 'ABASTECIMENTO_INEXISTENTE'))
    await enfileirarFoto('abast-1', new Blob(['i'], { type: 'image/jpeg' }), 'registrador_inicio')

    const { falhas } = await enviarFotosPendentes()

    expect(falhas).toBe(1)
    const [foto] = await db.foto_pendentes.toArray()
    expect(foto?.erro).toContain('ABASTECIMENTO_INEXISTENTE')
    expect(foto?.tentativas).toBe(1)
    expect(new Date(foto!.proxima_tentativa_em).getTime()).toBeGreaterThan(Date.now())
  })

  it('remove só a foto do papel pedido', async () => {
    await enfileirarFoto('abast-1', new Blob(['i'], { type: 'image/jpeg' }), 'registrador_inicio')
    await enfileirarFoto('abast-1', new Blob(['f'], { type: 'image/jpeg' }), 'registrador_fim')
    await removerFoto('abast-1', 'registrador_inicio')
    expect(await fotoDoAbastecimento('abast-1', 'registrador_inicio')).toBeNull()
    expect(await fotoDoAbastecimento('abast-1', 'registrador_fim')).not.toBeNull()
  })
})
