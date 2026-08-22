/**
 * Gera os segredos do ambiente: o par de chaves RSA-OAEP da revalidação de
 * assinaturas e o segredo de assinatura do JWT.
 *
 *   node banco/gerar-chaves-assinatura.mjs
 *
 * A chave pública vai para o app (VITE_CHAVE_PUBLICA_ASSINATURA) e é embarcada
 * no bundle — ela só cifra. A privada vai para a variável de ambiente da API
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
const segredoJwt = paraBase64(webcrypto.getRandomValues(new Uint8Array(48)))

console.log('\n--- Build Arguments do serviço do app (vão para o bundle) ---\n')
console.log('VITE_CHAVE_PUBLICA_ASSINATURA=' + publica)

console.log('\n--- Variáveis de ambiente da API (NUNCA no bundle) ---\n')
console.log('CHAVE_PRIVADA_ASSINATURA=' + privada)
console.log('JWT_SEGREDO=' + segredoJwt)
console.log()
