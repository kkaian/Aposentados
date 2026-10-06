import { Clock, XCircle } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'

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

export default function ContaStatus() {
  const { profile, refreshProfile } = useAuth()

  if (!profile) {
    return (
      <Shell icon={XCircle} title="Perfil não encontrado">
        <p className="mt-2 text-sm text-muted">Saia e entre de novo. Se continuar, fale com um admin.</p>
      </Shell>
    )
  }
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

