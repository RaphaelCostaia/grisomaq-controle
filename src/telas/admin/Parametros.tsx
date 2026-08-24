import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { listarCadastro, salvarParametro } from './definicoes-cadastro'
import { Botao } from '@/componentes/ui/Botao'
import { formatarNumero } from '@/utilitarios/numeros'

interface Parametro {
  chave: string
  valor: unknown
  descricao: string | null
  atualizado_em: string | null
}

/**
 * Os limiares que governam as validações de campo.
 *
 * Estes números mudam com a operação: a tolerância de litros que serve na
 * primeira semana costuma estar apertada demais na terceira. Sem esta tela eles
 * só mudariam com acesso ao banco da VPS — o escritório teria de pedir socorro
 * para afrouxar meio litro de tolerância.
 *
 * Não é cadastro: não se cria nem se apaga parâmetro, só se ajusta o valor. Por
 * isso não há "Novo" nem "Excluir" aqui.
 */
export function Parametros() {
  const [parametros, setParametros] = useState<Parametro[] | null>(null)
  const [rascunhos, setRascunhos] = useState<Record<string, string>>({})
  const [salvando, setSalvando] = useState<string | null>(null)

  async function recarregar() {
    try {
      const linhas = (await listarCadastro('parametros')) as unknown as Parametro[]
      setParametros(linhas)
      setRascunhos({})
    } catch (erro) {
      toast.error(erro instanceof Error ? erro.message : 'Falha ao carregar.')
      setParametros([])
    }
  }

  useEffect(() => {
    void recarregar()
  }, [])

  async function gravar(p: Parametro) {
    const bruto = rascunhos[p.chave]
    if (bruto === undefined) return

    // O valor é jsonb: número continua número, texto continua texto. Mandar
    // "0.5" como string faria a validação comparar litros com uma string.
    const ehNumero = typeof p.valor === 'number'
    const limpo = bruto.trim().replace(',', '.')
    if (ehNumero && (limpo === '' || !Number.isFinite(Number(limpo)))) {
      toast.error('Informe um número.')
      return
    }

    setSalvando(p.chave)
    try {
      await salvarParametro(p.chave, ehNumero ? Number(limpo) : bruto.trim())
      toast.success('Ajustado. Os celulares recebem no próximo sync.')
      await recarregar()
    } catch (erro) {
      toast.error(erro instanceof Error ? erro.message : 'Não foi possível salvar.')
    } finally {
      setSalvando(null)
    }
  }

  const exibir = (v: unknown) => (typeof v === 'number' ? formatarNumero(v, v % 1 === 0 ? 0 : 3) : String(v))

  if (parametros === null) {
    return <p className="p-8 text-sm text-[var(--cor-texto-suave)]">Carregando…</p>
  }

  return (
    <div className="p-8">
      <p className="mb-5 max-w-3xl text-sm text-[var(--cor-texto-suave)]">
        Estes números decidem quando o app avisa, quando exige justificativa e quando bloqueia. Depois de
        ajustar, cada celular recebe o valor novo no próximo envio — não precisa reinstalar nada.
      </p>

      <div className="border-2 border-[var(--cor-borda-forte)]">
        {parametros.map((p, i) => {
          const alterado = rascunhos[p.chave] !== undefined
          return (
            <div
              key={p.chave}
              className={
                'flex flex-wrap items-center gap-4 px-4 py-3' +
                (i > 0 ? ' border-t border-[var(--cor-borda)]' : '')
              }
            >
              <div className="min-w-0 flex-1">
                <div className="font-mono text-sm font-bold">{p.chave}</div>
                <div className="mt-0.5 text-sm text-[var(--cor-texto-suave)]">{p.descricao ?? '—'}</div>
              </div>

              <div className="flex items-center gap-2">
                <span className="w-20 text-right font-mono text-sm text-[var(--cor-texto-suave)]">
                  {exibir(p.valor)}
                </span>
                <input
                  aria-label={'Novo valor de ' + p.chave}
                  className="w-32 border-2 border-[var(--cor-borda-forte)] bg-white px-2 py-1.5 text-right font-mono text-base outline-none focus:border-marca-600"
                  value={rascunhos[p.chave] ?? ''}
                  placeholder="novo valor"
                  onChange={(e) => setRascunhos((r) => ({ ...r, [p.chave]: e.target.value }))}
                />
                <Botao
                  variante="secundaria"
                  disabled={!alterado || salvando === p.chave}
                  onClick={() => void gravar(p)}
                >
                  {salvando === p.chave ? 'Salvando…' : 'Salvar'}
                </Botao>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
