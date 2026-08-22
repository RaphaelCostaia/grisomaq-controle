import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Lock, LockOpen, TriangleAlert, X } from 'lucide-react'
import { chamar, ErroApi } from '@/dados/api'
import { CabecalhoPainel } from '@/componentes/layout/LayoutAdmin'
import { Botao } from '@/componentes/ui/Botao'
import { dataBr, dataHoraBr, hojeOperacional } from '@/utilitarios/datas'
import { cls } from '@/utilitarios/classes'

interface Fechamento {
  id: string
  de: string
  ate: string
  observacao: string | null
  fechado_em: string
  fechado_por_nome: string
  documentos_travados: number
  reaberto_em: string | null
  reaberto_por_nome: string | null
  motivo_reabertura: string | null
  vigente: boolean
}

const carregar = () =>
  chamar<{ fechamentos: Fechamento[] }>('/painel/fechamentos').then((r) => r.fechamentos)

/** Primeiro e último dia do mês anterior — o período que se fecha na prática. */
function mesAnterior(): { de: string; ate: string } {
  const hoje = new Date(hojeOperacional() + 'T12:00:00')
  const primeiroDesteMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1)
  const ultimoDoAnterior = new Date(primeiroDesteMes.getTime() - 86_400_000)
  const primeiroDoAnterior = new Date(ultimoDoAnterior.getFullYear(), ultimoDoAnterior.getMonth(), 1)
  const iso = (d: Date) =>
    d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
  return { de: iso(primeiroDoAnterior), ate: iso(ultimoDoAnterior) }
}

export function Fechamentos() {
  const [fechamentos, setFechamentos] = useState<Fechamento[] | null>(null)
  const [periodo, setPeriodo] = useState(mesAnterior)
  const [observacao, setObservacao] = useState('')
  const [fechando, setFechando] = useState(false)
  const [reabrindo, setReabrindo] = useState<Fechamento | null>(null)
  const [motivo, setMotivo] = useState('')

  useEffect(() => {
    void recarregar()
  }, [])

  async function recarregar() {
    try {
      setFechamentos(await carregar())
    } catch (erro) {
      toast.error(erro instanceof Error ? erro.message : 'Falha ao carregar.')
      setFechamentos([])
    }
  }

  async function fechar() {
    setFechando(true)
    try {
      const r = await chamar<{ documentos: number }>('/painel/fechamentos/travar', {
        corpo: { de: periodo.de, ate: periodo.ate, observacao: observacao || null },
      })
      toast.success(
        r.documentos === 0
          ? 'Nenhum lançamento novo neste período — nada a travar.'
          : r.documentos + ' lançamento(s) travados.',
      )
      setObservacao('')
      await recarregar()
    } catch (erro) {
      const codigo = erro instanceof ErroApi ? erro.codigo : ''
      toast.error(codigo === 'PERIODO_INVALIDO' ? 'A data final é anterior à inicial.' : 'Não foi possível fechar.')
    } finally {
      setFechando(false)
    }
  }

  async function reabrir() {
    if (!reabrindo) return
    try {
      const r = await chamar<{ documentos: number }>('/painel/fechamentos/reabrir', {
        corpo: { fechamento_id: reabrindo.id, motivo },
      })
      toast.success(r.documentos + ' lançamento(s) voltaram a aceitar correção.')
      setReabrindo(null)
      setMotivo('')
      await recarregar()
    } catch (erro) {
      const codigo = erro instanceof ErroApi ? erro.codigo : ''
      toast.error(codigo === 'MOTIVO_OBRIGATORIO' ? 'Escreva o motivo da reabertura.' : 'Não foi possível reabrir.')
    }
  }

  return (
    <>
      <CabecalhoPainel
        titulo="Fechamento de período"
        descricao="Depois de fechado, o campo não corrige mais nada dentro do período."
      />

      <div className="p-8">
        <section className="mb-6 border-2 border-[var(--cor-borda-forte)] bg-[var(--cor-fundo)] p-5">
          <h2 className="text-base font-bold">Fechar um período</h2>
          <p className="mt-1 mb-4 text-sm text-[var(--cor-texto-suave)]">
            Os números viram folha de pagamento e conferência de diesel. Fechar impede que alguém
            corrija depois disso sem passar pelo escritório.
          </p>

          <div className="flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="rotulo-campo">De</span>
              <input
                type="date"
                value={periodo.de}
                onChange={(e) => setPeriodo({ ...periodo, de: e.target.value })}
                className={campo}
              />
            </label>
            <label className="block">
              <span className="rotulo-campo">Até</span>
              <input
                type="date"
                value={periodo.ate}
                onChange={(e) => setPeriodo({ ...periodo, ate: e.target.value })}
                className={campo}
              />
            </label>
            <label className="block min-w-64 flex-1">
              <span className="rotulo-campo">Observação</span>
              <input
                value={observacao}
                onChange={(e) => setObservacao(e.target.value)}
                placeholder="Opcional"
                className={cls(campo, 'w-full')}
              />
            </label>
            <Botao onClick={() => void fechar()} disabled={fechando} icone={<Lock aria-hidden className="size-4" />}>
              {fechando ? 'Fechando…' : 'Fechar período'}
            </Botao>
          </div>
        </section>

        {fechamentos === null ? (
          <p className="text-sm text-[var(--cor-texto-suave)]">Carregando…</p>
        ) : fechamentos.length === 0 ? (
          <p className="border-2 border-[var(--cor-borda)] bg-[var(--cor-fundo)] px-4 py-4 text-sm text-[var(--cor-texto-suave)]">
            Nenhum período fechado ainda.
          </p>
        ) : (
          <table className="w-full border-2 border-[var(--cor-borda-forte)] bg-[var(--cor-fundo)] text-sm">
            <thead>
              <tr className="border-b-2 border-[var(--cor-borda-forte)] bg-[var(--cor-superficie)] text-left">
                <Th>Período</Th>
                <Th className="text-right">Lançamentos</Th>
                <Th>Fechado por</Th>
                <Th>Situação</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {fechamentos.map((f) => (
                <tr key={f.id} className={cls('border-b border-[var(--cor-borda)]', !f.vigente && 'opacity-60')}>
                  <Td className="font-semibold">
                    {dataBr(f.de)} a {dataBr(f.ate)}
                    {f.observacao && (
                      <span className="mt-0.5 block text-xs font-normal text-[var(--cor-texto-suave)]">
                        {f.observacao}
                      </span>
                    )}
                  </Td>
                  <Td className="numerico text-right">{f.documentos_travados}</Td>
                  <Td>
                    {f.fechado_por_nome}
                    <span className="mt-0.5 block text-xs text-[var(--cor-texto-suave)]">
                      {dataHoraBr(new Date(f.fechado_em))}
                    </span>
                  </Td>
                  <Td>
                    {f.vigente ? (
                      <span className="flex items-center gap-1.5 text-sm font-bold text-marca-600">
                        <Lock aria-hidden className="size-3.5" />
                        Fechado
                      </span>
                    ) : (
                      <span className="text-sm">
                        <span className="flex items-center gap-1.5 font-bold text-aviso-500">
                          <LockOpen aria-hidden className="size-3.5" />
                          Reaberto
                        </span>
                        <span className="mt-0.5 block text-xs text-[var(--cor-texto-suave)]">
                          {f.reaberto_por_nome} · {f.motivo_reabertura}
                        </span>
                      </span>
                    )}
                  </Td>
                  <Td className="text-right">
                    {f.vigente && (
                      <button
                        type="button"
                        onClick={() => setReabrindo(f)}
                        className="text-sm font-semibold text-carbono-700 underline"
                      >
                        Reabrir
                      </button>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {reabrindo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
          <div className="w-full max-w-md border-2 border-carbono-500 bg-[var(--cor-fundo)]">
            <header className="flex items-center justify-between border-b-2 border-carbono-500 bg-carbono-50 px-5 py-3.5">
              <h2 className="flex items-center gap-2 text-base font-bold text-carbono-700">
                <TriangleAlert aria-hidden className="size-5" />
                Reabrir período
              </h2>
              <button type="button" onClick={() => setReabrindo(null)} aria-label="Fechar" className="p-1">
                <X aria-hidden className="size-5" />
              </button>
            </header>

            <div className="px-5 py-5">
              <p className="text-sm">
                {dataBr(reabrindo.de)} a {dataBr(reabrindo.ate)} · {reabrindo.documentos_travados} lançamento(s)
              </p>
              {/* Reabrir depois do fechamento é excepcional. O motivo fica no
                  registro para a conferência seguinte entender o que houve. */}
              <p className="mt-3 text-sm text-[var(--cor-texto-suave)]">
                Reabrir devolve estes lançamentos para correção. O motivo fica registrado junto com o
                seu nome, e a conferência seguinte vai ver.
              </p>

              <label className="mt-4 block">
                <span className="rotulo-campo">Motivo da reabertura</span>
                <textarea
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  rows={3}
                  placeholder="Ex.: horímetro da frota 1204 lançado errado no dia 12."
                  className="mt-1.5 w-full border-2 border-[var(--cor-borda-forte)] bg-white px-3 py-2 text-base"
                />
              </label>

              <div className="mt-5 flex justify-end gap-3">
                <Botao variante="secundaria" onClick={() => setReabrindo(null)}>
                  Cancelar
                </Botao>
                <Botao variante="perigo" disabled={!motivo.trim()} onClick={() => void reabrir()}>
                  Reabrir período
                </Botao>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

const campo =
  'mt-1 block border-2 border-[var(--cor-borda-forte)] bg-white px-3 py-2 text-sm outline-none focus:border-marca-600'

function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <th
      className={cls(
        'px-4 py-2.5 text-[0.6875rem] font-bold tracking-[0.1em] text-[var(--cor-texto-suave)] uppercase',
        className,
      )}
    >
      {children}
    </th>
  )
}

function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={cls('px-4 py-3 align-top', className)}>{children}</td>
}
