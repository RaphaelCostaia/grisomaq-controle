import { db, type ItemOutbox } from './db'
import { novoIdOperacao } from '@/utilitarios/id'
import { idDoDispositivo, versaoDoApp } from '@/utilitarios/dispositivo'

export interface Enfileiramento {
  tabela: string
  registro_id: string
  tipo: ItemOutbox['tipo']
  payload: Record<string, unknown>
  base_versao?: number | null
  pin_cifrado?: string
}

/**
 * Coloca uma mutacao na fila. Chamado SEMPRE dentro da mesma transacao Dexie
 * que grava o registro de dominio: ou os dois entram, ou nenhum. Um registro
 * gravado sem item de fila seria um lancamento que nunca sobe e ninguem percebe.
 *
 * Coalescencia: se o registro ainda tem um `inserir` pendente, uma edicao e
 * FUNDIDA nele em vez de virar operacao nova. Sem isso, o operador corrigindo o
 * mesmo campo cinco vezes geraria cinco operacoes, e o servidor aplicaria as
 * cinco em sequencia para chegar no mesmo lugar.
 */
export async function enfileirar(e: Enfileiramento): Promise<void> {
  const pendentes = await db.outbox
    .where('[tabela+registro_id]')
    .equals([e.tabela, e.registro_id])
    .filter((i) => i.status === 'pendente')
    .toArray()

  const insercaoPendente = pendentes.find((i) => i.tipo === 'inserir')

  if (insercaoPendente && e.tipo === 'atualizar') {
    await db.outbox.update(insercaoPendente.op_id, {
      payload: { ...insercaoPendente.payload, ...e.payload },
    })
    return
  }

  // Excluir um registro que nem chegou ao servidor: some a operacao inteira.
  // Mandar inserir-e-depois-excluir seria trabalho a toa e ainda deixaria uma
  // linha morta no banco.
  if (insercaoPendente && e.tipo === 'excluir') {
    await db.outbox.delete(insercaoPendente.op_id)
    for (const i of pendentes.filter((p) => p.tipo === 'atualizar')) {
      await db.outbox.delete(i.op_id)
    }
    return
  }

  // Varias edicoes seguidas de um registro ja sincronizado tambem se fundem.
  const atualizacaoPendente = pendentes.find((i) => i.tipo === 'atualizar')
  if (atualizacaoPendente && e.tipo === 'atualizar') {
    await db.outbox.update(atualizacaoPendente.op_id, {
      payload: { ...atualizacaoPendente.payload, ...e.payload },
    })
    return
  }

  const item: ItemOutbox = {
    op_id: novoIdOperacao(),
    tabela: e.tabela,
    registro_id: e.registro_id,
    tipo: e.tipo,
    payload: e.payload,
    base_versao: e.base_versao ?? null,
    criado_em_dispositivo: new Date().toISOString(),
    status: 'pendente',
    tentativas: 0,
    proxima_tentativa_em: new Date().toISOString(),
    erro_codigo: null,
    erro_mensagem: null,
    ...(e.pin_cifrado ? { pin_cifrado: e.pin_cifrado } : {}),
  }

  await db.outbox.add(item)
}

/** Proximo lote a enviar, em ordem cronologica de op_id (UUIDv7). */
export async function proximoLote(tamanho = 25): Promise<ItemOutbox[]> {
  const agora = new Date().toISOString()
  const prontos = await db.outbox
    .where('status')
    .equals('pendente')
    .filter((i) => i.proxima_tentativa_em <= agora)
    .toArray()

  // A ordem importa: UUIDv7 e ordenavel no tempo, entao o cabecalho do
  // apontamento sobe antes dos itens que dependem dele.
  return prontos.sort((a, b) => a.op_id.localeCompare(b.op_id)).slice(0, tamanho)
}

export function contextoDoPush() {
  return { dispositivo_id: idDoDispositivo(), app_versao: versaoDoApp }
}
