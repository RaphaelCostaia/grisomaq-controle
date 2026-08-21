import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './db'
import { enfileirar, proximoLote } from './outbox'
import { MAX_TENTATIVAS, proximaEspera } from './sincronizacao/backoff'

const TABELA = 'abastecimentos'

beforeEach(async () => {
  await db.outbox.clear()
})

describe('coalescência da fila', () => {
  it('funde a edição no insert que ainda não subiu', async () => {
    await enfileirar({ tabela: TABELA, registro_id: 'a1', tipo: 'inserir', payload: { litros: 45, hora: '14:32' } })
    await enfileirar({ tabela: TABELA, registro_id: 'a1', tipo: 'atualizar', payload: { litros: 46 } })
    await enfileirar({ tabela: TABELA, registro_id: 'a1', tipo: 'atualizar', payload: { litros: 47 } })

    const fila = await db.outbox.toArray()
    expect(fila).toHaveLength(1)
    expect(fila[0]?.tipo).toBe('inserir')
    // A correção entra no insert; o resto do payload original sobrevive.
    expect(fila[0]?.payload).toEqual({ litros: 47, hora: '14:32' })
  })

  it('funde edições sucessivas de um registro já sincronizado', async () => {
    await enfileirar({ tabela: TABELA, registro_id: 'a2', tipo: 'atualizar', payload: { litros: 10 }, base_versao: 3 })
    await enfileirar({ tabela: TABELA, registro_id: 'a2', tipo: 'atualizar', payload: { odometro: 900 } })

    const fila = await db.outbox.toArray()
    expect(fila).toHaveLength(1)
    expect(fila[0]?.payload).toEqual({ litros: 10, odometro: 900 })
    expect(fila[0]?.base_versao).toBe(3)
  })

  it('some com a operação inteira quando o registro é apagado antes de subir', async () => {
    await enfileirar({ tabela: TABELA, registro_id: 'a3', tipo: 'inserir', payload: { litros: 45 } })
    await enfileirar({ tabela: TABELA, registro_id: 'a3', tipo: 'atualizar', payload: { litros: 46 } })
    await enfileirar({ tabela: TABELA, registro_id: 'a3', tipo: 'excluir', payload: {} })

    // Mandar inserir-e-depois-excluir seria trabalho à toa e deixaria uma linha
    // morta no servidor.
    expect(await db.outbox.count()).toBe(0)
  })

  it('mantém a exclusão de um registro que já existe no servidor', async () => {
    await enfileirar({ tabela: TABELA, registro_id: 'a4', tipo: 'excluir', payload: {}, base_versao: 2 })
    const fila = await db.outbox.toArray()
    expect(fila).toHaveLength(1)
    expect(fila[0]?.tipo).toBe('excluir')
  })

  it('não mistura registros diferentes', async () => {
    await enfileirar({ tabela: TABELA, registro_id: 'a5', tipo: 'inserir', payload: { litros: 1 } })
    await enfileirar({ tabela: TABELA, registro_id: 'a6', tipo: 'inserir', payload: { litros: 2 } })
    expect(await db.outbox.count()).toBe(2)
  })
})

describe('ordem de envio', () => {
  it('entrega o lote em ordem cronológica, para o pai subir antes do filho', async () => {
    await enfileirar({ tabela: 'apontamentos', registro_id: 'cab', tipo: 'inserir', payload: {} })
    await enfileirar({ tabela: 'apontamento_itens', registro_id: 'item-1', tipo: 'inserir', payload: {} })
    await enfileirar({ tabela: 'apontamento_itens', registro_id: 'item-2', tipo: 'inserir', payload: {} })

    const lote = await proximoLote()
    expect(lote.map((i) => i.registro_id)).toEqual(['cab', 'item-1', 'item-2'])
  })

  it('respeita o limite de tamanho do lote', async () => {
    for (let i = 0; i < 30; i++) {
      await enfileirar({ tabela: TABELA, registro_id: 'r' + i, tipo: 'inserir', payload: {} })
    }
    expect(await proximoLote()).toHaveLength(25)
    expect(await proximoLote(5)).toHaveLength(5)
  })

  it('não entrega item cuja espera de retentativa ainda não venceu', async () => {
    await enfileirar({ tabela: TABELA, registro_id: 'a7', tipo: 'inserir', payload: {} })
    const item = (await db.outbox.toArray())[0]!
    await db.outbox.update(item.op_id, {
      proxima_tentativa_em: new Date(Date.now() + 60_000).toISOString(),
    })
    expect(await proximoLote()).toHaveLength(0)
  })
})

describe('espera entre tentativas', () => {
  it('cresce a cada tentativa', () => {
    const primeira = proximaEspera(0)
    const quarta = proximaEspera(3)
    expect(quarta).toBeGreaterThan(primeira)
  })

  it('não passa do teto de 15 minutos', () => {
    for (let t = 0; t <= MAX_TENTATIVAS; t++) {
      expect(proximaEspera(t)).toBeLessThanOrEqual(15 * 60_000)
    }
  })

  // Sem dispersão, os dez celulares do comboio reencontram sinal no mesmo minuto
  // e passam a tentar de novo em rebanho, batendo juntos no servidor.
  it('dispersa as tentativas em vez de sincronizá-las', () => {
    const amostras = new Set(Array.from({ length: 40 }, () => proximaEspera(4)))
    expect(amostras.size).toBeGreaterThan(20)
  })
})
