import { AtSign, Clock, Ticket, User, XCircle } from 'lucide-react'
import { useState } from 'react'
import { Field, Notice } from '../components/ui'
import { friendlyError } from '../lib/errors'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'
import { USERNAME_RE } from '../lib/constants'

function Shell({ icon: Icon, title, children }) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center px-6 pt-[calc(56px+env(safe-area-inset-top))] text-center">
      <img src="/escudo.jpg" alt="Escudo Aposentados FC" className="mb-6 h-20 w-20 rounded-xl" />
      {Icon && <Icon size={36} className="mb-3 text-muted" />}
      <h1 className="text-xl font-bold">{title}</h1>
      {children}
      <button className="mt-8 text-sm text-muted underline" onClick={() => supabase.auth.signOut()}>
        Sair
      </button>
    </div>
  )
}

// Entrou pelo Google: falta convite, usuário e nome
function CompletarCadastro() {
  const { profile, refreshProfile } = useAuth()
  const [form, setForm] = useState({ invite: '', username: '', name: profile?.name ?? '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  async function submit(e) {
    e.preventDefault()
    setError('')
    const username = form.username.trim().toLowerCase()
    if (!USERNAME_RE.test(username)) return setError('Usuário: 3 a 20 letras minúsculas, números, ponto ou _.')
    setBusy(true)
    const { error } = await supabase.rpc('complete_signup', { p_invite: form.invite, p_username: username, p_name: form.name })
    setBusy(false)
    if (error) setError(friendlyError(error))
    else refreshProfile()
  }

  return (
    <Shell title="Complete seu cadastro">
      <p className="mt-1 text-sm text-muted">Falta o código de convite e o nome de usuário.</p>
      <form className="mt-6 flex w-full flex-col gap-3 text-left" onSubmit={submit}>
        <Field label="Código de convite" id="invite" icon={Ticket} autoCapitalize="characters" value={form.invite} onChange={set('invite')} required />
        <Field label="Nome" id="name" icon={User} maxLength={40} value={form.name} onChange={set('name')} required />
        <Field label="Nome de usuário" id="username" icon={AtSign} autoCapitalize="none" maxLength={20} value={form.username} onChange={set('username')} required />
        <Notice>{error}</Notice>
        <button className="btn" disabled={busy}>
          {busy ? 'Enviando…' : 'Enviar cadastro'}
        </button>
      </form>
    </Shell>
  )
}

export default function ContaStatus() {
  const { profile, refreshProfile } = useAuth()

  if (!profile) {
    return (
      <Shell icon={XCircle} title="Perfil não encontrado">
        <p className="mt-2 text-sm text-muted">Saia e entre de novo. Se continuar, fale com um admin.</p>
      </Shell>
    )
  }
  if (profile.status === 'incompleto') return <CompletarCadastro />
  if (profile.status === 'pendente') {
    return (
      <Shell icon={Clock} title="Cadastro enviado">
        <p className="mt-2 text-sm text-muted">
          Agora um admin precisa aprovar sua conta, {profile.name.split(' ')[0]}. Quando aprovar, é só abrir o app de novo.
        </p>
        <button className="btn-outline mt-6 w-full" onClick={refreshProfile}>
          Já fui aprovado
        </button>
      </Shell>
    )
  }
  return (
    <Shell icon={XCircle} title={profile.status === 'recusado' ? 'Cadastro recusado' : 'Conta desativada'}>
      <p className="mt-2 text-sm text-muted">Fale com um admin da pelada.</p>
    </Shell>
  )
}

