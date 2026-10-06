import { Navigate, Outlet, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import { Spinner } from './components/ui'
import { isAdminRole, useAuth } from './lib/auth'
import { isSupabaseConfigured } from './lib/supabase'
import Admin from './pages/admin/Admin'
import Cadastros from './pages/admin/Cadastros'
import Mensalistas from './pages/admin/Mensalistas'
import Permissoes from './pages/admin/Permissoes'
import Cadastro from './pages/Cadastro'
import ContaStatus from './pages/ContaStatus'
import EmBreve from './pages/EmBreve'
import EsqueciSenha from './pages/EsqueciSenha'
import Inicio from './pages/Inicio'
import Login from './pages/Login'
import Perfil from './pages/Perfil'

// Telas das próximas etapas
const SOON = [
  ['/pelada', 'Pelada de hoje'],
  ['/presenca', 'Presença'],
  ['/historico', 'Histórico'],
  ['/times', 'Times da pelada'],
  ['/notas', 'Avaliar colegas'],
  ['/notas/:id', 'Avaliar jogador'],
  ['/pagamentos', 'Pagamentos'],
]

const ADMIN_SOON = [
  ['peladas', 'Peladas'],
  ['kits', 'Nomes e escudos'],
  ['exportar', 'Exportar dados'],
  ['sorteio', 'Sorteio de times'],
  ['diarista', 'Adicionar diarista'],
]

function AdminOnly() {
  const { profile } = useAuth()
  return isAdminRole(profile) ? <Outlet /> : <Navigate to="/" replace />
}

export default function App() {
  const { session, profile, loading } = useAuth()

  if (!isSupabaseConfigured) {
    return <div className="p-6 text-center text-muted">Configure o Supabase no arquivo .env.local.</div>
  }
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

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Inicio />} />
        <Route path="/perfil" element={<Perfil />} />
        <Route path="/jogador/:id" element={<Perfil />} />
        {SOON.map(([path, titulo]) => (
          <Route key={path} path={path} element={<EmBreve titulo={titulo} />} />
        ))}
        <Route path="/admin" element={<AdminOnly />}>
          <Route index element={<Admin />} />
          <Route path="cadastros" element={<Cadastros />} />
          <Route path="permissoes" element={<Permissoes />} />
          <Route path="mensalistas" element={<Mensalistas />} />
          {ADMIN_SOON.map(([path, titulo]) => (
            <Route key={path} path={path} element={<EmBreve titulo={titulo} />} />
          ))}
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
