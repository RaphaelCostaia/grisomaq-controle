import { useLiveQuery } from 'dexie-react-hooks'
import { Link } from 'react-router'
import { ClipboardList, Lock, Plus } from 'lucide-react'
import { db } from '@/dados/db'
import { apontamentosDoDia, itensDoApontamento } from '@/dados/repositorios/apontamentos'
import { BarraSync } from '@/componentes/layout/BarraSync'
import { AbasInferiores } from '@/componentes/layout/AbasInferiores'
import { Botao } from '@/componentes/ui/Botao'
import { contar } from '@/utilitarios/numeros'

export function Apontamentos() {
  const fichas = useLiveQuery(() => apontamentosDoDia(), [], [])
  const frentes = useLiveQuery(() => db.mestre_frentes.toArray(), [], [])
  const turnos = useLiveQuery(() => db.mestre_turnos.toArray(), [], [])

  const contagens = useLiveQuery(
    async () => {
      const pares = await Promise.all(
        fichas.map(async (f) => {
          const itens = await itensDoApontamento(f.id)
          return [f.id, { total: itens.length, assinados: itens.filter((i) => i.assinatura_status !== 'pendente').length }] as const
        }),
      )
      return Object.fromEntries(pares)
    },
    [fichas],
    {} as Record<string, { total: number; assinados: number }>,
  )

  return (
    <div className="flex min-h-dvh flex-col">
      <BarraSync />

      <header className="border-b-2 border-[var(--cor-borda-forte)] px-4 py-3">
        <h1 className="text-sm font-bold tracking-[0.18em] uppercase">Apontamento</h1>
        <p className="mt-1 text-sm text-[var(--cor-texto-suave)]">
          {fichas.length === 0
            ? 'Nenhuma ficha aberta hoje.'
            : contar(fichas.length, 'ficha hoje', 'fichas hoje')}
        </p>
      </header>

      <main className="pauta flex-1">
        {fichas.map((f) => {
          const contagem = contagens[f.id] ?? { total: 0, assinados: 0 }
          const frente = frentes.find((x) => x.id === f.frente_id)
          const turno = turnos.find((x) => x.id === f.turno_id)
          const fechada = f.status !== 'rascunho'

          return (
            <Link key={f.id} to={'/apontamento/' + f.id} className="linha-ficha flex items-center gap-3">
              <span className="min-w-0 flex-1">
                <span className="rotulo-campo">
                  {frente?.nome ?? 'Frente'} · {turno?.nome ?? 'Turno'}
                </span>
                <span className="valor-leitura mt-1 block text-2xl">
                  {contagem.total}
                  <span className="ml-2 text-base font-semibold">
                    {contagem.total === 1 ? 'funcionário' : 'funcionários'}
                  </span>
                </span>
                <span className="mt-1 block text-sm text-[var(--cor-texto-suave)]">
                  {fechada
                    ? 'Ficha fechada'
                    : contagem.total === 0
                      ? 'Ainda sem ninguém lançado'
                      : contagem.assinados + ' de ' + contagem.total + ' assinaram'}
                </span>
              </span>
              {fechada && <Lock aria-hidden className="size-5 shrink-0 text-[var(--cor-texto-suave)]" />}
            </Link>
          )
        })}

        {fichas.length === 0 && (
          <p className="linha-ficha flex items-center gap-2.5 text-base text-[var(--cor-texto-suave)]">
            <ClipboardList aria-hidden className="size-5" />
            Abra a ficha do turno para começar a lançar os funcionários.
          </p>
        )}
      </main>

      <div className="sticky bottom-0 border-t-2 border-[var(--cor-borda-forte)] bg-[var(--cor-fundo)] px-4 py-3">
        <Link to="/apontamento/nova">
          <Botao barra icone={<Plus aria-hidden className="size-6" />}>
            Nova ficha
          </Botao>
        </Link>
      </div>

      <AbasInferiores />
    </div>
  )
}
