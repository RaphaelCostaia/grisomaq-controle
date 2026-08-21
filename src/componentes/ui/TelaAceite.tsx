import { useState } from 'react'
import { Loader2, X } from 'lucide-react'
import { TecladoNumerico } from './TecladoNumerico'
import { cls } from '@/utilitarios/classes'
import { vibrar } from '@/utilitarios/dispositivo'

const TAMANHO_PIN = 4

interface Props {
  /** Quem está assinando. Vai em destaque: o celular passa de mão em mão. */
  nome: string
  /** O texto exato que fica gravado na trilha de assinatura. */
  textoAceite: string
  onConfirmar: (pin: string) => Promise<void>
  onCancelar: () => void
}

/**
 * Aceite por PIN — o equivalente digital da rubrica no bloco carbonado.
 *
 * Fundo escuro e nome em destaque porque este é o momento em que o celular
 * passa para a mão de outra pessoa: ela precisa reconhecer, em um relance, que
 * está assinando em nome dela e o que exatamente está aceitando.
 *
 * A conferência aqui é local e serve à experiência. A autoridade é a
 * revalidação no servidor, que marca a assinatura como válida ou inválida
 * quando o lançamento sobe.
 */
export function TelaAceite({ nome, textoAceite, onConfirmar, onCancelar }: Props) {
  const [pin, setPin] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function digitar(d: string) {
    if (pin.length >= TAMANHO_PIN || enviando) return
    setErro(null)
    const novo = pin + d
    setPin(novo)
    if (novo.length < TAMANHO_PIN) return

    setEnviando(true)
    try {
      await onConfirmar(novo)
      vibrar('ok')
    } catch (e) {
      vibrar('erro')
      setPin('')
      setErro(e instanceof Error ? e.message : 'Não foi possível confirmar.')
      setEnviando(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-marca-800 text-white">
      <header className="area-segura-superior flex items-center justify-end px-2 py-2">
        <button
          type="button"
          onClick={onCancelar}
          aria-label="Cancelar assinatura"
          className="flex size-[var(--espaco-toque-min)] items-center justify-center"
        >
          <X aria-hidden className="size-7" />
        </button>
      </header>

      <div className="flex flex-1 flex-col justify-center px-5">
        <p className="text-[0.6875rem] font-bold tracking-[0.22em] text-marca-200 uppercase">Assinando</p>
        <p className="mt-1.5 text-3xl leading-tight font-extrabold">{nome}</p>

        <p className="mt-6 border-t-2 border-marca-500 pt-4 text-base leading-snug text-marca-100">
          {textoAceite}
        </p>

        <div className="mt-8">
          <p className="text-[0.6875rem] font-bold tracking-[0.22em] text-marca-200 uppercase">
            Digite seu PIN para confirmar
          </p>
          <div className="mt-3 flex items-center gap-3.5" aria-live="polite">
            {enviando ? (
              <span className="flex items-center gap-2.5 text-base font-semibold">
                <Loader2 aria-hidden className="size-6 animate-spin" />
                Confirmando…
              </span>
            ) : (
              Array.from({ length: TAMANHO_PIN }, (_, i) => (
                <span
                  key={i}
                  className={cls('size-6 border-2 border-white', i < pin.length && 'bg-white')}
                />
              ))
            )}
          </div>
        </div>

        {erro && (
          <p role="alert" className="mt-5 bg-carbono-500 px-3 py-2.5 text-sm font-bold">
            {erro}
          </p>
        )}
      </div>

      <div className="area-segura-inferior">
        <TecladoNumerico onDigito={(d) => void digitar(d)} onApagar={() => setPin(pin.slice(0, -1))} />
      </div>
    </div>
  )
}
