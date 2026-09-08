import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Check, ChevronDown, ChevronRight, FileWarning } from 'lucide-react'
import { carregarConflitos, resolverConflito, type Conflito } from '@/dados/painel'
import { CabecalhoPainel } from '@/componentes/layout/LayoutAdmin'
import { Botao } from '@/componentes/ui/Botao'
import { mensagemDe } from '@/dados/api'
import { dataHoraBr } from '@/utilitarios/datas'


const NOME_DA_TABELA: Record<string, string> = {
  abastecimentos: 'Abastecimento',
  caminhao_ciclos: 'Caminhão',
  apontamentos: 'Apontamento',
  apontamento_itens: 'Linha de apontamento',
  assinaturas_aceite: 'Assinatura',
}

/**
 * O que fazer com cada tipo de conflito.
 *
 * O sistema não decide sozinho: corrigir o número, relançar ou descartar depende
 * do que aconteceu no campo, e escolher por conta significaria escolher errado
 * em silêncio. O que a tela faz é dizer o que houve e o que costuma resolver.
 */
const ORIENTACAO: Record<string, string> = {
  NUMERO_DOCUMENTO_DUPLICADO:
    'Duas fichas com o mesmo número. Confira qual delas já está lançada e relance a outra com o próximo número livre do bloco.',
  CICLO_SOBREPOSTO:
    'Dois ciclos do mesmo caminhão se sobrepõem no horário. Provavelmente uma saída não foi registrada na hora.',
  CICLO_ABERTO_DUPLICADO:
    'O caminhão já estava no campo quando esta chegada foi lançada. Registre a saída do ciclo anterior.',
  APONTAMENTO_DUPLICADO:
    'Já existe ficha para esta frente e turno. Os lançamentos devem ir para a ficha que já foi aberta.',
  PERIODO_FECHADO:
    'O período já estava fechado quando esta correção chegou. Se ela precisa entrar, reabra o período em Fechamentos, corrija e feche de novo.',
  DADOS_INVALIDOS: 'O lançamento não passou nas regras do banco. Confira os valores no payload abaixo.',
  SEM_PERMISSAO: 'O funcionário não tinha permissão para este lançamento. Confira o cadastro dele.',
}

export function Conflitos() {
  const [conflitos, setConflitos] = useState<Conflito[] | null>(null)
  const [aberto, setAberto] = useState<string | null>(null)
  const [resolvendo, setResolvendo] = useState<string | null>(null)

  useEffect(() => {
    void recarregar()
  }, [])

  async function recarregar() {
    try {
      setConflitos(await carregarConflitos())
    } catch (erro) {
      toast.error(mensagemDe(erro, 'Falha ao carregar conflitos.'))
      setConflitos([])
    }
  }

  async function marcarResolvido(conflito: Conflito) {
    setResolvendo(conflito.id)
    try {
      await resolverConflito(conflito.id)
      toast.success('Conflito marcado como resolvido.')
      await recarregar()
    } catch (erro) {
      toast.error(mensagemDe(erro, 'Não foi possível resolver.'))
    } finally {
      setResolvendo(null)
    }
  }

  return (
    <>
      <CabecalhoPainel
        titulo="Lançamentos travados"
        descricao="Preenchidos no campo e recusados pelo banco. O que o operador digitou está guardado aqui."
      />

      <div className="p-8">
        {conflitos === null && <p className="text-sm text-[var(--cor-texto-suave)]">Carregando…</p>}

        {conflitos?.length === 0 && (
          <p className="flex items-center gap-2.5 border-2 border-[var(--cor-borda)] bg-[var(--cor-fundo)] px-4 py-4 text-sm">
            <Check aria-hidden className="size-5 text-ok-500" />
            Nenhum lançamento travado. Tudo que o campo enviou foi aceito.
          </p>
        )}

        <div className="space-y-3">
          {conflitos?.map((c) => {
            const expandido = aberto === c.id
            return (
              <article key={c.id} className="border-2 border-carbono-500 bg-[var(--cor-fundo)]">
                <button
                  type="button"
                  onClick={() => setAberto(expandido ? null : c.id)}
                  className="flex w-full items-start gap-3 px-4 py-3.5 text-left"
                  aria-expanded={expandido}
                >
                  <FileWarning aria-hidden className="mt-0.5 size-5 shrink-0 text-carbono-700" />

                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-base font-bold">
                        {NOME_DA_TABELA[c.tabela] ?? c.tabela}
                      </span>
                      {typeof c.payload?.numero_documento === 'number' && (
                        <span className="numero-documento text-base">
                          Nº {String(c.payload.numero_documento)}
                        </span>
                      )}
                    </span>
                    <span className="mt-1 block text-sm text-[var(--cor-texto-suave)]">
                      {c.funcionario_nome} (código {c.funcionario_codigo}) ·{' '}
                      {dataHoraBr(new Date(c.recebido_em))}
                    </span>
                    {c.erro_codigo && (
                      <span className="mt-1.5 block text-sm font-semibold text-carbono-700">
                        {ORIENTACAO[c.erro_codigo] ?? c.erro_codigo}
                      </span>
                    )}
                  </span>

                  {expandido ? (
                    <ChevronDown aria-hidden className="size-5 shrink-0" />
                  ) : (
                    <ChevronRight aria-hidden className="size-5 shrink-0" />
                  )}
                </button>

                {expandido && (
                  <div className="border-t-2 border-[var(--cor-borda)] px-4 py-4">
                    <p className="text-[0.6875rem] font-bold tracking-[0.12em] text-[var(--cor-texto-suave)] uppercase">
                      O que o operador preencheu
                    </p>
                    <pre className="mt-2 max-h-72 overflow-auto border border-[var(--cor-borda)] bg-[var(--cor-superficie)] p-3 font-mono text-xs">
                      {JSON.stringify(c.payload, null, 2)}
                    </pre>

                    {c.erro_mensagem && (
                      <p className="mt-3 font-mono text-xs text-[var(--cor-texto-suave)]">{c.erro_mensagem}</p>
                    )}

                    <div className="mt-4 flex items-center gap-3">
                      <Botao
                        variante="secundaria"
                        disabled={resolvendo === c.id}
                        onClick={() => void marcarResolvido(c)}
                        icone={<Check aria-hidden className="size-4" />}
                      >
                        {resolvendo === c.id ? 'Marcando…' : 'Marcar como resolvido'}
                      </Botao>
                      {/* Ser explícito evita a leitura errada mais provável:
                          que o botão relançaria o dado sozinho. */}
                      <p className="text-xs text-[var(--cor-texto-suave)]">
                        Só tira da fila. O lançamento em si você corrige pela ficha.
                      </p>
                    </div>
                  </div>
                )}
              </article>
            )
          })}
        </div>
      </div>
    </>
  )
}

