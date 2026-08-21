import { db, type ItemOutbox } from '../db'
import { supabase } from '../supabase'
import { contextoDoPush, proximoLote } from '../outbox'
import { MAX_TENTATIVAS, momentoDaProximaTentativa } from './backoff'

type StatusOperacao = 'aplicada' | 'duplicada' | 'conflito' | 'rejeitada'

interface ResultadoOperacao {
  op_id: string
  status: StatusOperacao
  erro_codigo?: string
  erro_mensagem?: string
}

interface RespostaPush {
  servidor_agora: string
  resultados: ResultadoOperacao[]
}

export interface SaidaPush {
  enviadas: number
  aplicadas: number
  conflitos: number
  /** Diferenca entre o relogio local e o do servidor. */
  desvioRelogioMs: number | null
  versaoObsoleta: boolean
  erro: string | null
}

const TIMEOUT_MS = 20_000

/**
 * Envia um lote da fila. Nao lanca excecao por falha de rede: sem sinal e o
 * estado NORMAL deste app, nao uma condicao de erro. A fila simplesmente
 * permanece e o motor tenta de novo.
 */
export async function enviarLote(): Promise<SaidaPush> {
  const lote = await proximoLote()
  const vazio: SaidaPush = {
    enviadas: 0, aplicadas: 0, conflitos: 0, desvioRelogioMs: null, versaoObsoleta: false, erro: null,
  }
  if (lote.length === 0) return vazio

  await marcarEnviando(lote)

  const { dispositivo_id, app_versao } = contextoDoPush()
  const enviadoEm = Date.now()

  let resposta: RespostaPush
  try {
    resposta = await comTimeout(
      supabase.rpc('sync_push', {
        p_operacoes: lote.map(paraOperacao),
        p_dispositivo_id: dispositivo_id,
        p_app_versao: app_versao,
      }),
    )
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : String(erro)
    if (/VERSAO_OBSOLETA/.test(mensagem)) {
      await devolverParaFila(lote, 'VERSAO_OBSOLETA', 'Atualize o aplicativo para enviar os lançamentos.')
      return { ...vazio, enviadas: lote.length, versaoObsoleta: true, erro: mensagem }
    }
    await devolverParaFila(lote, 'FALHA_ENVIO', mensagem)
    return { ...vazio, enviadas: lote.length, erro: mensagem }
  }

  const porOpId = new Map(resposta.resultados.map((r) => [r.op_id, r]))
  let aplicadas = 0
  let conflitos = 0
  // Capturado ANTES de concluir: `concluir` apaga o item da fila, e com ele o
  // PIN cifrado que a revalidação precisa.
  const paraRevalidar: Array<{ assinatura_id: string; pin_cifrado: string }> = []

  for (const item of lote) {
    const resultado = porOpId.get(item.op_id)

    // Operacao enviada e nao respondida: nao pode ser dada como perdida nem como
    // aplicada. Volta para a fila - o trinco de idempotencia do servidor garante
    // que reenviar nao duplica.
    if (!resultado) {
      await devolverParaFila([item], 'SEM_RESPOSTA', 'O servidor não respondeu sobre este lançamento.')
      continue
    }

    switch (resultado.status) {
      // 'duplicada' e sucesso, nao falha: significa que o servidor ja tinha
      // gravado e so a resposta anterior se perdeu no sinal.
      case 'aplicada':
      case 'duplicada':
        aplicadas++
        if (item.tabela === 'assinaturas_aceite' && item.pin_cifrado) {
          paraRevalidar.push({ assinatura_id: item.registro_id, pin_cifrado: item.pin_cifrado })
        }
        await concluir(item, 'sincronizado')
        break

      case 'conflito':
        conflitos++
        await concluir(item, 'conflito', resultado.erro_codigo ?? 'CONFLITO')
        break

      case 'rejeitada':
        await devolverParaFila([item], resultado.erro_codigo ?? 'REJEITADA', resultado.erro_mensagem ?? null)
        break
    }
  }

  await revalidarAssinaturas(paraRevalidar)

  // O relogio do celular e comparado com o do servidor a cada push. Hora errada
  // corrompe permanencia de caminhao e horario de abastecimento em silencio.
  const desvioRelogioMs = enviadoEm - new Date(resposta.servidor_agora).getTime()

  return { enviadas: lote.length, aplicadas, conflitos, desvioRelogioMs, versaoObsoleta: false, erro: null }
}

/**
 * Pede ao servidor que confira os PINs dos aceites que acabaram de subir.
 *
 * Falhar aqui nao e grave e nao volta para a fila: a assinatura ja esta gravada
 * e continua marcada como pendente de revalidacao. O painel do escritorio lista
 * as pendentes, e a proxima subida tenta de novo.
 */
async function revalidarAssinaturas(
  assinaturas: Array<{ assinatura_id: string; pin_cifrado: string }>,
): Promise<void> {
  if (assinaturas.length === 0) return

  try {
    const { data } = await supabase.functions.invoke<{
      resultados: Array<{ assinatura_id: string; validacao: string }>
    }>('verificar-assinaturas', { body: { assinaturas } })

    for (const r of data?.resultados ?? []) {
      if (r.validacao === 'validado_servidor' || r.validacao === 'invalida') {
        await db.assinaturas_aceite.update(r.assinatura_id, { validacao_pin: r.validacao })
      }
    }
  } catch {
    // Sem rede no meio do lote: fica para a proxima janela de sinal.
  }
}

function paraOperacao(i: ItemOutbox) {
  return {
    op_id: i.op_id,
    tabela: i.tabela,
    registro_id: i.registro_id,
    tipo: i.tipo,
    payload: i.payload,
    base_versao: i.base_versao,
  }
}

async function marcarEnviando(lote: ItemOutbox[]): Promise<void> {
  await db.transaction('rw', db.outbox, async () => {
    for (const i of lote) await db.outbox.update(i.op_id, { status: 'enviando' })
  })
}

/** Tira da fila e carimba o registro de dominio com o estado final. */
async function concluir(item: ItemOutbox, marca: 'sincronizado' | 'conflito', erro?: string): Promise<void> {
  const tabela = tabelaLocal(item.tabela)
  await db.transaction('rw', [db.outbox, ...tabelasTransacionais()], async () => {
    await db.outbox.delete(item.op_id)
    if (tabela) {
      await tabela.update(item.registro_id, erro ? { _sync: marca, _erro: erro } : { _sync: marca })
    }
  })
}

async function devolverParaFila(lote: ItemOutbox[], codigo: string, mensagem: string | null): Promise<void> {
  await db.transaction('rw', [db.outbox, ...tabelasTransacionais()], async () => {
    for (const i of lote) {
      const tentativas = i.tentativas + 1
      // Depois de oito tentativas, parar de tentar em silencio e pior do que
      // avisar: o operador precisa saber que aquele turno nao subiu.
      const esgotou = tentativas >= MAX_TENTATIVAS
      await db.outbox.update(i.op_id, {
        status: esgotou ? 'erro' : 'pendente',
        tentativas,
        proxima_tentativa_em: momentoDaProximaTentativa(tentativas),
        erro_codigo: codigo,
        erro_mensagem: mensagem,
      })
      const tabela = tabelaLocal(i.tabela)
      if (tabela) await tabela.update(i.registro_id, { _sync: esgotou ? 'erro' : 'pendente' })
    }
  })
}

function tabelasTransacionais() {
  return [db.caminhao_ciclos, db.apontamentos, db.apontamento_itens, db.abastecimentos, db.assinaturas_aceite]
}

function tabelaLocal(nome: string) {
  switch (nome) {
    case 'caminhao_ciclos': return db.caminhao_ciclos
    case 'apontamentos': return db.apontamentos
    case 'apontamento_itens': return db.apontamento_itens
    case 'abastecimentos': return db.abastecimentos
    case 'assinaturas_aceite': return db.assinaturas_aceite
    default: return null
  }
}

async function comTimeout<T>(promessa: PromiseLike<{ data: T | null; error: unknown }>): Promise<T> {
  const resultado = await Promise.race([
    promessa,
    new Promise<never>((_, rejeitar) =>
      setTimeout(() => rejeitar(new Error('TEMPO_ESGOTADO')), TIMEOUT_MS),
    ),
  ])
  if (resultado.error) {
    const e = resultado.error as { message?: string }
    throw new Error(e.message ?? 'Falha no envio')
  }
  if (!resultado.data) throw new Error('Resposta vazia do servidor')
  return resultado.data
}
