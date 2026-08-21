import { Delete } from 'lucide-react'
import type { ReactNode } from 'react'
import { cls } from '@/utilitarios/classes'

interface Props {
  onDigito: (digito: string) => void
  onApagar: () => void
  /** Habilita a virgula decimal - leituras de horimetro tem uma casa. */
  comVirgula?: boolean
  /** Acao contextual no lugar da virgula, ex.: "usar ultima leitura". */
  acaoExtra?: { rotulo: string; onAcionar: () => void; desabilitada?: boolean }
  className?: string
}

/**
 * Teclado proprio, e nao o do sistema. Tres motivos, todos de campo:
 * o teclado do iOS cobre justamente o campo que esta sendo digitado; as teclas
 * nativas sao pequenas demais para dedo com luva; e so aqui cabe o atalho
 * "usar ultima leitura", que e o que evita a maior parte dos erros de digitacao.
 */
export function TecladoNumerico({ onDigito, onApagar, comVirgula, acaoExtra, className }: Props) {
  return (
    <div
      className={cls('grid grid-cols-3 border-t-2 border-[var(--cor-borda-forte)] bg-[var(--cor-borda)]', className)}
      style={{ gap: '1px' }}
      role="group"
      aria-label="Teclado numérico"
    >
      {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
        <Tecla key={d} onAcionar={() => onDigito(d)}>
          {d}
        </Tecla>
      ))}

      {acaoExtra ? (
        <Tecla onAcionar={acaoExtra.onAcionar} desabilitada={acaoExtra.desabilitada} secundaria>
          <span className="px-1 text-xs leading-tight font-bold tracking-wide uppercase">{acaoExtra.rotulo}</span>
        </Tecla>
      ) : comVirgula ? (
        <Tecla onAcionar={() => onDigito(',')}>,</Tecla>
      ) : (
        <span className="bg-[var(--cor-superficie)]" />
      )}

      <Tecla onAcionar={() => onDigito('0')}>0</Tecla>

      <Tecla onAcionar={onApagar} secundaria rotuloAcessivel="Apagar último dígito">
        <Delete aria-hidden className="size-7" />
      </Tecla>
    </div>
  )
}

function Tecla({
  children,
  onAcionar,
  secundaria,
  desabilitada,
  rotuloAcessivel,
}: {
  children: ReactNode
  onAcionar: () => void
  secundaria?: boolean | undefined
  desabilitada?: boolean | undefined
  rotuloAcessivel?: string | undefined
}) {
  return (
    <button
      type="button"
      onClick={onAcionar}
      disabled={desabilitada}
      aria-label={rotuloAcessivel}
      className={cls(
        'flex min-h-[var(--espaco-tecla)] items-center justify-center',
        'font-mono text-3xl font-semibold tabular-nums select-none',
        'transition-colors duration-75 disabled:opacity-30',
        secundaria
          ? 'bg-[var(--cor-superficie)] text-[var(--cor-texto)] active:bg-[var(--cor-borda)]'
          : 'bg-[var(--cor-superficie-alta)] text-[var(--cor-texto)] active:bg-marca-100',
      )}
    >
      {children}
    </button>
  )
}
