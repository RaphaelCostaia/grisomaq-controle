import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { AlertTriangle, ArrowLeft, Check, TriangleAlert } from 'lucide-react'
import { db } from '@/dados/db'
import {
  contextoDeValidacao,
  novoRascunho,
  salvarAbastecimento,
  textoDeAceite,
  ultimoRegistradorDoComboio,
} from '@/dados/repositorios/abastecimentos'
import { conferirLitros, validarAbastecimento, type ContextoAbastecimento, type RascunhoAbastecimento } from '@/dominio/abastecimento/regras'
import type { Achado } from '@/dominio/severidade'
import { Botao } from '@/componentes/ui/Botao'
import { CampoLeitura, GrupoDeLeituras } from '@/componentes/ui/CampoLeitura'
import { SeletorBusca, type OpcaoSeletor } from '@/componentes/ui/SeletorBusca'
import { TelaAceite } from '@/componentes/ui/TelaAceite'
import { useSessao } from '@/autenticacao/contexto'
import { conferirPinLocal } from '@/autenticacao/pin-local'
import { formatarLeitura, formatarLitros } from '@/utilitarios/numeros'
import { dataBr, dataHoraBr } from '@/utilitarios/datas'
import { vibrar } from '@/utilitarios/dispositivo'
import { cls } from '@/utilitarios/classes'

export function AbastecimentoForm() {
  const navegar = useNavigate()
  const sessao = useSessao()

  const [r, setR] = useState<RascunhoAbastecimento | null>(null)
  const [ctx, setCtx] = useState<ContextoAbastecimento | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [assinando, setAssinando] = useState(false)

  const frotas = useLiveQuery(() => db.mestre_frotas.filter((f) => f.ativo).toArray(), [], [])
  const funcionarios = useLiveQuery(() => db.mestre_funcionarios.filter((f) => f.ativo).toArray(), [], [])

  useEffect(() => {
    void novoRascunho().then(setR)
  }, [])

  // O contexto é recarregado quando muda o que ele depende: trocar de frota
  // troca as últimas leituras conhecidas e, com elas, as validações.
  useEffect(() => {
    if (!r) return
    void contextoDeValidacao(r).then(setCtx)
  }, [r?.frota_id, r?.comboio_frota_id]) // eslint-disable-line react-hooks/exhaustive-deps

  // O início do registrador vem preenchido com o fim do abastecimento anterior
  // deste comboio. É o valor certo em quase todos os casos, e deixar o operador
  // redigitar oito dígitos é convidar o erro que a validação depois acusa.
  useEffect(() => {
    if (!r || r.registrador_inicio !== null || !r.comboio_frota_id) return
    void ultimoRegistradorDoComboio(r.comboio_frota_id, r.id).then((anterior) => {
      if (anterior) setR((atual) => (atual ? { ...atual, registrador_inicio: anterior.valor } : atual))
    })
  }, [r?.comboio_frota_id, r?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const diagnostico = useMemo(() => (r && ctx ? validarAbastecimento(r, ctx) : null), [r, ctx])
  const conferencia = useMemo(() => (r && ctx ? conferirLitros(r, ctx.parametros) : null), [r, ctx])

  if (!r || !ctx || !diagnostico) return <Carregando />

  const mudar = (parcial: Partial<RascunhoAbastecimento>) => setR({ ...r, ...parcial })
  const achadoDe = (campo: string) => diagnostico.achados.find((a) => a.campo === campo && a.severidade === 'bloqueante')
  const frota = ctx.frota

  // Nem todo bloqueio tem um campo na tela para pousar: o número da ficha vive
  // no cabeçalho, e a hora é preenchida sozinha. Sem isto, o operador veria o
  // botão desabilitado e nenhuma explicação do porquê.
  const semLugarNaTela = diagnostico.achados.filter(
    (a) => a.severidade === 'bloqueante' && !CAMPOS_COM_ERRO_PROPRIO.has(a.campo),
  )

  const opcoesFrota: OpcaoSeletor[] = frotas.map((f) => ({
    id: f.id,
    chave: f.numero,
    titulo: f.descricao,
    ...(f.capacidade_tanque_litros ? { detalhe: 'Tanque ' + formatarLitros(f.capacidade_tanque_litros) } : {}),
  }))

  const opcoesOperador: OpcaoSeletor[] = funcionarios.map((f) => ({
    id: f.id,
    chave: f.codigo,
    titulo: f.nome,
    ...(f.funcao ? { detalhe: f.funcao } : {}),
  }))

  const operador = funcionarios.find((f) => f.id === r.operador_funcionario_id) ?? null

  async function salvar(pinDoAceite: string) {
    if (!r || !diagnostico?.podeSalvar) return
    setSalvando(true)
    try {
      await salvarAbastecimento(r, sessao, pinDoAceite)
      toast.success('Salvo no celular. Será enviado quando houver sinal.')
      navegar('/abastecimento')
    } catch (erro) {
      vibrar('erro')
      toast.error(erro instanceof Error ? erro.message : 'Não foi possível salvar.')
      setSalvando(false)
      setAssinando(false)
    }
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center gap-2 border-b-2 border-[var(--cor-borda-forte)] px-2 py-2.5">
        <button
          type="button"
          onClick={() => navegar(-1)}
          aria-label="Voltar"
          className="flex size-[var(--espaco-toque-min)] items-center justify-center"
        >
          <ArrowLeft aria-hidden className="size-7" />
        </button>
        <span className="flex-1 text-sm font-bold tracking-[0.18em] uppercase">Abastecimento</span>
        {/* O número da ficha em carmim, como vem impresso no bloco de papel. */}
        <span className="numero-documento pr-2 text-2xl">
          Nº {r.numero_documento ?? '—'}
        </span>
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
            {dataBr(r.data)} · {r.hora}
          </span>
        </div>

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
            rotulo="Horímetro motor"
            valor={r.horimetro_motor}
            onMudar={(v) => mudar({ horimetro_motor: v })}
            desabilitado={!!frota && !frota.tem_horimetro_motor}
            motivoDesabilitado="Esta frota não tem horímetro de motor."
            ultimaConhecida={ultimaDe(ctx, 'horimetro_motor')}
            erro={achadoDe('horimetro_motor')?.mensagem}
          />

          <CampoLeitura
            rotulo="Horímetro elevador"
            valor={r.horimetro_elevador}
            onMudar={(v) => mudar({ horimetro_elevador: v })}
            desabilitado={!!frota && !frota.tem_horimetro_elevador}
            motivoDesabilitado="Esta frota não tem elevador."
            ultimaConhecida={ultimaDe(ctx, 'horimetro_elevador')}
            erro={achadoDe('horimetro_elevador')?.mensagem}
          />

          <CampoLeitura
            rotulo="Hodômetro"
            valor={r.odometro}
            onMudar={(v) => mudar({ odometro: v })}
            desabilitado={!!frota && !frota.tem_odometro}
            motivoDesabilitado="Esta frota não tem hodômetro."
            ultimaConhecida={ultimaDe(ctx, 'odometro')}
            erro={achadoDe('odometro')?.mensagem}
          />

          <CampoLeitura
            rotulo="Início reg. (bomba)"
            valor={r.registrador_inicio}
            onMudar={(v) => mudar({ registrador_inicio: v })}
            casas={1}
            {...(ctx.ultimoRegistradorComboio
              ? {
                  ultimaConhecida: {
                    valor: ctx.ultimoRegistradorComboio.valor,
                    texto:
                      'Ficha ' +
                      ctx.ultimoRegistradorComboio.numero_documento +
                      ' terminou em ' +
                      formatarLeitura(ctx.ultimoRegistradorComboio.valor) +
                      ' · ' +
                      dataHoraBr(new Date(ctx.ultimoRegistradorComboio.momento)),
                  },
                }
              : {})}
            erro={achadoDe('registrador_inicio')?.mensagem}
          />

          <CampoLeitura
            rotulo="Final reg. (bomba)"
            valor={r.registrador_fim}
            onMudar={(v) => mudar({ registrador_fim: v })}
            erro={achadoDe('registrador_fim')?.mensagem}
          />

          <CampoLeitura
            rotulo="Litros"
            valor={r.litros}
            onMudar={(v) => mudar({ litros: v })}
            sufixo="L"
            {...(conferencia
              ? {
                  ultimaConhecida: {
                    valor: conferencia.daBomba,
                    texto: 'A bomba registrou ' + formatarLitros(conferencia.daBomba),
                  },
                }
              : {})}
            erro={achadoDe('litros')?.mensagem}
          />
        </GrupoDeLeituras>

        {conferencia && <LinhaConferencia conferencia={conferencia} litros={r.litros} />}

        <SeletorBusca
          rotulo="Operador que recebeu"
          opcoes={opcoesOperador}
          valor={r.operador_funcionario_id}
          onEscolher={(id) => mudar({ operador_funcionario_id: id })}
          placeholder="Escolher"
          erro={achadoDe('operador_funcionario_id')?.mensagem}
        />

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
          onClick={() => setAssinando(true)}
          icone={<Check aria-hidden className="size-6" />}
        >
          {salvando ? 'Salvando…' : 'Assinar e salvar'}
        </Botao>
      </div>

      {assinando && operador && (
        <TelaAceite
          nome={operador.nome}
          textoAceite={textoDeAceite({
            litros: r.litros ?? 0,
            numero_documento: r.numero_documento ?? 0,
            data: r.data,
            hora: r.hora,
          })}
          onConfirmar={async (pin) => {
            await conferirPinLocal(r!.operador_funcionario_id!, pin)
            await salvar(pin)
          }}
          onCancelar={() => setAssinando(false)}
        />
      )}
    </div>
  )
}

/**
 * A conta que o papel carbonado nunca fez, resolvida enquanto o operador digita.
 * Quando não bate, a tela oferece o valor da bomba com um toque — corrigir é
 * mais provável de estar certo do que justificar.
 */
function LinhaConferencia({
  conferencia,
  litros,
}: {
  conferencia: NonNullable<ReturnType<typeof conferirLitros>>
  litros: number | null
}) {
  return (
    <div
      className={cls(
        'linha-ficha flex items-center gap-2.5',
        conferencia.confere ? 'bg-ok-100' : 'bg-aviso-100',
      )}
      aria-live="polite"
    >
      {conferencia.confere ? (
        <Check aria-hidden className="size-5 shrink-0 text-ok-500" />
      ) : (
        <TriangleAlert aria-hidden className="size-5 shrink-0 text-aviso-500" />
      )}
      <span className="text-sm font-bold">
        {conferencia.confere
          ? 'Confere com a bomba: ' + formatarLitros(conferencia.daBomba)
          : 'A bomba registrou ' +
            formatarLitros(conferencia.daBomba) +
            ' e você informou ' +
            formatarLitros(litros)}
      </span>
    </div>
  )
}

/** Aviso a confirmar ou justificativa a escrever, na própria pauta da ficha. */
function BlocoAchado({
  achado,
  rascunho,
  onMudar,
  confirmado,
}: {
  achado: Achado
  rascunho: RascunhoAbastecimento
  onMudar: (parcial: Partial<RascunhoAbastecimento>) => void
  confirmado: boolean
}) {
  const ehJustificativa = achado.severidade === 'justificavel'
  const campo = achado.campo as 'justificativa_divergencia' | 'justificativa_leitura'

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
          onClick={() =>
            onMudar({ [achado.campo]: achado.sugestao!.valor } as Partial<RascunhoAbastecimento>)
          }
        >
          {achado.sugestao.rotulo}
        </Botao>
      )}

      {ehJustificativa ? (
        <textarea
          value={rascunho[campo] ?? ''}
          onChange={(e) => onMudar({ [campo]: e.target.value } as Partial<RascunhoAbastecimento>)}
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

/** Campos que desenham o próprio erro logo abaixo de si. */
const CAMPOS_COM_ERRO_PROPRIO = new Set([
  'frota_id',
  'horimetro_motor',
  'horimetro_elevador',
  'odometro',
  'registrador_inicio',
  'registrador_fim',
  'litros',
  'operador_funcionario_id',
])

function ultimaDe(ctx: ContextoAbastecimento, tipo: 'horimetro_motor' | 'horimetro_elevador' | 'odometro') {
  const l = ctx.ultimasLeituras[tipo]
  if (!l) return undefined
  return {
    valor: l.valor,
    texto: 'Última: ' + formatarLeitura(l.valor) + ' · ' + dataHoraBr(new Date(l.momento)),
  }
}

function Carregando() {
  return (
    <div className="flex min-h-dvh items-center justify-center text-base font-semibold text-[var(--cor-texto-suave)]">
      Abrindo ficha…
    </div>
  )
}
