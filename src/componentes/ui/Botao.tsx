import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cls } from '@/utilitarios/classes'

type Variante = 'primaria' | 'secundaria' | 'perigo' | 'fantasma'

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: Variante
  /** Ocupa a barra de acao inteira, na altura de acao primaria (64px). */
  barra?: boolean
  icone?: ReactNode
}

/**
 * Sem cantos arredondados: a barra de acao e o painel de controle da maquina,
 * nao um cartao. Altura minima vem dos tokens de toque, nao de numero solto.
 */
const porVariante: Record<Variante, string> = {
  primaria: 'bg-marca-600 text-white border-marca-600 active:bg-marca-700',
  secundaria: 'bg-white text-marca-600 border-marca-600 active:bg-marca-50',
  perigo: 'bg-carbono-500 text-white border-carbono-500 active:bg-carbono-700',
  fantasma: 'bg-transparent text-[var(--cor-texto)] border-transparent active:bg-[var(--cor-superficie)]',
}

export function Botao({ variante = 'primaria', barra = false, icone, children, className, ...resto }: Props) {
  return (
    <button
      type="button"
      {...resto}
      className={cls(
        'inline-flex items-center justify-center gap-2 border-2 font-bold uppercase tracking-wide',
        'transition-colors duration-100 disabled:opacity-40 disabled:pointer-events-none',
        barra
          ? 'w-full min-h-[var(--espaco-toque-primario)] text-lg'
          : 'min-h-[var(--espaco-toque-min)] px-5 text-base',
        porVariante[variante],
        className,
      )}
    >
      {icone}
      {children}
    </button>
  )
}
