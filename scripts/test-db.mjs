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
// dentro de um teste: esta ação precisa ser recusada
async function expect_fail(fn) {
  await q('savepoint f')
  try {
    await fn()
  } catch {
    await q('rollback to savepoint f')
    return
  }
  throw new Error('devia ter sido recusado')
}
const U = {}; const id = (n) => (U[n] ??= crypto.randomUUID())
const mkUser = (n, meta) => q(`insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at) values ($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2,$3,now(),now())`, [id(n), n + '@aposentados.app', meta])
const one = async (s, p) => (await q(s, p)).rows[0]

await q('begin')
// --with=arquivo.sql: aplica uma migração nova dentro da transação (testa antes de aplicar de verdade)
const extra = process.argv.find((a) => a.startsWith('--with='))?.slice(7)
if (extra) await q((await import('node:fs')).readFileSync(extra, 'utf8'))
try {
  // tira os dados reais do caminho (tudo é desfeito no rollback)
  await q(`update invites set active = false`)
  await q(`update profiles set status = 'inativo', role = 'jogador'`)
  await q(`update peladas set date = date - 36500`)
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
  await expect('pênaltis só em jogo empatado', async () => {
    const g = (await one(`insert into games (pelada_id, number, team1_id, team2_id) values ($1,3,$2,$3) returning id`, [pel, t1, t2])).id
    await q(`select start_game($1)`, [g])
    await q(`insert into game_events (game_id, type, team_id, player_id) values ($1,'gol',$2,$3)`, [g, t1, id('j1')])
    await expect_fail(() => q(`select finish_game($1, $2)`, [g, t2]))
    await q(`delete from games where id = $1`, [g])
  })
  await expect('empate com vitória do time 2 nos pênaltis', async () => {
    const g = (await one(`insert into games (pelada_id, number, team1_id, team2_id) values ($1,2,$2,$3) returning id`, [pel, t1, t2])).id
    await q(`select start_game($1)`, [g])
    await q(`select finish_game($1, $2)`, [g, t2])
    const s = await one(`select team1_goals, team2_goals, winner_id = $2 as time2_venceu, penalties from game_scores where game_id = $1`, [g, t2])
    if (!s.time2_venceu || !s.penalties) throw new Error(JSON.stringify(s))
    return JSON.stringify(s)
  })
  await expect('admin encerra a pelada', () => q(`select close_pelada($1)`, [pel]))
  await expect('vitória nos pênaltis conta no pódio (j2: 1 vitória em 2 jogos)', async () => {
    const r = await one(`select games, wins from player_month_stats where profile_id = $1`, [id('j2')])
    if (r.games !== 2 || r.wins !== 1) throw new Error(JSON.stringify(r))
    return JSON.stringify(r)
  })
  await expect('pódio de outubro', async () => {
    const r = await q(`select name, goals, assists, wins, total, rank_total from podium where month='2026-10-01' order by rank_total, name`)
    return '\n' + r.rows.map((x) => `   ${x.rank_total}o ${x.name}: ${x.goals}G ${x.assists}A ${x.wins}V = ${x.total}`).join('\n')
  })
  await expect('j7 (entrou na substituição, time perdeu) sem vitória', async () => JSON.stringify(await one(`select games, wins from player_month_stats where profile_id=$1`, [id('j7')])))

  await expect('troféus só saem quando o mês fecha', async () => {
    const r = await one(`select count(*)::int n from awards where month = current_month()`)
    if (r.n) throw new Error(`${r.n} troféus no mês atual`)
    return 'nenhum no mês atual'
  })
  await expect('troféus do mês fechado', async () => {
    await as(null)
    await q(`update peladas set date = '2026-09-13' where id = $1`, [pel])
    await as(id('adm'))
    const r = await q(`select a.award, a.position, p.name from awards a join profiles p on p.id = a.profile_id where a.month = '2026-09-01' order by a.award, a.position, p.name`)
    return '\n' + r.rows.map((x) => `   ${x.award} ${x.position}o: ${x.name}`).join('\n')
  })
  await expect('mensalidade do mês é criada uma vez só', async () => {
    await as(null)
    await q(`update app_settings set fee_amount = 50, fee_due_day = 10`)
    await as(id('adm'))
    await q(`select ensure_current_fee()`)
    await q(`select ensure_current_fee()`)
    const r = await one(`select count(*)::int n, min(due_date)::text due from charges where kind = 'mensalidade' and month = current_month()`)
    if (r.n !== 1) throw new Error(`${r.n} mensalidades`)
    return `vence ${r.due}`
  })
  await expect('jogador informa pagamento e admin confirma', async () => {
    const charge = (await one(`select id from charges where kind = 'mensalidade' and month = current_month()`)).id
    await as(id('j3'))
    await q(`select inform_payment($1)`, [charge])
    await expect_fail(() => q(`select confirm_payment($1, $2)`, [charge, id('j3')]))
    await as(id('adm'))
    await q(`select confirm_payment($1, $2)`, [charge, id('j3')])
    return (await one(`select status from payments where charge_id = $1 and profile_id = $2`, [charge, id('j3')])).status
  })

  await expect('admin cria a mensalidade do mês seguinte quando quiser', async () => {
    await as(id('adm'))
    const next = (await one(`select (current_month() + interval '1 month')::date::text m`)).m
    await q(`select create_month_fee($1)`, [next])
    const r = await one(`select count(*)::int n from payments p join charges c on c.id = p.charge_id where c.month = $1`, [next])
    return `${next}: ${r.n} mensalistas cobrados`
  })
  await expect('não cria mensalidade de mês passado', () => q(`select create_month_fee((current_month() - interval '1 month')::date)`), true)
  await expect('quem vira mensalista entra na do mês e na seguinte, não nas antigas', async () => {
    await as(null)
    await q(`update app_settings set mensalista_quota = 50`)
    const old = (await one(`insert into charges (kind, title, amount, month) values ('mensalidade', 'Mensalidade', 47, (current_month() - interval '1 month')::date) returning id`)).id
    await as(id('adm'))
    await q(`select set_player_type($1, 'mensalista')`, [id('dia')])
    const r = await q(`select c.month::text from payments p join charges c on c.id = p.charge_id where p.profile_id = $1 and c.kind = 'mensalidade' order by 1`, [id('dia')])
    const months = r.rows.map((x) => x.month)
    if (months.includes((await one(`select month::text m from charges where id = $1`, [old])).m)) throw new Error('cobrou mês antigo')
    return months.join(', ')
  })
  await expect('admin dispensa alguém de uma cobrança', async () => {
    const charge = (await one(`select id from charges where kind = 'mensalidade' and month = current_month()`)).id
    await q(`select dismiss_payment($1, $2)`, [charge, id('dia')])
    const r = await one(`select count(*)::int n from payments where charge_id = $1 and profile_id = $2`, [charge, id('dia')])
    return r.n === 0 ? 'dispensado' : 'ainda cobrado'
  })
  // volta o diarista de teste e a cota para os testes seguintes
  await q(`select set_player_type($1, 'diarista')`, [id('dia')])
  await as(null)
  await q(`update app_settings set mensalista_quota = 12`)

  // caixa
  await expect('confirmar pagamento lança no caixa com quem recebeu', async () => {
    await as(id('adm'))
    const charge = (await one(`select id from charges where kind = 'mensalidade' and month = current_month()`)).id
    await q(`select confirm_payment($1, $2, $3)`, [charge, id('j4'), id('dono')])
    await q(`select confirm_payment($1, $2, $3)`, [charge, id('j4'), id('dono')])
    const r = await one(`select count(*)::int n, min(amount)::text valor, bool_and(holder_id = $2) com_dono from cash_entries where charge_id = $1 and payer_id = $3 and voided_at is null`, [charge, id('dono'), id('j4')])
    if (r.n !== 1) throw new Error(`${r.n} lançamentos`)
    return `1 entrada de R$ ${r.valor}, com o dono: ${r.com_dono}`
  })
  await expect('desfazer confirmação estorna e volta para pendente', async () => {
    const charge = (await one(`select id from charges where kind = 'mensalidade' and month = current_month()`)).id
    await q(`select unconfirm_payment($1, $2, 'apertei errado')`, [charge, id('j4')])
    const p = await one(`select status from payments where charge_id = $1 and profile_id = $2`, [charge, id('j4')])
    const e = await one(`select void_reason from cash_entries where charge_id = $1 and payer_id = $2`, [charge, id('j4')])
    return `pagamento ${p.status}, lançamento estornado: "${e.void_reason}"`
  })
  await expect('gasto e transferência entre admins', async () => {
    await q(`select cash_add('saida', 'Society', 120, $1)`, [id('adm')])
    await q(`select cash_add('transferencia', 'Repasse', 30, $1, $2)`, [id('dono'), id('adm')])
    return 'ok'
  })
  await expect('dinheiro só fica com admin ou dono', () => q(`select cash_add('entrada', 'Doação', 10, $1)`, [id('j5')]), true)
  await expect('saldo por admin (entradas - saídas ± transferências)', async () => {
    const r = await q(`
      select p.username,
        coalesce(sum(case when e.kind = 'entrada' and e.holder_id = p.id then e.amount
                          when e.kind = 'saida' and e.holder_id = p.id then -e.amount
                          when e.kind = 'transferencia' and e.holder_id = p.id then -e.amount
                          when e.kind = 'transferencia' and e.to_holder_id = p.id then e.amount else 0 end), 0)::text saldo
      from profiles p left join cash_entries e on e.voided_at is null and p.id in (e.holder_id, e.to_holder_id)
      where p.role in ('dono','admin') group by p.username order by 1`)
    return r.rows.map((x) => `${x.username}=${x.saldo}`).join(', ')
  })
  await as(id('j1'))
  await expect('jogador não vê o caixa', async () => { const r = await q(`select count(*)::int n from cash_entries`); if (r.rows[0].n) throw new Error('viu'); return 'invisível' })
  await expect('ninguém lança direto na tabela', () => q(`insert into cash_entries (kind, category, description, amount, holder_id) values ('entrada','avulsa','x',1,$1)`, [id('j1')]), true)
  await as(id('adm'))
  await expect('nem admin apaga lançamento (só estorna)', () => q(`delete from cash_entries`), true)

  // notas
  await as(id('j1'))
  await expect('mensalista avalia colega', () => q(`insert into ratings (rater_id, rated_id, dribble, shot, speed, defense, passing, overall) values ($1,$2,4,4,4,4,4,4)`, [id('j1'), id('j2')]))
  await expect('nota sem defesa e passe é recusada', () => q(`insert into ratings (rater_id, rated_id, dribble, shot, speed, overall) values ($1,$2,4,4,4,4)`, [id('j1'), id('j3')]), true)
  await expect('não dá para avaliar a si mesmo', () => q(`insert into ratings (rater_id, rated_id, dribble, shot, speed, defense, passing, overall) values ($1,$1,5,5,5,5,5,5)`, [id('j1')]), true)
  await expect('mudar a mesma nota antes da próxima pelada é bloqueado', () => q(`update ratings set overall=5 where rated_id=$1`, [id('j2')]), true)
  await expect('pelada encerrada libera mudar a nota de novo', async () => {
    await as(null)
    // simula o encerramento de uma pelada depois da nota
    await q(`update peladas set closed_at = now() + interval '1 second' where id = $1`, [pel])
    await as(id('j1'))
    const r = await q(`update ratings set overall=5 where rated_id=$1`, [id('j2')])
    return `${r.rowCount} nota mudada`
  })
  await expect('e trava de novo até a pelada seguinte', async () => {
    await as(null)
    // a pelada encerrou antes desta última mudança
    await q(`update peladas set closed_at = now() - interval '1 second' where id = $1`, [pel])
    await as(id('j1'))
    return q(`update ratings set overall=3 where rated_id=$1`, [id('j2')])
  }, true)
  await expect('diarista não é avaliado', () => q(`insert into ratings (rater_id, rated_id, dribble, shot, speed, defense, passing, overall) values ($1,$2,3,3,3,3,3,3)`, [id('j1'), id('dia')]), true)
  await as(id('j2'))
  await expect('ninguém vê quem deu a nota', async () => { const r = await q(`select count(*)::int n from ratings`); if (r.rows[0].n) throw new Error('viu ' + r.rows[0].n); return 'invisível' })
  await expect('média só aparece com 3+ votos', async () => JSON.stringify(await one(`select votes, overall from rating_summary where profile_id=$1`, [id('j2')])))

  // escolha dos times
  await as(id('adm'))
  const pel2 = (await one(`insert into peladas (date, start_time, location, max_slots) values ('2026-10-18','08:00','Campo',20) returning id`)).id
  // presença é só status: j4 (capitão) e j9 não responderam; dono e adm não vão
  for (const n of ['j1', 'j2', 'j3', 'j5', 'j6', 'j7', 'j8', 'j10']) await q(`insert into presence (pelada_id, profile_id, answer) values ($1,$2,'vou')`, [pel2, id(n)])
  for (const n of ['dono', 'adm']) await q(`insert into presence (pelada_id, profile_id, answer) values ($1,$2,'nao_vou')`, [pel2, id(n)])
  await expect('capitães precisam ser mensalistas', () => q(`select define_captains($1, $2)`, [pel2, [id('j1'), id('j2'), id('j3'), id('dia')]]), true)
  await expect('admin define 4 capitães', () => q(`select define_captains($1, $2)`, [pel2, [id('j1'), id('j2'), id('j3'), id('j4')]]))
  const team = async (order) => (await one(`select id from teams where pelada_id=$1 and captain_order=$2`, [pel2, order])).id
  await expect('definir capitães não marca presença por eles', async () => {
    const r = await one(`select count(*)::int n from presence where pelada_id=$1 and profile_id=$2`, [pel2, id('j4')])
    if (r.n) throw new Error('marcou presença do capitão')
    return 'capitão responde sozinho'
  })
  await as(id('j2'))
  await expect('capitão 2 não escolhe na vez do 1', () => q(`select draft_pick($1,$2)`, [pel2, id('j5')]), true)
  await as(id('j1'))
  await expect('capitão 1 escolhe na sua vez (fase livre)', () => q(`select draft_pick($1,$2)`, [pel2, id('j5')]))
  await expect('jogador já escolhido não está disponível', async () => { await as(id('j2')); return q(`select draft_pick($1,$2)`, [pel2, id('j5')]) }, true)
  await as(id('j2')); await q(`select draft_pick($1,$2)`, [pel2, id('j6')])
  await as(id('j3')); await q(`select draft_pick($1,$2)`, [pel2, id('j7')])
  await as(id('j4')); await q(`select draft_pick($1,$2)`, [pel2, id('j8')])
  await expect('quem disse "não vou" não pode ser escolhido', async () => { await as(id('j4')); return q(`select draft_pick($1,$2)`, [pel2, id('dono')]) }, true)
  await expect('rodada 2 começa pelo capitão 4 (1234 · 4123) e escolhe quem não respondeu', async () => { await as(id('j4')); await q(`select draft_pick($1,$2)`, [pel2, id('j9')]); return 'ok' })
  await expect('kit e cor fora da vez do capitão é recusado', async () => { await as(id('j2')); return q(`select choose_identity($1,null,'roxo')`, [await team(2)]) }, true)
  await expect('kit e cor na vez do capitão', async () => { await as(id('j1')); return q(`select choose_identity($1,null,'roxo')`, [await team(1)]) })
  await expect('vaga de diarista não pode enquanto há disponíveis', async () => { await as(id('j1')); return q(`select draft_pick_slot($1)`, [pel2]) }, true)
  await expect('fim das 24 h: turnos de 10 min e sorteio automático', async () => {
    await as(null)
    await q(`update drafts set free_until = now() - interval '25 minutes' where pelada_id=$1`, [pel2])
    await q(`select draft_tick()`)
    const d = await one(`select phase, next_pick from drafts where pelada_id=$1`, [pel2])
    const auto = await one(`select count(*)::int n from team_members where pelada_id=$1 and source='sorteio'`, [pel2])
    return `fase=${d.phase}, próxima escolha=${d.next_pick}, sorteados=${auto.n}`
  })
  await expect('sem disponíveis, capitão da vez escolhe vaga de diarista', async () => {
    await as(id('j2'))
    await q(`select draft_pick_slot($1)`, [pel2])
    return (await one(`select count(*)::int n from team_members where pelada_id=$1 and is_slot`, [pel2])).n + ' vaga'
  })
  await expect('prazo vencido sem ninguém vira vaga sozinho', async () => {
    await as(null)
    await q(`update drafts set turn_deadline = now() - interval '1 minute' where pelada_id=$1`, [pel2])
    await q(`select draft_tick()`)
    return (await one(`select count(*)::int n from team_members where pelada_id=$1 and is_slot`, [pel2])).n + ' vagas'
  })
  await expect('no horário da pelada, o resto vira vaga e cada time fecha com 5', async () => {
    await q(`update peladas set date = current_date - 1 where id=$1`, [pel2])
    await q(`select draft_tick()`)
    await q(`update peladas set date = '2026-10-18' where id=$1`, [pel2])
    const d = await one(`select phase from drafts where pelada_id=$1`, [pel2])
    const r = await q(`select count(*)::int n from team_members where pelada_id=$1 group by team_id order by 1`, [pel2])
    return `fase=${d.phase}, por time: ${r.rows.map((x) => x.n).join(',')}`
  })
  await expect('ajudante preenche vaga com avulso que pagou (vai pro caixa)', async () => {
    await as(id('adm'))
    await q(`insert into pelada_helpers values ($1,$2)`, [pel2, id('j8')])
    await as(id('j8'))
    const slot = await one(`select id from team_members where pelada_id=$1 and is_slot order by id limit 1`, [pel2])
    await q(`select fill_slot($1, null, 'Juninho', 20, $2)`, [slot.id, id('adm')])
    const r = await one(`select (select count(*)::int from team_members where pelada_id=$1 and is_slot) vagas, (select count(*)::int from guests where pelada_id=$1 and name='Juninho') avulso`, [pel2])
    return JSON.stringify(r)
  })
  await expect('vaga não aceita quem já está em time', async () => {
    const slot = await one(`select id from team_members where pelada_id=$1 and is_slot order by id limit 1`, [pel2])
    return q(`select fill_slot($1, $2, null)`, [slot.id, id('j5')])
  }, true)
  await expect('jogo começa sem as vagas vazias e aceita jogador emprestado', async () => {
    await as(id('adm'))
    const t1 = await team(1)
    const t3 = await team(3)
    const g = (await one(`select set_next_game($1,$2,$3) id`, [pel2, t1, t3])).id
    await q(`select start_game($1)`, [g])
    const before = (await one(`select count(*)::int n from game_lineup where game_id=$1`, [g])).n
    await q(`select lend_player($1,$2,null,'Emprestado')`, [g, t3])
    const after = (await one(`select count(*)::int n from game_lineup where game_id=$1`, [g])).n
    await q(`select finish_game($1)`, [g])
    return `em campo ${before} -> ${after}`
  })
  await expect('vaga cheia: troca integral usa outro caminho', async () => {
    const slot = await one(`select id from team_members where pelada_id=$1 and is_slot order by id limit 1`, [pel2])
    return q(`select replace_member($1, null, 'X')`, [slot.id])
  }, true)
  await as(id('j1'))
  const kit = (await one(`select id from kits order by id limit 1`)).id
  await expect('capitão escolhe kit e cor', async () => q(`select choose_identity($1,$2,'verde')`, [await team(1), kit]))
  await as(id('j2'))
  await expect('outro time não pega o mesmo kit na pelada', async () => q(`select choose_identity($1,$2,'azul')`, [await team(2), kit]), true)
  await expect('outro time não pega a mesma cor na pelada', async () => q(`select choose_identity($1,null,'verde')`, [await team(2)]), true)
  await expect('capitão não muda o time dos outros', async () => q(`select choose_identity($1,null,'roxo')`, [await team(1)]), true)
  await expect('jogador do time diz "não vou" no dia: sai e vira vaga de diarista', async () => {
    await as(id('j7'))
    await q(`update presence set answer='nao_vou' where pelada_id=$1 and profile_id=$2`, [pel2, id('j7')])
    await as(null)
    const r = await one(`select m.is_out, s.is_slot from team_members m join team_members s on s.replaces_member_id = m.id where m.pelada_id=$1 and m.profile_id=$2`, [pel2, id('j7')])
    if (!r?.is_out || !r.is_slot) throw new Error(JSON.stringify(r))
    return 'vaga criada'
  })
  await expect('voltou a ir antes de preencherem a vaga: volta para o time', async () => {
    await as(id('adm'))
    await q(`update presence set answer='vou' where pelada_id=$1 and profile_id=$2`, [pel2, id('j7')])
    const r = await one(`select m.is_out, m.pick_number, (select count(*)::int from team_members s where s.replaces_member_id = m.id) vagas from team_members m where m.pelada_id=$1 and m.profile_id=$2`, [pel2, id('j7')])
    if (r.is_out || r.vagas || !r.pick_number) throw new Error(JSON.stringify(r))
    return 'de volta'
  })
  await expect('jogador não troca capitão', async () => { await as(id('j7')); return q(`select change_captain($1,$2)`, [await team(3), id('j7')]) }, true)
  await expect('capitão de outro time não vira capitão deste', async () => { await as(id('adm')); return q(`select change_captain($1,$2)`, [await team(3), id('j5')]) }, true)
  await expect('admin troca o capitão por outro do mesmo time, sem refazer a escolha', async () => {
    await as(id('adm'))
    const before = (await one(`select count(*)::int n from team_members where team_id=$1`, [await team(3)])).n
    await q(`select change_captain($1,$2)`, [await team(3), id('j7')])
    const r = await one(`select t.captain_id = $2 novo, (select is_captain from team_members where team_id=t.id and profile_id=$3) antigo, (select count(*)::int from team_members where team_id=t.id) membros from teams t where t.id=$1`, [await team(3), id('j7'), id('j3')])
    if (!r.novo || r.antigo || r.membros !== before) throw new Error(JSON.stringify(r))
    return 'trocado'
  })
  await expect('novo capitão escolhe kit e cor', async () => { await as(id('j7')); return q(`select choose_identity($1,null,'laranja')`, [await team(3)]) })
  await expect('"vou" com a pelada em andamento é recusado', async () => {
    await as(id('j9'))
    return q(`update presence set answer='vou' where pelada_id=$1 and profile_id=$2 returning 1`, [pel2, id('j9')]).then((r) => {
      if (!r.rowCount) throw new Error('sem linha')
    }).catch(async () => q(`insert into presence (pelada_id, profile_id, answer) values ($1,$2,'vou')`, [pel2, id('j9')]))
  }, true)
  await as(id('adm'))
  await expect('substituição integral por avulso', async () => {
    const m = await one(`select id from team_members where pelada_id=$1 and profile_id=$2`, [pel2, id('j5')])
    await q(`select replace_member($1, null, 'Zé Avulso')`, [m.id])
    const r = await one(`select count(*) filter (where is_out)::int fora, count(*) filter (where guest_id is not null)::int avulsos from team_members where pelada_id=$1`, [pel2])
    return JSON.stringify(r)
  })
  await expect('diarista que pagou para jogar entra no caixa', async () => {
    const m = await one(`select id from team_members where pelada_id = $1 and profile_id = $2 and not is_out`, [pel2, id('j6')])
    await q(`select replace_member($1, null, 'Primo do Zé', 25, $2)`, [m.id, id('adm')])
    return (await one(`select description, amount::text from cash_entries where category = 'diarista' and voided_at is null`)).description
  })
  await expect('sorteio de dia atípico substitui os times', async () => {
    await as(null)
    await q(`delete from games where pelada_id = $1`, [pel2])
    await as(id('adm'))
    await q(`select save_sorteio($1, $2)`, [pel2, JSON.stringify([[id('j1'), id('j2'), id('j3')], [id('j4'), id('j5'), id('j6')]])])
    return JSON.stringify(await one(`select count(*)::int times, (select count(*)::int from team_members where pelada_id=$1) jogadores from teams where pelada_id=$1`, [pel2]))
  })

  // diarista só quando falta mensalista (20 lugares)
  await as(null)
  const invite = (await one(`select code from invites where active`)).code
  for (let i = 1; i <= 8; i++) await mkUser('m' + i, { username: 'u_m' + i, name: 'Mensal ' + i, invite_code: invite })
  await q(`update app_settings set mensalista_quota = 20`)
  const pel3 = (await one(`insert into peladas (date, start_time, location, max_slots) values ('2026-10-25','08:00','Campo',20) returning id`)).id
  await q(`update profiles set status='ativo', type='mensalista' where username like 'u_m%' or username in ('u_dono','u_adm','u_j1','u_j2','u_j3','u_j4','u_j5','u_j6','u_j7','u_j8','u_j9','u_j10')`)
  await expect('com 20 mensalistas, diarista não é chamado antes de alguém dizer "não vou"', async () => {
    const n = (await one(`select count(*)::int n from profiles where status='ativo' and type='mensalista'`)).n
    if (n !== 20) throw new Error('mensalistas: ' + n)
    await as(id('adm'))
    return q(`insert into pelada_diaristas values ($1,$2)`, [pel3, id('dia')])
  }, true)
  await expect('mensalista disse "não vou": diarista pode ser chamado e escolhido', async () => {
    await as(id('j1'))
    await q(`insert into presence (pelada_id, profile_id, answer) values ($1,$2,'nao_vou')`, [pel3, id('j1')])
    await as(id('adm'))
    await q(`insert into pelada_diaristas values ($1,$2)`, [pel3, id('dia')])
    const r = await one(`select count(*)::int n from draft_available($1) where profile_id=$2`, [pel3, id('dia')])
    if (r.n !== 1) throw new Error('diarista não disponível')
    return 'liberado'
  })
  await expect('mensalista voltou a ir: diarista sai da lista de disponíveis', async () => {
    await as(id('adm'))
    await q(`update presence set answer='vou' where pelada_id=$1 and profile_id=$2`, [pel3, id('j1')])
    const r = await one(`select count(*)::int n from draft_available($1) where profile_id=$2`, [pel3, id('dia')])
    if (r.n) throw new Error('diarista ainda disponível')
    return 'fora'
  })

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
