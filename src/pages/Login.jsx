import { Eye, EyeOff, Lock, User } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { usernameToEmail } from '../lib/constants'
import { supabase } from '../lib/supabase'

function GoogleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  )
}

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

  function google() {
    supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } })
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
        <div className="flex items-center gap-3 text-xs text-muted">
          <span className="h-px flex-1 bg-line" />
          ou
          <span className="h-px flex-1 bg-line" />
        </div>
        <button type="button" className="btn-ghost flex items-center justify-center gap-2" onClick={google}>
          <GoogleLogo />
          Entrar com Google
        </button>
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
