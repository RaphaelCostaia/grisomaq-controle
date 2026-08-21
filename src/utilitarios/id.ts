import { v7 as uuidv7 } from 'uuid'

/**
 * Toda chave primaria do sistema nasce no celular, nao no banco - senao nada
 * poderia ser criado offline. UUIDv7 (e nao v4) porque carrega o timestamp no
 * prefixo: a fila de sincronizacao ordenada por id fica em ordem cronologica,
 * o que garante que o cabecalho do apontamento suba antes dos seus itens.
 */
export function novoId(): string {
  return uuidv7()
}

/** Id de uma operacao da fila de sincronizacao. Mesma propriedade de ordem. */
export function novoIdOperacao(): string {
  return uuidv7()
}

/**
 * SHA-256 do JSON canonico de um documento - vai para a trilha de assinatura,
 * provando que o que foi assinado e exatamente o que esta gravado.
 * Canonico = chaves ordenadas, para o mesmo documento sempre gerar o mesmo hash.
 */
export async function hashDocumento(documento: Record<string, unknown>): Promise<string> {
  const canonico = JSON.stringify(documento, Object.keys(documento).sort())
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonico))
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
