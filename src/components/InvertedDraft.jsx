import { Clock, Scissors, Shirt } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { friendlyError } from '../lib/errors'
import { photoUrl } from '../lib/storage'
import { supabase } from '../lib/supabase'
import Avatar from './Avatar'
import { PositionTags } from './Positions'
import Sheet from './Sheet'
import TeamShield from './TeamShield'
import { Notice, SectionLabel } from './ui'

const PICKS_PER_TEAM = 4

// Capitães invertidos: cada mensalista escolhe o time; o capitão corta quando passa de 4
export default function InvertedDraft({ pelada, teams, draft, available, profile, isAdmin, countdown, onChanged }) {
  const [choices, setChoices] = useState([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [closing, setClosing] = useState(false)

  const load = useCallback(
    () =>
      supabase
        .from('invert_choices')
        .select('*')
        .eq('pelada_id', pelada.id)
        .then(({ data }) => setChoices(data ?? [])),
    [pelada.id],
  )

  useEffect(() => {
    load()
    const channel = supabase
      .channel(`invert-${pelada.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'invert_choices', filter: `pelada_id=eq.${pelada.id}` }, load)
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [pelada.id, load])

  const byId = Object.fromEntries(available.map((p) => [p.id, p]))
  // só vale a escolha de quem continua disponível
  const choiceOf = Object.fromEntries(choices.filter((c) => byId[c.profile_id]).map((c) => [c.profile_id, c]))
  const mine = choiceOf[profile.id]
  const canChoose = profile.type === 'mensalista' && Boolean(byId[profile.id])
  const myTeam = teams.find((t) => t.captain_id === profile.id)
  const free = available.filter((p) => !choiceOf[p.id]?.team_id)

  async function rpc(fn, args) {
    setBusy(true)
    setMsg('')
    const { error } = await supabase.rpc(fn, args)
    setBusy(false)
    if (error) setMsg(friendlyError(error))
    load()
    onChanged()
  }

  return (
    <>
      <div className={`mx-4 mt-3 rounded-xl border p-3 ${canChoose && !mine?.team_id ? 'border-action bg-action/10' : 'border-line'}`}>
        <div className="text-xs font-semibold tracking-wide text-muted">CAPITÃES INVERTIDOS</div>
        <div className="mt-0.5 text-lg font-bold">
          {canChoose
            ? mine?.team_id
              ? `Você está na lista do ${teams.find((t) => t.id === mine.team_id)?.label ?? 'time'}`
              : 'Escolha em qual time quer jogar'
            : myTeam
              ? 'Os jogadores estão escolhendo o seu time'
              : 'Os mensalistas estão escolhendo os times'}
        </div>
        <div className="mt-1 flex items-center gap-1.5 text-sm text-muted">
          <Clock size={15} /> Fecha em {countdown}
        </div>
      </div>

      {msg && (
        <div className="px-4 pt-3">
          <Notice>{msg}</Notice>
        </div>
      )}

      {myTeam && (
        <div className="px-4 pt-3">
          {myTeam.kit_id && myTeam.color ? (
            <div className="text-center text-xs text-muted">Kit e cor do seu time já escolhidos.</div>
          ) : (
            <Link to="/times/meu" className="btn-outline flex items-center justify-center gap-2">
              <Shirt size={18} /> Meu time: kit e cor (quem escolhe primeiro leva)
            </Link>
          )}
        </div>
      )}

      <div className="space-y-2 px-4 pt-3">
        {teams.map((t) => {
          const list = available.filter((p) => choiceOf[p.id]?.team_id === t.id)
          const over = list.length > PICKS_PER_TEAM
          const isCaptain = t.captain_id === profile.id
          const cut = mine?.blocked?.includes(t.id)
          return (
            <div key={t.id} className={`rounded-xl border p-2.5 ${mine?.team_id === t.id ? 'border-action' : 'border-line'}`}>
              <div className="flex items-center gap-2">
                <TeamShield team={t} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-bold">{t.label}</div>
                  <div className="text-xs text-muted">Capitão: {t.captain?.name ?? '–'}</div>
                </div>
                <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${over ? 'border-gold text-gold' : 'border-line-2 text-muted'}`}>
                  {list.length}/{PICKS_PER_TEAM}
                </span>
              </div>
              {over && (
                <div className="mt-1.5 text-xs text-gold">
                  {isCaptain ? `Mais de ${PICKS_PER_TEAM}: corte ${list.length - PICKS_PER_TEAM} (sem cortar, o app sorteia).` : `Mais de ${PICKS_PER_TEAM}: o capitão vai cortar.`}
                </div>
              )}
              {list.map((p) => (
                <div key={p.id} className="flex min-h-11 items-center gap-2 border-b border-row last:border-0">
                  <Avatar name={p.name} src={photoUrl(p.photo_path)} size={26} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm">
                      {p.name}
                      {p.id === profile.id && <span className="text-xs text-muted"> (você)</span>}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      <PositionTags positions={p.positions} />
                    </div>
                  </div>
                  {isCaptain && over && (
                    <button className="flex h-9 items-center gap-1 rounded-lg border border-line-2 px-2.5 text-xs font-semibold" disabled={busy} onClick={() => rpc('invert_cut', { p_pelada: pelada.id, p_profile: p.id })}>
                      <Scissors size={13} /> Cortar
                    </button>
                  )}
                </div>
              ))}
              {list.length === 0 && <div className="py-1.5 text-xs text-muted">Ninguém escolheu ainda.</div>}
              {canChoose &&
                (mine?.team_id === t.id ? (
                  <button className="btn-ghost mt-2 h-10 w-full text-sm" disabled={busy} onClick={() => rpc('invert_leave', { p_pelada: pelada.id })}>
                    Sair da lista
                  </button>
                ) : cut ? (
                  <div className="mt-2 text-center text-xs text-muted">O capitão te cortou deste time.</div>
                ) : (
                  <button className="btn mt-2 h-10 w-full text-sm" disabled={busy} onClick={() => rpc('invert_choose', { p_team: t.id })}>
                    {mine?.team_id ? 'Trocar para este time' : 'Quero jogar neste time'}
                  </button>
                ))}
            </div>
          )
        })}
      </div>

      <SectionLabel>Ainda sem time · {free.length}</SectionLabel>
      {free.length === 0 && <div className="px-4 text-sm text-muted">Todo mundo já escolheu.</div>}
      {free.map((p) => (
        <div key={p.id} className="flex min-h-12 items-center gap-3 border-b border-row px-4">
          <Avatar name={p.name} src={photoUrl(p.photo_path)} size={30} />
          <span className="flex-1 truncate text-sm">{p.name}</span>
          <span className="text-[11px] text-muted">{p.type === 'diarista' ? 'diarista' : choiceOf[p.id]?.blocked?.length ? 'cortado' : p.going ? 'vai' : 'dúvida'}</span>
        </div>
      ))}
      <p className="px-4 pt-3 text-xs text-muted">
        No fim do prazo, quem não escolheu (ou foi cortado e não escolheu outro) vai para os times que precisam de gente; o que faltar vira
        vaga de diarista. Os times valem só para esta pelada.
      </p>

      {isAdmin && (
        <div className="flex gap-2 px-4 pt-3">
          <Link to={`/admin/peladas/${pelada.id}/capitaes`} className="btn-ghost flex flex-1 items-center justify-center text-sm">
            Refazer capitães
          </Link>
          <button className="btn-ghost flex-1 text-sm" onClick={() => setClosing(true)}>
            Fechar times agora
          </button>
        </div>
      )}

      {closing && (
        <Sheet
          title="Fechar os times agora?"
          subtitle={`Antes do prazo (${new Date(draft.free_until).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}). Times com mais de 4 têm corte sorteado, quem sobrou vai para onde falta e o resto vira vaga de diarista.`}
          onClose={() => setClosing(false)}
        >
          <button
            className="btn w-full"
            disabled={busy}
            onClick={async () => {
              await rpc('invert_close', { p_pelada: pelada.id })
              setClosing(false)
            }}
          >
            Fechar times
          </button>
          <button className="mt-2 h-11 w-full text-sm text-muted" onClick={() => setClosing(false)}>
            Cancelar
          </button>
        </Sheet>
      )}
    </>
  )
}
