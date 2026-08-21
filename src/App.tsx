import { BrowserRouter } from 'react-router'
import { Toaster } from 'sonner'
import { ProvedorAutenticacao } from '@/autenticacao/contexto'
import { Rotas } from '@/rotas'

export function App() {
  return (
    <BrowserRouter>
      <ProvedorAutenticacao>
        <Rotas />
        <Toaster
          position="top-center"
          duration={4000}
          // O padrão da lib é pequeno demais para ser lido de relance sob sol.
          toastOptions={{
            style: {
              border: '2px solid var(--cor-borda-forte)',
              borderRadius: 0,
              fontSize: '1rem',
              fontWeight: 600,
            },
          }}
        />
      </ProvedorAutenticacao>
    </BrowserRouter>
  )
}
