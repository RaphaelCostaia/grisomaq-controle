import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { ArrowLeft, Check, PenLine } from 'lucide-react'
import { db } from '@/dados/db'
import { assinarItem, itensDoApontamento, paraRascunhoItem, textoDeAceiteItem } from '@/dados/repositorios/apontamentos'
import { Botao } from '@/componentes/ui/Botao'
import { TelaAceite } from '@/componentes/ui/TelaAceite'
import { conferirPinLocal } from '@/autenticacao/pin-local'
import { cls } from '@/utilitarios/classes'

/**
 * Modo "passa o celular".
 *
 * No papel, o responsável circulava com a prancheta e cada um rubricava a
 * própria linha. Aqui é o mesmo gesto: a lista mostra quem falta, ele toca no
 * nome e entrega o aparelho. A tela de aceite fica com fundo escuro e o nome em
 * destaque justamente porque quem vai olhar não é quem estava segurando.
 */
export function Assinaturas() {
  const { id } = useParams<{ id: string }>()
  const navegar = useNavigate()
  const [assinandoId, setAssinandoId] = useState<string | null>(null)

  const itens = useLiveQuery(() => (id ? itensDoApontamento(id) : []), [id], [])
  const funcionarios = useLiveQuery(() => db.mestre_funcionarios.toArray(), [], [])
  const frotas = useLiveQuery(() => db.mestre_frotas.toArray(), [], [])

  const pendentes = itens.filter((i) => i.assinatura_status === 'pendente')
  const item = itens.find((i) => i.id === assinandoId)
  const funcionario = funcionarios.find((f) => f.id === item?.funcionario_id)
  const frota = frotas.find((f) => f.id === item?.frota_id)

  const textoAceite =
    item && funcionario && frota
      ? textoDeAceiteItem(funcionario.nome, frota.numero, paraRascunhoItem(item))
      : ''

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="area-segura-superior flex items-center gap-2 border-b-2 border-[var(--cor-borda-forte)] px-2 py-2.5">
        <button
          type="button"
          onClick={() => navegar(-1)}
          aria-label="Voltar"
          className="flex size-[var(--espaco-toque-min)] items-center justify-center"
        >
          <ArrowLeft aria-hidden className="size-7" />
        </button>
        <span className="flex-1 text-sm font-bold tracking-[0.18em] uppercase">Assinaturas</span>
      </header>

      <p className="border-b-2 border-[var(--cor-borda-forte)] px-4 py-3 text-sm text-[var(--cor-texto-suave)]">
        {pendentes.length === 0
          ? 'Todos já assinaram esta ficha.'
          : 'Toque no nome e entregue o celular para a pessoa confirmar com o PIN dela.'}
      </p>

      <main className="pauta flex-1">
        {itens.map((i) => {
          const f = funcionarios.find((x) => x.id === i.funcionario_id)
          const fr = frotas.find((x) => x.id === i.frota_id)
          const assinado = i.assinatura_status !== 'pendente'

          return (
            <button
              key={i.id}
              type="button"
              disabled={assinado}
              onClick={() => setAssinandoId(i.id)}
              className={cls('linha-ficha flex w-full items-center gap-3', assinado && 'opacity-60')}
            >
              <span className="min-w-0 flex-1 text-left">
                <span className="block truncate text-base font-bold">{f?.nome ?? '—'}</span>
                <span className="mt-0.5 block text-sm text-[var(--cor-texto-suave)]">
                  Frota {fr?.numero ?? '—'}
                </span>
              </span>

              {assinado ? (
                <span className="flex shrink-0 items-center gap-1.5 text-sm font-bold text-ok-500">
                  <Check aria-hidden className="size-5" />
                  Assinado
                </span>
              ) : (
                <span className="flex shrink-0 items-center gap-1.5 text-sm font-bold text-marca-600">
                  <PenLine aria-hidden className="size-5" />
                  Assinar
                </span>
              )}
            </button>
          )
        })}
      </main>

      <div className="area-segura-inferior sticky bottom-0 border-t-2 border-[var(--cor-borda-forte)] bg-[var(--cor-fundo)] px-4 py-3">
        <Botao barra variante="secundaria" onClick={() => navegar('/apontamento/' + id)}>
          Voltar para a ficha
        </Botao>
      </div>

      {item && funcionario && (
        <TelaAceite
          nome={funcionario.nome}
          textoAceite={textoAceite}
          onConfirmar={async (pin) => {
            await conferirPinLocal(funcionario.id, pin)
            await assinarItem(item.id, textoAceite, pin)
            toast.success(funcionario.nome.split(' ')[0] + ' assinou.')
            setAssinandoId(null)
          }}
          onCancelar={() => setAssinandoId(null)}
        />
      )}
    </div>
  )
}
