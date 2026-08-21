import { CornerLeftDown, Delete } from 'lucide-react'
import type { ReactNode } from 'react'
import { cls } from '@/utilitarios/classes'

interface Props {
  onDigito: (digito: string) => void
  onApagar: () => void
  /** Habilita a virgula decimal - leituras de horimetro tem uma casa. */
  comVirgula?: boolean
  /** Atalho contextual mostrado acima das teclas, ex.: "usar ultima leitura". */
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
    <div className={cls('border-t-2 border-[var(--cor-borda-forte)]', className)}>
      {/* O atalho fica numa faixa própria, acima dos dígitos, e não ocupando a
          tecla da vírgula: leitura de horímetro tem casa decimal, e trocar a
          vírgula pelo atalho deixaria o operador sem como digitar 8119,5. */}
      {acaoExtra && (
        <button
          type="button"
          onClick={acaoExtra.onAcionar}
          disabled={acaoExtra.desabilitada}
          className={cls(
            'flex min-h-[var(--espaco-toque-min)] w-full items-center justify-center gap-2',
            'border-b-2 border-[var(--cor-borda-forte)] bg-marca-50 px-4',
            'text-base font-bold tracking-wide uppercase text-marca-600',
            'active:bg-marca-100 disabled:opacity-40',
          )}
        >
          <CornerLeftDown aria-hidden className="size-5" />
          {acaoExtra.rotulo}
        </button>
      )}

      <div
        className="grid grid-cols-3 bg-[var(--cor-borda)]"
        style={{ gap: '1px' }}
        role="group"
        aria-label="Teclado numérico"
      >
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <Tecla key={d} onAcionar={() => onDigito(d)}>
            {d}
          </Tecla>
        ))}

        {comVirgula ? (
          <Tecla onAcionar={() => onDigito(',')}>,</Tecla>
        ) : (
          <span className="bg-[var(--cor-superficie)]" />
        )}

        <Tecla onAcionar={() => onDigito('0')}>0</Tecla>

        <Tecla onAcionar={onApagar} secundaria rotuloAcessivel="Apagar último dígito">
          <Delete aria-hidden className="size-7" />
        </Tecla>
      </div>
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
