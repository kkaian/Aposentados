import { Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import { useAuth } from './lib/auth'
import { isSupabaseConfigured } from './lib/supabase'
import EmBreve from './pages/EmBreve'
import Login from './pages/Login'

const APP_ROUTES = [
  ['/', 'Início'],
  ['/pelada', 'Pelada de hoje'],
  ['/historico', 'Histórico'],
  ['/times', 'Times da pelada'],
  ['/notas', 'Notas'],
  ['/pagamentos', 'Pagamentos'],
  ['/perfil', 'Perfil'],
  ['/admin', 'Administração'],
  ['/admin/sorteio', 'Sorteio de times'],
  ['/admin/diarista', 'Adicionar diarista'],
]

export default function App() {
  const { session, loading } = useAuth()

  if (loading) return null

  // Sem Supabase configurado (.env.local), abre direto o app para conferir o layout
  const loggedIn = Boolean(session) || !isSupabaseConfigured

  if (!loggedIn) {
    return (
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="/cadastro" element={<EmBreve titulo="Criar conta" />} />
        <Route path="/esqueci-senha" element={<EmBreve titulo="Esqueci minha senha" />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    )
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        {APP_ROUTES.map(([path, titulo]) => (
          <Route key={path} path={path} element={<EmBreve titulo={titulo} />} />
        ))}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
