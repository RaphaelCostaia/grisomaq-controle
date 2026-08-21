import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { ArrowLeft, Check, TriangleAlert } from 'lucide-react'
import { db } from '@/dados/db'
import {
  contextoDoApontamento,
  novoRascunhoApontamento,
  salvarApontamento,
} from '@/dados/repositorios/apontamentos'
import { validarApontamento, type ContextoApontamento, type RascunhoApontamento } from '@/dominio/apontamento/regras'
import { Botao } from '@/componentes/ui/Botao'
import { SeletorBusca, type OpcaoSeletor } from '@/componentes/ui/SeletorBusca'
import { useSessao } from '@/autenticacao/contexto'
import { dataBr } from '@/utilitarios/datas'
import { vibrar } from '@/utilitarios/dispositivo'

const CAMPOS_COM_ERRO_PROPRIO = new Set(['frente_id', 'turno_id', 'responsavel_funcionario_id'])

export function ApontamentoNovo() {
  const navegar = useNavigate()
  const sessao = useSessao()

  const [r, setR] = useState<RascunhoApontamento | null>(null)
  const [ctx, setCtx] = useState<ContextoApontamento | null>(null)
  const [salvando, setSalvando] = useState(false)

  const frentes = useLiveQuery(() => db.mestre_frentes.filter((f) => f.ativo).toArray(), [], [])
  const turnos = useLiveQuery(() => db.mestre_turnos.filter((t) => t.ativo).toArray(), [], [])
  const funcionarios = useLiveQuery(() => db.mestre_funcionarios.filter((f) => f.ativo).toArray(), [], [])

  useEffect(() => {
    void novoRascunhoApontamento(sessao).then(setR)
  }, [sessao])

  useEffect(() => {
    void contextoDoApontamento().then(setCtx)
  }, [r?.frente_id, r?.turno_id, r?.data]) // eslint-disable-line react-hooks/exhaustive-deps

  const diagnostico = useMemo(() => (r && ctx ? validarApontamento(r, ctx) : null), [r, ctx])

  const frenteEscolhida = frentes.find((f) => f.id === r?.frente_id)

  // A operação roda 2 turnos em algumas frentes e 3 em outras. Mostrar os cinco
  // turnos cadastrados faria o responsável escolher um que não existe na frente
  // dele — por isso o seletor filtra pela escala da frente.
  const turnosDaFrente = useMemo(
    () => (frenteEscolhida ? turnos.filter((t) => t.escala === frenteEscolhida.escala) : []),
    [turnos, frenteEscolhida],
  )

  if (!r || !ctx || !diagnostico) return <Abrindo />

  const mudar = (parcial: Partial<RascunhoApontamento>) => setR({ ...r, ...parcial })
  const achadoDe = (campo: string) =>
    diagnostico.achados.find((a) => a.campo === campo && a.severidade === 'bloqueante')
  const semLugarNaTela = diagnostico.achados.filter(
    (a) => a.severidade === 'bloqueante' && !CAMPOS_COM_ERRO_PROPRIO.has(a.campo),
  )

  const opcoesFuncionario: OpcaoSeletor[] = funcionarios.map((f) => ({
    id: f.id,
    chave: f.codigo,
    titulo: f.nome,
    ...(f.funcao ? { detalhe: f.funcao } : {}),
  }))

  async function abrirFicha() {
    if (!r || !diagnostico?.podeSalvar) return
    setSalvando(true)
    try {
      const ficha = await salvarApontamento(r, sessao)
      vibrar('ok')
      toast.success('Ficha aberta. Agora lance os funcionários do turno.')
      navegar('/apontamento/' + ficha.id, { replace: true })
    } catch (erro) {
      vibrar('erro')
      toast.error(erro instanceof Error ? erro.message : 'Não foi possível abrir a ficha.')
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
        <span className="flex-1 text-sm font-bold tracking-[0.18em] uppercase">Nova ficha</span>
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

        <div className="linha-ficha">
          <span className="rotulo-campo">Data</span>
          <span className="valor-leitura mt-1 block text-2xl">{dataBr(r.data)}</span>
        </div>

        <SeletorBusca
          rotulo="Frente"
          opcoes={frentes.map((f) => ({ id: f.id, chave: f.codigo, titulo: f.nome }))}
          valor={r.frente_id}
          onEscolher={(id) => mudar({ frente_id: id, turno_id: null })}
          placeholder="Escolher"
          erro={achadoDe('frente_id')?.mensagem}
        />

        {frenteEscolhida ? (
          <SeletorBusca
            rotulo="Turno"
            opcoes={turnosDaFrente.map((t) => ({
              id: t.id,
              chave: t.codigo,
              titulo: t.nome,
              detalhe: t.hora_inicio.slice(0, 5) + ' às ' + t.hora_fim.slice(0, 5),
            }))}
            valor={r.turno_id}
            onEscolher={(id) => mudar({ turno_id: id })}
            placeholder="Escolher"
            erro={achadoDe('turno_id')?.mensagem}
          />
        ) : (
          <div className="linha-ficha opacity-45">
            <span className="rotulo-campo">Turno</span>
            <span className="valor-leitura valor-leitura--vazio mt-1 block">—</span>
            <span className="mt-1 block text-sm text-[var(--cor-texto-suave)]">
              Escolha a frente primeiro: cada frente tem a própria escala de turnos.
            </span>
          </div>
        )}

        <SeletorBusca
          rotulo="Responsável pela ficha"
          opcoes={opcoesFuncionario}
          valor={r.responsavel_funcionario_id}
          onEscolher={(id) => mudar({ responsavel_funcionario_id: id })}
          placeholder="Escolher"
          erro={achadoDe('responsavel_funcionario_id')?.mensagem}
        />

        <div className="linha-ficha">
          <label className="rotulo-campo" htmlFor="observacao">
            Observação
          </label>
          <textarea
            id="observacao"
            value={r.observacao ?? ''}
            onChange={(e) => mudar({ observacao: e.target.value || null })}
            rows={2}
            placeholder="Opcional"
            className="mt-2 w-full border-2 border-[var(--cor-borda-forte)] bg-white px-3 py-2 text-base"
          />
        </div>
      </main>

      <div className="area-segura-inferior sticky bottom-0 border-t-2 border-[var(--cor-borda-forte)] bg-[var(--cor-fundo)] px-4 py-3">
        <Botao
          barra
          disabled={!diagnostico.podeSalvar || salvando}
          onClick={() => void abrirFicha()}
          icone={<Check aria-hidden className="size-6" />}
        >
          {salvando ? 'Abrindo…' : 'Abrir ficha'}
        </Botao>
      </div>
    </div>
  )
}

function Abrindo() {
  return (
    <div className="flex min-h-dvh items-center justify-center text-base font-semibold text-[var(--cor-texto-suave)]">
      Abrindo…
    </div>
  )
}
