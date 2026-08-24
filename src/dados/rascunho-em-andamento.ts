import { CHAVES_META, gravarMeta, lerMeta } from './db'
import { hojeOperacional } from '@/utilitarios/datas'

/**
 * Guarda o formulário em andamento na base local.
 *
 * O app sobrevive uma semana sem rede, mas perdia tudo num recarregamento de
 * página — e os números da ficha vêm de ler o painel da máquina com a mão. Se a
 * tela reinicia (memória curta no aparelho, o PWA voltando do segundo plano, um
 * puxão para atualizar sem querer), o operador teria de voltar até a máquina
 * para reler horímetro e bomba.
 *
 * O rascunho é UM por tipo de ficha: o fluxo de campo é uma ficha por vez, e
 * guardar uma pilha deles criaria a dúvida de qual está aberto.
 */
interface Guardado<T> {
  data: string
  rascunho: T
}

export async function guardarRascunho<T>(chave: string, rascunho: T): Promise<void> {
  await gravarMeta(chave, { data: hojeOperacional(), rascunho } satisfies Guardado<T>)
}

/**
 * Devolve o rascunho guardado, se for do dia operacional de hoje.
 *
 * Rascunho de ontem não volta: ele traz hora, número de ficha e leituras de um
 * turno que já fechou, e ressuscitá-lo silenciosamente é pior que perdê-lo — o
 * operador continuaria preenchendo uma ficha com a data errada.
 */
export async function recuperarRascunho<T>(chave: string): Promise<T | null> {
  const guardado = await lerMeta<Guardado<T>>(chave)
  if (!guardado || guardado.data !== hojeOperacional()) {
    if (guardado) await descartarRascunho(chave)
    return null
  }
  return guardado.rascunho
}

export async function descartarRascunho(chave: string): Promise<void> {
  await gravarMeta(chave, null)
}

export const CHAVE_RASCUNHO_ABASTECIMENTO = CHAVES_META.rascunhoAbastecimento

/**
 * Há algo digitado pelo operador?
 *
 * Data, hora, número da ficha e comboio vêm preenchidos pelo app — não contam.
 * Guardar antes disso faria a tela "retomar" uma ficha em branco toda vez que
 * alguém abrisse e desistisse.
 */
export function comeceiAPreencher(r: {
  frota_id: string | null
  horimetro_motor: number | null
  horimetro_elevador: number | null
  odometro: number | null
  registrador_fim: number | null
  litros: number | null
  operador_funcionario_id: string | null
}): boolean {
  return (
    r.frota_id !== null ||
    r.horimetro_motor !== null ||
    r.horimetro_elevador !== null ||
    r.odometro !== null ||
    r.registrador_fim !== null ||
    r.litros !== null ||
    r.operador_funcionario_id !== null
  )
}
