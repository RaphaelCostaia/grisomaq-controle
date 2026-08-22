import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { AlertTriangle, ArrowLeft, Check, Clock, RefreshCw, Share2 } from 'lucide-react'
import { db, type ItemOutbox } from '@/dados/db'
import { sincronizarAgora } from '@/dados/sincronizacao/motor'
import { useEstadoSync } from '@/dados/sincronizacao/estado'
import { MAX_TENTATIVAS } from '@/dados/sincronizacao/backoff'
import { Botao } from '@/componentes/ui/Botao'
import { dataHoraBr } from '@/utilitarios/datas'
import { idDoDispositivo, versaoDoApp } from '@/utilitarios/dispositivo'
import { cls } from '@/utilitarios/classes'

const NOME_DA_TABELA: Record<string, string> = {
  abastecimentos: 'Abastecimento',
  assinaturas_aceite: 'Assinatura',
  caminhao_ciclos: 'Caminhão',
  apontamentos: 'Apontamento',
  apontamento_itens: 'Linha de apontamento',
}

/**
 * O que ainda não saiu do celular, e por quê.
 *
 * Esta tela existe para o operador nunca precisar acreditar no app: ele vê a
 * fila, vê o erro em português e tem um botão. Se nada resolver, ele exporta a
 * fila e manda para o escritório — o lançamento sobrevive à conversa.
 */
export function Pendencias() {
  const navegar = useNavigate()
  const { situacao, ultimoSyncOk } = useEstadoSync()

  const fila = useLiveQuery(
    async () => (await db.outbox.toArray()).sort((a, b) => a.op_id.localeCompare(b.op_id)),
    [],
    [],
  )

  const comErro = fila.filter((i) => i.status === 'erro')

  async function exportarFila() {
    const conteudo = JSON.stringify(
      {
        gerado_em: new Date().toISOString(),
        dispositivo_id: idDoDispositivo(),
        app_versao: versaoDoApp,
        fila,
      },
      null,
      2,
    )
    const arquivo = new File([conteudo], 'fila-grisomaq.json', { type: 'application/json' })

    // No celular, compartilhar é o caminho real: o operador manda por WhatsApp
    // para o escritório. Baixar arquivo em campo não resolve nada.
    if (navigator.canShare?.({ files: [arquivo] })) {
      try {
        await navigator.share({ files: [arquivo], title: 'Fila do GRISOMAQ CONTROLE' })
        return
      } catch {
        // Compartilhamento cancelado: cai para o download.
      }
    }

    const url = URL.createObjectURL(arquivo)
    const link = document.createElement('a')
    link.href = url
    link.download = arquivo.name
    link.click()
    URL.revokeObjectURL(url)
    toast.success('Fila salva no aparelho.')
  }

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
        <span className="flex-1 text-sm font-bold tracking-[0.18em] uppercase">Envio</span>
      </header>

      <div className="border-b-2 border-[var(--cor-borda-forte)] px-4 py-3">
        <p className="text-base font-bold">
          {fila.length === 0 ? 'Nada esperando envio.' : fila.length + ' na fila'}
        </p>
        <p className="mt-1 text-sm text-[var(--cor-texto-suave)]">
          {ultimoSyncOk
            ? 'Último envio concluído em ' + dataHoraBr(new Date(ultimoSyncOk)) + '.'
            : 'Ainda não houve nenhum envio neste aparelho.'}
        </p>
      </div>

      {comErro.length > 0 && (
        <p className="flex items-start gap-2.5 border-b-2 border-[var(--cor-borda-forte)] bg-carbono-50 px-4 py-3.5 text-sm font-semibold text-carbono-700">
          <AlertTriangle aria-hidden className="mt-0.5 size-5 shrink-0" />
          {comErro.length === 1
            ? 'Um lançamento não conseguiu subir depois de várias tentativas. Mostre esta tela ao escritório.'
            : comErro.length + ' lançamentos não conseguiram subir. Mostre esta tela ao escritório.'}
        </p>
      )}

      <main className="pauta flex-1">
        {fila.map((item) => (
          <ItemDaFila key={item.op_id} item={item} />
        ))}

        {fila.length === 0 && (
          <p className="linha-ficha flex items-center gap-2.5 text-base text-[var(--cor-texto-suave)]">
            <Check aria-hidden className="size-5 text-ok-500" />
            Tudo que você lançou já chegou ao escritório.
          </p>
        )}
      </main>

      <div className="area-segura-inferior sticky bottom-0 space-y-2 border-t-2 border-[var(--cor-borda-forte)] bg-[var(--cor-fundo)] px-4 py-3">
        <Botao
          barra
          disabled={situacao === 'sincronizando' || fila.length === 0}
          onClick={() => void sincronizarAgora()}
          icone={<RefreshCw aria-hidden className={cls('size-6', situacao === 'sincronizando' && 'animate-spin')} />}
        >
          {situacao === 'sincronizando' ? 'Enviando…' : 'Tentar agora'}
        </Botao>

        {fila.length > 0 && (
          <Botao
            barra
            variante="secundaria"
            onClick={() => void exportarFila()}
            icone={<Share2 aria-hidden className="size-5" />}
          >
            Enviar fila ao escritório
          </Botao>
        )}
      </div>
    </div>
  )
}

function ItemDaFila({ item }: { item: ItemOutbox }) {
  const erro = item.status === 'erro'

  return (
    <div className={cls('linha-ficha', erro && 'bg-carbono-50')}>
      <div className="flex items-center gap-3">
        {erro ? (
          <AlertTriangle aria-hidden className="size-5 shrink-0 text-carbono-700" />
        ) : (
          <Clock aria-hidden className="size-5 shrink-0 text-aviso-500" />
        )}
        <span className="flex-1">
          <span className="rotulo-campo">{NOME_DA_TABELA[item.tabela] ?? item.tabela}</span>
          <span className="mt-0.5 block text-base font-bold">{descricao(item)}</span>
        </span>
      </div>

      {item.tentativas > 0 && (
        <p className="mt-2 text-sm text-[var(--cor-texto-suave)]">
          {item.tentativas} de {MAX_TENTATIVAS} tentativas
        </p>
      )}

      {item.erro_codigo && (
        <p className="mt-1.5 text-sm font-semibold text-carbono-700">{explicar(item.erro_codigo)}</p>
      )}
    </div>
  )
}

function descricao(item: ItemOutbox): string {
  const numero = item.payload?.numero_documento
  if (typeof numero === 'number') return 'Ficha nº ' + numero

  // A assinatura não carrega o número da ficha, mas o texto do aceite identifica
  // o que foi assinado. Sem isso, o operador vê "novo lançamento" e não sabe a
  // que aquela linha da fila pertence.
  const aceite = item.payload?.texto_aceite
  if (typeof aceite === 'string') {
    const daFicha = aceite.match(/ficha nº (\d+)/i)
    if (daFicha) return 'Da ficha nº ' + daFicha[1]

    // Aceite de linha de apontamento: "Eu, Fulano, confirmo que trabalhei..."
    const dePessoa = aceite.match(/^Eu, ([^,]+),/)
    if (dePessoa) return 'De ' + dePessoa[1]
  }

  return item.tipo === 'inserir' ? 'Novo lançamento' : item.tipo === 'atualizar' ? 'Correção' : 'Exclusão'
}

/**
 * Códigos de erro traduzidos para o que o operador pode fazer. "Duplicado" e
 * "sobreposto" não são culpa dele e não têm ação em campo: dizer isso é mais
 * útil do que mostrar a mensagem do Postgres.
 */
function explicar(codigo: string): string {
  switch (codigo) {
    case 'NUMERO_DOCUMENTO_DUPLICADO':
      return 'Este número de ficha já existe no escritório. Eles vão resolver.'
    case 'CICLO_SOBREPOSTO':
    case 'CICLO_ABERTO_DUPLICADO':
      return 'Este caminhão já tem uma chegada em aberto. O escritório vai resolver.'
    case 'APONTAMENTO_DUPLICADO':
      return 'Já existe uma ficha para esta frente e turno.'
    case 'PERIODO_FECHADO':
      return 'O escritório já fechou este período. Correções agora passam por eles.'
    case 'VERSAO_OBSOLETA':
      return 'O aplicativo precisa ser atualizado para enviar.'
    case 'SEM_RESPOSTA':
    case 'FALHA_ENVIO':
      return 'O sinal caiu no meio do envio. Vai tentar de novo sozinho.'
    case 'DADOS_INVALIDOS':
      return 'O escritório precisa conferir este lançamento.'
    default:
      return 'Não foi possível enviar. Mostre esta tela ao escritório.'
  }
}
