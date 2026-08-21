/**
 * Cifra o PIN para a revalidação no servidor.
 *
 * O aceite acontece offline, então o PIN precisa viajar junto com o lançamento
 * quando houver sinal. Ele nunca viaja em claro nem é gravado em claro: no
 * momento da assinatura é cifrado com a chave pública RSA-OAEP embarcada no
 * bundle, e só a Edge Function `verificar-assinaturas` tem a privada.
 *
 * O texto cifrado é apagado da fila assim que a revalidação responde.
 */

let chavePublica: CryptoKey | null = null

async function carregarChavePublica(): Promise<CryptoKey | null> {
  if (chavePublica) return chavePublica

  const spkiBase64 = import.meta.env.VITE_CHAVE_PUBLICA_ASSINATURA
  if (!spkiBase64) return null

  const spki = Uint8Array.from(atob(spkiBase64), (c) => c.charCodeAt(0))
  chavePublica = await crypto.subtle.importKey(
    'spki',
    spki,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['encrypt'],
  )
  return chavePublica
}

/**
 * Devolve o PIN cifrado, ou `null` quando não há chave configurada.
 *
 * Null não impede o aceite: a assinatura sobe como `validado_local` e fica
 * marcada como pendente de revalidação. Bloquear o lançamento porque a chave
 * não foi provisionada puniria o operador por uma falha do escritório.
 */
export async function cifrarPin(pin: string): Promise<string | null> {
  const chave = await carregarChavePublica()
  if (!chave) return null

  const cifrado = await crypto.subtle.encrypt(
    { name: 'RSA-OAEP' },
    chave,
    new TextEncoder().encode(pin),
  )
  return btoa(String.fromCharCode(...new Uint8Array(cifrado)))
}
