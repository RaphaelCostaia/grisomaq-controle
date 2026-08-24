import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { KeyRound, Unlock, Lock, Plus, X } from 'lucide-react'
import {
  carregarFuncionarios,
  liberarAcesso,
  provisionarPin,
  salvarFuncionario,
  type FuncionarioPainel,
  type PinProvisionado,
} from '@/dados/painel'
import { CabecalhoPainel } from '@/componentes/layout/LayoutAdmin'
import { Botao } from '@/componentes/ui/Botao'
import { dataHoraBr } from '@/utilitarios/datas'
import { cls } from '@/utilitarios/classes'

const PAPEIS = [
  { valor: 'campo', rotulo: 'Campo' },
  { valor: 'lider', rotulo: 'Líder' },
  { valor: 'admin', rotulo: 'Escritório' },
] as const

export function Funcionarios() {
  const [funcionarios, setFuncionarios] = useState<FuncionarioPainel[] | null>(null)
  const [editando, setEditando] = useState<Partial<FuncionarioPainel> | null>(null)
  const [pinGerado, setPinGerado] = useState<PinProvisionado | null>(null)
  const [ocupado, setOcupado] = useState(false)

  useEffect(() => {
    void recarregar()
  }, [])

  async function recarregar() {
    try {
      setFuncionarios(await carregarFuncionarios())
    } catch (erro) {
      toast.error(erro instanceof Error ? erro.message : 'Falha ao carregar.')
      setFuncionarios([])
    }
  }

  async function salvar() {
    if (!editando?.codigo || !editando?.nome) return
    setOcupado(true)
    try {
      await salvarFuncionario(editando)
      toast.success('Cadastro salvo.')
      setEditando(null)
      await recarregar()
    } catch (erro) {
      const codigo = erro instanceof Error ? erro.message : ''
      toast.error(
        codigo.includes('CODIGO_JA_USADO')
          ? 'Este código já está com outro funcionário.'
          : 'Não foi possível salvar.',
      )
    } finally {
      setOcupado(false)
    }
  }

  async function gerarPin(f: FuncionarioPainel) {
    setOcupado(true)
    try {
      setPinGerado(await provisionarPin(f.id))
      await recarregar()
    } catch (erro) {
      toast.error(erro instanceof Error ? erro.message : 'Não foi possível gerar o PIN.')
    } finally {
      setOcupado(false)
    }
  }

  /**
   * Devolve o acesso sem trocar o PIN.
   *
   * Errar o PIN cinco vezes de luva é comum; trocar o número por causa disso
   * transferiria o custo para o operador, que teria de decorar outro no meio do
   * turno. Este botão só zera o contador.
   */
  async function liberar(f: FuncionarioPainel) {
    setOcupado(true)
    try {
      await liberarAcesso(f.id)
      await recarregar()
      toast.success(f.nome.split(' ')[0] + ' já pode entrar com o PIN de sempre.')
    } catch (erro) {
      toast.error(erro instanceof Error ? erro.message : 'Não foi possível liberar.')
    } finally {
      setOcupado(false)
    }
  }

  return (
    <>
      <CabecalhoPainel
        titulo="Funcionários"
        descricao="Quem entra no app de campo, e o estado do PIN de cada um."
      />

      <div className="p-8">
        <div className="mb-4 flex justify-end">
          <Botao
            onClick={() => setEditando({ papel: 'campo', ativo: true })}
            icone={<Plus aria-hidden className="size-4" />}
          >
            Novo funcionário
          </Botao>
        </div>

        {funcionarios === null ? (
          <p className="text-sm text-[var(--cor-texto-suave)]">Carregando…</p>
        ) : (
          <table className="w-full border-2 border-[var(--cor-borda-forte)] bg-[var(--cor-fundo)] text-sm">
            <thead>
              <tr className="border-b-2 border-[var(--cor-borda-forte)] bg-[var(--cor-superficie)] text-left">
                <Th>Código</Th>
                <Th>Nome</Th>
                <Th>Função</Th>
                <Th>Papel</Th>
                <Th>Acesso</Th>
                <Th className="text-right">Ações</Th>
              </tr>
            </thead>
            <tbody>
              {funcionarios.map((f) => (
                <tr
                  key={f.id}
                  className={cls('border-b border-[var(--cor-borda)]', !f.ativo && 'opacity-50')}
                >
                  <Td className="numerico font-mono font-bold">{f.codigo}</Td>
                  <Td className="font-semibold">{f.nome}</Td>
                  <Td className="text-[var(--cor-texto-suave)]">{f.funcao ?? '—'}</Td>
                  <Td>{PAPEIS.find((p) => p.valor === f.papel)?.rotulo ?? f.papel}</Td>
                  <Td>
                    <EstadoDoAcesso funcionario={f} />
                  </Td>
                  <Td className="text-right">
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setEditando(f)}
                        className="text-sm font-semibold text-marca-600 underline"
                      >
                        Editar
                      </button>
                      {f.bloqueado && (
                        <button
                          type="button"
                          disabled={ocupado}
                          onClick={() => void liberar(f)}
                          className="flex items-center gap-1 text-sm font-semibold text-carbono-700 underline disabled:opacity-40"
                        >
                          <Unlock aria-hidden className="size-3.5" />
                          Liberar
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={ocupado}
                        onClick={() => void gerarPin(f)}
                        className="flex items-center gap-1 text-sm font-semibold text-marca-600 underline disabled:opacity-40"
                      >
                        <KeyRound aria-hidden className="size-3.5" />
                        {f.pin_provisionado ? 'Novo PIN' : 'Gerar PIN'}
                      </button>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editando && (
        <Modal titulo={editando.id ? 'Editar funcionário' : 'Novo funcionário'} onFechar={() => setEditando(null)}>
          <div className="space-y-4">
            <Campo rotulo="Código" descricao="O mesmo número que já vai na ficha de papel.">
              <input
                inputMode="numeric"
                value={editando.codigo ?? ''}
                onChange={(e) => setEditando({ ...editando, codigo: e.target.value.replace(/\D/g, '') })}
                className={entrada}
              />
            </Campo>

            <Campo rotulo="Nome">
              <input
                value={editando.nome ?? ''}
                onChange={(e) => setEditando({ ...editando, nome: e.target.value })}
                className={entrada}
              />
            </Campo>

            <Campo rotulo="Função" descricao="Opcional. Ex.: Operador de colhedora.">
              <input
                value={editando.funcao ?? ''}
                onChange={(e) => setEditando({ ...editando, funcao: e.target.value || null })}
                className={entrada}
              />
            </Campo>

            <Campo rotulo="Papel" descricao="Escritório enxerga tudo e provisiona acessos.">
              <select
                value={editando.papel ?? 'campo'}
                onChange={(e) => setEditando({ ...editando, papel: e.target.value as FuncionarioPainel['papel'] })}
                className={entrada}
              >
                {PAPEIS.map((p) => (
                  <option key={p.valor} value={p.valor}>
                    {p.rotulo}
                  </option>
                ))}
              </select>
            </Campo>

            <label className="flex items-center gap-2.5 text-sm font-semibold">
              <input
                type="checkbox"
                checked={editando.ativo ?? true}
                onChange={(e) => setEditando({ ...editando, ativo: e.target.checked })}
                className="size-4"
              />
              Ativo
            </label>

            <div className="flex justify-end gap-3 pt-2">
              <Botao variante="secundaria" onClick={() => setEditando(null)}>
                Cancelar
              </Botao>
              <Botao disabled={ocupado || !editando.codigo || !editando.nome} onClick={() => void salvar()}>
                {ocupado ? 'Salvando…' : 'Salvar'}
              </Botao>
            </div>
          </div>
        </Modal>
      )}

      {pinGerado && (
        <Modal titulo="PIN gerado" onFechar={() => setPinGerado(null)}>
          <p className="text-sm">
            <strong>{pinGerado.funcionario.nome}</strong> · código {pinGerado.funcionario.codigo}
          </p>

          {/* O PIN aparece uma vez e não fica recuperável. Mostrá-lo grande e em
              carmim é o que faz a pessoa perceber que precisa anotar AGORA. */}
          <p className="numero-documento my-5 text-center font-mono text-6xl tracking-[0.2em]">
            {pinGerado.pin_inicial}
          </p>

          <p className="border-2 border-carbono-500 bg-carbono-50 px-4 py-3 text-sm font-semibold text-carbono-700">
            {pinGerado.aviso}
          </p>
          <p className="mt-3 text-sm text-[var(--cor-texto-suave)]">
            No primeiro acesso o app vai pedir que ele troque por um PIN próprio. As sessões
            anteriores deste funcionário foram encerradas.
          </p>

          <div className="mt-5 flex justify-end gap-3">
            <Botao variante="secundaria" onClick={() => window.print()}>
              Imprimir
            </Botao>
            <Botao onClick={() => setPinGerado(null)}>Anotei</Botao>
          </div>
        </Modal>
      )}
    </>
  )
}

function EstadoDoAcesso({ funcionario }: { funcionario: FuncionarioPainel }) {
  if (!funcionario.pin_provisionado) {
    return <span className="text-sm font-semibold text-aviso-500">Sem PIN — não consegue entrar</span>
  }
  if (funcionario.bloqueado) {
    return (
      <span className="flex items-center gap-1.5 text-sm font-semibold text-carbono-700">
        <Lock aria-hidden className="size-3.5" />
        Bloqueado até {dataHoraBr(new Date(funcionario.pin_bloqueado_ate!))}
      </span>
    )
  }
  if (funcionario.pin_precisa_trocar) {
    return <span className="text-sm text-[var(--cor-texto-suave)]">PIN inicial, ainda não trocado</span>
  }
  return <span className="text-sm text-ok-500">Ativo</span>
}

const entrada =
  'w-full border-2 border-[var(--cor-borda-forte)] bg-white px-3 py-2 text-base outline-none focus:border-marca-600'

function Campo({
  rotulo,
  descricao,
  children,
}: {
  rotulo: string
  descricao?: string
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="rotulo-campo">{rotulo}</span>
      {descricao && <span className="mt-0.5 block text-xs text-[var(--cor-texto-suave)]">{descricao}</span>}
      <span className="mt-1.5 block">{children}</span>
    </label>
  )
}

function Modal({
  titulo,
  onFechar,
  children,
}: {
  titulo: string
  onFechar: () => void
  children: React.ReactNode
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
      <div className="w-full max-w-md border-2 border-[var(--cor-borda-forte)] bg-[var(--cor-fundo)]">
        <header className="flex items-center justify-between border-b-2 border-[var(--cor-borda-forte)] px-5 py-3.5">
          <h2 className="text-base font-bold">{titulo}</h2>
          <button type="button" onClick={onFechar} aria-label="Fechar" className="p-1">
            <X aria-hidden className="size-5" />
          </button>
        </header>
        <div className="px-5 py-5">{children}</div>
      </div>
    </div>
  )
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      className={cls(
        'px-4 py-2.5 text-[0.6875rem] font-bold tracking-[0.1em] text-[var(--cor-texto-suave)] uppercase',
        className,
      )}
    >
      {children}
    </th>
  )
}

function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={cls('px-4 py-3', className)}>{children}</td>
}
