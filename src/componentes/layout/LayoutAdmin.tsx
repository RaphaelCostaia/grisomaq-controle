import { useEffect } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router'
import { AlertTriangle, BarChart3, FileSpreadsheet, LogOut, Settings, Users } from 'lucide-react'
import { Marca } from '@/componentes/ui/Marca'
import { useAutenticacao } from '@/autenticacao/contexto'
import { sair } from '@/autenticacao/login'
import { cls } from '@/utilitarios/classes'

const SECOES = [
  { para: '/admin', rotulo: 'Painel', Icone: BarChart3, exato: true },
  { para: '/admin/conflitos', rotulo: 'Conflitos', Icone: AlertTriangle, exato: false },
  { para: '/admin/relatorios', rotulo: 'Relatórios', Icone: FileSpreadsheet, exato: false },
  { para: '/admin/funcionarios', rotulo: 'Funcionários', Icone: Users, exato: false },
  { para: '/admin/cadastros', rotulo: 'Cadastros', Icone: Settings, exato: false },
]

/**
 * O escritório é outro lugar: mesa, mouse, tela grande e ninguém de luva.
 *
 * Por isso o tema muda — `data-modo="escritorio"` reduz peso de fonte, aperta a
 * densidade e suaviza as bordas. Manter aqui o contraste extremo do modo sol
 * seria gritar com quem está numa sala com cortina.
 */
export function LayoutAdmin() {
  const { sessao, definirSessao } = useAutenticacao()
  const navegar = useNavigate()

  useEffect(() => {
    document.documentElement.dataset.modo = 'escritorio'
    return () => {
      delete document.documentElement.dataset.modo
    }
  }, [])

  async function encerrar() {
    await sair()
    definirSessao(null)
    navegar('/')
  }

  return (
    <div className="flex min-h-dvh bg-[var(--cor-superficie)]">
      <aside className="flex w-60 shrink-0 flex-col border-r-2 border-[var(--cor-borda-forte)] bg-[var(--cor-fundo)]">
        <div className="border-b-2 border-[var(--cor-borda-forte)] px-5 py-5">
          <Marca />
        </div>

        <nav className="flex-1 py-2">
          {SECOES.map(({ para, rotulo, Icone, exato }) => (
            <NavLink
              key={para}
              to={para}
              end={exato}
              className={({ isActive }) =>
                cls(
                  'flex items-center gap-3 px-5 py-3 text-sm font-bold',
                  isActive
                    ? 'border-l-4 border-marca-600 bg-marca-50 text-marca-600'
                    : 'border-l-4 border-transparent text-[var(--cor-texto-suave)] hover:bg-[var(--cor-superficie)]',
                )
              }
            >
              <Icone aria-hidden className="size-5" />
              {rotulo}
            </NavLink>
          ))}
        </nav>

        <div className="border-t-2 border-[var(--cor-borda-forte)] px-5 py-4">
          <p className="text-sm font-bold">{sessao?.nome}</p>
          <p className="text-xs text-[var(--cor-texto-suave)]">Código {sessao?.codigo}</p>
          <button
            type="button"
            onClick={() => void encerrar()}
            className="mt-3 flex items-center gap-2 text-sm font-semibold text-[var(--cor-texto-suave)] hover:text-carbono-700"
          >
            <LogOut aria-hidden className="size-4" />
            Sair
          </button>
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-x-auto">
        <Outlet />
      </main>
    </div>
  )
}

/** Cabeçalho padrão das telas do painel. */
export function CabecalhoPainel({ titulo, descricao }: { titulo: string; descricao?: string }) {
  return (
    <header className="border-b-2 border-[var(--cor-borda-forte)] bg-[var(--cor-fundo)] px-8 py-5">
      <h1 className="text-xl font-extrabold tracking-tight">{titulo}</h1>
      {descricao && <p className="mt-1 text-sm text-[var(--cor-texto-suave)]">{descricao}</p>}
    </header>
  )
}
