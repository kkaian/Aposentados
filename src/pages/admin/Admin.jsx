import { CalendarDays, ChevronRight, Download, Shield, Ticket, UserCheck, Users, Wallet, BadgeDollarSign } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AdminBadge } from '../../components/ui'
import { supabase } from '../../lib/supabase'

export default function Admin() {
  const [pending, setPending] = useState(0)
  const [passwordReqs, setPasswordReqs] = useState(0)

  useEffect(() => {
    supabase
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pendente')
      .then(({ count }) => setPending(count ?? 0))
    supabase
      .from('password_requests')
      .select('id', { count: 'exact', head: true })
      .is('resolved_at', null)
      .then(({ count }) => setPasswordReqs(count ?? 0))
  }, [])

  const items = [
    { to: '/admin/cadastros', icon: UserCheck, title: 'Aprovar cadastros', sub: 'Novos jogadores e pedidos de senha', count: pending + passwordReqs },
    { to: '/admin/permissoes', icon: Users, title: 'Jogadores e permissões', sub: 'Dono, admin e jogador' },
    { to: '/admin/peladas', icon: CalendarDays, title: 'Peladas', sub: 'Criar, editar e definir ajudantes' },
    { to: '/admin/mensalistas', icon: BadgeDollarSign, title: 'Mensalistas e cota', sub: 'Valor, vencimento e vagas' },
    { to: '/admin/cadastros', icon: Ticket, title: 'Código de convite', sub: 'Ver, copiar ou gerar um novo' },
    { to: '/pagamentos', icon: Wallet, title: 'Pagamentos', sub: 'Confirmar Pix e cotinhas' },
    { to: '/admin/kits', icon: Shield, title: 'Nomes e escudos', sub: 'Kits e criação pelos capitães' },
    { to: '/admin/exportar', icon: Download, title: 'Exportar dados', sub: 'Planilha CSV de gols, peladas e pagamentos' },
  ]

  return (
    <div className="pb-4">
      <div className="flex justify-end px-4 pt-3">
        <AdminBadge />
      </div>
      <div className="px-2 pt-1">
        {items.map(({ to, icon: Icon, title, sub, count }) => (
          <Link key={title} to={to} className="flex min-h-16 items-center gap-3 rounded-lg border-b border-row px-2 active:bg-surface-2">
            <span className="flex h-10 w-10 flex-none items-center justify-center rounded-lg bg-surface-2 text-silver">
              <Icon size={20} />
            </span>
            <div className="flex-1">
              <div className="font-semibold">{title}</div>
              <div className="text-xs text-muted">{sub}</div>
            </div>
            {count > 0 && (
              <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-action px-1.5 text-xs font-bold text-white">
                {String(count).padStart(2, '0')}
              </span>
            )}
            <ChevronRight size={18} className="text-muted" />
          </Link>
        ))}
      </div>
    </div>
  )
}
