import { AtSign, KeyRound, Lock, Ticket, User } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { BackHeader, Field, Notice } from '../components/ui'
import { friendlyError } from '../lib/errors'
import { USERNAME_RE, usernameToEmail } from '../lib/constants'
import { supabase } from '../lib/supabase'

export default function Cadastro() {
  const [form, setForm] = useState({ invite: '', name: '', username: '', password: '', confirm: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  async function submit(e) {
    e.preventDefault()
    setError('')
    const username = form.username.trim().toLowerCase()
    if (!USERNAME_RE.test(username)) return setError('Usuário: 3 a 20 letras minúsculas, números, ponto ou _.')
    if (form.password.length < 6) return setError('A senha precisa ter pelo menos 6 caracteres.')
    if (form.password !== form.confirm) return setError('As senhas não conferem.')

    setBusy(true)
    try {
      const [{ data: validInvite }, { data: free }] = await Promise.all([
        supabase.rpc('invite_is_valid', { p_code: form.invite }),
        supabase.rpc('username_available', { p_username: username }),
      ])
      if (!validInvite) throw new Error('Código de convite inválido. Peça o código atual ao admin.')
      if (!free) throw new Error('Esse nome de usuário já está em uso.')

      const { error } = await supabase.auth.signUp({
        email: usernameToEmail(username),
        password: form.password,
        options: { data: { username, name: form.name.trim(), invite_code: form.invite.trim().toUpperCase() } },
      })
      if (error) throw error
      // a sessão abre sozinha e o app mostra "aguardando aprovação"
    } catch (err) {
      setError(friendlyError(err))
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto min-h-dvh max-w-md pt-[env(safe-area-inset-top)]">
      <BackHeader title="Criar conta" to="/" />
      <form className="flex flex-col gap-3 p-6" onSubmit={submit}>
        <Field label="Código de convite" id="invite" icon={Ticket} autoCapitalize="characters" value={form.invite} onChange={set('invite')} required />
        <Field label="Nome" id="name" icon={User} maxLength={40} autoComplete="name" value={form.name} onChange={set('name')} required />
        <Field
          label="Nome de usuário"
          id="username"
          icon={AtSign}
          autoCapitalize="none"
          autoComplete="username"
          maxLength={20}
          hint="É com ele que você entra. Letras minúsculas, números, ponto ou _."
          value={form.username}
          onChange={set('username')}
          required
        />
        <Field label="Senha" id="password" icon={Lock} type="password" autoComplete="new-password" value={form.password} onChange={set('password')} required />
        <Field label="Confirmar senha" id="confirm" icon={KeyRound} type="password" autoComplete="new-password" value={form.confirm} onChange={set('confirm')} required />
        <Notice>{error}</Notice>
        <button className="btn mt-1" disabled={busy}>
          {busy ? 'Criando…' : 'Criar conta'}
        </button>
        <p className="text-center text-xs text-muted">
          O código fica com o admin. Você entra como diarista e o admin define quem é mensalista.
        </p>
      </form>
      <div className="pb-6 text-center text-sm text-muted">
        Já tenho conta ·{' '}
        <Link to="/" className="font-semibold text-action">
          Entrar
        </Link>
      </div>
    </div>
  )
}
