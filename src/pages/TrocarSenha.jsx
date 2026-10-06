import { KeyRound, Lock } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Field, Notice } from '../components/ui'
import { useAuth } from '../lib/auth'
import { friendlyError } from '../lib/errors'
import { supabase } from '../lib/supabase'

// Troca de senha: obrigatória depois de uma senha temporária, ou pelo perfil
export default function TrocarSenha({ forced = false }) {
  const { refreshProfile } = useAuth()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setError('')
    if (password.length < 6) return setError('A senha precisa ter pelo menos 6 caracteres.')
    if (password !== confirm) return setError('As senhas não conferem.')
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password })
    if (!error) await supabase.rpc('password_changed')
    setBusy(false)
    if (error) return setError(friendlyError(error))
    if (forced) refreshProfile()
    else setDone(true)
  }

  return (
    <div className={`mx-auto max-w-md ${forced ? 'min-h-dvh pt-[calc(48px+env(safe-area-inset-top))]' : 'pt-4'}`}>
      {forced && (
        <div className="flex flex-col items-center px-6 pb-2 text-center">
          <img src="/escudo.jpg" alt="Escudo Aposentados FC" className="mb-4 h-20 w-20 rounded-xl" />
          <h1 className="text-xl font-bold">Crie uma nova senha</h1>
          <p className="mt-1 text-sm text-muted">Você entrou com uma senha temporária. Escolha a sua para continuar.</p>
        </div>
      )}
      <form className="flex flex-col gap-3 px-6 pt-4" onSubmit={submit}>
        <Field label="Nova senha" id="np" icon={Lock} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        <Field label="Confirmar nova senha" id="nc" icon={KeyRound} type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        <Notice>{error}</Notice>
        {done ? (
          <>
            <Notice kind="ok">Senha trocada.</Notice>
            <button type="button" className="btn-ghost" onClick={() => navigate('/perfil')}>
              Voltar ao perfil
            </button>
          </>
        ) : (
          <button className="btn" disabled={busy}>
            {busy ? 'Salvando…' : 'Salvar nova senha'}
          </button>
        )}
        {forced && (
          <button type="button" className="py-2 text-sm text-muted underline" onClick={() => supabase.auth.signOut()}>
            Sair
          </button>
        )}
      </form>
    </div>
  )
}
