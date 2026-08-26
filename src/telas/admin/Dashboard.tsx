import { Fragment, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { AlertTriangle, Image as ImageIcon, CheckCircle2, CloudOff, FileWarning, PenLine } from 'lucide-react'
import { carregarResumo, type ResumoPainel } from '@/dados/painel'
import { baixarBinario } from '@/dados/api'
import { toast } from 'sonner'
import { CabecalhoPainel } from '@/componentes/layout/LayoutAdmin'
import { dataBr, duracaoCurta } from '@/utilitarios/datas'
import { formatarLitros, formatarNumero, formatarHoras, contar } from '@/utilitarios/numeros'
import { cls } from '@/utilitarios/classes'

/**
 * Paleta das séries, validada para daltonismo contra o fundo claro do painel.
 *
 * Não usa o carmim nem as cores de estado: carmim é identidade de documento, e
 * verde/âmbar/vermelho estão reservados para "está tudo bem / atenção / erro".
 * Reaproveitá-los como cor de série faria uma linha subindo parecer um alerta.
 */
const SERIE_A = '#0a8f55'
const SERIE_B = '#1d4ed8'
const TINTA_SUAVE = '#56605a'
const GRADE = '#e3e7e5'

export function Dashboard() {
  const [resumo, setResumo] = useState<ResumoPainel | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    carregarResumo(30)
      .then(setResumo)
      .catch((e) => setErro(e instanceof Error ? e.message : 'Falha ao carregar'))
  }, [])

  const permanencia = useMemo(
    () =>
      (resumo?.caminhoes ?? [])
        .map((l) => ({
          data: l.data,
          rotulo: dataBr(l.data).slice(0, 5),
          media: l.permanencia_media_min === null ? null : Math.round(l.permanencia_media_min),
          p90: l.permanencia_p90_min === null ? null : Math.round(l.permanencia_p90_min),
        }))
        .sort((a, b) => a.data.localeCompare(b.data)),
    [resumo],
  )

  // A API devolve uma linha por frota por dia; o gráfico quer o total do dia.
  const litrosPorDia = useMemo(() => {
    const porDia = new Map<string, number>()
    for (const l of resumo?.abastecimento ?? []) {
      porDia.set(l.data, (porDia.get(l.data) ?? 0) + Number(l.litros ?? 0))
    }
    return [...porDia.entries()]
      .map(([data, litros]) => ({ data, rotulo: dataBr(data).slice(0, 5), litros }))
      .sort((a, b) => a.data.localeCompare(b.data))
  }, [resumo])

  const fichasDivergentes = useMemo(
    () => (resumo?.abastecimento ?? []).reduce((s, l) => s + Number(l.lancamentos_divergentes ?? 0), 0),
    [resumo],
  )

  if (erro) {
    return (
      <>
        <CabecalhoPainel titulo="Painel" />
        <p className="m-8 border-2 border-carbono-500 bg-carbono-50 px-4 py-3 text-sm font-semibold text-carbono-700">
          {erro}
        </p>
      </>
    )
  }

  if (!resumo) {
    return (
      <>
        <CabecalhoPainel titulo="Painel" />
        <p className="p-8 text-sm text-[var(--cor-texto-suave)]">Carregando…</p>
      </>
    )
  }

  return (
    <>
      <CabecalhoPainel titulo="Painel" descricao="Últimos 30 dias da operação." />

      <div className="space-y-6 p-8">
        {/* O que exige ação vem primeiro. Quem abre esta tela de manhã precisa
            saber se algo travou antes de olhar tendência. */}
        <section>
          <h2 className="mb-3 text-[0.6875rem] font-bold tracking-[0.18em] text-[var(--cor-texto-suave)] uppercase">
            Precisa de atenção
          </h2>
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
            <Indicador
              rotulo="Lançamentos travados"
              valor={resumo.conflitos_pendentes}
              detalhe="Conflitos esperando decisão"
              severidade={resumo.conflitos_pendentes > 0 ? 'critica' : 'ok'}
              Icone={FileWarning}
              para="/admin/conflitos"
            />
            <Indicador
              rotulo="Celulares parados"
              valor={resumo.dispositivos_sem_sync.length}
              detalhe="Sem enviar há mais de 12 h"
              severidade={resumo.dispositivos_sem_sync.length > 0 ? 'atencao' : 'ok'}
              Icone={CloudOff}
            />
            <Indicador
              rotulo="Assinaturas a conferir"
              valor={resumo.assinaturas.total}
              detalhe={
                resumo.assinaturas.invalidas > 0
                  ? contar(resumo.assinaturas.invalidas, 'contestada', 'contestadas')
                  : 'Aguardando confirmação'
              }
              severidade={
                resumo.assinaturas.invalidas > 0
                  ? 'critica'
                  : resumo.assinaturas.total > 0
                    ? 'atencao'
                    : 'ok'
              }
              Icone={PenLine}
            />
            <Indicador
              rotulo="Fichas com diferença"
              valor={fichasDivergentes}
              detalhe="Litros não batem com a bomba"
              severidade={fichasDivergentes > 0 ? 'atencao' : 'ok'}
              Icone={AlertTriangle}
            />
          </div>
        </section>

        <section className="grid grid-cols-1 gap-6 2xl:grid-cols-2">
          <Painel
            titulo="Permanência dos caminhões no campo"
            descricao="Caminhão parado é dinheiro parado. A linha de pico mostra os piores casos, que a média esconde."
          >
            {permanencia.length === 0 ? (
              <Vazio texto="Nenhum ciclo de caminhão registrado no período." />
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={permanencia} margin={{ top: 8, right: 16, bottom: 4, left: 4 }}>
                  <CartesianGrid stroke={GRADE} vertical={false} />
                  <XAxis
                    dataKey="rotulo"
                    tick={{ fontSize: 11, fill: TINTA_SUAVE }}
                    tickLine={false}
                    axisLine={{ stroke: GRADE }}
                    minTickGap={24}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: TINTA_SUAVE }}
                    tickLine={false}
                    axisLine={false}
                    width={52}
                    tickFormatter={(v) => duracaoCurta(Number(v))}
                  />
                  <Tooltip
                    formatter={(v, nome) => [duracaoCurta(Number(v)), String(nome)]}
                    labelFormatter={(r) => 'Dia ' + String(r)}
                    contentStyle={dicaEstilo}
                  />
                  <Legend
                    verticalAlign="top"
                    align="left"
                    height={28}
                    iconType="plainline"
                    wrapperStyle={{ fontSize: 12, fontWeight: 600 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="media"
                    name="Média"
                    stroke={SERIE_A}
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 5, strokeWidth: 2, stroke: '#fff' }}
                    connectNulls
                  />
                  <Line
                    type="monotone"
                    dataKey="p90"
                    name="Pico (90%)"
                    stroke={SERIE_B}
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 5, strokeWidth: 2, stroke: '#fff' }}
                    connectNulls
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </Painel>

          <Painel titulo="Diesel abastecido por dia" descricao="Soma de todas as frotas.">
            {litrosPorDia.length === 0 ? (
              <Vazio texto="Nenhum abastecimento lançado no período." />
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={litrosPorDia} margin={{ top: 8, right: 16, bottom: 4, left: 4 }}>
                  <CartesianGrid stroke={GRADE} vertical={false} />
                  <XAxis
                    dataKey="rotulo"
                    tick={{ fontSize: 11, fill: TINTA_SUAVE }}
                    tickLine={false}
                    axisLine={{ stroke: GRADE }}
                    minTickGap={24}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: TINTA_SUAVE }}
                    tickLine={false}
                    axisLine={false}
                    width={56}
                    tickFormatter={(v) => formatarNumero(Number(v), 0)}
                  />
                  <Tooltip
                    formatter={(v) => [formatarLitros(Number(v)), 'Diesel']}
                    labelFormatter={(r) => 'Dia ' + String(r)}
                    cursor={{ fill: 'rgba(10,143,85,0.06)' }}
                    contentStyle={dicaEstilo}
                  />
                  {/* Cantos arredondados só no topo: a base fica ancorada na
                      linha de zero, que é de onde a barra é lida. */}
                  <Bar dataKey="litros" fill={SERIE_A} radius={[4, 4, 0, 0]} maxBarSize={28} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </Painel>
        </section>

        {resumo.fichas_divergentes.length > 0 && (
          <Painel
            titulo="Fichas com diferença de litros"
            descricao="O motivo é o que decide se está tudo bem ou se precisa investigar. Sem justificativa, é diesel saindo sem lançamento."
          >
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b-2 border-[var(--cor-borda-forte)] text-left">
                  <Th>Data</Th>
                  <Th>Ficha</Th>
                  <Th>Frota</Th>
                  <Th className="text-right">Litros</Th>
                  <Th className="text-right">Diferença</Th>
                  <Th>Operador</Th>
                </tr>
              </thead>
              <tbody>
                {resumo.fichas_divergentes.map((f) => (
                  <Fragment key={f.id}>
                    <tr className="border-b border-[var(--cor-borda-fina)]">
                      <Td className="whitespace-nowrap">{dataBr(f.data)} · {String(f.hora).slice(0, 5)}</Td>
                      <Td className="font-mono font-bold text-[var(--carmim)]">{f.numero_documento}</Td>
                      <Td>{f.frota_numero ?? '—'}</Td>
                      <Td className="numerico text-right">{formatarLitros(f.litros)}</Td>
                      <Td className="numerico text-right font-bold text-aviso-500">
                        {Number(f.divergencia_litros) > 0 ? '+' : ''}{formatarLitros(f.divergencia_litros)}
                      </Td>
                      <Td className="text-[var(--cor-texto-suave)]">
                        <span className="mr-2">{f.operador_nome ?? '—'}</span>
                        {f.foto_id && <BotaoFoto anexoId={f.foto_id} />}
                      </Td>
                    </tr>
                    {/* O motivo é o que interessa. Uma linha secundária, indentada,
                        para caber sem apertar as colunas de dados acima. Sem motivo
                        vira alerta explícito: essa é a ficha que precisa ser
                        investigada, e o escritório precisa vê-la de longe. */}
                    <tr className="border-b-2 border-[var(--cor-borda)]">
                      <Td colSpan={6} className="pt-0 pl-2 pb-3">
                        {f.justificativa_divergencia ? (
                          <span className="italic text-[var(--cor-texto)]">
                            <span className="mr-2 font-mono text-xs uppercase tracking-widest text-[var(--cor-texto-suave)]">motivo</span>
                            &ldquo;{f.justificativa_divergencia}&rdquo;
                          </span>
                        ) : (
                          <span className="font-semibold text-carmim-600">
                            Sem justificativa. Investigar antes do fechamento.
                          </span>
                        )}
                      </Td>
                    </tr>
                  </Fragment>
                ))}
              </tbody>
            </table>
          </Painel>
        )}

        {resumo.dispositivos_sem_sync.length > 0 && (
          <Painel
            titulo="Celulares sem enviar"
            descricao="Cada um desses tem lançamentos que ainda não chegaram ao escritório."
          >
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b-2 border-[var(--cor-borda-forte)] text-left">
                  <Th>Funcionário</Th>
                  <Th>Aparelho</Th>
                  <Th>Versão</Th>
                  <Th className="text-right">Sem enviar há</Th>
                </tr>
              </thead>
              <tbody>
                {resumo.dispositivos_sem_sync.map((d) => (
                  <tr key={d.id} className="border-b border-[var(--cor-borda)]">
                    <Td>{d.funcionario_nome ?? '—'}</Td>
                    <Td className="font-mono text-xs">{d.id.slice(0, 8).toUpperCase()}</Td>
                    <Td>{d.app_versao ?? '—'}</Td>
                    <Td className="numerico text-right font-bold">
                      {d.horas_sem_sync === null || d.horas_sem_sync === undefined
                        ? 'nunca enviou'
                        : formatarHoras(d.horas_sem_sync)}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Painel>
        )}
      </div>
    </>
  )
}

const dicaEstilo = {
  border: '2px solid var(--cor-borda-forte)',
  borderRadius: 0,
  fontSize: 12,
  fontWeight: 600,
} as const

type Severidade = 'ok' | 'atencao' | 'critica'

/**
 * Indicador de ação. Cor NUNCA sozinha: sempre com ícone e com o texto do
 * detalhe dizendo o que aquele número significa.
 */
function Indicador({
  rotulo,
  valor,
  detalhe,
  severidade,
  Icone,
  para,
}: {
  rotulo: string
  valor: number
  detalhe: string
  severidade: Severidade
  Icone: typeof AlertTriangle
  para?: string
}) {
  const aparencia: Record<Severidade, string> = {
    ok: 'border-[var(--cor-borda)] bg-[var(--cor-fundo)] text-[var(--cor-texto-suave)]',
    atencao: 'border-aviso-500 bg-aviso-100 text-aviso-500',
    critica: 'border-carbono-500 bg-carbono-50 text-carbono-700',
  }

  const conteudo = (
    <div className={cls('border-2 px-4 py-3.5', aparencia[severidade])}>
      <div className="flex items-center gap-2">
        {severidade === 'ok' ? (
          <CheckCircle2 aria-hidden className="size-4 text-ok-500" />
        ) : (
          <Icone aria-hidden className="size-4" />
        )}
        <span className="text-[0.6875rem] font-bold tracking-[0.12em] uppercase">{rotulo}</span>
      </div>
      <p className="numerico mt-2 font-mono text-3xl font-bold text-[var(--cor-texto)]">{valor}</p>
      <p className="mt-1 text-xs">{detalhe}</p>
    </div>
  )

  return para && valor > 0 ? (
    <Link to={para} className="block transition-opacity hover:opacity-80">
      {conteudo}
    </Link>
  ) : (
    conteudo
  )
}

function Painel({
  titulo,
  descricao,
  children,
}: {
  titulo: string
  descricao?: string
  children: React.ReactNode
}) {
  return (
    <section className="border-2 border-[var(--cor-borda-forte)] bg-[var(--cor-fundo)] p-5">
      <h2 className="text-base font-bold">{titulo}</h2>
      {descricao && <p className="mt-1 mb-4 text-sm text-[var(--cor-texto-suave)]">{descricao}</p>}
      {children}
    </section>
  )
}

function Vazio({ texto }: { texto: string }) {
  return (
    <p className="flex h-[260px] items-center justify-center text-sm text-[var(--cor-texto-suave)]">
      {texto}
    </p>
  )
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      className={cls(
        'py-2 text-[0.6875rem] font-bold tracking-[0.1em] text-[var(--cor-texto-suave)] uppercase',
        className,
      )}
    >
      {children}
    </th>
  )
}

function BotaoFoto({ anexoId }: { anexoId: string }) {
  const [abrindo, setAbrindo] = useState(false)

  /**
   * Abre a foto em aba nova. O endpoint exige Authorization; um `<a href>` cru
   * seria 401. Baixa via fetch autenticado, gera um blob URL local e abre.
   *
   * `window.open` chamado dentro do handler do clique preserva o "aberto pelo
   * usuário" e escapa do bloqueador de pop-ups; para isso a URL final precisa
   * ser passada logo em seguida, mesmo que a foto ainda esteja chegando.
   */
  async function abrir() {
    setAbrindo(true)
    // Abrir a aba DENTRO do handler preserva o gesto do usuário e escapa do
    // bloqueador de pop-ups; a URL final é setada quando a foto chegar.
    const nova = window.open('', '_blank')
    try {
      const blob = await baixarBinario('/anexos/' + anexoId + '/arquivo')
      const url = URL.createObjectURL(blob)
      if (nova) nova.location.href = url
      else window.open(url, '_blank')
      // Não revogo aqui: se revogar imediatamente, a aba nova perde a imagem
      // antes de terminar de carregar. Fica na memória até fechar a página.
    } catch (erro) {
      nova?.close()
      toast.error(erro instanceof Error ? erro.message : 'Não foi possível baixar a foto.')
    } finally {
      setAbrindo(false)
    }
  }

  return (
    <button
      type="button"
      onClick={() => void abrir()}
      disabled={abrindo}
      className="inline-flex items-center gap-1 border border-[var(--cor-borda)] px-2 py-0.5 text-xs font-semibold text-[var(--cor-texto)] hover:bg-[var(--cor-superficie)] disabled:opacity-40"
    >
      <ImageIcon aria-hidden className="size-3.5" />
      {abrindo ? 'abrindo…' : 'ver foto'}
    </button>
  )
}

function Td({ children, className, colSpan }: { children: React.ReactNode; className?: string; colSpan?: number }) {
  return <td colSpan={colSpan} className={cls('py-2.5', className)}>{children}</td>
}
