import { Navigate, Route, Routes } from 'react-router'
import { useAutenticacao } from '@/autenticacao/contexto'
import { Entrar } from '@/telas/campo/Entrar'
import { Abastecimentos } from '@/telas/campo/Abastecimentos'
import { AbastecimentoForm } from '@/telas/campo/AbastecimentoForm'
import { Pendencias } from '@/telas/campo/Pendencias'
import { Patio } from '@/telas/campo/Patio'
import { NovaChegada } from '@/telas/campo/NovaChegada'

export function Rotas() {
  const { sessao, carregando } = useAutenticacao()

  // A sessão vem do IndexedDB, então há um instante de leitura antes de saber
  // se há alguém logado. Mostrar a tela de login nesse intervalo faria o app
  // piscar "entre de novo" toda vez que o operador o abrisse.
  if (carregando) return <Abrindo />

  if (!sessao) {
    return (
      <Routes>
        <Route path="*" element={<Entrar />} />
      </Routes>
    )
  }

  return (
    <Routes>
      <Route path="/" element={<Navigate to="/abastecimento" replace />} />
      <Route path="/abastecimento" element={<Abastecimentos />} />
      <Route path="/abastecimento/novo" element={<AbastecimentoForm />} />
      <Route path="/caminhoes" element={<Patio />} />
      <Route path="/caminhoes/chegada" element={<NovaChegada />} />
      <Route path="/pendencias" element={<Pendencias />} />
      <Route path="*" element={<Navigate to="/abastecimento" replace />} />
    </Routes>
  )
}

function Abrindo() {
  return (
    <div className="flex min-h-dvh items-center justify-center text-base font-semibold text-[var(--cor-texto-suave)]">
      Abrindo…
    </div>
  )
}
