import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { AlertTriangle, ArrowLeft, Check, TriangleAlert } from 'lucide-react'
import { db } from '@/dados/db'
import { contextoDeValidacaoCiclo, novoRascunhoCiclo, salvarChegada } from '@/dados/repositorios/caminhoes'
import { validarCiclo, type ContextoCiclo, type RascunhoCiclo } from '@/dominio/caminhoes/regras'
import { Botao } from '@/componentes/ui/Botao'
import { SeletorBusca, type OpcaoSeletor } from '@/componentes/ui/SeletorBusca'
import { useSessao } from '@/autenticacao/contexto'
import { dataBr } from '@/utilitarios/datas'
import { vibrar } from '@/utilitarios/dispositivo'
import { cls } from '@/utilitarios/classes'

/** Campos que desenham o próprio erro logo abaixo de si. */
const CAMPOS_COM_ERRO_PROPRIO = new Set(['caminhao_id', 'carreta1_id', 'carreta2_id', 'fazenda_id', 'lider_id'])

export function NovaChegada() {
  const navegar = useNavigate()
  const sessao = useSessao()

  const [r, setR] = useState<RascunhoCiclo | null>(null)
  const [ctx, setCtx] = useState<ContextoCiclo | null>(null)
  const [salvando, setSalvando] = useState(false)

  const veiculos = useLiveQuery(() => db.mestre_veiculos.filter((v) => v.ativo).toArray(), [], [])
  const fazendas = useLiveQuery(() => db.mestre_fazendas.filter((f) => f.ativo).toArray(), [], [])
  const lideres = useLiveQuery(() => db.mestre_lideres.filter((l) => l.ativo).toArray(), [], [])

  useEffect(() => {
    void novoRascunhoCiclo().then(setR)
  }, [])

  useEffect(() => {
    if (!r) return
    void contextoDeValidacaoCiclo(r).then(setCtx)
  }, [r?.caminhao_id, r?.carreta1_id, r?.carreta2_id]) // eslint-disable-line react-hooks/exhaustive-deps

  const diagnostico = useMemo(() => (r && ctx ? validarCiclo(r, ctx) : null), [r, ctx])

  if (!r || !ctx || !diagnostico) return <Abrindo />

  const mudar = (parcial: Partial<RascunhoCiclo>) => setR({ ...r, ...parcial })
  const achadoDe = (campo: string) =>
    diagnostico.achados.find((a) => a.campo === campo && a.severidade === 'bloqueante')
  const semLugarNaTela = diagnostico.achados.filter(
    (a) => a.severidade === 'bloqueante' && !CAMPOS_COM_ERRO_PROPRIO.has(a.campo),
  )

  const cavalos: OpcaoSeletor[] = veiculos
    .filter((v) => v.tipo === 'cavalo')
    .map((v) => ({ id: v.id, chave: v.numero, titulo: v.transportadora ?? 'Caminhão ' + v.numero }))

  const carretas: OpcaoSeletor[] = veiculos
    .filter((v) => v.tipo === 'carreta')
    .map((v) => ({ id: v.id, chave: v.numero, titulo: v.transportadora ?? 'Carreta ' + v.numero }))

  async function salvar() {
    if (!r || !diagnostico?.podeSalvar) return
    setSalvando(true)
    try {
      await salvarChegada(r, sessao)
      vibrar('ok')
      toast.success('Chegada registrada. O cronômetro já está correndo.')
      navegar('/caminhoes')
    } catch (erro) {
      vibrar('erro')
      toast.error(erro instanceof Error ? erro.message : 'Não foi possível registrar.')
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
        <span className="flex-1 text-sm font-bold tracking-[0.18em] uppercase">Chegada</span>
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
          <span className="rotulo-campo">Data e hora</span>
          <span className="valor-leitura mt-1 block text-2xl">
            {dataBr(r.data)} · {r.hora_chegada}
          </span>
        </div>

        <SeletorBusca
          rotulo="Caminhão"
          opcoes={cavalos}
          valor={r.caminhao_id}
          onEscolher={(id) => mudar({ caminhao_id: id })}
          placeholder="Escolher"
          erro={achadoDe('caminhao_id')?.mensagem}
        />

        <SeletorBusca
          rotulo="1ª carreta"
          opcoes={carretas}
          valor={r.carreta1_id}
          onEscolher={(id) => mudar({ carreta1_id: id })}
          placeholder="Escolher"
          erro={achadoDe('carreta1_id')?.mensagem}
        />

        <SeletorBusca
          rotulo="2ª carreta"
          opcoes={carretas}
          valor={r.carreta2_id}
          onEscolher={(id) => mudar({ carreta2_id: id })}
          placeholder="Escolher"
          erro={achadoDe('carreta2_id')?.mensagem}
        />

        <SeletorBusca
          rotulo="Fazenda"
          opcoes={fazendas.map((f) => ({ id: f.id, chave: f.codigo, titulo: f.nome }))}
          valor={r.fazenda_id}
          onEscolher={(id) => mudar({ fazenda_id: id })}
          placeholder="Escolher"
        />

        <SeletorBusca
          rotulo="Líder do malhador"
          opcoes={lideres.map((l) => ({ id: l.id, chave: l.codigo ?? '—', titulo: l.nome }))}
          valor={r.lider_id}
          onEscolher={(id) => mudar({ lider_id: id })}
          placeholder="Escolher"
        />

        {diagnostico.achados
          .filter((a) => a.severidade === 'aviso')
          .map((a) => (
            <div key={a.codigo} className="linha-ficha bg-aviso-100">
              <div className="flex items-start gap-2.5">
                <AlertTriangle aria-hidden className="mt-0.5 size-5 shrink-0 text-aviso-500" />
                <p className="flex-1 text-sm font-semibold">{a.mensagem}</p>
              </div>
              <Botao
                variante={r.avisos_confirmados.includes(a.codigo) ? 'primaria' : 'secundaria'}
                className="mt-3 w-full"
                onClick={() =>
                  mudar({
                    avisos_confirmados: r.avisos_confirmados.includes(a.codigo)
                      ? r.avisos_confirmados.filter((c) => c !== a.codigo)
                      : [...r.avisos_confirmados, a.codigo],
                  })
                }
                icone={
                  r.avisos_confirmados.includes(a.codigo) ? <Check aria-hidden className="size-5" /> : undefined
                }
              >
                {r.avisos_confirmados.includes(a.codigo) ? 'Confirmado' : 'Confirmo'}
              </Botao>
            </div>
          ))}
      </main>

      <div className="area-segura-inferior sticky bottom-0 border-t-2 border-[var(--cor-borda-forte)] bg-[var(--cor-fundo)] px-4 py-3">
        <Botao
          barra
          disabled={!diagnostico.podeSalvar || salvando}
          onClick={() => void salvar()}
          icone={<Check aria-hidden className="size-6" />}
        >
          {salvando ? 'Registrando…' : 'Registrar chegada'}
        </Botao>
      </div>
    </div>
  )
}

function Abrindo() {
  return (
    <div className={cls('flex min-h-dvh items-center justify-center text-base font-semibold text-[var(--cor-texto-suave)]')}>
      Abrindo…
    </div>
  )
}
