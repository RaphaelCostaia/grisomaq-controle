import { Navigate, Route, Routes } from 'react-router'
import { useAutenticacao } from '@/autenticacao/contexto'
import { Entrar } from '@/telas/campo/Entrar'
import { Abastecimentos } from '@/telas/campo/Abastecimentos'
import { AbastecimentoForm } from '@/telas/campo/AbastecimentoForm'
import { Patio } from '@/telas/campo/Patio'
import { NovaChegada } from '@/telas/campo/NovaChegada'
import { Apontamentos } from '@/telas/campo/Apontamentos'
import { ApontamentoNovo } from '@/telas/campo/ApontamentoNovo'
import { ApontamentoGrade } from '@/telas/campo/ApontamentoGrade'
import { ApontamentoItemTela } from '@/telas/campo/ApontamentoItem'
import { Assinaturas } from '@/telas/campo/Assinaturas'
import { Pendencias } from '@/telas/campo/Pendencias'
import { LayoutAdmin } from '@/componentes/layout/LayoutAdmin'
import { Dashboard } from '@/telas/admin/Dashboard'
import { Conflitos } from '@/telas/admin/Conflitos'
import { Funcionarios } from '@/telas/admin/Funcionarios'
import { Cadastros } from '@/telas/admin/Cadastros'
import { Relatorios } from '@/telas/admin/Relatorios'
import { Fechamentos } from '@/telas/admin/Fechamentos'

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

  // O escritório entra com o mesmo código e PIN do campo — não há segunda
  // credencial para lembrar. O papel no cadastro é que decide onde ele cai.
  const ehEscritorio = sessao.papel === 'admin'

  return (
    <Routes>
      <Route path="/" element={<Navigate to={ehEscritorio ? '/admin' : '/abastecimento'} replace />} />

      <Route path="/abastecimento" element={<Abastecimentos />} />
      <Route path="/abastecimento/novo" element={<AbastecimentoForm />} />
      <Route path="/caminhoes" element={<Patio />} />
      <Route path="/caminhoes/chegada" element={<NovaChegada />} />
      <Route path="/apontamento" element={<Apontamentos />} />
      <Route path="/apontamento/nova" element={<ApontamentoNovo />} />
      <Route path="/apontamento/:id" element={<ApontamentoGrade />} />
      <Route path="/apontamento/:id/item/:itemId" element={<ApontamentoItemTela />} />
      <Route path="/apontamento/:id/assinaturas" element={<Assinaturas />} />
      <Route path="/pendencias" element={<Pendencias />} />

      {/* O painel é servido só a quem tem o papel. Isso é conveniência de
          navegação, não segurança: a barreira real é a RLS no banco, que recusa
          a consulta mesmo que alguém chegue à rota por outro caminho. */}
      {ehEscritorio && (
        <Route path="/admin" element={<LayoutAdmin />}>
          <Route index element={<Dashboard />} />
          <Route path="conflitos" element={<Conflitos />} />
          <Route path="funcionarios" element={<Funcionarios />} />
          <Route path="cadastros" element={<Navigate to="/admin/cadastros/frotas" replace />} />
          <Route path="cadastros/:cadastro" element={<Cadastros />} />
          <Route path="relatorios" element={<Relatorios />} />
          <Route path="fechamentos" element={<Fechamentos />} />
        </Route>
      )}

      <Route path="*" element={<Navigate to={ehEscritorio ? '/admin' : '/abastecimento'} replace />} />
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
