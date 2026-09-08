import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { mensagemDe } from '@/dados/api'
import { LogOut, Plus, Share2, Truck } from 'lucide-react'
import { db, lerMeta } from '@/dados/db'
import { ciclosAbertos, ciclosConcluidosDoDia, registrarSaida } from '@/dados/repositorios/caminhoes'
import { faixaDePermanencia } from '@/dominio/caminhoes/regras'
import { mesclarParametros, PARAMETROS_PADRAO } from '@/dominio/parametros'
import type { CaminhaoCiclo } from '@/dominio/tipos'
import { BarraSync } from '@/componentes/layout/BarraSync'
import { AbasInferiores } from '@/componentes/layout/AbasInferiores'
import { Botao } from '@/componentes/ui/Botao'
import { Cronometro } from '@/componentes/ui/Cronometro'
import { useSessao } from '@/autenticacao/contexto'
import { duracaoCurta, horaDe, hojeOperacional, minutosEntre } from '@/utilitarios/datas'
import { vibrar } from '@/utilitarios/dispositivo'
import { cls } from '@/utilitarios/classes'

/**
 * O pátio: quem está no campo agora e há quanto tempo.
 *
 * Esta é a tela que a planilha nunca pôde ser. No papel, a permanência só
 * existiria se alguém subtraísse trezentas linhas à mão — aqui ela é o assunto
 * principal, correndo na frente de quem pode fazer algo a respeito.
 */
export function Patio() {
  const sessao = useSessao()
  const [fechando, setFechando] = useState<string | null>(null)
  const [exportando, setExportando] = useState(false)

  const abertos = useLiveQuery(() => ciclosAbertos(), [], [])
  const concluidos = useLiveQuery(() => ciclosConcluidosDoDia(), [], [])
  const veiculos = useLiveQuery(() => db.mestre_veiculos.toArray(), [], [])
  const parametros = useLiveQuery(
    async () => {
      const brutos = await lerMeta<Array<{ chave: string; valor: unknown }>>('parametros')
      return brutos ? mesclarParametros(brutos) : PARAMETROS_PADRAO
    },
    [],
    PARAMETROS_PADRAO,
  )

  const numeroDe = (id: string | null) => veiculos.find((v) => v.id === id)?.numero ?? null

  async function fecharCiclo(ciclo: CaminhaoCiclo) {
    setFechando(ciclo.id)
    try {
      await registrarSaida(ciclo.id, sessao)
      vibrar('ok')
      const permanencia = minutosEntre(new Date(ciclo.chegada_em), new Date())
      toast.success('Saída registrada. ' + duracaoCurta(permanencia) + ' no campo.')
    } catch (erro) {
      vibrar('erro')
      toast.error(mensagemDe(erro, 'Não foi possível registrar a saída.'))
    } finally {
      setFechando(null)
    }
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <BarraSync />

      <header className="border-b-2 border-[var(--cor-borda-forte)] px-4 py-3">
        <h1 className="text-sm font-bold tracking-[0.18em] uppercase">Pátio</h1>
        <p className="mt-1 text-sm text-[var(--cor-texto-suave)]">
          {abertos.length === 0
            ? 'Nenhum caminhão no campo agora.'
            : abertos.length === 1
              ? '1 caminhão no campo'
              : abertos.length + ' caminhões no campo'}
          {concluidos.length > 0 && ' · ' + concluidos.length + ' já saíram hoje'}
        </p>
      </header>

      <main className="pauta flex-1">
        {abertos.map((ciclo) => (
          <LinhaNoCampo
            key={ciclo.id}
            ciclo={ciclo}
            numeroDe={numeroDe}
            faixa={faixaDePermanencia(minutosEntre(new Date(ciclo.chegada_em), new Date()), parametros)}
            fechando={fechando === ciclo.id}
            onSaida={() => void fecharCiclo(ciclo)}
          />
        ))}

        {abertos.length === 0 && (
          <p className="linha-ficha flex items-center gap-2.5 text-base text-[var(--cor-texto-suave)]">
            <Truck aria-hidden className="size-5" />
            Toque em “Chegada” quando o próximo caminhão entrar.
          </p>
        )}

        {concluidos.length > 0 && (
          <>
            <p className="linha-ficha bg-[var(--cor-superficie)] py-2">
              <span className="rotulo-campo">Já saíram hoje</span>
            </p>
            {concluidos.map((ciclo) => (
              <LinhaConcluida key={ciclo.id} ciclo={ciclo} numeroDe={numeroDe} />
            ))}
          </>
        )}
      </main>

      <div className="sticky bottom-0 space-y-2 border-t-2 border-[var(--cor-borda-forte)] bg-[var(--cor-fundo)] px-4 py-3">
        <Link to="/caminhoes/chegada">
          <Botao barra icone={<Plus aria-hidden className="size-6" />}>
            Chegada
          </Botao>
        </Link>

        {(abertos.length > 0 || concluidos.length > 0) && (
          <Botao
            barra
            variante="secundaria"
            disabled={exportando}
            onClick={() => void exportarDia(setExportando)}
            icone={<Share2 aria-hidden className="size-5" />}
          >
            {exportando ? 'Gerando…' : 'Enviar controle do dia'}
          </Botao>
        )}
      </div>

      <AbasInferiores />
    </div>
  )
}

/** Gera o controle do dia no layout da planilha original e compartilha. */
async function exportarDia(setExportando: (v: boolean) => void) {
  setExportando(true)
  try {
    const { exportarCaminhoes, entregarArquivo } = await import('@/relatorios/exportar')
    const hoje = hojeOperacional()
    const blob = await exportarCaminhoes(hoje)
    const destino = await entregarArquivo(blob, 'CAMINHOES ' + hoje + '.xlsx')
    toast.success(destino === 'compartilhado' ? 'Controle enviado.' : 'Controle salvo no aparelho.')
  } catch (erro) {
    toast.error(mensagemDe(erro, 'Não foi possível gerar o controle.'))
  } finally {
    setExportando(false)
  }
}

function LinhaNoCampo({
  ciclo,
  numeroDe,
  faixa,
  fechando,
  onSaida,
}: {
  ciclo: CaminhaoCiclo
  numeroDe: (id: string | null) => string | null
  faixa: 'normal' | 'atencao' | 'critica'
  fechando: boolean
  onSaida: () => void
}) {
  // Cor acompanha o texto, nunca o substitui: o tempo em números é o que
  // informa, e a faixa só o torna visível de longe.
  const fundo =
    faixa === 'critica' ? 'bg-carbono-50' : faixa === 'atencao' ? 'bg-aviso-100' : 'bg-[var(--cor-superficie-alta)]'

  const carretas = [numeroDe(ciclo.carreta1_id), numeroDe(ciclo.carreta2_id)].filter(Boolean)

  return (
    <div className={cls('linha-ficha flex items-center gap-3', fundo)}>
      <span className="min-w-0 flex-1">
        <span className="rotulo-campo">Caminhão</span>
        <span className="valor-leitura mt-0.5 block">{numeroDe(ciclo.caminhao_id) ?? '—'}</span>
        <span className="mt-1 block text-sm text-[var(--cor-texto-suave)]">
          {carretas.length > 0 ? 'Carretas ' + carretas.join(' · ') : 'Sem carreta'}
          {' · chegou ' + horaDe(new Date(ciclo.chegada_em))}
        </span>
        <span
          className={cls(
            'mt-1.5 block text-lg font-extrabold',
            faixa === 'critica' ? 'text-carbono-700' : faixa === 'atencao' ? 'text-aviso-500' : 'text-marca-600',
          )}
        >
          <Cronometro desde={ciclo.chegada_em} /> no campo
        </span>
      </span>

      <Botao
        onClick={onSaida}
        disabled={fechando}
        className="h-[var(--espaco-toque-primario)] shrink-0"
        icone={<LogOut aria-hidden className="size-5" />}
      >
        {fechando ? '…' : 'Saída'}
      </Botao>
    </div>
  )
}

function LinhaConcluida({
  ciclo,
  numeroDe,
}: {
  ciclo: CaminhaoCiclo
  numeroDe: (id: string | null) => string | null
}) {
  const permanencia = minutosEntre(new Date(ciclo.chegada_em), new Date(ciclo.saida_em!))
  return (
    <div className="linha-ficha flex items-center gap-3 opacity-70">
      <span className="numerico w-16 shrink-0 font-mono text-xl font-semibold">
        {numeroDe(ciclo.caminhao_id) ?? '—'}
      </span>
      <span className="min-w-0 flex-1 text-sm">
        {horaDe(new Date(ciclo.chegada_em))} → {horaDe(new Date(ciclo.saida_em!))}
      </span>
      <span className="numerico shrink-0 text-base font-bold">{duracaoCurta(permanencia)}</span>
    </div>
  )
}
