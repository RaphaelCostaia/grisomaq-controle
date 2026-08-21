import { cls } from '@/utilitarios/classes'

/**
 * Lockup da marca. "GRISOMAQ" carrega o peso, "CONTROLE" vem leve logo abaixo
 * na mesma largura optica - o nome da empresa e o nome do sistema lidos como
 * uma coisa so, do jeito que estao no cabecalho da ficha de papel.
 */
export function Marca({ className }: { className?: string }) {
  return (
    <div className={cls('select-none', className)}>
      <div className="text-[2.125rem] leading-none font-extrabold tracking-[-0.02em] text-marca-600">GrisoMaq</div>
      <div className="mt-1.5 flex items-baseline gap-2">
        <span className="text-[0.625rem] font-bold tracking-[0.34em] text-[var(--cor-texto-suave)] uppercase">
          Serviços Agrícolas
        </span>
      </div>
      <div className="mt-3 border-t-2 border-[var(--cor-borda-forte)] pt-2 text-sm font-bold tracking-[0.22em] uppercase">
        Controle
      </div>
    </div>
  )
}
