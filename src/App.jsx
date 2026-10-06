import { Navigate, Outlet, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import { Spinner } from './components/ui'
import { isAdminRole, useAuth } from './lib/auth'
import Admin from './pages/admin/Admin'
import DefinirCapitaes from './pages/admin/DefinirCapitaes'
import Diarista from './pages/admin/Diarista'
import Sorteio from './pages/admin/Sorteio'
import Cadastros from './pages/admin/Cadastros'
import Kits from './pages/admin/Kits'
import Exportar from './pages/admin/Exportar'
import Mensalistas from './pages/admin/Mensalistas'
import PeladaForm from './pages/admin/PeladaForm'
import Peladas from './pages/admin/Peladas'
import Permissoes from './pages/admin/Permissoes'
import Cadastro from './pages/Cadastro'
import ContaStatus from './pages/ContaStatus'
import EsqueciSenha from './pages/EsqueciSenha'
import EncerrarPelada from './pages/EncerrarPelada'
import Historico from './pages/Historico'
import Inicio from './pages/Inicio'
import Jogo from './pages/Jogo'
import Login from './pages/Login'
import MeuTime from './pages/MeuTime'
import { AvaliarLista, Votar } from './pages/Notas'
import Pagamentos from './pages/Pagamentos'
import PeladaHoje from './pages/PeladaHoje'
import Perfil from './pages/Perfil'
import Presenca from './pages/Presenca'
import Times from './pages/Times'
import TrocarSenha from './pages/TrocarSenha'

function AdminOnly() {
  const { profile } = useAuth()
  return isAdminRole(profile) ? <Outlet /> : <Navigate to="/" replace />
}

export default function App() {
  const { session, profile, loading } = useAuth()

  if (loading) return <Spinner className="pt-32" />

  if (!session) {
    return (
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="/cadastro" element={<Cadastro />} />
        <Route path="/esqueci-senha" element={<EsqueciSenha />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    )
  }

  if (profile?.status !== 'ativo') return <ContaStatus />
  if (profile.must_change_password) return <TrocarSenha forced />

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Inicio />} />
        <Route path="/perfil" element={<Perfil />} />
        <Route path="/jogador/:id" element={<Perfil />} />
        <Route path="/presenca" element={<Presenca />} />
        <Route path="/presenca/:id" element={<Presenca />} />
        <Route path="/pelada" element={<PeladaHoje />} />
        <Route path="/jogo/:id" element={<Jogo />} />
        <Route path="/historico" element={<Historico />} />
        <Route path="/times" element={<Times />} />
        <Route path="/notas" element={<AvaliarLista />} />
        <Route path="/notas/:id" element={<Votar />} />
        <Route path="/pagamentos" element={<Pagamentos />} />
        <Route path="/trocar-senha" element={<TrocarSenha />} />
        <Route path="/times/meu" element={<MeuTime />} />
        <Route path="/admin" element={<AdminOnly />}>
          <Route index element={<Admin />} />
          <Route path="/admin/encerrar/:id" element={<EncerrarPelada />} />
          <Route path="cadastros" element={<Cadastros />} />
          <Route path="permissoes" element={<Permissoes />} />
          <Route path="mensalistas" element={<Mensalistas />} />
          <Route path="peladas" element={<Peladas />} />
          <Route path="peladas/nova" element={<PeladaForm />} />
          <Route path="peladas/:id" element={<PeladaForm />} />
          <Route path="peladas/:id/capitaes" element={<DefinirCapitaes />} />
          <Route path="sorteio" element={<Sorteio />} />
          <Route path="kits" element={<Kits />} />
          <Route path="exportar" element={<Exportar />} />
          <Route path="diarista" element={<Diarista />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
