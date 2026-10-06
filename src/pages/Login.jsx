import { Eye, EyeOff, Lock, User } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { usernameToEmail } from '../lib/constants'
import { supabase } from '../lib/supabase'

export default function Login() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setError('')
    setBusy(true)
    const { error } = await supabase.auth.signInWithPassword({ email: usernameToEmail(username), password })
    setBusy(false)
    if (error) setError('Usuário ou senha incorretos.')
  }

  return (
    <div className="relative mx-auto min-h-dvh max-w-md overflow-hidden pt-[env(safe-area-inset-top)]">
      {/* brilho azul atrás do escudo, como na arte original */}
      <div className="pointer-events-none absolute -top-24 left-1/2 h-80 w-80 -translate-x-1/2 rounded-full bg-action/25 blur-3xl" />

      <div className="relative flex flex-col items-center px-6 pt-14">
        <img
          src="/escudo.jpg"
          alt="Escudo Aposentados FC"
          className="block h-36 w-36 rounded-2xl shadow-[0_8px_40px_rgba(61,120,255,.35)]"
        />
        <div className="mt-4 text-2xl font-bold tracking-wide">Aposentados FC</div>
        <div className="text-sm text-muted">Entre para ver o ranking e a pelada</div>
      </div>

      <form className="relative flex flex-col gap-3 px-6 pt-8" onSubmit={submit}>
        <div>
          <label className="label" htmlFor="u">
            Usuário
          </label>
          <div className="relative">
            <User size={18} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
            <input
              id="u"
              className="field pl-10"
              autoCapitalize="none"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="p">
            Senha
          </label>
          <div className="relative">
            <Lock size={18} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
            <input
              id="p"
              className="field px-10"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <button
              type="button"
              className="absolute top-0 right-0 flex h-12 w-11 items-center justify-center text-muted"
              aria-label={showPassword ? 'Esconder senha' : 'Mostrar senha'}
              onClick={() => setShowPassword((v) => !v)}
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </div>
        {error && <div className="text-sm text-[#E5604F]">{error}</div>}
        <button className="btn mt-1" disabled={busy}>
          {busy ? 'Entrando…' : 'Entrar'}
        </button>
        <Link to="/esqueci-senha" className="py-1 text-center text-sm font-semibold text-action">
          Esqueci minha senha
        </Link>
      </form>

      <div className="relative p-6 text-center text-sm text-muted">
        Primeiro acesso?{' '}
        <Link to="/cadastro" className="font-semibold text-action">
          Criar conta
        </Link>
      </div>
    </div>
  )
}
