import { beforeEach, describe, expect, it, vi } from 'vitest'

const chamar = vi.fn()
vi.mock('../api', () => ({ chamar: (...args: unknown[]) => chamar(...args) }))

const { db, CHAVES_META, lerMeta } = await import('../db')
const { baixarAlteracoes } = await import('./pull')

const BLOCO = {
  id: 'bloco-1',
  numero_inicial: 6950,
  numero_final: 6999,
  dispositivo_id: 'celular-1',
  ativo: true,
}

/** Resposta de pull com um bloco novo e um abastecimento vindo do servidor. */
function resposta(
  abastecimentos: Array<Record<string, unknown>>,
  parametros?: Array<{ chave: string; valor: unknown }>,
) {
  return {
    servidor_agora: '2026-08-24T15:30:00.000-03:00',
    mestres: { blocos: [BLOCO], ...(parametros ? { parametros } : {}) },
    transacionais: { abastecimentos },
  }
}

describe('pull', () => {
  beforeEach(async () => {
    chamar.mockReset()
    await Promise.all([db.mestre_blocos.clear(), db.abastecimentos.clear(), db.meta.clear()])
  })

  it('grava mestres e avança a marca d’água', async () => {
    chamar.mockResolvedValue(resposta([]))

    const r = await baixarAlteracoes()

    expect(r.erro).toBeNull()
    expect(await db.mestre_blocos.count()).toBe(1)
    expect(await lerMeta(CHAVES_META.ultimoPull)).toBe('2026-08-24T15:30:00.000-03:00')
  })

  /**
   * O caso que derrubava tudo em campo: o servidor manda um lançamento cujo
   * número de ficha já existe no celular com OUTRO id — acontece em troca de
   * aparelho, reinstalação ou conflito resolvido pelo escritório.
   *
   * Antes, o índice único local abortava a transação inteira: o bloco de
   * numeração não entrava, a marca d’água não avançava, e o celular parava de
   * receber qualquer atualização — em silêncio, para sempre.
   */
  it('não deixa um número de ficha repetido derrubar o resto do pull', async () => {
    await db.abastecimentos.put({
      id: 'local-antigo',
      numero_documento: 6900,
      data: '2026-08-24',
      _sync: 'sincronizado',
    } as never)

    chamar.mockResolvedValue(
      resposta([{ id: 'servidor-novo', numero_documento: 6900, data: '2026-08-24' }]),
    )

    const r = await baixarAlteracoes()

    expect(r.erro).toBeNull()
    expect(await db.mestre_blocos.count()).toBe(1)
    expect(await db.abastecimentos.count()).toBe(2)
    expect(await lerMeta(CHAVES_META.ultimoPull)).toBe('2026-08-24T15:30:00.000-03:00')
  })

  it('preserva o lançamento local que ainda não subiu', async () => {
    await db.abastecimentos.put({
      id: 'mesmo-id',
      numero_documento: 6951,
      litros: 999,
      _sync: 'pendente',
    } as never)

    chamar.mockResolvedValue(resposta([{ id: 'mesmo-id', numero_documento: 6951, litros: 100 }]))

    await baixarAlteracoes()

    const guardado = await db.abastecimentos.get('mesmo-id')
    expect(guardado?.litros).toBe(999)
  })

  /**
   * Os parâmetros chegam filtrados pela marca d’água. Gravar a lista recebida
   * por cima apagava todos os outros — bastava um segundo sync sem mudança
   * nenhuma para o celular perder as tolerâncias configuradas pelo escritório e
   * validar pelos padrões de fábrica, sem avisar ninguém.
   */
  it('não perde os parâmetros num pull que não trouxe nenhum', async () => {
    chamar.mockResolvedValue(
      resposta([], [
        { chave: 'tolerancia_litros_abs', valor: 0.5 },
        { chave: 'km_max_turno', valor: 400 },
      ]),
    )
    await baixarAlteracoes()
    expect((await lerMeta<unknown[]>('parametros'))?.length).toBe(2)

    chamar.mockResolvedValue(resposta([], []))
    await baixarAlteracoes()
    expect((await lerMeta<unknown[]>('parametros'))?.length).toBe(2)
  })

  it('atualiza o parâmetro que mudou sem derrubar os demais', async () => {
    chamar.mockResolvedValue(
      resposta([], [
        { chave: 'tolerancia_litros_abs', valor: 0.5 },
        { chave: 'km_max_turno', valor: 400 },
      ]),
    )
    await baixarAlteracoes()

    chamar.mockResolvedValue(resposta([], [{ chave: 'km_max_turno', valor: 250 }]))
    await baixarAlteracoes()

    const guardados = (await lerMeta<Array<{ chave: string; valor: unknown }>>('parametros')) ?? []
    expect(guardados).toHaveLength(2)
    expect(guardados.find((p) => p.chave === 'km_max_turno')?.valor).toBe(250)
    expect(guardados.find((p) => p.chave === 'tolerancia_litros_abs')?.valor).toBe(0.5)
  })

  // Falhar não pode virar "atualizado": se a marca d’água avançasse sobre
  // linhas que não entraram, elas nunca mais seriam pedidas.
  it('não avança a marca d’água quando a gravação falha, e explica em português', async () => {
    chamar.mockResolvedValue({
      servidor_agora: '2026-08-24T15:30:00.000-03:00',
      mestres: { blocos: [BLOCO] },
      transacionais: { abastecimentos: [{ id: null }] },
    })

    const r = await baixarAlteracoes()

    expect(r.erro).toBeTruthy()
    expect(r.erro).not.toMatch(/bulkPut|ConstraintError/)
    expect(r.erro).toMatch(/lançamentos continuam salvos/i)
    expect(await lerMeta(CHAVES_META.ultimoPull)).toBeUndefined()
  })
})
