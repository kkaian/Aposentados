import { AtSign } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { BackHeader, Field, Notice } from '../components/ui'
import { friendlyError } from '../lib/errors'
import { supabase } from '../lib/supabase'

export default function EsqueciSenha() {
  const [username, setUsername] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setError('')
    setBusy(true)
    const { error } = await supabase.rpc('request_password_reset', { p_username: username })
    setBusy(false)
    if (error) setError(friendlyError(error))
    else setSent(true)
  }

  return (
    <div className="mx-auto min-h-dvh max-w-md pt-[env(safe-area-inset-top)]">
      <BackHeader title="Esqueci minha senha" to="/" />
      <form className="flex flex-col gap-3 p-6" onSubmit={submit}>
        <p className="text-sm text-muted">
          Informe seu usuário. Um admin vai gerar uma senha temporária e passar para você. Você troca no primeiro acesso.
        </p>
        <Field label="Usuário" id="u" icon={AtSign} autoCapitalize="none" value={username} onChange={(e) => setUsername(e.target.value)} required />
        <Notice>{error}</Notice>
        {sent ? (
          <Notice kind="ok">Pedido enviado. Fale com um admin da pelada.</Notice>
        ) : (
          <button className="btn" disabled={busy}>
            {busy ? 'Enviando…' : 'Pedir nova senha'}
          </button>
        )}
        <Link to="/" className="py-2 text-center text-sm font-semibold text-action">
          Voltar ao login
        </Link>
      </form>
    </div>
  )
}
