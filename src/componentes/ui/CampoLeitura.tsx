import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { TecladoNumerico } from './TecladoNumerico'
import { formatarNumero, paraNumero } from '@/utilitarios/numeros'
import { cls } from '@/utilitarios/classes'

interface Props {
  rotulo: string
  valor: number | null
  onMudar: (valor: number | null) => void
  /** Última leitura conhecida da frota, oferecida com um toque no teclado. */
  ultimaConhecida?: { valor: number; texto: string } | undefined
  casas?: number
  sufixo?: string
  desabilitado?: boolean | undefined
  motivoDesabilitado?: string | undefined
  erro?: string | undefined
}

/**
 * Uma linha da ficha. O rótulo é o andaime e o número é o conteúdo: o operador
 * sabe em que campo está, o que ele precisa é conferir o dígito.
 *
 * O teclado abre embaixo, dentro da própria linha, em vez de o teclado do
 * sistema subir por cima do campo — que é exatamente o que acontece no iOS e
 * faz o operador digitar sem ver o que digitou.
 */
export function CampoLeitura({
  rotulo,
  valor,
  onMudar,
  ultimaConhecida,
  casas = 1,
  sufixo,
  desabilitado,
  motivoDesabilitado,
  erro,
}: Props) {
  const [aberto, setAberto] = useState(false)
  const [texto, setTexto] = useState<string | null>(null)

  const exibido = texto ?? (valor === null ? '' : formatarNumero(valor, casas))

  function digitar(d: string) {
    const base = texto ?? (valor === null ? '' : String(valor).replace('.', ','))
    if (d === ',' && base.includes(',')) return
    const novo = base + d
    setTexto(novo)
    onMudar(paraNumero(novo))
  }

  function apagar() {
    const base = texto ?? (valor === null ? '' : String(valor).replace('.', ','))
    const novo = base.slice(0, -1)
    setTexto(novo)
    onMudar(novo === '' ? null : paraNumero(novo))
  }

  return (
    <div>
      <button
        type="button"
        disabled={desabilitado}
        onClick={() => {
          // Ao fechar, descarta o texto cru e volta a exibir o valor formatado:
          // o operador precisa conferir o número como ele ficou gravado, e não
          // como ele foi digitado.
          if (aberto) setTexto(null)
          setAberto(!aberto)
        }}
        className={cls('linha-ficha flex w-full items-center gap-3', desabilitado && 'opacity-45')}
        aria-expanded={aberto}
      >
        <span className="min-w-0 flex-1">
          <span className="rotulo-campo">{rotulo}</span>
          <span className={cls('valor-leitura mt-1 block', !exibido && 'valor-leitura--vazio')}>
            {exibido || '—'}
            {exibido && sufixo && <span className="ml-1.5 text-lg font-semibold">{sufixo}</span>}
          </span>
          {desabilitado && motivoDesabilitado && (
            <span className="mt-1 block text-sm text-[var(--cor-texto-suave)]">{motivoDesabilitado}</span>
          )}
          {!desabilitado && ultimaConhecida && (
            <span className="mt-1 block text-sm text-[var(--cor-texto-suave)]">{ultimaConhecida.texto}</span>
          )}
        </span>
        {!desabilitado && (
          <ChevronRight
            aria-hidden
            className={cls('size-6 shrink-0 transition-transform', aberto && 'rotate-90')}
          />
        )}
      </button>

      {erro && (
        <p role="alert" className="border-b-2 border-[var(--cor-borda-forte)] bg-carbono-50 px-4 py-2.5 text-sm font-semibold text-carbono-700">
          {erro}
        </p>
      )}

      {aberto && !desabilitado && (
        <TecladoNumerico
          comVirgula
          onDigito={digitar}
          onApagar={apagar}
          {...(ultimaConhecida
            ? {
                acaoExtra: {
                  rotulo: 'Usar ' + formatarNumero(ultimaConhecida.valor, casas),
                  onAcionar: () => {
                    setTexto(formatarNumero(ultimaConhecida.valor, casas))
                    onMudar(ultimaConhecida.valor)
                  },
                },
              }
            : {})}
        />
      )}
    </div>
  )
}
