import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { AlertTriangle, ArrowLeft, Check, TriangleAlert } from 'lucide-react'
import { db } from '@/dados/db'
import {
  contextoDoItem,
  novoRascunhoItem,
  paraRascunhoItem,
  salvarItem,
} from '@/dados/repositorios/apontamentos'
import { validarItem, type ContextoItem, type RascunhoItem } from '@/dominio/apontamento/regras'
import type { Achado } from '@/dominio/severidade'
import { Botao } from '@/componentes/ui/Botao'
import { CampoLeitura, GrupoDeLeituras } from '@/componentes/ui/CampoLeitura'
import { SeletorBusca, type OpcaoSeletor } from '@/componentes/ui/SeletorBusca'
import { useSessao } from '@/autenticacao/contexto'
import { formatarLeitura } from '@/utilitarios/numeros'
import { dataHoraBr } from '@/utilitarios/datas'
import { vibrar } from '@/utilitarios/dispositivo'
import { cls } from '@/utilitarios/classes'

const CAMPOS_COM_ERRO_PROPRIO = new Set([
  'funcionario_id',
  'frota_id',
  'odometro_inicial',
  'odometro_final',
  'elevador_inicial',
  'elevador_final',
])

export function ApontamentoItemTela() {
  const { id: apontamentoId, itemId } = useParams<{ id: string; itemId: string }>()
  const navegar = useNavigate()
  const sessao = useSessao()

  const [r, setR] = useState<RascunhoItem | null>(null)
  const [ctx, setCtx] = useState<ContextoItem | null>(null)
  const [salvando, setSalvando] = useState(false)

  const funcionarios = useLiveQuery(() => db.mestre_funcionarios.filter((f) => f.ativo).toArray(), [], [])
  const frotas = useLiveQuery(() => db.mestre_frotas.filter((f) => f.ativo).toArray(), [], [])

  useEffect(() => {
    if (!apontamentoId) return
    void (async () => {
      if (itemId && itemId !== 'novo') {
        const existente = await db.apontamento_itens.get(itemId)
        setR(existente ? paraRascunhoItem(existente) : await novoRascunhoItem(apontamentoId))
      } else {
        setR(await novoRascunhoItem(apontamentoId))
      }
    })()
  }, [apontamentoId, itemId])

  useEffect(() => {
    if (!apontamentoId || !r) return
    void contextoDoItem(apontamentoId, r).then(setCtx)
  }, [apontamentoId, r?.frota_id, r?.funcionario_id]) // eslint-disable-line react-hooks/exhaustive-deps

  const diagnostico = useMemo(() => (r && ctx ? validarItem(r, ctx) : null), [r, ctx])

  if (!apontamentoId || !r || !ctx || !diagnostico) return <Abrindo />

  const mudar = (parcial: Partial<RascunhoItem>) => setR({ ...r, ...parcial })
  const achadoDe = (campo: string) =>
    diagnostico.achados.find((a) => a.campo === campo && a.severidade === 'bloqueante')
  const semLugarNaTela = diagnostico.achados.filter(
    (a) => a.severidade === 'bloqueante' && !CAMPOS_COM_ERRO_PROPRIO.has(a.campo),
  )
  const frota = ctx.frota

  const opcoesFuncionario: OpcaoSeletor[] = funcionarios.map((f) => ({
    id: f.id,
    chave: f.codigo,
    titulo: f.nome,
    ...(f.funcao ? { detalhe: f.funcao } : {}),
  }))

  const opcoesFrota: OpcaoSeletor[] = frotas.map((f) => ({
    id: f.id,
    chave: f.numero,
    titulo: f.descricao,
  }))

  async function salvar() {
    if (!r || !apontamentoId || !diagnostico?.podeSalvar) return
    setSalvando(true)
    try {
      await salvarItem(apontamentoId, r, sessao)
      vibrar('ok')
      toast.success('Linha salva.')
      navegar('/apontamento/' + apontamentoId)
    } catch (erro) {
      vibrar('erro')
      toast.error(erro instanceof Error ? erro.message : 'Não foi possível salvar.')
      setSalvando(false)
    }
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
        <span className="flex-1 text-sm font-bold tracking-[0.18em] uppercase">Linha {r.seq}</span>
      </header>

      <main className="pauta flex-1 pb-4">
        {semLugarNaTela.map((a) => (
          <p
            key={a.codigo}
            role="alert"
            className="linha-ficha flex items-start gap-2.5 bg-carbono-50 text-sm font-semibold text-carbono-700"
          >
            <TriangleAlert aria-hidden className="mt-0.5 size-5 shrink-0" />
            {a.mensagem}
          </p>
        ))}

        <SeletorBusca
          rotulo="Funcionário"
          opcoes={opcoesFuncionario}
          valor={r.funcionario_id}
          onEscolher={(id) => mudar({ funcionario_id: id })}
          placeholder="Escolher"
          erro={achadoDe('funcionario_id')?.mensagem}
        />

        <SeletorBusca
          rotulo="Frota"
          opcoes={opcoesFrota}
          valor={r.frota_id}
          onEscolher={(id) => mudar({ frota_id: id })}
          placeholder="Escolher"
          erro={achadoDe('frota_id')?.mensagem}
        />

        <GrupoDeLeituras>
          <CampoLeitura
            rotulo="Hodômetro inicial"
            valor={r.odometro_inicial}
            onMudar={(v) => mudar({ odometro_inicial: v })}
            desabilitado={!!frota && !frota.tem_odometro}
            motivoDesabilitado="Esta frota não tem hodômetro."
            ultimaConhecida={ultimaDe(ctx, 'odometro')}
            erro={achadoDe('odometro_inicial')?.mensagem}
          />

          <CampoLeitura
            rotulo="Hodômetro final"
            valor={r.odometro_final}
            onMudar={(v) => mudar({ odometro_final: v })}
            desabilitado={!!frota && !frota.tem_odometro}
            motivoDesabilitado="Esta frota não tem hodômetro."
            erro={achadoDe('odometro_final')?.mensagem}
          />

          <CampoLeitura
            rotulo="Elevador inicial"
            valor={r.elevador_inicial}
            onMudar={(v) => mudar({ elevador_inicial: v })}
            desabilitado={!!frota && !frota.tem_horimetro_elevador}
            motivoDesabilitado="Esta frota não tem elevador."
            ultimaConhecida={ultimaDe(ctx, 'horimetro_elevador')}
            erro={achadoDe('elevador_inicial')?.mensagem}
          />

          <CampoLeitura
            rotulo="Elevador final"
            valor={r.elevador_final}
            onMudar={(v) => mudar({ elevador_final: v })}
            desabilitado={!!frota && !frota.tem_horimetro_elevador}
            motivoDesabilitado="Esta frota não tem elevador."
            erro={achadoDe('elevador_final')?.mensagem}
          />
        </GrupoDeLeituras>

        {r.odometro_inicial !== null && r.odometro_final !== null && (
          <Resumo rotulo="Rodou" valor={formatarLeitura(r.odometro_final - r.odometro_inicial) + ' km'} />
        )}
        {r.elevador_inicial !== null && r.elevador_final !== null && (
          <Resumo rotulo="Elevador" valor={formatarLeitura(r.elevador_final - r.elevador_inicial) + ' h'} />
        )}

        {diagnostico.achados
          .filter((a) => a.severidade !== 'bloqueante')
          .map((a) => (
            <BlocoAchado
              key={a.codigo}
              achado={a}
              rascunho={r}
              onMudar={mudar}
              confirmado={r.avisos_confirmados.includes(a.codigo)}
            />
          ))}
      </main>

      <div className="area-segura-inferior sticky bottom-0 border-t-2 border-[var(--cor-borda-forte)] bg-[var(--cor-fundo)] px-4 py-3">
        <Botao
          barra
          disabled={!diagnostico.podeSalvar || salvando}
          onClick={() => void salvar()}
          icone={<Check aria-hidden className="size-6" />}
        >
          {salvando ? 'Salvando…' : 'Salvar linha'}
        </Botao>
      </div>
    </div>
  )
}

/** Os deltas calculados, para o operador conferir antes de salvar. */
function Resumo({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="linha-ficha flex items-center justify-between bg-[var(--cor-superficie)] py-2.5">
      <span className="rotulo-campo">{rotulo}</span>
      <span className="numerico font-mono text-xl font-semibold">{valor}</span>
    </div>
  )
}

function BlocoAchado({
  achado,
  rascunho,
  onMudar,
  confirmado,
}: {
  achado: Achado
  rascunho: RascunhoItem
  onMudar: (parcial: Partial<RascunhoItem>) => void
  confirmado: boolean
}) {
  const ehJustificativa = achado.severidade === 'justificavel'

  return (
    <div className={cls('linha-ficha', ehJustificativa ? 'bg-carbono-50' : 'bg-aviso-100')}>
      <div className="flex items-start gap-2.5">
        <AlertTriangle
          aria-hidden
          className={cls('mt-0.5 size-5 shrink-0', ehJustificativa ? 'text-carbono-700' : 'text-aviso-500')}
        />
        <p className="flex-1 text-sm font-semibold">{achado.mensagem}</p>
      </div>

      {achado.sugestao && (
        <Botao
          variante="secundaria"
          className="mt-3 w-full"
          onClick={() => onMudar({ [achado.campo]: achado.sugestao!.valor } as Partial<RascunhoItem>)}
        >
          {achado.sugestao.rotulo}
        </Botao>
      )}

      {ehJustificativa ? (
        <textarea
          value={rascunho.justificativa_leitura ?? ''}
          onChange={(e) => onMudar({ justificativa_leitura: e.target.value || null })}
          rows={2}
          placeholder="Escreva o motivo"
          className="mt-3 w-full border-2 border-[var(--cor-borda-forte)] bg-white px-3 py-2 text-base"
        />
      ) : (
        <Botao
          variante={confirmado ? 'primaria' : 'secundaria'}
          className="mt-3 w-full"
          onClick={() =>
            onMudar({
              avisos_confirmados: confirmado
                ? rascunho.avisos_confirmados.filter((c) => c !== achado.codigo)
                : [...rascunho.avisos_confirmados, achado.codigo],
            })
          }
          icone={confirmado ? <Check aria-hidden className="size-5" /> : undefined}
        >
          {confirmado ? 'Confirmado' : 'Confirmo'}
        </Botao>
      )}
    </div>
  )
}

function ultimaDe(ctx: ContextoItem, tipo: 'odometro' | 'horimetro_elevador') {
  const l = ctx.ultimasLeituras[tipo]
  if (!l) return undefined
  return {
    valor: l.valor,
    texto: 'Última: ' + formatarLeitura(l.valor) + ' · ' + dataHoraBr(new Date(l.momento)),
  }
}

function Abrindo() {
  return (
    <div className="flex min-h-dvh items-center justify-center text-base font-semibold text-[var(--cor-texto-suave)]">
      Abrindo…
    </div>
  )
}
