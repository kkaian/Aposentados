import {
  CalendarDays,
  ChevronRight,
  Download,
  History,
  House,
  Landmark,
  LogOut,
  Menu,
  Settings,
  Shirt,
  Shuffle,
  Star,
  Trophy,
  User,
  UserPlus,
  Wallet,
} from 'lucide-react'
import { useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { isAdminRole, useAuth } from '../lib/auth'
import { useInstallPrompt } from '../lib/install'
import { photoUrl } from '../lib/storage'
import { supabase } from '../lib/supabase'
import Avatar from './Avatar'
import InstallSheet from './InstallSheet'
import Shield from './Shield'

const TABS = [
  { to: '/', label: 'Início', icon: Trophy },
  { to: '/pelada', label: 'Pelada', icon: CalendarDays },
  { to: '/pagamentos', label: 'Pagamentos', icon: Wallet },
  { to: '/perfil', label: 'Perfil', icon: User },
]

const MENU = [
  { to: '/', label: 'Início', icon: House },
  { to: '/pelada', label: 'Pelada de hoje', icon: CalendarDays },
  { to: '/historico', label: 'Histórico', icon: History },
  { to: '/times', label: 'Times da pelada', icon: Shirt },
  { to: '/notas', label: 'Avaliar colegas', icon: Star },
  { to: '/pagamentos', label: 'Pagamentos', icon: Wallet },
  { to: '/perfil', label: 'Perfil', icon: User },
]

const ADMIN_MENU = [
  { to: '/admin', label: 'Administração', icon: Settings },
  { to: '/admin/caixa', label: 'Caixa', icon: Landmark },
  { to: '/admin/sorteio', label: 'Sorteio de times', icon: Shuffle },
  { to: '/admin/diarista', label: 'Adicionar diarista', icon: UserPlus },
]

const TITLES = {
  ...Object.fromEntries([...MENU, ...ADMIN_MENU].map((m) => [m.to, m.label])),
  '/presenca': 'Presença',
  '/times/meu': 'Meu time',
  '/trocar-senha': 'Trocar senha',
  '/admin/cadastros': 'Cadastros',
  '/admin/permissoes': 'Permissões',
  '/admin/mensalistas': 'Mensalistas',
  '/admin/peladas': 'Peladas',
  '/admin/kits': 'Nomes e escudos',
  '/admin/exportar': 'Exportar dados',
}

const PREFIX_TITLES = [
  ['/admin/peladas/nova', 'Criar pelada'],
  ['/jogo/', 'Jogo'],
  ['/notas/', 'Avaliar jogador'],
  ['/admin/encerrar/', 'Encerrar pelada'],
  ['/jogador/', 'Jogador'],
  ['/presenca/', 'Presença'],
  ['/admin/peladas/', 'Pelada'],
]

const titleFor = (pathname) =>
  pathname === '/'
    ? 'Aposentados FC'
    : pathname.endsWith('/capitaes')
      ? 'Definir capitães'
    : (TITLES[pathname] ?? PREFIX_TITLES.find(([p]) => pathname.startsWith(p))?.[1] ?? 'Aposentados FC')

const itemClass = 'flex h-12 w-full items-center gap-3 rounded-lg px-3 text-left transition-colors active:bg-surface-2'

function MenuItem({ to, label, icon: Icon, onClick }) {
  return (
    <NavLink
      to={to}
      end
      onClick={onClick}
      className={({ isActive }) => `${itemClass} ${isActive ? 'bg-action/12 font-bold text-action' : 'text-ink'}`}
    >
      <Icon size={20} strokeWidth={2} />
      <span className="flex-1">{label}</span>
    </NavLink>
  )
}

const ROLE_LABEL = { dono: 'Dono', admin: 'Admin', jogador: 'Jogador' }

export default function Layout() {
  const { profile } = useAuth()
  const isAdmin = isAdminRole(profile)
  const [menuOpen, setMenuOpen] = useState(false)
  const [installOpen, setInstallOpen] = useState(false)
  const { installed } = useInstallPrompt()
  const { pathname } = useLocation()
  const close = () => setMenuOpen(false)

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col">
      <header className="sticky top-0 z-20 flex items-center gap-2 border-b border-line bg-bg/90 pt-[env(safe-area-inset-top)] pr-3 pl-1 backdrop-blur">
        <button
          className="flex h-14 w-12 items-center justify-center rounded-lg active:bg-surface-2"
          aria-label="Abrir menu"
          onClick={() => setMenuOpen(true)}
        >
          <Menu size={24} />
        </button>
        <Shield />
        <b className="flex-1 truncate text-xl">{titleFor(pathname)}</b>
        <NavLink to="/perfil" aria-label="Meu perfil">
          <Avatar name={profile.name} src={photoUrl(profile.photo_path)} size={36} />
        </NavLink>
      </header>

      <main className="flex-1 pb-[calc(72px+env(safe-area-inset-bottom))]">
        <Outlet />
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-30 mx-auto flex max-w-md border-t border-line bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
        {TABS.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end
            className={({ isActive }) =>
              `relative flex h-16 flex-1 flex-col items-center justify-center gap-1 text-xs ${isActive ? 'font-bold text-action' : 'text-muted'}`
            }
          >
            {({ isActive }) => (
              <>
                {isActive && <span className="absolute top-0 h-0.5 w-10 rounded-full bg-action" />}
                <Icon size={22} strokeWidth={isActive ? 2.4 : 2} />
                {label}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {menuOpen && (
        <div className="fixed inset-0 z-40">
          <div className="absolute inset-0 bg-[rgba(4,7,16,.78)]" onClick={close} />
          <aside className="absolute inset-y-0 left-0 flex w-[300px] max-w-[85vw] flex-col overflow-y-auto border-r border-line-2 bg-surface pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
            <div className="flex items-center gap-3 border-b border-line p-4">
              <Shield />
              <b className="text-lg">Aposentados FC</b>
            </div>
            <NavLink to="/perfil" onClick={close} className="mx-2 mt-2 flex items-center gap-3 rounded-lg p-2 active:bg-surface-2">
              <Avatar name={profile.name} src={photoUrl(profile.photo_path)} size={40} />
              <div className="flex-1">
                <div className="truncate font-semibold">{profile.name}</div>
                <div className="text-xs text-muted">
                  {ROLE_LABEL[profile.role]} · {profile.type}
                </div>
              </div>
              <ChevronRight size={18} className="text-muted" />
            </NavLink>

            <div className="flex flex-col gap-0.5 p-2">
              {MENU.map((m) => (
                <MenuItem key={m.to} {...m} onClick={close} />
              ))}
              {!installed && (
                <button
                  className={`${itemClass} text-ink`}
                  onClick={() => {
                    close()
                    setInstallOpen(true)
                  }}
                >
                  <Download size={20} />
                  Instalar app
                </button>
              )}
            </div>

            {isAdmin && (
              <div className="flex flex-col gap-0.5 border-t border-line p-2">
                <div className="px-3 pt-2 pb-1 text-xs font-semibold tracking-wide text-muted">ADMIN</div>
                {ADMIN_MENU.map((m) => (
                  <MenuItem key={m.to} {...m} onClick={close} />
                ))}
              </div>
            )}

            <div className="mt-auto border-t border-line p-2">
              <button
                className={`${itemClass} text-muted`}
                onClick={() => {
                  close()
                  supabase?.auth.signOut()
                }}
              >
                <LogOut size={20} />
                Sair
              </button>
            </div>
          </aside>
        </div>
      )}

      {installOpen && <InstallSheet onClose={() => setInstallOpen(false)} />}
    </div>
  )
}
