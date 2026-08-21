import { NavLink } from 'react-router'
import { ClipboardList, Fuel, Truck } from 'lucide-react'
import { cls } from '@/utilitarios/classes'

const ABAS = [
  { para: '/abastecimento', rotulo: 'Diesel', Icone: Fuel },
  { para: '/caminhoes', rotulo: 'Pátio', Icone: Truck },
  { para: '/apontamento', rotulo: 'Turno', Icone: ClipboardList },
]

/**
 * Três abas fixas, sempre visíveis. Sem menu escondido: com luva e sob sol, um
 * hambúrguer é um toque a mais e um lugar a menos onde a mão acerta.
 */
export function AbasInferiores() {
  return (
    <nav className="area-segura-inferior sticky bottom-0 flex border-t-2 border-[var(--cor-borda-forte)] bg-[var(--cor-fundo)]">
      {ABAS.map(({ para, rotulo, Icone }) => (
        <NavLink
          key={para}
          to={para}
          className={({ isActive }) =>
            cls(
              'flex min-h-[var(--espaco-toque-primario)] flex-1 flex-col items-center justify-center gap-1 py-2',
              'text-[0.6875rem] font-bold tracking-[0.14em] uppercase',
              isActive
                ? 'bg-marca-600 text-white'
                : 'text-[var(--cor-texto-suave)] active:bg-[var(--cor-superficie)]',
            )
          }
        >
          <Icone aria-hidden className="size-6" />
          {rotulo}
        </NavLink>
      ))}
    </nav>
  )
}
