import { LogOut, Plus, Search, Shuffle, UserPlus } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { friendlyError } from '../lib/errors'
import { winnerOf } from '../lib/games'
import { photoUrl } from '../lib/storage'
import { supabase } from '../lib/supabase'
import Avatar from './Avatar'
import Sheet from './Sheet'
import { Notice, SectionLabel } from './ui'

const TEAM_SIZE = 5
const keyOf = (p) => (p.profile_id ? `p:${p.profile_id}` : `g:${p.guest_id}`)
const shuffle = (list) => list.map((x) => [Math.random(), x]).sort((a, b) => a[0] - b[0]).map(([, x]) => x)

// Quem fica depois do último jogo: o vencedor (pênaltis valem). Empate sem pênaltis: sai o time que estava
// há mais tempo em campo (o que já tinha jogado o jogo anterior) e fica o outro; no 1º jogo, saem os dois.
function stayingTeam(games, events) {
  const done = games.filter((g) => g.status === 'finalizado').sort((a, b) => a.number - b.number)
  const last = done.at(-1)
  if (!last) return null
  const winner = winnerOf(last, events)
  if (winner) return winner
  const prev = done.at(-2)
  if (!prev) return null
  const veteran = [last.team1_id, last.team2_id].find((t) => t === prev.team1_id || t === prev.team2_id)
  return veteran ? (veteran === last.team1_id ? last.team2_id : last.team1_id) : null
}

// Fila: mais jogos sem jogar primeiro; empate, quem jogou menos; empate de novo, sorteio (na proposta)
// ou ordem de chegada (na lista da tela, para não ficar pulando)
const byPriority = (list) => shuffle(list).sort((a, b) => b.waiting - a.waiting || a.played - b.played)
const byQueue = (list) => [...list].sort((a, b) => b.waiting - a.waiting || a.played - b.played || Date.parse(a.arrived_at) - Date.parse(b.arrived_at))

export default function RodizioPanel({ pelada, games, events, canManage }) {
  const navigate = useNavigate()
  const [queue, setQueue] = useState([])
  const [people, setPeople] = useState({ profiles: [], guests: [] })
  // quem estava em campo no último jogo encerrado
  const [lastLineup, setLastLineup] = useState([])
  const [sheet, setSheet] = useState(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const lastDoneId = games.filter((g) => g.status === 'finalizado').sort((a, b) => a.number - b.number).at(-1)?.id
  const load = useCallback(async () => {
    const [{ data: q }, { data: profiles }, { data: guests }, { data: lineup }] = await Promise.all([
      supabase.rpc('rodizio_queue', { p_pelada: pelada.id }),
      supabase.from('profiles').select('id, name, photo_path, type, goalkeeper').eq('status', 'ativo').order('name'),
      supabase.from('guests').select('id, name').eq('pelada_id', pelada.id),
      lastDoneId ? supabase.from('game_lineup').select('*').eq('game_id', lastDoneId) : Promise.resolve({ data: [] }),
    ])
    setQueue(q ?? [])
    setPeople({ profiles: profiles ?? [], guests: guests ?? [] })
    setLastLineup(lineup ?? [])
  }, [pelada.id, lastDoneId])

  useEffect(() => {
    load()
    const channel = supabase
      .channel(`rodizio-${pelada.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rodizio_arrivals', filter: `pelada_id=eq.${pelada.id}` }, load)
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [pelada.id, load])

  const profileById = Object.fromEntries(people.profiles.map((p) => [p.id, p]))
  const guestById = Object.fromEntries(people.guests.map((g) => [g.id, g]))
  const named = (q) => ({
    ...q,
    key: keyOf(q),
    name: q.profile_id ? (profileById[q.profile_id]?.name ?? 'Jogador') : (guestById[q.guest_id]?.name ?? 'Avulso'),
    photo_path: q.profile_id ? profileById[q.profile_id]?.photo_path : null,
    sub: q.guest_id ? 'avulso' : profileById[q.profile_id]?.type,
  })
  const present = queue.map(named)
  const pending = games.find((g) => g.status === 'agendado' || g.status === 'ao_vivo')
  const keepTeam = stayingTeam(games, events)
  // quem estava em campo no fim do último jogo pelo time que fica (e continua aqui)
  const presentKeys = new Set(present.map((p) => p.key))
  const champions = keepTeam
    ? lastLineup.filter((l) => l.team_id === keepTeam && l.left_minute == null).map((l) => keyOf(l)).filter((k) => presentKeys.has(k))
    : []

  // proposta do próximo jogo: quem ficou x os próximos da fila
  function propose() {
    const champ = present.filter((p) => champions.includes(p.key))
    const rest = byPriority(present.filter((p) => !champions.includes(p.key)))
    if (champ.length) return { keep: keepTeam, a: champ.slice(0, TEAM_SIZE), b: rest.slice(0, TEAM_SIZE) }
    const ten = shuffle(rest.slice(0, TEAM_SIZE * 2))
    return { keep: null, a: ten.slice(0, Math.ceil(ten.length / 2)), b: ten.slice(Math.ceil(ten.length / 2)) }
  }

  async function rpc(fn, args, after) {
    setBusy(true)
    setMsg('')
    const { data, error } = await supabase.rpc(fn, args)
    setBusy(false)
    if (error) return setMsg(friendlyError(error))
    after?.(data)
    load()
  }

  const ordered = byQueue(present.filter((p) => !champions.includes(p.key)))

  return (
    <>
      <div className="flex items-center justify-between pr-4">
        <SectionLabel>Rodízio · chegaram {present.length}</SectionLabel>
        {canManage && (
          <button className="flex items-center gap-1 text-xs font-semibold text-action" onClick={() => setSheet({ kind: 'chegada' })}>
            <UserPlus size={14} /> Marcar chegada
          </button>
        )}
      </div>

      <div className="px-4">
        {pending ? (
          <Link to={`/jogo/${pending.id}`} className="card flex items-center justify-between active:bg-surface-2">
            <div>
              <div className="font-semibold">Jogo {pending.number} {pending.status === 'ao_vivo' ? 'ao vivo' : 'marcado'}</div>
              <div className="text-xs text-muted">Abra para iniciar, registrar e encerrar.</div>
            </div>
            <span className="text-sm font-semibold text-action">Abrir</span>
          </Link>
        ) : (
          canManage && (
            <button
              className="btn flex w-full items-center justify-center gap-2"
              disabled={present.length < 2}
              onClick={() => setSheet({ kind: 'jogo', ...propose() })}
            >
              <Plus size={18} /> Montar próximo jogo
            </button>
          )
        )}
        {!pending && keepTeam && champions.length > 0 && (
          <p className="mt-1 text-xs text-muted">Quem ganhou o último jogo fica em campo.</p>
        )}
        {pending && canManage && pending.status === 'agendado' && (
          <button className="mt-1 h-9 w-full text-xs text-muted" disabled={busy} onClick={() => rpc('rodizio_cancel_game', { p_game: pending.id })}>
            Cancelar o jogo marcado (ainda não começou)
          </button>
        )}
      </div>

      <div className="mt-2">
        {present.length === 0 && <div className="px-4 text-sm text-muted">Ninguém marcado ainda. Admin ou ajudante marca quem for chegando.</div>}
        {[...present.filter((p) => champions.includes(p.key)), ...ordered].map((p) => (
          <div key={p.key} className="flex min-h-12 items-center gap-3 border-b border-row px-4">
            <Avatar name={p.name} src={photoUrl(p.photo_path)} size={30} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm">{p.name}</div>
              <div className="text-[11px] text-muted">
                {champions.includes(p.key) ? 'em campo (ganhou)' : p.waiting ? `${p.waiting} ${p.waiting === 1 ? 'jogo' : 'jogos'} sem jogar` : p.played ? 'acabou de jogar' : 'chegou agora'}
                {' · '}
                {p.played} {p.played === 1 ? 'jogo' : 'jogos'}
                {p.sub === 'avulso' && ' · avulso'}
              </div>
            </div>
            {canManage && (
              <button className="flex h-9 items-center gap-1 px-1 text-xs text-muted" disabled={busy} onClick={() => rpc('rodizio_leave', { p_arrival: p.arrival_id })}>
                <LogOut size={14} /> Foi embora
              </button>
            )}
          </div>
        ))}
      </div>
      <p className="px-4 pt-2 text-xs text-muted">
        Quem ganha fica; o próximo time sai da fila, com vantagem para quem está há mais jogos sem jogar (empate: quem jogou menos, depois
        sorteio). Empate sem pênaltis: sai quem estava há mais tempo em campo. Até {TEAM_SIZE} por time.
      </p>
      {msg && (
        <div className="px-4 pt-2">
          <Notice>{msg}</Notice>
        </div>
      )}

      {sheet?.kind === 'chegada' && (
        <ArrivalSheet
          profiles={people.profiles.filter((p) => !present.some((x) => x.profile_id === p.id))}
          busy={busy}
          msg={msg}
          onClose={() => setSheet(null)}
          onArrive={(p) => rpc('rodizio_arrive', { p_pelada: pelada.id, p_profile: p.id })}
          onGuest={(name) => rpc('rodizio_arrive', { p_pelada: pelada.id, p_profile: null, p_guest_name: name })}
        />
      )}

      {sheet?.kind === 'jogo' && (
        <NextGameSheet
          plan={sheet}
          present={present}
          busy={busy}
          msg={msg}
          onReshuffle={() => setSheet({ kind: 'jogo', ...propose() })}
          onChange={(plan) => setSheet({ kind: 'jogo', ...plan })}
          onClose={() => setSheet(null)}
          onConfirm={() => {
            const ids = (list) => list.map((p) => (p.profile_id ? { profile_id: p.profile_id } : { guest_id: p.guest_id }))
            rpc('rodizio_create_game', { p_pelada: pelada.id, p_keep_team: sheet.keep, p_side_a: ids(sheet.a), p_side_b: ids(sheet.b) }, (gameId) => {
              setSheet(null)
              navigate(`/jogo/${gameId}`)
            })
          }}
        />
      )}
    </>
  )
}

// Marcar chegada: jogador com conta (busca) ou avulso pelo nome
function ArrivalSheet({ profiles, busy, msg, onClose, onArrive, onGuest }) {
  const [query, setQuery] = useState('')
  const [guest, setGuest] = useState('')
  const q = query.trim().toLowerCase()
  const visible = profiles.filter((p) => !q || p.name.toLowerCase().includes(q))
  return (
    <Sheet title="Quem chegou?" subtitle="Toque em quem chegou. Entra no fim da fila." onClose={onClose}>
      <div className="flex gap-2">
        <input className="field flex-1" placeholder="Avulso (sem conta): nome" maxLength={40} value={guest} onChange={(e) => setGuest(e.target.value)} />
        <button
          className="btn px-3"
          disabled={!guest.trim() || busy}
          onClick={() => {
            onGuest(guest.trim())
            setGuest('')
          }}
        >
          Chegou
        </button>
      </div>
      <div className="relative mt-3 mb-1">
        <Search size={18} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
        <input className="field pl-10" placeholder="Buscar jogador" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <Notice>{msg}</Notice>
      <div className="max-h-[45dvh] overflow-y-auto">
        {visible.map((p) => (
          <button key={p.id} className="flex min-h-12 w-full items-center gap-3 border-b border-row text-left" disabled={busy} onClick={() => onArrive(p)}>
            <Avatar name={p.name} src={photoUrl(p.photo_path)} size={30} />
            <span className="flex-1">{p.name}</span>
            <span className="text-xs text-muted">{p.goalkeeper === 'so_goleiro' ? 'goleiro' : p.type}</span>
          </button>
        ))}
        {visible.length === 0 && <div className="py-3 text-sm text-muted">Todo mundo já chegou.</div>}
      </div>
      <button className="mt-3 h-11 w-full text-sm text-muted" onClick={onClose}>
        Pronto
      </button>
    </Sheet>
  )
}

// Próximo jogo: a proposta do app, com ajuste na mão (tocar move entre times e fila)
function NextGameSheet({ plan, present, busy, msg, onReshuffle, onChange, onClose, onConfirm }) {
  const inA = new Set(plan.a.map((p) => p.key))
  const inB = new Set(plan.b.map((p) => p.key))
  const bench = byQueue(present.filter((p) => !inA.has(p.key) && !inB.has(p.key)))
  const [pickFor, setPickFor] = useState(null)

  const remove = (side, p) => onChange({ ...plan, [side]: plan[side].filter((x) => x.key !== p.key) })
  const add = (side, p) => {
    if (plan[side].length >= TEAM_SIZE) return
    onChange({ ...plan, [side]: [...plan[side], p] })
    setPickFor(null)
  }
  const column = (side, title) => (
    <div className="min-w-0 flex-1 rounded-xl border border-line p-2">
      <div className="mb-1 text-xs font-semibold text-muted">
        {title} · {plan[side].length}/{TEAM_SIZE}
      </div>
      {plan[side].map((p) => (
        <button key={p.key} className="flex h-8 w-full items-center gap-1.5 text-left text-[13px]" onClick={() => remove(side, p)}>
          <Avatar name={p.name} src={photoUrl(p.photo_path)} size={20} />
          <span className="flex-1 truncate">{p.name}</span>
          <span className="text-[11px] text-muted">tirar</span>
        </button>
      ))}
      {plan[side].length < TEAM_SIZE && (
        <button className={`mt-1 h-8 w-full rounded border border-dashed text-[12px] font-semibold ${pickFor === side ? 'border-action text-action' : 'border-line-2 text-action'}`} onClick={() => setPickFor(side)}>
          + Pôr da fila
        </button>
      )}
    </div>
  )

  return (
    <Sheet title="Próximo jogo" subtitle={plan.keep ? 'Quem ganhou fica (lado A). O lado B vem da fila.' : 'Ninguém fica: os dois times saem da fila.'} onClose={onClose}>
      <div className="flex gap-2">
        {column('a', plan.keep ? 'Fica (A)' : 'Time A')}
        {column('b', 'Time B')}
      </div>
      {pickFor && (
        <div className="mt-3">
          <div className="mb-1 text-xs font-semibold text-muted">Fila · toque para pôr no {pickFor === 'a' ? 'time A' : 'time B'}</div>
          <div className="max-h-[30dvh] overflow-y-auto">
            {bench.map((p) => (
              <button key={p.key} className="flex min-h-11 w-full items-center gap-2 border-b border-row text-left text-sm" onClick={() => add(pickFor, p)}>
                <Avatar name={p.name} src={photoUrl(p.photo_path)} size={24} />
                <span className="flex-1 truncate">{p.name}</span>
                <span className="text-[11px] text-muted">{p.waiting} sem jogar</span>
              </button>
            ))}
            {bench.length === 0 && <div className="py-2 text-sm text-muted">Ninguém na fila.</div>}
          </div>
        </div>
      )}
      <div className="mt-3">
        <Notice>{msg}</Notice>
      </div>
      <button className="btn mt-3 w-full" disabled={!plan.a.length || !plan.b.length || busy} onClick={onConfirm}>
        Criar jogo
      </button>
      <button className="btn-ghost mt-2 flex w-full items-center justify-center gap-2 text-sm" onClick={onReshuffle}>
        <Shuffle size={15} /> Refazer proposta
      </button>
      <button className="mt-1 h-11 w-full text-sm text-muted" onClick={onClose}>
        Cancelar
      </button>
    </Sheet>
  )
}
