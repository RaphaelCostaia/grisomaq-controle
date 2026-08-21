import { useMemo, useState } from 'react'
import { ChevronRight, Search, X } from 'lucide-react'
import { cls } from '@/utilitarios/classes'

export interface OpcaoSeletor {
  id: string
  /** O que o operador procura: número da frota, código do funcionário. */
  chave: string
  titulo: string
  detalhe?: string
}

interface Props {
  rotulo: string
  opcoes: OpcaoSeletor[]
  valor: string | null
  onEscolher: (id: string) => void
  placeholder?: string
  erro?: string | undefined
}

/**
 * Escolha por número, não por digitação livre. A busca casa pelo início da
 * chave primeiro: o operador digita "12" pensando na frota 1204, e não quer ver
 * antes a 3120 só porque ela também contém "12".
 */
export function SeletorBusca({ rotulo, opcoes, valor, onEscolher, placeholder, erro }: Props) {
  const [aberto, setAberto] = useState(false)
  const [busca, setBusca] = useState('')

  const escolhida = opcoes.find((o) => o.id === valor) ?? null

  const filtradas = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    if (!termo) return opcoes
    const normalizar = (t: string) => t.toLowerCase()
    return opcoes
      .filter((o) => normalizar(o.chave).includes(termo) || normalizar(o.titulo).includes(termo))
      .sort((a, b) => {
        const pesoA = normalizar(a.chave).startsWith(termo) ? 0 : 1
        const pesoB = normalizar(b.chave).startsWith(termo) ? 0 : 1
        return pesoA - pesoB || a.chave.localeCompare(b.chave, 'pt-BR', { numeric: true })
      })
  }, [opcoes, busca])

  return (
    <>
      <button type="button" onClick={() => setAberto(true)} className="linha-ficha flex w-full items-center gap-3">
        <span className="min-w-0 flex-1">
          <span className="rotulo-campo">{rotulo}</span>
          {escolhida ? (
            <>
              <span className="valor-leitura mt-1 block">{escolhida.chave}</span>
              <span className="mt-0.5 block truncate text-sm font-semibold text-[var(--cor-texto-suave)]">
                {escolhida.titulo}
              </span>
            </>
          ) : (
            <span className="valor-leitura valor-leitura--vazio mt-1 block">{placeholder ?? '—'}</span>
          )}
        </span>
        <ChevronRight aria-hidden className="size-6 shrink-0" />
      </button>

      {erro && (
        <p role="alert" className="border-b-2 border-[var(--cor-borda-forte)] bg-carbono-50 px-4 py-2.5 text-sm font-semibold text-carbono-700">
          {erro}
        </p>
      )}

      {aberto && (
        <div className="fixed inset-0 z-50 flex flex-col bg-[var(--cor-fundo)]">
          <header className="area-segura-superior flex items-center gap-2 border-b-2 border-[var(--cor-borda-forte)] px-3 py-3">
            <Search aria-hidden className="size-5 shrink-0 text-[var(--cor-texto-suave)]" />
            <input
              autoFocus
              inputMode="numeric"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder={'Buscar ' + rotulo.toLowerCase()}
              className="numerico min-w-0 flex-1 bg-transparent py-2 text-2xl font-semibold outline-none"
            />
            <button
              type="button"
              onClick={() => {
                setAberto(false)
                setBusca('')
              }}
              aria-label="Fechar"
              className="flex size-[var(--espaco-toque-min)] items-center justify-center"
            >
              <X aria-hidden className="size-7" />
            </button>
          </header>

          <ul className="pauta flex-1 overflow-y-auto">
            {filtradas.map((o) => (
              <li key={o.id}>
                <button
                  type="button"
                  onClick={() => {
                    onEscolher(o.id)
                    setAberto(false)
                    setBusca('')
                  }}
                  className={cls('linha-ficha flex w-full items-center gap-3', o.id === valor && 'bg-marca-50')}
                >
                  <span className="numerico w-20 shrink-0 font-mono text-2xl font-semibold">{o.chave}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-base font-bold">{o.titulo}</span>
                    {o.detalhe && (
                      <span className="block truncate text-sm text-[var(--cor-texto-suave)]">{o.detalhe}</span>
                    )}
                  </span>
                </button>
              </li>
            ))}
            {filtradas.length === 0 && (
              <li className="linha-ficha text-base text-[var(--cor-texto-suave)]">
                Nada encontrado. Confira o número ou peça o cadastro ao escritório.
              </li>
            )}
          </ul>
        </div>
      )}
    </>
  )
}
