/**
 * Gera o par de chaves RSA-OAEP usado na revalidação das assinaturas.
 *
 *   node supabase/gerar-chaves-assinatura.mjs
 *
 * A pública vai para o app (VITE_CHAVE_PUBLICA_ASSINATURA) e é embarcada no
 * bundle — ela só cifra. A privada vai para o segredo da Edge Function
 * (CHAVE_PRIVADA_ASSINATURA) e nunca sai do servidor.
 *
 * Rode uma vez por ambiente. Trocar o par depois invalida a revalidação das
 * assinaturas que ainda estiverem na fila dos celulares, porque elas foram
 * cifradas com a pública antiga.
 */
import { webcrypto } from 'node:crypto'

const par = await webcrypto.subtle.generateKey(
  { name: 'RSA-OAEP', modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true,
  ['encrypt', 'decrypt'],
)

const paraBase64 = (buffer) => Buffer.from(new Uint8Array(buffer)).toString('base64')

const publica = paraBase64(await webcrypto.subtle.exportKey('spki', par.publicKey))
const privada = paraBase64(await webcrypto.subtle.exportKey('pkcs8', par.privateKey))

console.log('\n--- .env do app (pode ir para o bundle) ---\n')
console.log('VITE_CHAVE_PUBLICA_ASSINATURA=' + publica)

console.log('\n--- segredo da Edge Function (NUNCA no bundle) ---\n')
console.log('supabase secrets set CHAVE_PRIVADA_ASSINATURA=' + privada)

console.log('\n--- segredo da derivação de senha, se ainda não existir ---\n')
console.log('supabase secrets set AUTH_DERIVACAO_SECRET=' + paraBase64(webcrypto.getRandomValues(new Uint8Array(32))))
console.log()
