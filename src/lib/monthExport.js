import { AWARDS } from './awards'
import { TIMEZONE } from './constants'
import { addMonths, lastSunday, monthClosed } from './dates'
import { EVENT_LABEL } from './games'
import { supabase } from './supabase'

const when = (ts) => (ts ? new Date(ts).toLocaleString('pt-BR', { timeZone: TIMEZONE }) : '')
// vírgula decimal: o Excel em português lê como número
const money = (v) => (v == null ? '' : Number(v).toFixed(2).replace('.', ','))
const yesNo = (v) => (v ? 'sim' : 'não')

async function rows(query) {
  const { data, error } = await query
  if (error) throw error
  return data ?? []
}

// Listas que podem passar do limite de 1000 linhas por consulta do Supabase
async function allPages(build) {
  const out = []
  for (let from = 0; ; from += 1000) {
    const page = await rows(build().order('id').range(from, from + 999))
    out.push(...page)
    if (page.length < 1000) return out
  }
}

// Tudo o que o app guarda de um mês, como seções [título, linhas] de um CSV só.
// Fora: votos das notas (são anônimos e não têm mês; só vale a nota atual).
export async function buildMonthExport(month) {
  const next = addMonths(month, 1)
  const peladas = await rows(supabase.from('peladas').select('*').gte('date', month).lt('date', next).order('date'))
  const ids = peladas.map((p) => p.id)
  const inPeladas = (table, select = '*') => (ids.length ? rows(supabase.from(table).select(select).in('pelada_id', ids)) : [])

  const [people, kits, guests, teams, members, games, scores, presence, helpers, diaristas, drafts, arrivals, peladaStats, stats, keeperStats, podium, awards, periods, charges, cash] = await Promise.all([
    rows(supabase.from('profiles').select('id, name, username, role, type, status')),
    rows(supabase.from('kits').select('id, name')),
    inPeladas('guests', 'id, name'),
    inPeladas('teams'),
    inPeladas('team_members'),
    ids.length ? rows(supabase.from('games').select('*').in('pelada_id', ids).order('pelada_id').order('number')) : [],
    inPeladas('game_scores'),
    inPeladas('presence'),
    inPeladas('pelada_helpers'),
    inPeladas('pelada_diaristas'),
    inPeladas('drafts'),
    inPeladas('rodizio_arrivals'),
    inPeladas('player_pelada_stats'),
    rows(supabase.from('player_month_stats').select('*').eq('month', month)),
    rows(supabase.from('goalkeeper_month_stats').select('*').eq('month', month)),
    rows(supabase.from('podium').select('profile_id, rank_total, rank_wins, rank_goals, rank_assists').eq('month', month)),
    rows(supabase.from('awards').select('*').eq('month', month)),
    rows(supabase.from('mensalista_periods').select('*').lt('started_on', next).or(`ended_on.is.null,ended_on.gte.${month}`)),
    rows(supabase.from('charges').select('*')),
    allPages(() => supabase.from('cash_entries').select('*').lt('date', next)),
  ])

  const gameIds = games.map((g) => g.id)
  const inGames = (table) => (gameIds.length ? allPages(() => supabase.from(table).select('*').in('game_id', gameIds)) : [])
  const [lineup, keepers, events] = await Promise.all([inGames('game_lineup'), inGames('game_keepers'), inGames('game_events')])

  // cobranças do mês: mensalidade pelo mês de referência; cotinha pelo vencimento (ou pela criação)
  const monthCharges = charges.filter((c) => (c.kind === 'mensalidade' ? c.month === month : (c.due_date ?? c.created_at.slice(0, 10)) >= month && (c.due_date ?? c.created_at.slice(0, 10)) < next))
  const chargeIds = monthCharges.map((c) => c.id)
  const payments = chargeIds.length ? await rows(supabase.from('payments').select('*').in('charge_id', chargeIds)) : []

  const person = Object.fromEntries(people.map((p) => [p.id, p]))
  const guestName = Object.fromEntries(guests.map((g) => [g.id, g.name]))
  const kitName = Object.fromEntries(kits.map((k) => [k.id, k.name]))
  const peladaById = Object.fromEntries(peladas.map((p) => [p.id, p]))
  const gameById = Object.fromEntries(games.map((g) => [g.id, g]))
  const scoreOf = Object.fromEntries(scores.map((s) => [s.game_id, s]))
  const rankOf = Object.fromEntries(podium.map((r) => [r.profile_id, r]))

  const nameOf = (id) => person[id]?.name ?? ''
  const who = (profileId, guestId) => (profileId ? nameOf(profileId) : guestId ? `${guestName[guestId] ?? 'Avulso'} (avulso)` : '')
  const teamName = (t) => {
    if (!t) return ''
    const captain = person[t.captain_id]
    return kitName[t.kit_id] ?? t.label ?? (captain ? `Time de ${captain.name.split(' ')[0]}` : `Time ${t.captain_order}`)
  }
  const teamById = Object.fromEntries(teams.map((t) => [t.id, t]))
  const teamLabel = (id) => teamName(teamById[id])
  const dateOf = (peladaId) => peladaById[peladaId]?.date ?? ''
  const gameRef = (gameId) => ({ pelada: dateOf(gameById[gameId]?.pelada_id), jogo: gameById[gameId]?.number })

  const done = games.filter((g) => g.status === 'finalizado')
  const goalsIn = (list) => {
    const set = new Set(list.map((g) => g.id))
    return events.filter((e) => set.has(e.game_id) && (e.type === 'gol' || e.type === 'gol_contra')).length
  }
  const doneClosed = done.filter((g) => peladaById[g.pelada_id].status === 'encerrada')
  const live = (e) => !e.voided_at
  const sum = (list) => list.reduce((acc, e) => acc + Number(e.amount), 0)
  const net = (list) => sum(list.filter((e) => e.kind === 'entrada')) - sum(list.filter((e) => e.kind === 'saida'))
  const cashMonth = cash.filter((e) => e.date >= month)

  const resumo = [
    ['Mês', month.slice(0, 7)],
    ['Situação', monthClosed(month) ? 'fechado' : `aberto (fecha depois de ${lastSunday(month)})`],
    ['Peladas encerradas', peladas.filter((p) => p.status === 'encerrada').length],
    ['Peladas em andamento', peladas.filter((p) => p.status === 'em_andamento').length],
    ['Peladas agendadas', peladas.filter((p) => p.status === 'agendada').length],
    ['Peladas canceladas', peladas.filter((p) => p.status === 'cancelada').length],
    ['Jogos (peladas encerradas)', doneClosed.length],
    ['Gols (peladas encerradas)', goalsIn(doneClosed)],
    ['Entradas no caixa', money(sum(cashMonth.filter(live).filter((e) => e.kind === 'entrada')))],
    ['Gastos no caixa', money(sum(cashMonth.filter(live).filter((e) => e.kind === 'saida')))],
    ['Saldo do mês', money(net(cashMonth.filter(live)))],
    ['Saldo acumulado até o fim do mês', money(net(cash.filter(live)))],
  ].map(([item, valor]) => ({ item, valor }))

  const awardOrder = Object.keys(AWARDS)
  const byName = (a, b) => a.jogador.localeCompare(b.jogador, 'pt-BR')

  const sections = [
    ['Resumo', resumo],
    ['Premiados', [...awards]
      .sort((a, b) => awardOrder.indexOf(a.award) - awardOrder.indexOf(b.award) || a.position - b.position)
      .map((a) => ({ premio: AWARDS[a.award]?.label(a.position) ?? a.award, jogador: nameOf(a.profile_id) }))],
    ['Estatísticas dos jogadores no mês (peladas encerradas)', stats
      .map((s) => ({ jogador: nameOf(s.profile_id), tipo_hoje: person[s.profile_id]?.type, no_podio: yesNo(rankOf[s.profile_id]), posicao_total: rankOf[s.profile_id]?.rank_total ?? '', jogos: s.games, vitorias: s.wins, gols: s.goals, assistencias: s.assists, total: s.total, posicao_vitorias: rankOf[s.profile_id]?.rank_wins ?? '', posicao_gols: rankOf[s.profile_id]?.rank_goals ?? '', posicao_assistencias: rankOf[s.profile_id]?.rank_assists ?? '' }))
      .sort((a, b) => (a.posicao_total || 999) - (b.posicao_total || 999) || byName(a, b))],
    ['Goleiros no mês (peladas encerradas)', keeperStats.map((s) => ({ goleiro: nameOf(s.profile_id), jogos: s.games, vitorias: s.wins, gols_sofridos: s.conceded, assistencias: s.assists, defesas_dificeis: s.saves }))],
    ['Mensalistas no mês', periods.map((m) => ({ jogador: nameOf(m.profile_id), desde: m.started_on, ate: m.ended_on ?? '' }))],
    ['Peladas', peladas.map((p) => ({ data: p.date, horario: p.start_time, local: p.location, vagas: p.max_slots, status: p.status, formato: p.format, minutos_por_jogo: p.game_minutes, gols_por_jogo: p.game_goals, modo_dos_times: drafts.find((d) => d.pelada_id === p.id)?.mode ?? '', encerrada_em: when(p.closed_at), encerrada_por: nameOf(p.closed_by), ajudantes: helpers.filter((h) => h.pelada_id === p.id).map((h) => nameOf(h.profile_id)).join(', '), diaristas_chamados: diaristas.filter((d) => d.pelada_id === p.id).map((d) => nameOf(d.profile_id)).join(', ') }))],
    ['Números de cada jogador por pelada', peladaStats
      .map((s) => ({ pelada: dateOf(s.pelada_id), jogador: nameOf(s.profile_id), jogos: s.games, vitorias: s.wins, gols: s.goals, assistencias: s.assists, total: s.total }))
      .sort((a, b) => a.pelada.localeCompare(b.pelada) || byName(a, b))],
    ['Presença', presence
      .map((x) => ({ pelada: dateOf(x.pelada_id), jogador: nameOf(x.profile_id), resposta: x.answer === 'vou' ? 'vou' : 'não vou', respondeu_em: when(x.answered_at) }))
      .sort((a, b) => a.pelada.localeCompare(b.pelada) || byName(a, b))],
    ['Chegadas do rodízio', arrivals.map((a) => ({ pelada: dateOf(a.pelada_id), jogador: who(a.profile_id, a.guest_id), chegou: when(a.arrived_at), saiu: when(a.left_at) }))],
    ['Times', teams
      .map((t) => ({ pelada: dateOf(t.pelada_id), ordem: t.captain_order ?? '', time: teamName(t), capitao: nameOf(t.captain_id), kit: kitName[t.kit_id] ?? '', cor: t.color ?? '' }))
      .sort((a, b) => a.pelada.localeCompare(b.pelada) || a.ordem - b.ordem)],
    ['Jogadores dos times', members
      .map((m) => ({ pelada: dateOf(m.pelada_id), time: teamLabel(m.team_id), jogador: m.is_slot ? 'Vaga de diarista' : who(m.profile_id, m.guest_id), capitao: yesNo(m.is_captain), escolha: m.pick_number ?? '', origem: m.source, saiu: yesNo(m.is_out) }))
      .sort((a, b) => a.pelada.localeCompare(b.pelada) || a.time.localeCompare(b.time, 'pt-BR') || (a.escolha || 99) - (b.escolha || 99))],
    ['Jogos', games.map((g) => {
      const s = scoreOf[g.id]
      return { pelada: dateOf(g.pelada_id), jogo: g.number, time1: teamLabel(g.team1_id), gols1: s?.team1_goals ?? '', gols2: s?.team2_goals ?? '', time2: teamLabel(g.team2_id), vencedor: teamLabel(s?.winner_id) || 'empate', nos_penaltis: yesNo(s?.penalties), status: g.status, inicio: when(g.started_at), fim: when(g.ended_at) }
    })],
    ['Quem esteve em campo em cada jogo', lineup.map((l) => ({ ...gameRef(l.game_id), time: teamLabel(l.team_id), jogador: who(l.profile_id, l.guest_id), entrou_no_minuto: l.entered_minute, saiu_no_minuto: l.left_minute ?? '' }))],
    ['Goleiros em cada jogo', keepers.map((k) => ({ ...gameRef(k.game_id), time: teamLabel(k.team_id), goleiro: k.profile_id ? nameOf(k.profile_id) : 'Goleiro avulso', entrou_no_minuto: k.entered_minute, saiu_no_minuto: k.left_minute ?? '' }))],
    ['Eventos (gols, cartões, substituições, defesas)', events.map((e) => ({ ...gameRef(e.game_id), minuto: e.minute, tipo: EVENT_LABEL[e.type] ?? e.type, time: teamLabel(e.team_id), jogador: who(e.player_id, e.player_guest_id), assistencia: who(e.assist_id, e.assist_guest_id), entrou: who(e.sub_in_id, e.sub_in_guest_id), lancado_por: nameOf(e.created_by), lancado_em: when(e.created_at) }))],
    ['Pagamentos', payments.map((x) => {
      const c = monthCharges.find((y) => y.id === x.charge_id)
      return { cobranca: c.title, tipo: c.kind, valor: money(c.amount), vencimento: c.due_date ?? '', jogador: nameOf(x.profile_id), status: x.status, informado_em: when(x.informed_at), confirmado_em: when(x.confirmed_at), confirmado_por: nameOf(x.confirmed_by) }
    })],
    ['Caixa', cashMonth.map((e) => ({ data: e.date, tipo: e.kind, categoria: e.category, descricao: e.description, valor: money(e.amount), com: nameOf(e.holder_id), para: nameOf(e.to_holder_id), pagador: e.payer_name ?? nameOf(e.payer_id), pelada: dateOf(e.pelada_id), lancado_por: nameOf(e.created_by), estornado: e.voided_at ? 'sim' : '', motivo_do_estorno: e.void_reason ?? '', estornado_por: nameOf(e.voided_by) }))],
  ]
  const hasData = peladas.length > 0 || cashMonth.length > 0 || payments.length > 0
  return { sections, hasData }
}
