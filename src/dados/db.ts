import Dexie, { type EntityTable } from 'dexie'
import type {
  Abastecimento,
  Apontamento,
  ApontamentoItem,
  AssinaturaAceite,
  BlocoAbastecimento,
  CaminhaoCiclo,
  Fazenda,
  Frente,
  Frota,
  Funcionario,
  Lider,
  Turno,
  UltimaLeitura,
  VeiculoTransporte,
} from '@/dominio/tipos'

/** Uma mutacao esperando sinal. E o unico caminho de escrita para o servidor. */
export interface ItemOutbox {
  op_id: string
  tabela: string
  registro_id: string
  tipo: 'inserir' | 'atualizar' | 'excluir'
  payload: Record<string, unknown>
  base_versao: number | null
  criado_em_dispositivo: string
  status: 'pendente' | 'enviando' | 'erro'
  tentativas: number
  proxima_tentativa_em: string
  erro_codigo: string | null
  erro_mensagem: string | null
  /** PIN cifrado com RSA-OAEP, so em operacoes de assinatura. Apagado apos o push. */
  pin_cifrado?: string
}

/** Verificador Argon2id para conferir o PIN sem rede. */
export interface VerificadorPin {
  funcionario_id: string
  algoritmo: 'argon2id'
  parametros: { m: number; t: number; p: number }
  salt: string
  hash: string
  atualizado_em: string
}

/** Chave/valor de controle: watermark do pull, sessao de campo, contadores. */
export interface Meta {
  chave: string
  valor: unknown
}

/**
 * Base local do app. E a fonte de verdade da UI: nenhuma tela le do Supabase.
 * O motor de sincronizacao e o unico componente que conhece a rede.
 */
export class BaseGrisomaq extends Dexie {
  // Mestres (somente leitura em campo - vem do sync_pull)
  mestre_fazendas!: EntityTable<Fazenda, 'id'>
  mestre_frentes!: EntityTable<Frente, 'id'>
  mestre_turnos!: EntityTable<Turno, 'id'>
  mestre_funcionarios!: EntityTable<Funcionario, 'id'>
  mestre_frotas!: EntityTable<Frota, 'id'>
  mestre_veiculos!: EntityTable<VeiculoTransporte, 'id'>
  mestre_lideres!: EntityTable<Lider, 'id'>
  mestre_blocos!: EntityTable<BlocoAbastecimento, 'id'>
  mestre_ultimas_leituras!: EntityTable<UltimaLeitura, 'frota_id'>

  // Transacionais
  caminhao_ciclos!: EntityTable<CaminhaoCiclo, 'id'>
  apontamentos!: EntityTable<Apontamento, 'id'>
  apontamento_itens!: EntityTable<ApontamentoItem, 'id'>
  abastecimentos!: EntityTable<Abastecimento, 'id'>
  assinaturas_aceite!: EntityTable<AssinaturaAceite, 'id'>

  // Infraestrutura
  outbox!: EntityTable<ItemOutbox, 'op_id'>
  pin_verificadores!: EntityTable<VerificadorPin, 'funcionario_id'>
  meta!: EntityTable<Meta, 'chave'>

  constructor() {
    super('grisomaq_controle')

    this.version(1).stores({
      mestre_fazendas: '&id, codigo, ativo',
      mestre_frentes: '&id, codigo, ativo',
      mestre_turnos: '&id, codigo, escala, ativo',
      mestre_funcionarios: '&id, codigo, nome, ativo',
      mestre_frotas: '&id, numero, tipo, ativo',
      mestre_veiculos: '&id, numero, tipo, ativo',
      mestre_lideres: '&id, nome, ativo',
      mestre_blocos: '&id, dispositivo_id, ativo',
      // Chave composta: a validacao pergunta "ultima leitura de horimetro da frota X".
      mestre_ultimas_leituras: '&[frota_id+tipo], frota_id',

      caminhao_ciclos: '&id, data, caminhao_id, saida_em, _sync, [data+_sync]',
      apontamentos: '&id, data, &[data+frente_id+turno_id], _sync',
      apontamento_itens: '&id, apontamento_id, [apontamento_id+seq], funcionario_id, _sync',
      abastecimentos: '&id, data, &numero_documento, frota_id, comboio_frota_id, _sync, [data+_sync]',
      assinaturas_aceite: '&id, [tipo_documento+documento_id], funcionario_id, _sync',

      outbox: '&op_id, status, proxima_tentativa_em, [tabela+registro_id]',
      pin_verificadores: '&funcionario_id',
      meta: '&chave',
    })
  }
}

export const db = new BaseGrisomaq()

// --- Acesso a tabela meta --------------------------------------------------

export const CHAVES_META = {
  sessaoCampo: 'sessao_campo',
  ultimoPull: 'ultimo_pull',
  ultimoSyncOk: 'ultimo_sync_ok',
  desvioRelogioMs: 'desvio_relogio_ms',
  ultimoBloqueioTela: 'ultimo_bloqueio_tela',
} as const

export async function lerMeta<T>(chave: string): Promise<T | undefined> {
  return (await db.meta.get(chave))?.valor as T | undefined
}

export async function gravarMeta(chave: string, valor: unknown): Promise<void> {
  await db.meta.put({ chave, valor })
}

/**
 * Limpeza no logout. Preserva `outbox` e as transacionais nao sincronizadas:
 * apagar a fila junto com a sessao ja custou turno de trabalho em outros
 * sistemas de campo, e o dado ainda nao chegou ao servidor.
 */
export async function limparDadosDeSessao(): Promise<void> {
  await db.transaction('rw', db.pin_verificadores, db.meta, async () => {
    await db.pin_verificadores.clear()
    await db.meta.delete(CHAVES_META.sessaoCampo)
  })
}

/** Total real da fila, incluindo assinaturas. Usado para bloquear o logout. */
export async function totalPendentes(): Promise<number> {
  return db.outbox.where('status').anyOf('pendente', 'enviando', 'erro').count()
}

/**
 * Quantos LANCAMENTOS o operador tem esperando sinal.
 *
 * A assinatura sobe como uma operacao propria, mas para quem preencheu ela nao
 * e um lancamento separado - e parte da mesma ficha. Contar as duas faria a
 * barra dizer "2 esperando" para uma unica ficha na tela, e o operador iria
 * procurar a segunda.
 */
export async function lancamentosPendentes(): Promise<number> {
  return db.outbox
    .where('status')
    .anyOf('pendente', 'enviando', 'erro')
    .filter((i) => i.tabela !== 'assinaturas_aceite')
    .count()
}
