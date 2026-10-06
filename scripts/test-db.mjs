// Testa as regras e permissões do banco simulando usuários.
// Tudo roda dentro de uma transação desfeita no final: não deixa dados no banco.
import { connect } from './db.mjs'

const c = await connect()
let ok = 0, fail = 0
const q = (s, p) => c.query(s, p)
const as = async (uid) => {
  await q(`reset role`)
  if (uid) { await q(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid, role: 'authenticated' })]); await q(`set local role authenticated`) }
}
async function expect(name, fn, shouldFail = false) {
  await q('savepoint t')
  try { const r = await fn(); if (shouldFail) { fail++; console.log('FALHOU (devia dar erro):', name) } else { ok++; console.log('ok', name, typeof r === 'string' ? r : '') } await q('release savepoint t') }
  catch (e) { await q('rollback to savepoint t'); if (shouldFail) { ok++; console.log('ok', name, '->', e.message) } else { fail++; console.log('FALHOU:', name, '->', e.message) } }
}
const U = {}; const id = (n) => (U[n] ??= crypto.randomUUID())
const mkUser = (n, meta) => q(`insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at) values ($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2,$3,now(),now())`, [id(n), n + '@aposentados.app', meta])
const one = async (s, p) => (await q(s, p)).rows[0]

await q('begin')
try {
  await q(`insert into invites (code) values ('TESTE123')`)
  await expect('cadastro com convite inválido é recusado', () => mkUser('x', { username: 'xx1', name: 'X', invite_code: 'ERRADO1' }), true)
  for (const n of ['dono', 'adm', 'j1', 'j2', 'j3', 'j4', 'j5', 'j6', 'j7', 'j8', 'j9', 'j10', 'dia'])
    await mkUser(n, { username: 'u_' + n, name: 'Nome ' + n, invite_code: 'teste123' })
  await expect('perfil criado como pendente/diarista', async () => { const r = await one(`select status, type, role from profiles where id=$1`, [id('j1')]); if (r.status !== 'pendente' || r.type !== 'diarista') throw new Error(JSON.stringify(r)); return JSON.stringify(r) })
  await mkUser('goog', { full_name: 'Fulano Google' })
  await expect('login Google cria perfil incompleto', async () => (await one(`select status from profiles where id=$1`, [id('goog')])).status)

  // primeiro dono (feito por SQL, uma vez)
  await q(`update profiles set status='ativo', role='dono', type='mensalista' where id=$1`, [id('dono')])

  await as(id('j1'))
  await expect('pendente não vê outros perfis', async () => { const r = await q(`select count(*)::int n from profiles`); if (r.rows[0].n !== 1) throw new Error('viu ' + r.rows[0].n); return 'vê só o próprio' })
  await expect('pendente não aprova ninguém', () => q(`select review_signup($1, true)`, [id('j2')]), true)

  await as(id('dono'))
  await expect('dono gera convite novo e o antigo deixa de valer', async () => { const code = (await one(`select generate_invite() c`)).c; const old = (await one(`select invite_is_valid('TESTE123') v`)).v; if (old) throw new Error('antigo ainda vale'); return code })
  for (const n of ['adm', 'j1', 'j2', 'j3', 'j4', 'j5', 'j6', 'j7', 'j8', 'j9', 'j10', 'dia']) await q(`select review_signup($1, true)`, [id(n)])
  await expect('dono torna adm admin (vira mensalista)', async () => { await q(`select set_admin($1, true)`, [id('adm')]); return JSON.stringify(await one(`select role, type from profiles where id=$1`, [id('adm')])) })
  await as(null); await q(`update app_settings set mensalista_quota = 12`); await as(id('adm'))
  for (const n of ['j1', 'j2', 'j3', 'j4', 'j5', 'j6', 'j7', 'j8', 'j9', 'j10']) await q(`select set_player_type($1, 'mensalista')`, [id(n)])
  await expect('cota cheia (12 de 12) bloqueia novo mensalista', () => q(`select set_player_type($1, 'mensalista')`, [id('dia')]), true)
  await expect('admin não define admins', () => q(`select set_admin($1, true)`, [id('j1')]), true)

  await as(id('j1'))
  await expect('jogador não muda o próprio papel', () => q(`update profiles set role='admin' where id=$1`, [id('j1')]), true)
  await expect('jogador muda o próprio nome', async () => { const r = await q(`update profiles set name='Novo Nome' where id=$1`, [id('j1')]); return r.rowCount + ' linha' })
  await expect('jogador não muda nome de outro', async () => { const r = await q(`update profiles set name='Hack' where id=$1`, [id('j2')]); if (r.rowCount) throw new Error('mudou!'); return '0 linhas' })
  await expect('jogador não vê código de convite', async () => { const r = await q(`select count(*)::int n from invites`); if (r.rows[0].n) throw new Error('viu'); return 'nenhum' })

  // pelada, times e jogo
  await as(id('adm'))
  const pel = (await one(`insert into peladas (date, start_time, location, max_slots) values ('2026-10-11','08:00','Campo',20) returning id`)).id
  await q(`insert into pelada_helpers values ($1,$2)`, [pel, id('j9')])
  const t1 = (await one(`insert into teams (pelada_id, captain_order, captain_id, color) values ($1,1,$2,'azul') returning id`, [pel, id('j1')])).id
  const t2 = (await one(`insert into teams (pelada_id, captain_order, captain_id, color) values ($1,2,$2,'vermelho') returning id`, [pel, id('j2')])).id
  await expect('dois times não usam a mesma cor na mesma pelada', () => q(`insert into teams (pelada_id, captain_order, captain_id, color) values ($1,3,$2,'azul')`, [pel, id('j3')]), true)
  for (const [n, t] of [['j1', t1], ['j3', t1], ['j5', t1], ['j2', t2], ['j4', t2], ['j6', t2]]) await q(`insert into team_members (pelada_id, team_id, profile_id) values ($1,$2,$3)`, [pel, t, id(n)])
  const game = (await one(`insert into games (pelada_id, number, team1_id, team2_id) values ($1,1,$2,$3) returning id`, [pel, t1, t2])).id

  await as(id('j9'))
  await expect('ajudante inicia o jogo e vira responsável', () => q(`select start_game($1)`, [game]))
  await expect('responsável registra gol com assistência', () => q(`insert into game_events (game_id, type, team_id, player_id, assist_id, minute) values ($1,'gol',$2,$3,$4,3)`, [game, t1, id('j1'), id('j3')]))
  await expect('gol de quem não está em campo é recusado', () => q(`insert into game_events (game_id, type, team_id, player_id) values ($1,'gol',$2,$3)`, [game, t1, id('j7')]), true)
  await expect('assistência de jogador do outro time é recusada', () => q(`insert into game_events (game_id, type, team_id, player_id, assist_id) values ($1,'gol',$2,$3,$4)`, [game, t1, id('j1'), id('j2')]), true)
  await expect('substituição parcial põe j7 em campo', () => q(`insert into game_events (game_id, type, team_id, player_id, sub_in_id, minute) values ($1,'substituicao',$2,$3,$4,5)`, [game, t2, id('j6'), id('j7')]))
  await expect('gol contra de j4 conta para o time 1', () => q(`insert into game_events (game_id, type, team_id, player_id, minute) values ($1,'gol_contra',$2,$3,7)`, [game, t2, id('j4')]))
  await expect('responsável não edita evento (só admin)', async () => { const r = await q(`update game_events set minute=9 where game_id=$1`, [game]); if (r.rowCount) throw new Error('editou'); return '0 linhas' })

  await as(id('j5'))
  await expect('jogador comum não registra evento', () => q(`insert into game_events (game_id, type, team_id, player_id) values ($1,'gol',$2,$3)`, [game, t1, id('j5')]), true)
  await expect('jogador comum não assume o registro', () => q(`select take_recorder($1)`, [game]), true)
  await expect('jogador vê o placar ao vivo', async () => JSON.stringify(await one(`select team1_goals, team2_goals from game_scores where game_id=$1`, [game])))

  await as(id('j9'))
  await expect('responsável salva o resultado', () => q(`select finish_game($1)`, [game]))
  await as(id('adm'))
  await expect('admin encerra a pelada', () => q(`select close_pelada($1)`, [pel]))
  await expect('pódio de outubro', async () => {
    const r = await q(`select name, goals, assists, wins, total, rank_total from podium where month='2026-10-01' order by rank_total, name`)
    return '\n' + r.rows.map((x) => `   ${x.rank_total}o ${x.name}: ${x.goals}G ${x.assists}A ${x.wins}V = ${x.total}`).join('\n')
  })
  await expect('j7 (entrou na substituição, time perdeu) sem vitória', async () => JSON.stringify(await one(`select games, wins from player_month_stats where profile_id=$1`, [id('j7')])))

  // notas
  await as(id('j1'))
  await expect('mensalista avalia colega', () => q(`insert into ratings (rater_id, rated_id, dribble, shot, speed, overall) values ($1,$2,4,4,4,4)`, [id('j1'), id('j2')]))
  await expect('não dá para avaliar a si mesmo', () => q(`insert into ratings (rater_id, rated_id, dribble, shot, speed, overall) values ($1,$1,5,5,5,5)`, [id('j1')]), true)
  await expect('mudar a mesma nota no mesmo mês é bloqueado', () => q(`update ratings set overall=5 where rated_id=$1`, [id('j2')]), true)
  await expect('diarista não é avaliado', () => q(`insert into ratings (rater_id, rated_id, dribble, shot, speed, overall) values ($1,$2,3,3,3,3)`, [id('j1'), id('dia')]), true)
  await as(id('j2'))
  await expect('ninguém vê quem deu a nota', async () => { const r = await q(`select count(*)::int n from ratings`); if (r.rows[0].n) throw new Error('viu ' + r.rows[0].n); return 'invisível' })
  await expect('média só aparece com 3+ votos', async () => JSON.stringify(await one(`select votes, overall from rating_summary where profile_id=$1`, [id('j2')])))

  // posse
  await as(id('dono'))
  await expect('dono passa a posse para adm', async () => { await q(`select transfer_ownership($1)`, [id('adm')]); const r = await q(`select username, role from profiles where role in ('dono','admin') order by 1`); return r.rows.map((x) => x.username + '=' + x.role).join(', ') })
  await as(null)
  await expect('visitante sem login não lê perfis', async () => { await q(`set local role anon`); const r = await q(`select count(*) from profiles`); throw new Error('leu ' + r.rows[0].count) }, true)
} finally {
  await q('rollback')
  await c.end()
}
console.log(`\n${ok} ok, ${fail} falhas`)
