import { argon2Verify } from 'hash-wasm'
import { db } from '@/dados/db'

/**
 * Confere o PIN sem rede, para o aceite acontecer no campo.
 *
 * Esta conferência serve à experiência, não à prova. A autoridade é a
 * revalidação no servidor: quando o lançamento sobe, a Edge Function confere o
 * PIN contra o hash autoritativo e marca a assinatura como válida ou inválida.
 * Um celular adulterado consegue burlar o que está aqui — não consegue burlar lá.
 */
export async function conferirPinLocal(funcionarioId: string, pin: string): Promise<void> {
  if (!/^[0-9]{4}$/.test(pin)) {
    throw new Error('O PIN tem 4 números.')
  }

  const verificador = await db.pin_verificadores.get(funcionarioId)

  // Sem verificador em cache, o aceite segue e fica pendente de validação no
  // servidor. Bloquear aqui impediria o funcionário de assinar no primeiro dia
  // em campo — que é exatamente quando ele mais precisa lançar.
  if (!verificador) return

  const confere = await argon2Verify({ password: pin, hash: verificador.hash })
  if (!confere) {
    throw new Error('PIN incorreto.')
  }
}
