import { useLiveQuery } from 'dexie-react-hooks'
import { Link } from 'react-router'
import { AlertTriangle, Check, Clock, Plus, RefreshCw } from 'lucide-react'
import { db } from '@/dados/db'
import { blocoDoDispositivo } from '@/dados/repositorios/abastecimentos'
import { BarraSync } from '@/componentes/layout/BarraSync'
import { AbasInferiores } from '@/componentes/layout/AbasInferiores'
import { Botao } from '@/componentes/ui/Botao'
import type { EstadoSync } from '@/dominio/tipos'
import { formatarLitros } from '@/utilitarios/numeros'
import { hojeOperacional } from '@/utilitarios/datas'

export function Abastecimentos() {
  const hoje = hojeOperacional()

  const doDia = useLiveQuery(
    async () =>
      (await db.abastecimentos.where('data').equals(hoje).toArray())
        .filter((a) => !a.excluido)
        .sort((a, b) => b.momento.localeCompare(a.momento)),
    [hoje],
    [],
  )

  const bloco = useLiveQuery(() => blocoDoDispositivo(), [], null)

  const totalLitros = doDia.reduce((soma, a) => soma + a.litros, 0)

  return (
    <div className="flex min-h-dvh flex-col">
      <BarraSync />

      <header className="border-b-2 border-[var(--cor-borda-forte)] px-4 py-3">
        <h1 className="text-sm font-bold tracking-[0.18em] uppercase">Abastecimento</h1>
        <p className="mt-1 text-sm text-[var(--cor-texto-suave)]">
          {doDia.length === 0
            ? 'Nenhuma ficha lançada hoje.'
            : doDia.length + (doDia.length === 1 ? ' ficha hoje · ' : ' fichas hoje · ') + formatarLitros(totalLitros)}
        </p>
      </header>

      {bloco && (
        <p className="border-b-2 border-[var(--cor-borda-forte)] bg-[var(--cor-superficie)] px-4 py-2.5 text-sm">
          Bloco deste celular: <span className="numerico font-bold">{bloco.numero_inicial}</span> a{' '}
          <span className="numerico font-bold">{bloco.numero_final}</span>
        </p>
      )}

      <main className="pauta flex-1">
        {doDia.map((a) => (
          <Link key={a.id} to={'/abastecimento/' + a.id} className="linha-ficha flex items-center gap-3">
            <span className="numero-documento w-16 shrink-0 text-lg">{a.numero_documento}</span>
            <span className="min-w-0 flex-1">
              <span className="valor-leitura block text-xl">{formatarLitros(a.litros)}</span>
              <span className="mt-0.5 block text-sm text-[var(--cor-texto-suave)]">{a.hora}</span>
            </span>
            <MarcaSync estado={a._sync} />
          </Link>
        ))}

        {doDia.length === 0 && (
          <p className="linha-ficha text-base text-[var(--cor-texto-suave)]">
            Toque em “Nova ficha” para lançar o primeiro abastecimento do dia.
          </p>
        )}
      </main>

      <div className="sticky bottom-0 border-t-2 border-[var(--cor-borda-forte)] bg-[var(--cor-fundo)] px-4 py-3">
        <Link to="/abastecimento/novo">
          <Botao barra icone={<Plus aria-hidden className="size-6" />}>
            Nova ficha
          </Botao>
        </Link>
      </div>

      <AbasInferiores />
    </div>
  )
}

/**
 * Estado de envio de cada lançamento. Ícone E texto acessível, nunca só cor:
 * daltonismo em campo é comum e ninguém faz teste admissional para isso.
 */
function MarcaSync({ estado }: { estado: EstadoSync }) {
  const mapa: Record<EstadoSync, { Icone: typeof Check; cor: string; texto: string }> = {
    sincronizado: { Icone: Check, cor: 'text-ok-500', texto: 'Enviado' },
    pendente: { Icone: Clock, cor: 'text-aviso-500', texto: 'Esperando sinal' },
    enviando: { Icone: RefreshCw, cor: 'text-info-500', texto: 'Enviando' },
    erro: { Icone: AlertTriangle, cor: 'text-carbono-500', texto: 'Falhou ao enviar' },
    conflito: { Icone: AlertTriangle, cor: 'text-carbono-500', texto: 'Precisa de conferência' },
  }
  const { Icone, cor, texto } = mapa[estado]
  return (
    <span className={'flex shrink-0 items-center gap-1.5 ' + cor} title={texto}>
      <Icone aria-hidden className="size-5" />
      <span className="sr-only">{texto}</span>
    </span>
  )
}
