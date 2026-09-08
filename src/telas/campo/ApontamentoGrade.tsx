import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link, useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { mensagemDe } from '@/dados/api'
import { AlertTriangle, ArrowLeft, Check, Clock, FileText, Lock, PenLine, Plus, Share2 } from 'lucide-react'
import { db } from '@/dados/db'
import { fecharApontamento, itensDoApontamento, paraRascunhoItem } from '@/dados/repositorios/apontamentos'
import { pendenciasParaFechar } from '@/dominio/apontamento/regras'
import { Botao } from '@/componentes/ui/Botao'
import { useSessao } from '@/autenticacao/contexto'
import { formatarLeitura } from '@/utilitarios/numeros'
import { dataBr } from '@/utilitarios/datas'
import { vibrar } from '@/utilitarios/dispositivo'
import { cls } from '@/utilitarios/classes'

/**
 * A grade de 25 linhas do papel, em cartões.
 *
 * Uma tabela real não cabe num celular: oito colunas viram texto de 9px que
 * ninguém lê com luva e sob sol. Cada linha da ficha vira um cartão com o que
 * importa em tamanho legível, e o resto abre em tela cheia.
 */
export function ApontamentoGrade() {
  const { id } = useParams<{ id: string }>()
  const navegar = useNavigate()
  const sessao = useSessao()
  const [fechando, setFechando] = useState(false)
  const [exportando, setExportando] = useState(false)

  const ficha = useLiveQuery(() => (id ? db.apontamentos.get(id) : undefined), [id], undefined)
  const itens = useLiveQuery(() => (id ? itensDoApontamento(id) : []), [id], [])
  const funcionarios = useLiveQuery(() => db.mestre_funcionarios.toArray(), [], [])
  const frotas = useLiveQuery(() => db.mestre_frotas.toArray(), [], [])
  const frentes = useLiveQuery(() => db.mestre_frentes.toArray(), [], [])
  const turnos = useLiveQuery(() => db.mestre_turnos.toArray(), [], [])

  if (!id || !ficha) return <Abrindo />

  const frente = frentes.find((f) => f.id === ficha.frente_id)
  const turno = turnos.find((t) => t.id === ficha.turno_id)
  const fechada = ficha.status !== 'rascunho'
  const pendencias = pendenciasParaFechar(itens.map(paraRascunhoItem))
  const semAssinatura = itens.filter((i) => i.assinatura_status === 'pendente').length

  async function fechar() {
    if (!id) return
    setFechando(true)
    try {
      await fecharApontamento(id, sessao)
      vibrar('ok')
      toast.success('Ficha fechada e enviada para o escritório.')
      navegar('/apontamento')
    } catch (erro) {
      vibrar('erro')
      toast.error(mensagemDe(erro, 'Não foi possível fechar.'))
      setFechando(false)
    }
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="area-segura-superior flex items-center gap-2 border-b-2 border-[var(--cor-borda-forte)] px-2 py-2.5">
        <button
          type="button"
          onClick={() => navegar('/apontamento')}
          aria-label="Voltar"
          className="flex size-[var(--espaco-toque-min)] items-center justify-center"
        >
          <ArrowLeft aria-hidden className="size-7" />
        </button>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold tracking-[0.18em] uppercase">
            {frente?.nome ?? 'Frente'}
          </span>
          <span className="block text-sm text-[var(--cor-texto-suave)]">
            {turno?.nome ?? 'Turno'} · {dataBr(ficha.data)}
          </span>
        </span>
        {fechada && <Lock aria-hidden className="mr-2 size-5 shrink-0" />}
      </header>

      {fechada && (
        <p className="border-b-2 border-[var(--cor-borda-forte)] bg-[var(--cor-superficie)] px-4 py-2.5 text-sm font-semibold">
          Esta ficha foi fechada. Correções agora são feitas pelo escritório.
        </p>
      )}

      <main className="pauta flex-1">
        {itens.map((item) => {
          const funcionario = funcionarios.find((f) => f.id === item.funcionario_id)
          const frota = frotas.find((f) => f.id === item.frota_id)
          const assinado = item.assinatura_status !== 'pendente'

          return (
            <Link
              key={item.id}
              to={fechada ? '#' : '/apontamento/' + id + '/item/' + item.id}
              className={cls('linha-ficha flex items-center gap-3', fechada && 'pointer-events-none')}
            >
              <span className="numerico w-7 shrink-0 font-mono text-lg font-semibold text-[var(--cor-texto-suave)]">
                {item.seq}
              </span>

              <span className="min-w-0 flex-1">
                <span className="block truncate text-base font-bold">{funcionario?.nome ?? '—'}</span>
                <span className="mt-0.5 block text-sm text-[var(--cor-texto-suave)]">
                  Frota {frota?.numero ?? '—'}
                  {item.elevador_inicial !== null && item.elevador_final !== null &&
                    ' · ' + formatarLeitura(item.elevador_final - item.elevador_inicial) + ' h elevador'}
                  {item.odometro_inicial !== null && item.odometro_final !== null &&
                    ' · ' + formatarLeitura(item.odometro_final - item.odometro_inicial) + ' km'}
                </span>
              </span>

              {assinado ? (
                <span className="flex shrink-0 items-center gap-1 text-ok-500">
                  <Check aria-hidden className="size-5" />
                  <span className="sr-only">Assinado</span>
                </span>
              ) : (
                <span className="flex shrink-0 items-center gap-1 text-aviso-500">
                  <Clock aria-hidden className="size-5" />
                  <span className="sr-only">Falta assinar</span>
                </span>
              )}
            </Link>
          )
        })}

        {itens.length === 0 && (
          <p className="linha-ficha text-base text-[var(--cor-texto-suave)]">
            Nenhum funcionário lançado ainda. Toque em “Funcionário” para começar.
          </p>
        )}

        {!fechada && pendencias.length > 0 && itens.length > 0 && (
          <div className="linha-ficha bg-aviso-100">
            <div className="flex items-start gap-2.5">
              <AlertTriangle aria-hidden className="mt-0.5 size-5 shrink-0 text-aviso-500" />
              <span className="flex-1">
                <span className="rotulo-campo">Falta para fechar</span>
                <ul className="mt-1.5 space-y-1 text-sm font-semibold">
                  {pendencias.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </span>
            </div>
          </div>
        )}
      </main>

      <div className="area-segura-inferior sticky bottom-0 space-y-2 border-t-2 border-[var(--cor-borda-forte)] bg-[var(--cor-fundo)] px-4 py-3">
        {!fechada && (
          <Link to={'/apontamento/' + id + '/item/novo'}>
            <Botao barra icone={<Plus aria-hidden className="size-6" />}>
              Funcionário
            </Botao>
          </Link>
        )}

        {!fechada && semAssinatura > 0 && (
          <Link to={'/apontamento/' + id + '/assinaturas'}>
            <Botao barra variante="secundaria" icone={<PenLine aria-hidden className="size-5" />}>
              Colher {semAssinatura} assinatura{semAssinatura > 1 ? 's' : ''}
            </Botao>
          </Link>
        )}

        {itens.length > 0 && (
          <>
            <Botao
              barra
              variante="secundaria"
              disabled={exportando}
              onClick={() => void exportarFicha(id, setExportando, 'excel')}
              icone={<Share2 aria-hidden className="size-5" />}
            >
              {exportando ? 'Gerando…' : 'Enviar planilha'}
            </Botao>
            <Botao
              barra
              variante="secundaria"
              disabled={exportando}
              onClick={() => void exportarFicha(id, setExportando, 'pdf')}
              icone={<FileText aria-hidden className="size-5" />}
            >
              {exportando ? 'Gerando…' : 'Enviar PDF'}
            </Botao>
          </>
        )}

        {/* A ficha fechada continua exportável — o escritório pode pedir a via
            de novo — mas não volta a aceitar lançamento. */}
        {!fechada && (
          <Botao
            barra
            variante="secundaria"
            disabled={pendencias.length > 0 || fechando}
            onClick={() => void fechar()}
            icone={<Lock aria-hidden className="size-5" />}
          >
            {fechando ? 'Fechando…' : 'Fechar ficha'}
          </Botao>
        )}
      </div>
    </div>
  )
}

/**
 * Gera a ficha no layout original, com as 25 linhas numeradas.
 *
 * Planilha para conferir e somar; PDF para arquivar e enviar. São usos
 * diferentes, e o escritório costuma querer os dois da mesma ficha.
 */
async function exportarFicha(
  apontamentoId: string,
  setExportando: (v: boolean) => void,
  formato: 'excel' | 'pdf',
) {
  setExportando(true)
  try {
    const relatorios = await import('@/relatorios/exportar')
    const blob =
      formato === 'pdf'
        ? await relatorios.exportarApontamentoPdf(apontamentoId)
        : await relatorios.exportarApontamento(apontamentoId)
    if (!blob) throw new Error('Ficha não encontrada neste aparelho.')

    const destino = await relatorios.entregarArquivo(
      blob,
      'APONTAMENTO.' + (formato === 'pdf' ? 'pdf' : 'xlsx'),
    )
    toast.success(destino === 'compartilhado' ? 'Ficha enviada.' : 'Ficha salva no aparelho.')
  } catch (erro) {
    toast.error(mensagemDe(erro, 'Não foi possível gerar a ficha.'))
  } finally {
    setExportando(false)
  }
}

function Abrindo() {
  return (
    <div className="flex min-h-dvh items-center justify-center text-base font-semibold text-[var(--cor-texto-suave)]">
      Abrindo…
    </div>
  )
}
