import { AlertTriangle, Check, CloudOff, RefreshCw } from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import { lancamentosPendentes } from '@/dados/db'
import { useEstadoSync } from '@/dados/sincronizacao/estado'
import { sincronizarAgora } from '@/dados/sincronizacao/motor'
import { horaDe } from '@/utilitarios/datas'
import { cls } from '@/utilitarios/classes'

/**
 * O operador precisa saber, sem perguntar a ninguém, se o que ele lançou já
 * saiu do celular. Esta barra é a resposta e fica sempre visível.
 *
 * "Pendente" não é erro e não é pintado como erro: sem sinal é o estado normal
 * desta operação. Vermelho fica reservado para o que exige ação humana.
 */
export function BarraSync() {
  const { situacao, ultimoSyncOk, ultimoErro } = useEstadoSync()

  // A contagem vem da FILA, não do estado em memória do motor. O motor só
  // atualiza esse estado quando roda; a barra precisa passar a dizer "1
  // esperando sinal" no instante em que o operador salva, mesmo que nenhuma
  // sincronização tenha acontecido ainda.
  const pendentes = useLiveQuery(() => lancamentosPendentes(), [], 0)

  const aparencia =
    situacao === 'erro'
      ? 'bg-carbono-50 text-carbono-700 border-carbono-500'
      : pendentes > 0
        ? 'bg-aviso-100 text-aviso-500 border-[var(--cor-borda-forte)]'
        : 'bg-ok-100 text-ok-500 border-[var(--cor-borda-forte)]'

  return (
    <button
      type="button"
      onClick={() => void sincronizarAgora()}
      className={cls(
        'area-segura-superior flex w-full items-center gap-2.5 border-b-2 px-4 py-2.5 text-left',
        aparencia,
      )}
    >
      <Icone situacao={situacao} pendentes={pendentes} />
      <span className="flex-1 text-sm font-bold">{resumo(situacao, pendentes, ultimoErro)}</span>
      {ultimoSyncOk && pendentes === 0 && situacao !== 'erro' && (
        <span className="numerico text-xs font-semibold opacity-80">
          {horaDe(new Date(ultimoSyncOk))}
        </span>
      )}
    </button>
  )
}

function Icone({ situacao, pendentes }: { situacao: string; pendentes: number }) {
  if (situacao === 'erro') return <AlertTriangle aria-hidden className="size-5 shrink-0" />
  if (situacao === 'sincronizando') return <RefreshCw aria-hidden className="size-5 shrink-0 animate-spin" />
  if (situacao === 'sem_sinal') return <CloudOff aria-hidden className="size-5 shrink-0" />
  if (pendentes > 0) return <CloudOff aria-hidden className="size-5 shrink-0" />
  return <Check aria-hidden className="size-5 shrink-0" />
}

function resumo(situacao: string, pendentes: number, erro: string | null): string {
  if (situacao === 'erro') return erro ?? 'Falha ao enviar. Toque para tentar de novo.'
  if (situacao === 'sincronizando') return 'Enviando…'
  if (pendentes === 1) return '1 lançamento esperando sinal'
  if (pendentes > 1) return pendentes + ' lançamentos esperando sinal'
  if (situacao === 'sem_sinal') return 'Sem sinal. Tudo que você lançar fica salvo no celular.'
  return 'Tudo enviado'
}
