import { supabase } from './supabase'
import { fetchTeams } from './teams'

export const GAME_MINUTES = 10
export const GAME_GOALS = 2

export const EVENT_LABEL = {
  gol: 'Gol',
  gol_contra: 'Gol contra',
  amarelo: 'Cartão amarelo',
  vermelho: 'Cartão vermelho',
  substituicao: 'Substituição',
}

export const GAME_STATUS_LABEL = { agendado: 'A seguir', ao_vivo: 'Ao vivo', finalizado: 'Finalizado' }

// Placar a partir dos eventos (gol contra conta para o adversário)
export function scoreOf(game, events) {
  let a = 0
  let b = 0
  for (const e of events) {
    if (e.game_id !== game.id) continue
    const forTeam1 = (e.type === 'gol' && e.team_id === game.team1_id) || (e.type === 'gol_contra' && e.team_id === game.team2_id)
    const forTeam2 = (e.type === 'gol' && e.team_id === game.team2_id) || (e.type === 'gol_contra' && e.team_id === game.team1_id)
    if (forTeam1) a++
    if (forTeam2) b++
  }
  return [a, b]
}

export function winnerOf(game, events) {
  const [a, b] = scoreOf(game, events)
  return a > b ? game.team1_id : b > a ? game.team2_id : (game.penalty_winner_id ?? null)
}

// Empate decidido nos pênaltis
export function wonOnPenalties(game, events) {
  const [a, b] = scoreOf(game, events)
  return a === b && game.penalty_winner_id != null
}

export const minuteOf = (game, now = Date.now()) =>
  game?.started_at ? Math.max(0, Math.floor((now - Date.parse(game.started_at)) / 60000)) : 0

// Nome de quem fez o evento (perfil ou avulso)
export function makeNamer(profiles, guests) {
  const p = Object.fromEntries(profiles.map((x) => [x.id, x.name]))
  const g = Object.fromEntries(guests.map((x) => [x.id, x.name]))
  return (profileId, guestId) => (profileId ? (p[profileId] ?? 'Jogador') : guestId ? (g[guestId] ?? 'Avulso') : null)
}

export function describeEvent(e, name) {
  const who = name(e.player_id, e.player_guest_id)
  if (e.type === 'substituicao') return { title: `Substituição · ${who} sai`, sub: `Entra: ${name(e.sub_in_id, e.sub_in_guest_id)}` }
  if (e.type === 'gol') {
    const assist = name(e.assist_id, e.assist_guest_id)
    return { title: `Gol · ${who}`, sub: assist ? `Assistência: ${assist}` : 'Sem assistência' }
  }
  return { title: `${EVENT_LABEL[e.type]} · ${who}`, sub: null }
}

// Tudo que a tela do jogo precisa
export async function fetchGame(gameId) {
  const { data: game } = await supabase.from('games').select('*').eq('id', gameId).maybeSingle()
  if (!game) return null
  const [{ data: pelada }, teams, { data: lineup }, { data: events }, { data: guests }, { data: profiles }, { data: helpers }] = await Promise.all([
    supabase.from('peladas').select('*').eq('id', game.pelada_id).single(),
    fetchTeams(game.pelada_id),
    supabase.from('game_lineup').select('*').eq('game_id', gameId).order('id'),
    supabase.from('game_events').select('*').eq('game_id', gameId).order('minute').order('id'),
    supabase.from('guests').select('id, name').eq('pelada_id', game.pelada_id),
    supabase.from('profiles').select('id, name, photo_path, role, type').eq('status', 'ativo'),
    supabase.from('pelada_helpers').select('profile_id').eq('pelada_id', game.pelada_id),
  ])
  return {
    game,
    pelada,
    teams,
    team1: teams.find((t) => t.id === game.team1_id),
    team2: teams.find((t) => t.id === game.team2_id),
    lineup: lineup ?? [],
    events: events ?? [],
    guests: guests ?? [],
    profiles: profiles ?? [],
    helperIds: (helpers ?? []).map((h) => h.profile_id),
  }
}

// Jogos e eventos de uma pelada (placar, resumo do dia)
export async function fetchPeladaGames(peladaId) {
  const { data: games } = await supabase.from('games').select('*').eq('pelada_id', peladaId).order('number')
  const ids = (games ?? []).map((g) => g.id)
  const { data: events } = ids.length ? await supabase.from('game_events').select('*').in('game_id', ids) : { data: [] }
  return { games: games ?? [], events: events ?? [] }
}

// Resumo do dia: artilheiro, garçom e time com mais vitórias
export function daySummary(games, events, teams, name) {
  const done = games.filter((g) => g.status === 'finalizado')
  const doneIds = new Set(done.map((g) => g.id))
  const count = (pick) => {
    const m = new Map()
    for (const e of events) {
      if (!doneIds.has(e.game_id) || e.type !== 'gol') continue
      const key = pick(e)
      if (key) m.set(key, (m.get(key) ?? 0) + 1)
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }
  const topOf = (list) => {
    if (!list.length) return null
    const best = list[0][1]
    const names = list.filter(([, n]) => n === best).map(([k]) => name(...k.split('|').map((x) => x || null)))
    return { names, n: best }
  }
  const scorers = count((e) => (e.player_id || e.player_guest_id ? `${e.player_id ?? ''}|${e.player_guest_id ?? ''}` : null))
  const assists = count((e) => (e.assist_id || e.assist_guest_id ? `${e.assist_id ?? ''}|${e.assist_guest_id ?? ''}` : null))

  const wins = new Map()
  for (const g of done) {
    const w = winnerOf(g, events)
    if (w) wins.set(w, (wins.get(w) ?? 0) + 1)
  }
  const bestWins = Math.max(0, ...wins.values())
  const champions = bestWins ? teams.filter((t) => wins.get(t.id) === bestWins) : []

  return {
    games: done.length,
    goals: events.filter((e) => doneIds.has(e.game_id) && (e.type === 'gol' || e.type === 'gol_contra')).length,
    scorer: topOf(scorers),
    assister: topOf(assists),
    champions,
    bestWins,
  }
}
