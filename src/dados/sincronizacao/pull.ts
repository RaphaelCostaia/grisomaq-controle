import { CHAVES_META, db, gravarMeta, lerMeta } from '../db'
import { chamar } from '../api'

interface RespostaPull {
  servidor_agora: string
  mestres: Record<string, unknown[]>
  transacionais: Record<string, Array<Record<string, unknown>>>
}

/**
 * Baixa mestres e lancamentos alterados desde a ultima marca d'agua.
 *
 * Regra que nao pode ser quebrada: NUNCA sobrescrever um registro local que
 * ainda nao subiu. O servidor nao conhece a correcao que o operador acabou de
 * fazer no celular; deixar o pull passar por cima dela apagaria trabalho.
 */
export async function baixarAlteracoes(): Promise<{ baixados: number; erro: string | null }> {
  const desde = await lerMeta<string>(CHAVES_META.ultimoPull)

  let resposta: RespostaPull
  try {
    resposta = await chamar<RespostaPull>('/sync/pull', { corpo: { desde: desde ?? null } })
  } catch (erro) {
    return { baixados: 0, erro: erro instanceof Error ? erro.message : String(erro) }
  }
  let baixados = 0

  await db.transaction(
    'rw',
    [
      db.mestre_fazendas, db.mestre_frentes, db.mestre_turnos, db.mestre_funcionarios,
      db.mestre_frotas, db.mestre_veiculos, db.mestre_lideres, db.mestre_blocos,
      db.mestre_ultimas_leituras,
      db.caminhao_ciclos, db.apontamentos, db.apontamento_itens, db.abastecimentos,
      db.meta,
    ],
    async () => {
      const m = resposta.mestres
      baixados += await gravarMestre(db.mestre_fazendas, m.fazendas)
      baixados += await gravarMestre(db.mestre_frentes, m.frentes)
      baixados += await gravarMestre(db.mestre_turnos, m.turnos)
      baixados += await gravarMestre(db.mestre_funcionarios, m.funcionarios)
      baixados += await gravarMestre(db.mestre_frotas, m.frotas)
      baixados += await gravarMestre(db.mestre_veiculos, m.veiculos_transporte)
      baixados += await gravarMestre(db.mestre_lideres, m.lideres)
      baixados += await gravarMestre(db.mestre_blocos, m.blocos)

      // As ultimas leituras vem inteiras a cada pull, sem marca d'agua: e o dado
      // que sustenta a validacao "esta leitura esta longe da anterior", e ele
      // precisa estar correto no celular mesmo depois de dias offline.
      if (Array.isArray(m.ultimas_leituras)) {
        await db.mestre_ultimas_leituras.clear()
        await db.mestre_ultimas_leituras.bulkPut(m.ultimas_leituras as never[])
        baixados += m.ultimas_leituras.length
      }

      if (Array.isArray(m.parametros)) {
        await gravarMeta('parametros', m.parametros)
      }

      const t = resposta.transacionais
      baixados += await mesclarTransacional(db.caminhao_ciclos, t.caminhao_ciclos)
      baixados += await mesclarTransacional(db.apontamentos, t.apontamentos)
      baixados += await mesclarTransacional(db.apontamento_itens, t.apontamento_itens)
      baixados += await mesclarTransacional(db.abastecimentos, t.abastecimentos)

      await db.meta.put({ chave: CHAVES_META.ultimoPull, valor: resposta.servidor_agora })
    },
  )

  return { baixados, erro: null }
}

type TabelaDexie = { bulkPut(itens: never[]): Promise<unknown>; get(chave: string): Promise<unknown> }

async function gravarMestre(tabela: TabelaDexie, linhas: unknown[] | undefined): Promise<number> {
  if (!Array.isArray(linhas) || linhas.length === 0) return 0
  await tabela.bulkPut(linhas as never[])
  return linhas.length
}

/**
 * Mescla lancamentos vindos do servidor. Um registro local com `_sync` diferente
 * de 'sincronizado' esta a frente do servidor - ele fica.
 */
async function mesclarTransacional(
  tabela: { get(id: string): Promise<{ _sync?: string } | undefined>; bulkPut(itens: never[]): Promise<unknown> },
  linhas: Array<Record<string, unknown>> | undefined,
): Promise<number> {
  if (!Array.isArray(linhas) || linhas.length === 0) return 0

  const aceitos: Array<Record<string, unknown>> = []
  for (const linha of linhas) {
    const local = await tabela.get(linha.id as string)
    if (local && local._sync && local._sync !== 'sincronizado') continue
    aceitos.push({ ...linha, _sync: 'sincronizado' })
  }

  if (aceitos.length > 0) await tabela.bulkPut(aceitos as never[])
  return aceitos.length
}
