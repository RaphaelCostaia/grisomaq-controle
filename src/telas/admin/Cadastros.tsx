import { useCallback, useEffect, useState } from 'react'
import { NavLink, useParams } from 'react-router'
import { toast } from 'sonner'
import { Plus, X } from 'lucide-react'
import {
  CADASTROS,
  MOTIVO_DA_RECUSA,
  listarCadastro,
  salvarCadastro,
  type Campo,
} from './definicoes-cadastro'
import { carregarFuncionarios } from '@/dados/painel'
import { ErroApi, mensagemDe } from '@/dados/api'
import { CabecalhoPainel } from '@/componentes/layout/LayoutAdmin'
import { Botao } from '@/componentes/ui/Botao'
import { Parametros } from './Parametros'
import { cls } from '@/utilitarios/classes'

type Registro = Record<string, unknown>

export function Cadastros() {
  const { cadastro: chave } = useParams<{ cadastro: string }>()
  const definicao = CADASTROS.find((c) => c.chave === chave) ?? CADASTROS[0]!

  const [registros, setRegistros] = useState<Registro[] | null>(null)
  const [editando, setEditando] = useState<Registro | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [referencias, setReferencias] = useState<Record<string, Array<{ id: string; rotulo: string }>>>({})

  const recarregar = useCallback(async () => {
    setRegistros(null)
    try {
      setRegistros(await listarCadastro(definicao.chave))
    } catch (erro) {
      toast.error(mensagemDe(erro, 'Falha ao carregar.'))
      setRegistros([])
    }
  }, [definicao.chave])

  useEffect(() => {
    void recarregar()
  }, [recarregar])

  // As listas de vínculo são carregadas uma vez e reaproveitadas: sem elas, o
  // seletor de frente ou de comboio mostraria uuid em vez de nome.
  useEffect(() => {
    void (async () => {
      const [frentes, fazendas, frotas, funcionarios] = await Promise.all([
        listarCadastro('frentes').catch(() => []),
        listarCadastro('fazendas').catch(() => []),
        listarCadastro('frotas').catch(() => []),
        carregarFuncionarios().catch(() => []),
      ])
      setReferencias({
        frentes: frentes.map((f) => ({ id: String(f.id), rotulo: String(f.nome) })),
        fazendas: fazendas.map((f) => ({ id: String(f.id), rotulo: f.codigo + ' · ' + f.nome })),
        frotas: frotas.map((f) => ({ id: String(f.id), rotulo: f.numero + ' · ' + f.descricao })),
        funcionarios: funcionarios.map((f) => ({ id: f.id, rotulo: f.codigo + ' · ' + f.nome })),
      })
    })()
  }, [])

  async function salvar() {
    if (!editando) return
    setSalvando(true)
    try {
      const { id, ...campos } = editando
      await salvarCadastro(definicao.chave, campos, typeof id === 'string' ? id : undefined)
      toast.success('Cadastro salvo.')
      setEditando(null)
      await recarregar()
    } catch (erro) {
      const codigo = erro instanceof ErroApi ? erro.codigo : ''
      toast.error(MOTIVO_DA_RECUSA[codigo] ?? 'Não foi possível salvar.')
    } finally {
      setSalvando(false)
    }
  }

  const colunas = definicao.campos.filter((c) => c.naLista)

  // Parâmetro não é cadastro: não se cria nem se apaga. A aba mora na mesma
  // navegação porque é lá que o escritório procura, mas o corpo é outro.
  const ehParametros = chave === 'parametros'

  return (
    <>
      <CabecalhoPainel
        titulo="Cadastros"
        descricao={
          ehParametros
            ? 'Os limiares que decidem quando o app avisa, exige justificativa ou bloqueia.'
            : definicao.descricao
        }
      />

      <nav className="flex flex-wrap gap-1 border-b-2 border-[var(--cor-borda-forte)] bg-[var(--cor-fundo)] px-8 py-2">
        {CADASTROS.map((c) => (
          <NavLink
            key={c.chave}
            to={'/admin/cadastros/' + c.chave}
            className={({ isActive }) =>
              cls(
                'px-3 py-1.5 text-sm font-bold',
                isActive
                  ? 'bg-marca-600 text-white'
                  : 'text-[var(--cor-texto-suave)] hover:bg-[var(--cor-superficie)]',
              )
            }
          >
            {c.titulo}
          </NavLink>
        ))}
        <NavLink
          to="/admin/cadastros/parametros"
          className={({ isActive }) =>
            cls(
              'px-3 py-1.5 text-sm font-bold',
              isActive
                ? 'bg-marca-600 text-white'
                : 'text-[var(--cor-texto-suave)] hover:bg-[var(--cor-superficie)]',
            )
          }
        >
          Parâmetros
        </NavLink>
      </nav>

      {ehParametros ? (
        <Parametros />
      ) : (
      <div className="p-8">
        <div className="mb-4 flex justify-end">
          <Botao onClick={() => setEditando(valorInicial(definicao.campos))} icone={<Plus aria-hidden className="size-4" />}>
            Novo
          </Botao>
        </div>

        {registros === null ? (
          <p className="text-sm text-[var(--cor-texto-suave)]">Carregando…</p>
        ) : registros.length === 0 ? (
          <p className="border-2 border-[var(--cor-borda)] bg-[var(--cor-fundo)] px-4 py-4 text-sm text-[var(--cor-texto-suave)]">
            Nada cadastrado ainda. Enquanto estiver vazio, os seletores do app de campo abrem sem opção.
          </p>
        ) : (
          <table className="w-full border-2 border-[var(--cor-borda-forte)] bg-[var(--cor-fundo)] text-sm">
            <thead>
              <tr className="border-b-2 border-[var(--cor-borda-forte)] bg-[var(--cor-superficie)] text-left">
                {colunas.map((c) => (
                  <th
                    key={c.nome}
                    className="px-4 py-2.5 text-[0.6875rem] font-bold tracking-[0.1em] text-[var(--cor-texto-suave)] uppercase"
                  >
                    {c.rotulo}
                  </th>
                ))}
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {registros.map((r) => (
                <tr
                  key={String(r.id)}
                  className={cls('border-b border-[var(--cor-borda)]', r.ativo === false && 'opacity-50')}
                >
                  {colunas.map((c) => (
                    <td key={c.nome} className="px-4 py-3">
                      {exibir(r[c.nome], c, referencias)}
                    </td>
                  ))}
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => setEditando(r)}
                      className="text-sm font-semibold text-marca-600 underline"
                    >
                      Editar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      )}

      {editando && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/40 p-6">
          <div className="my-auto w-full max-w-lg border-2 border-[var(--cor-borda-forte)] bg-[var(--cor-fundo)]">
            <header className="flex items-center justify-between border-b-2 border-[var(--cor-borda-forte)] px-5 py-3.5">
              <h2 className="text-base font-bold">
                {editando.id ? 'Editar' : 'Novo'} · {definicao.titulo}
              </h2>
              <button type="button" onClick={() => setEditando(null)} aria-label="Fechar" className="p-1">
                <X aria-hidden className="size-5" />
              </button>
            </header>

            <div className="space-y-4 px-5 py-5">
              {definicao.campos.map((campo) => (
                <CampoDoFormulario
                  key={campo.nome}
                  campo={campo}
                  valor={editando[campo.nome]}
                  referencias={referencias}
                  onMudar={(v) => setEditando({ ...editando, [campo.nome]: v })}
                />
              ))}

              <div className="flex justify-end gap-3 pt-1">
                <Botao variante="secundaria" onClick={() => setEditando(null)}>
                  Cancelar
                </Botao>
                <Botao disabled={salvando} onClick={() => void salvar()}>
                  {salvando ? 'Salvando…' : 'Salvar'}
                </Botao>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function valorInicial(campos: Campo[]): Registro {
  const registro: Registro = {}
  for (const c of campos) {
    if (c.tipo === 'booleano') registro[c.nome] = c.nome === 'ativo'
  }
  return registro
}

function exibir(
  valor: unknown,
  campo: Campo,
  referencias: Record<string, Array<{ id: string; rotulo: string }>>,
): string {
  if (valor === null || valor === undefined || valor === '') return '—'
  if (campo.tipo === 'booleano') return valor ? 'Sim' : 'Não'
  if (campo.tipo === 'opcao') return campo.opcoes?.find((o) => o.valor === valor)?.rotulo ?? String(valor)
  if (campo.tipo === 'referencia' && campo.referencia) {
    return referencias[campo.referencia]?.find((r) => r.id === valor)?.rotulo ?? '—'
  }
  if (campo.tipo === 'hora') return String(valor).slice(0, 5)
  return String(valor)
}

const entrada =
  'w-full border-2 border-[var(--cor-borda-forte)] bg-white px-3 py-2 text-base outline-none focus:border-marca-600'

function CampoDoFormulario({
  campo,
  valor,
  referencias,
  onMudar,
}: {
  campo: Campo
  valor: unknown
  referencias: Record<string, Array<{ id: string; rotulo: string }>>
  onMudar: (valor: unknown) => void
}) {
  if (campo.tipo === 'booleano') {
    return (
      <label className="block">
        <span className="flex items-center gap-2.5 text-sm font-semibold">
          <input type="checkbox" checked={valor === true} onChange={(e) => onMudar(e.target.checked)} className="size-4" />
          {campo.rotulo}
        </span>
        {campo.descricao && (
          <span className="mt-1 block pl-6 text-xs text-[var(--cor-texto-suave)]">{campo.descricao}</span>
        )}
      </label>
    )
  }

  const opcoes =
    campo.tipo === 'opcao'
      ? campo.opcoes ?? []
      : campo.tipo === 'referencia' && campo.referencia
        ? (referencias[campo.referencia] ?? []).map((r) => ({ valor: r.id, rotulo: r.rotulo }))
        : null

  return (
    <label className="block">
      <span className="rotulo-campo">
        {campo.rotulo}
        {campo.obrigatorio && <span className="ml-1 text-carbono-500">*</span>}
      </span>
      {campo.descricao && (
        <span className="mt-0.5 block text-xs text-[var(--cor-texto-suave)]">{campo.descricao}</span>
      )}

      <span className="mt-1.5 block">
        {opcoes ? (
          <select
            value={valor === null || valor === undefined ? '' : String(valor)}
            onChange={(e) => onMudar(e.target.value || null)}
            className={entrada}
          >
            <option value="">—</option>
            {opcoes.map((o) => (
              <option key={o.valor} value={o.valor}>
                {o.rotulo}
              </option>
            ))}
          </select>
        ) : (
          <input
            type={campo.tipo === 'hora' ? 'time' : campo.tipo === 'texto' ? 'text' : 'number'}
            step={campo.tipo === 'numero' ? '0.1' : campo.tipo === 'inteiro' ? '1' : undefined}
            value={valor === null || valor === undefined ? '' : String(valor).slice(0, campo.tipo === 'hora' ? 5 : undefined)}
            onChange={(e) => onMudar(converter(e.target.value, campo.tipo))}
            className={entrada}
          />
        )}
      </span>
    </label>
  )
}

function converter(texto: string, tipo: Campo['tipo']): unknown {
  if (texto === '') return null
  if (tipo === 'numero') return Number(texto.replace(',', '.'))
  if (tipo === 'inteiro') return parseInt(texto, 10)
  return texto
}
