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
const mkUser = (n, meta) => q(`insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at) values ($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2,$3,now(),now())`, [id(n), 'teste_' + n + '@aposentados.app', meta])
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
  await q(`insert into pelada_helpers values ($1,$2)`, [pel, id('j10')])
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
  await expect('jogador comum não encerra o jogo', () => q(`select finish_game($1)`, [game]), true)
  await as(id('j10'))
  await expect('outro ajudante registra junto (sem ser o responsável)', () => q(`insert into game_events (game_id, type, team_id, player_id, minute) values ($1,'amarelo',$2,$3,8)`, [game, t1, id('j1')]))
  await as(id('j5'))
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
    // os jogadores de teste viraram mensalistas hoje: o período passa a começar em setembro
    await q(`update mensalista_periods set started_on = '2026-09-01'`)
    await as(id('adm'))
    const r = await q(`select a.award, a.position, p.name from awards a join profiles p on p.id = a.profile_id where a.month = '2026-09-01' order by a.award, a.position, p.name`)
    return '\n' + r.rows.map((x) => `   ${x.award} ${x.position}o: ${x.name}`).join('\n')
  })
  await expect('quem vira diarista ou é desativado continua no pódio e nos troféus dos meses em que foi mensalista', async () => {
    await as(id('adm'))
    const before = (await one(`select count(*)::int n from awards where month = '2026-09-01' and profile_id in ($1, $2)`, [id('j2'), id('j3')])).n
    await q(`select set_player_type($1, 'diarista')`, [id('j2')])
    await q(`select set_player_active($1, false)`, [id('j3')])
    const r = await one(`select (select count(*)::int from podium where month = '2026-09-01' and profile_id in ($1, $2)) podio, (select count(*)::int from awards where month = '2026-09-01' and profile_id in ($1, $2)) trofeus`, [id('j2'), id('j3')])
    // um mês depois de deixar de ser mensalista, não entra mais
    await as(null)
    await q(`update mensalista_periods set ended_on = '2026-09-30' where profile_id = $1`, [id('j2')])
    const later = (await one(`select public.was_mensalista($1, '2026-10-01') m`, [id('j2')])).m
    await q(`update mensalista_periods set ended_on = current_date where profile_id = $1`, [id('j2')])
    await as(id('adm'))
    await q(`select set_player_active($1, true)`, [id('j3')])
    await q(`select set_player_type($1, 'mensalista')`, [id('j2')])
    if (r.podio !== 2 || r.trofeus !== before || !before || later) throw new Error(JSON.stringify({ ...r, before, later }))
    return `pódio: ${r.podio}, troféus: ${r.trofeus} de ${before}`
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
  const pel2 = (await one(`insert into peladas (date, start_time, location, max_slots) values (current_date + 21,'08:00','Campo',20) returning id`)).id
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
  await expect('admin também respeita a vez (não escolhe jogador pelo capitão)', async () => { await as(id('adm')); return q(`select draft_pick($1,$2)`, [pel2, id('j10')]) }, true)
  await expect('admin não mexe em kit e cor durante a escolha', async () => { await as(id('adm')); return q(`select choose_identity($1,null,'cinza')`, [await team(2)]) }, true)
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
    await q(`update peladas set date = current_date + 21 where id=$1`, [pel2])
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
  await expect('time que já tem kit e cor não muda depois da escolha', async () => { await as(id('j1')); return q(`select choose_identity($1,null,'cinza')`, [await team(1)]) }, true)
  await expect('sem kit depois da véspera: fica o padrão', async () => {
    await as(null)
    await q(`update peladas set date = current_date where id=$1`, [pel2])
    await as(id('j2'))
    return q(`select choose_identity($1,null,'cinza')`, [await team(2)])
  }, true)
  await expect('admin ajusta kit e cor depois da escolha', async () => { await as(id('adm')); return q(`select choose_identity($1,null,'cinza')`, [await team(4)]) })
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
  await expect('admin marca que um jogador do time não vai (faltou sem avisar) e depois desfaz', async () => {
    await as(id('adm'))
    await q(`insert into presence (pelada_id, profile_id, answer) values ($1,$2,'nao_vou') on conflict (pelada_id, profile_id) do update set answer='nao_vou'`, [pel2, id('j8')])
    const out = await one(`select is_out from team_members where pelada_id=$1 and profile_id=$2`, [pel2, id('j8')])
    await q(`update presence set answer='vou' where pelada_id=$1 and profile_id=$2`, [pel2, id('j8')])
    const back = await one(`select is_out from team_members where pelada_id=$1 and profile_id=$2`, [pel2, id('j8')])
    if (!out.is_out || back.is_out) throw new Error(JSON.stringify({ out, back }))
    return 'vaga criada e desfeita'
  })
  await expect('jogador não marca presença por outro', async () => {
    await as(id('j9'))
    return q(`insert into presence (pelada_id, profile_id, answer) values ($1,$2,'nao_vou') on conflict (pelada_id, profile_id) do update set answer='nao_vou'`, [pel2, id('j8')])
  }, true)
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

  // corrigir e desfazer (faltou, editar times, excluir, reabrir)
  await as(id('adm'))
  const pel4 = (await one(`insert into peladas (date, start_time, location, max_slots) values ('2026-11-01','08:00','Campo',20) returning id`)).id
  await q(`select save_sorteio($1, $2)`, [pel4, JSON.stringify([[id('j1'), id('j2'), id('j3')], [id('j4'), id('j5'), id('j6')]])])
  const [ta, tb] = (await q(`select id from teams where pelada_id=$1 order by captain_order`, [pel4])).rows.map((r) => r.id)
  const g4 = (await one(`select set_next_game($1,$2,$3) id`, [pel4, ta, tb])).id
  await q(`select start_game($1)`, [g4])
  await q(`insert into game_events (game_id, type, team_id, player_id, sub_in_id, minute) values ($1,'substituicao',$2,$3,$4,0)`, [g4, ta, id('j3'), id('j7')])
  await q(`insert into game_events (game_id, type, team_id, player_id, minute) values ($1,'gol',$2,$3,2)`, [g4, ta, id('j1')])
  await q(`select finish_game($1)`, [g4])
  const g4b = (await one(`select set_next_game($1,$2,$3) id`, [pel4, ta, tb])).id
  await q(`select start_game($1)`, [g4b])
  await expect('ajudante tira do jogo ao vivo quem foi emprestado por engano', async () => {
    await q(`insert into pelada_helpers values ($1,$2)`, [pel4, id('j10')])
    await q(`select lend_player($1,$2,$3,null)`, [g4b, tb, id('j8')])
    await as(id('j10'))
    await q(`select remove_from_game($1,$2,null)`, [g4b, id('j8')])
    const r = await one(`select count(*)::int n from game_lineup where game_id=$1 and profile_id=$2`, [g4b, id('j8')])
    if (r.n) throw new Error('continua em campo')
    return 'fora do jogo'
  })
  await as(id('adm'))
  await q(`select finish_game($1)`, [g4b])
  await q(`select close_pelada($1)`, [pel4])
  const nov = async (n) => (await one(`select games, wins from player_month_stats where month='2026-11-01' and profile_id=$1`, [id(n)])) ?? { games: 0, wins: 0 }
  await expect('quem saiu no minuto 0 ainda conta jogo e vitória (antes do "Faltou")', async () => {
    const r = await nov('j3')
    if (r.games !== 2 || r.wins !== 1) throw new Error(JSON.stringify(r))
    return JSON.stringify(r)
  })
  await as(id('j5'))
  await expect('jogador não marca falta de ninguém', () => q(`select mark_absent($1,$2,null)`, [pel4, id('j3')]), true)
  await as(id('adm'))
  await expect('"Faltou" recusa quem tem gol na pelada', () => q(`select mark_absent($1,$2,null)`, [pel4, id('j1')]), true)
  await expect('"Faltou" com a pelada encerrada: sai dos jogos e do time, sem vaga', async () => {
    await q(`select mark_absent($1,$2,null)`, [pel4, id('j3')])
    const s = await nov('j3')
    const j7 = await nov('j7')
    const m = await one(`select is_out, (select count(*)::int from team_members where pelada_id=$1 and is_slot) vagas, (select count(*)::int from game_events where game_id=$3 and type='substituicao') subs from team_members where pelada_id=$1 and profile_id=$2`, [pel4, id('j3'), g4])
    if (s.games || !m.is_out || m.vagas || m.subs || j7.games !== 1) throw new Error(JSON.stringify({ s, m, j7 }))
    return 'j3: 0 jogos; j7 (entrou no lugar) continua com o jogo'
  })
  await expect('time: não põe de volta quem saiu por outro caminho', () => q(`select add_member($1,$2,null)`, [tb, id('j3')]), true)
  await as(id('j5'))
  await expect('jogador não edita times', () => q(`select vacate_member(id) from team_members where pelada_id=$1 and profile_id=$2`, [pel4, id('j2')]), true)
  await as(id('adm'))
  await expect('admin troca quem está na posição (com conta -> avulso)', async () => {
    const m = await one(`select id from team_members where pelada_id=$1 and profile_id=$2`, [pel4, id('j2')])
    await q(`select swap_member($1,null,'Avulso Certo')`, [m.id])
    const r = await one(`select g.name from team_members tm join guests g on g.id=tm.guest_id where tm.id=$1`, [m.id])
    return r.name
  })
  await expect('tirar do time vira vaga; vaga pode ser excluída e criada', async () => {
    const m = await one(`select id from team_members where pelada_id=$1 and profile_id=$2`, [pel4, id('j5')])
    await q(`select vacate_member($1)`, [m.id])
    const slot = await one(`select is_slot from team_members where id=$1`, [m.id])
    await q(`select delete_slot($1)`, [m.id])
    await q(`select add_slot($1)`, [tb])
    const n = (await one(`select count(*)::int n from team_members where team_id=$1 and is_slot`, [tb])).n
    if (!slot.is_slot || n !== 1) throw new Error(JSON.stringify({ slot, n }))
    return '1 vaga'
  })
  await expect('admin coloca alguém e muda de time', async () => {
    await q(`select add_member($1,$2,null)`, [tb, id('j9')])
    const m = await one(`select id from team_members where pelada_id=$1 and profile_id=$2`, [pel4, id('j9')])
    await q(`select move_member($1,$2)`, [m.id, ta])
    return (await one(`select team_id = $2 ok from team_members where id=$1`, [m.id, ta])).ok ? 'mudou' : 'não mudou'
  })
  await expect('desfazer saída: volta ao time e consta como "vai"', async () => {
    const m = await one(`select id from team_members where pelada_id=$1 and profile_id=$2`, [pel4, id('j3')])
    await q(`select restore_member($1)`, [m.id])
    const r = await one(`select tm.is_out, p.answer from team_members tm join presence p on p.pelada_id=tm.pelada_id and p.profile_id=tm.profile_id where tm.id=$1`, [m.id])
    if (r.is_out || r.answer !== 'vou') throw new Error(JSON.stringify(r))
    return 'de volta'
  })
  await expect('desfazer saída segue a corrente (vaga preenchida e depois trocada)', async () => {
    const pel6 = (await one(`insert into peladas (date, start_time, location, max_slots) values ('2026-11-08','08:00','Campo',20) returning id`)).id
    await q(`select save_sorteio($1, $2)`, [pel6, JSON.stringify([[id('j1'), id('j2')], [id('j4'), id('j5')]])])
    await q(`insert into presence (pelada_id, profile_id, answer) values ($1,$2,'nao_vou')`, [pel6, id('j2')])
    const slot = await one(`select id from team_members where pelada_id=$1 and is_slot`, [pel6])
    await q(`select fill_slot($1,null,'André')`, [slot.id])
    await q(`select replace_member($1,null,'Diarista')`, [slot.id])
    const kim = await one(`select id, team_id from team_members where pelada_id=$1 and profile_id=$2`, [pel6, id('j2')])
    await q(`select restore_member($1)`, [kim.id])
    const r = await one(`select count(*)::int n, count(*) filter (where profile_id = $2 and not is_out)::int volta from team_members where team_id=$1`, [kim.team_id, id('j2')])
    if (r.n !== 2 || r.volta !== 1) throw new Error(JSON.stringify(r))
    return 'time volta a ter 2 (sem André nem "Diarista")'
  })

  await expect('admin não reabre pelada encerrada (só o dono)', () => q(`select reopen_pelada($1)`, [pel4]), true)
  await as(id('dono'))
  await expect('dono reabre a pelada: os números saem do mês até encerrar de novo', async () => {
    await q(`select reopen_pelada($1)`, [pel4])
    const r = await nov('j1')
    await q(`select close_pelada($1)`, [pel4])
    const back = await nov('j1')
    if (r.games || back.games !== 2) throw new Error(JSON.stringify({ r, back }))
    return 'saiu e voltou'
  })
  await expect('excluir jogo exige digitar "aposentados fc"', () => q(`select delete_game($1, 'aposentados')`, [g4]), true)
  await as(id('adm'))
  await expect('admin não exclui jogo (só o dono)', () => q(`select delete_game($1, 'aposentados fc')`, [g4]), true)
  await as(id('dono'))
  await expect('dono exclui o jogo 1 e o jogo 2 vira jogo 1', async () => {
    await q(`select delete_game($1, '  Aposentados   FC ')`, [g4])
    const r = await q(`select number from games where pelada_id=$1`, [pel4])
    if (r.rows.length !== 1 || r.rows[0].number !== 1) throw new Error(JSON.stringify(r.rows))
    return 'renumerado'
  })
  await expect('dono exclui a pelada e o dinheiro de diarista dela é estornado', async () => {
    const slot = await one(`select id from team_members where pelada_id=$1 and is_slot limit 1`, [pel4])
    await q(`select fill_slot($1,null,'Pagante',15,$2)`, [slot.id, id('dono')])
    await q(`select delete_pelada($1, 'aposentados fc')`, [pel4])
    const r = await one(`select (select count(*)::int from peladas where id=$1) peladas, (select void_reason from cash_entries where payer_name='Pagante') motivo`, [pel4])
    if (r.peladas || r.motivo !== 'Pelada excluída') throw new Error(JSON.stringify(r))
    return 'excluída, estorno com motivo'
  })

  await as(id('adm'))
  const pel5 = (await one(`insert into peladas (date, start_time, location, max_slots) values ('2026-12-06','08:00','Campo',20) returning id`)).id
  await q(`select define_captains($1, $2)`, [pel5, [id('j1'), id('j2'), id('j3'), id('j4')]])
  await expect('nada para desfazer antes da 1ª escolha', () => q(`select draft_undo($1)`, [pel5]), true)
  await expect('admin desfaz a última escolha e a vez volta para o capitão', async () => {
    await as(id('j1'))
    await q(`select draft_pick($1,$2)`, [pel5, id('j5')])
    await expect_fail(() => q(`select draft_undo($1)`, [pel5]))
    await as(id('adm'))
    await q(`select draft_undo($1)`, [pel5])
    const r = await one(`select next_pick, (select count(*)::int from team_members where pelada_id=$1 and profile_id=$2) j5 from drafts where pelada_id=$1`, [pel5, id('j5')])
    if (r.next_pick !== 1 || r.j5) throw new Error(JSON.stringify(r))
    await as(id('j1'))
    await q(`select draft_pick($1,$2)`, [pel5, id('j6')])
    return 'capitão 1 escolheu de novo'
  })
  await as(id('adm'))
  await expect('times não se editam durante a escolha', () => q(`select add_slot(id) from teams where pelada_id=$1 limit 1`, [pel5]), true)
  await expect('pelada cancelada por engano volta a ser agendada', async () => {
    await q(`update peladas set status='cancelada' where id=$1`, [pel5])
    await q(`select reopen_pelada($1)`, [pel5])
    return (await one(`select status from peladas where id=$1`, [pel5])).status
  })

  await expect('admin desativa e reativa um jogador', async () => {
    await q(`select set_player_active($1, false)`, [id('j10')])
    const off = (await one(`select status from profiles where id=$1`, [id('j10')])).status
    await q(`select set_player_active($1, true)`, [id('j10')])
    return `${off} -> ${(await one(`select status from profiles where id=$1`, [id('j10')])).status}`
  })
  await expect('admin não desativa o dono', () => q(`select set_player_active($1, false)`, [id('dono')]), true)
  await expect('admin corrige o nome de um jogador', async () => {
    await q(`select admin_rename($1, '  Nome Certo ')`, [id('j10')])
    return (await one(`select name from profiles where id=$1`, [id('j10')])).name
  })
  await expect('jogador não muda nome de outro pela função', async () => { await as(id('j5')); return q(`select admin_rename($1, 'Hack')`, [id('j10')]) }, true)
  await expect('cadastro recusado por engano pode ser aprovado', async () => {
    await as(null)
    await mkUser('rec', { username: 'u_rec', name: 'Recusado', invite_code: invite })
    await as(id('adm'))
    await q(`select review_signup($1, false)`, [id('rec')])
    await q(`select review_signup($1, true)`, [id('rec')])
    return (await one(`select status from profiles where id=$1`, [id('rec')])).status
  })

  await expect('jogador desfaz o "Já paguei" tocado sem querer', async () => {
    await as(id('adm'))
    const ct = (await one(`select create_cotinha('Bola', 30, null) id`)).id
    await as(id('j5'))
    await q(`select inform_payment($1)`, [ct])
    await q(`select uninform_payment($1)`, [ct])
    return (await one(`select status from payments where charge_id=$1 and profile_id=$2`, [ct, id('j5')])).status
  })
  await expect('cotinha: valor muda até alguém pagar; com pagamento, não exclui', async () => {
    await as(id('adm'))
    const ct = (await one(`select id from charges where title='Bola'`)).id
    await q(`select update_charge($1,'Bola nova',35,null)`, [ct])
    await q(`select confirm_payment($1,$2)`, [ct, id('j5')])
    await expect_fail(() => q(`select update_charge($1,'Bola nova',40,null)`, [ct]))
    await expect_fail(() => q(`select delete_charge($1)`, [ct]))
    await q(`select unconfirm_payment($1,$2)`, [ct, id('j5')])
    await q(`select delete_charge($1)`, [ct])
    return (await one(`select count(*)::int n from charges where id=$1`, [ct])).n ? 'ainda existe' : 'excluída'
  })
  await expect('mensalidade do mês atual não se exclui', async () => {
    await as(id('adm'))
    const fee = (await one(`select id from charges where kind='mensalidade' and month=current_month()`)).id
    return q(`select delete_charge($1)`, [fee])
  }, true)

  // goleiro: "dia" é só goleiro (diarista); j3 e j7 são mensalistas e também goleiros (j3 joga num dos times)
  await as(id('j5'))
  await expect('jogador não marca goleiro', () => q(`select set_goalkeeper($1, 'so_goleiro')`, [id('dia')]), true)
  await as(id('adm'))
  await expect('admin marca diarista como só goleiro', () => q(`select set_goalkeeper($1, 'so_goleiro')`, [id('dia')]))
  await expect('mensalista não pode ser só goleiro', () => q(`select set_goalkeeper($1, 'so_goleiro')`, [id('j1')]), true)
  await expect('mensalista pode ser também goleiro', async () => {
    await q(`select set_goalkeeper($1, 'tambem')`, [id('j3')])
    await q(`select set_goalkeeper($1, 'tambem')`, [id('j7')])
  })
  await expect('só goleiro não vira mensalista', () => q(`select set_player_type($1, 'mensalista')`, [id('dia')]), true)
  const pg = (await one(`insert into peladas (date, start_time, location, max_slots) values ('2026-10-04','08:00','Campo',20) returning id`)).id
  await expect('só goleiro não é chamado como diarista', () => q(`insert into pelada_diaristas values ($1,$2)`, [pg, id('dia')]), true)
  await as(id('dia'))
  await expect('só goleiro confirma presença', () => q(`insert into presence (pelada_id, profile_id, answer) values ($1,$2,'vou')`, [pg, id('dia')]))
  await expect('só goleiro não ocupa vaga na lista de presença', async () => {
    const r = await one(`select count(*)::int n from presence_list where pelada_id = $1`, [pg])
    if (r.n) throw new Error(`${r.n} na lista`)
    return 'fora da contagem'
  })
  await as(id('adm'))
  const tga = (await one(`insert into teams (pelada_id, captain_order, captain_id, color) values ($1,1,$2,'azul') returning id`, [pg, id('j1')])).id
  const tgb = (await one(`insert into teams (pelada_id, captain_order, captain_id, color) values ($1,2,$2,'vermelho') returning id`, [pg, id('j2')])).id
  for (const [n, t] of [['j1', tga], ['j3', tga], ['j5', tga], ['j2', tgb], ['j4', tgb]]) await q(`insert into team_members (pelada_id, team_id, profile_id) values ($1,$2,$3)`, [pg, t, id(n)])
  await q(`insert into presence (pelada_id, profile_id, answer) values ($1,$2,'vou')`, [pg, id('j7')])
  const gg = (await one(`insert into games (pelada_id, number, team1_id, team2_id) values ($1,1,$2,$3) returning id`, [pg, tga, tgb])).id
  await expect('admin põe o só goleiro no gol do time B', () => q(`select set_keeper($1,$2,$3)`, [gg, tgb, id('dia')]))
  await expect('quem está num dos times do jogo não agarra (j3 joga no time A)', () => q(`select set_keeper($1,$2,$3)`, [gg, tga, id('j3')]), true)
  await expect('j7 (também goleiro, time dele fora deste jogo) agarra pelo time A', () => q(`select set_keeper($1,$2,$3)`, [gg, tga, id('j7')]))
  await expect('quem não é goleiro não vai para o gol', () => q(`select set_keeper($1,$2,$3)`, [gg, tgb, id('j4')]), true)
  await expect('o mesmo goleiro não agarra pelos dois times', () => q(`select set_keeper($1,$2,$3)`, [gg, tga, id('dia')]), true)
  await as(id('j5'))
  await expect('jogador comum não define goleiro', () => q(`select set_keeper($1,$2,null,true)`, [gg, tga]), true)
  await as(id('adm'))
  await q(`select start_game($1)`, [gg])
  await as(null)
  await q(`update games set started_at = now() - interval '5 minutes' where id = $1`, [gg])
  await as(id('adm'))
  const ev = (type, team, player, minute, assist = null) =>
    q(`insert into game_events (game_id, type, team_id, player_id, assist_id, minute) values ($1,$2,$3,$4,$5,$6)`, [gg, type, team, player, assist, minute])
  await expect('goleiro faz defesa difícil', () => ev('defesa_dificil', tgb, id('dia'), 1))
  await expect('defesa difícil de quem não é o goleiro é recusada', () => ev('defesa_dificil', tgb, id('j4'), 1), true)
  await expect('gols sofridos e assistência do goleiro', async () => {
    await ev('gol', tga, id('j1'), 2)
    await ev('gol', tga, id('j1'), 3, id('j7'))
    await ev('gol', tgb, id('j2'), 4, id('dia'))
    return 'A 2 x 1 B'
  })
  await expect('troca no meio do jogo: goleiro avulso entra no minuto 5', () => q(`select set_keeper($1,$2,null,true)`, [gg, tgb]))
  await expect('gol depois da troca não conta para o goleiro que saiu', async () => {
    await ev('gol', tga, id('j5'), 6)
    await q(`select finish_game($1)`, [gg])
    await q(`select close_pelada($1)`, [pg])
    const r = await one(`select games, wins, conceded, assists, saves from goalkeeper_month_stats where profile_id = $1 and month = '2026-10-01'`, [id('dia')])
    if (JSON.stringify(r) !== JSON.stringify({ games: 1, wins: 0, conceded: 2, assists: 1, saves: 1 })) throw new Error(JSON.stringify(r))
    return JSON.stringify(r)
  })
  await expect('j7 agarrou: vitória, gol sofrido e assistência* contam como goleiro', async () => {
    const r = await one(`select games, wins, conceded, assists, saves from goalkeeper_month_stats where profile_id = $1`, [id('j7')])
    if (JSON.stringify(r) !== JSON.stringify({ games: 1, wins: 1, conceded: 1, assists: 1, saves: 0 })) throw new Error(JSON.stringify(r))
    return JSON.stringify(r)
  })
  await expect('o jogo em que j7 agarrou não conta como jogo de linha nem a assistência', async () => {
    const r = await one(`select coalesce(sum(games),0)::int games, coalesce(sum(assists),0)::int assists from player_month_stats where profile_id = $1 and month = '2026-10-01'`, [id('j7')])
    if (r.games || r.assists) throw new Error(JSON.stringify(r))
    return JSON.stringify(r)
  })
  await as(id('j1'))
  await expect('mensalista dá nota de goleiro', () => q(`insert into goalkeeper_ratings (rater_id, rated_id, hands, feet, reach, jump, overall) values ($1,$2,4,3,5,4,4)`, [id('j1'), id('dia')]))
  await expect('nota de goleiro só para goleiros', () => q(`insert into goalkeeper_ratings (rater_id, rated_id, hands, feet, reach, jump, overall) values ($1,$2,4,3,5,4,4)`, [id('j1'), id('j2')]), true)
  await as(id('dia'))
  await expect('só goleiro (diarista) não avalia', () => q(`insert into goalkeeper_ratings (rater_id, rated_id, hands, feet, reach, jump, overall) values ($1,$2,4,3,5,4,4)`, [id('dia'), id('j3')]), true)

  // estratégia (gramadinho): time E1 = j1 (capitão), j3, j5; time E2 = j2 (capitão), j4
  // as notificações vão para uma tabela temporária (desfeita no fim) para conferir quem receberia
  await as(null)
  await q(`create temp table pushes (to_ids uuid[], title text)`)
  await q(`grant all on pg_temp.pushes to authenticated`)
  await q(`create or replace function private.push(p_to uuid[], p_title text, p_body text, p_url text default '/') returns void
           language sql security definer as $$ insert into pg_temp.pushes values (p_to, p_title) $$`)
  const pushedTo = async (title) => (await q(`select unnest(to_ids) id from pg_temp.pushes where title = $1`, [title])).rows.map((r) => r.id)
  await as(id('adm'))
  const pe = (await one(`insert into peladas (date, start_time, location, max_slots) values (current_date + 35,'08:00','Campo',20) returning id`)).id
  const te1 = (await one(`insert into teams (pelada_id, captain_order, captain_id, color) values ($1,1,$2,'azul') returning id`, [pe, id('j1')])).id
  const te2 = (await one(`insert into teams (pelada_id, captain_order, captain_id, color) values ($1,2,$2,'vermelho') returning id`, [pe, id('j2')])).id
  const mem = {}
  for (const [n, t] of [['j1', te1], ['j3', te1], ['j5', te1], ['j2', te2], ['j4', te2]])
    mem[n] = (await one(`insert into team_members (pelada_id, team_id, profile_id, is_captain) values ($1,$2,$3,$4) returning id`, [pe, t, id(n), n === 'j1' || n === 'j2'])).id
  const save = (team, slots, instr = []) => q(`select save_tactic($1,'2-1-2',$2,$3)`, [team, slots, instr])
  await as(id('j1'))
  await expect('capitão monta a estratégia', () => save(te1, [mem.j1, mem.j3, null, null, null], ['Marcar a saída', '  ', 'Tocar rápido']))
  await expect('instruções vazias somem', async () => JSON.stringify((await one(`select instructions from team_tactics where team_id=$1`, [te1])).instructions))
  await expect('o time (menos o capitão) é avisado da estratégia', async () => {
    const to = await pushedTo('Estratégia do time')
    if (to.length !== 2 || !to.includes(id('j3')) || !to.includes(id('j5'))) throw new Error(JSON.stringify(to))
    return 'j3 e j5'
  })
  await expect('jogador de outro time não entra no gramado', () => save(te1, [mem.j1, mem.j2, null, null, null]), true)
  await expect('mesmo jogador em duas posições é recusado', () => save(te1, [mem.j1, mem.j1, null, null, null]), true)
  await expect('no máximo 5 instruções', () => save(te1, [mem.j1, null, null, null, null], ['a', 'b', 'c', 'd', 'e', 'f']), true)
  await expect('instrução com mais de 80 caracteres é recusada', () => save(te1, [mem.j1, null, null, null, null], ['x'.repeat(81)]), true)
  await as(id('j3'))
  await expect('jogador do time não edita a estratégia', () => save(te1, [mem.j3, null, null, null, null]), true)
  await expect('jogador do time vê a estratégia', async () => (await one(`select count(*)::int n from team_tactics where team_id=$1`, [te1])).n + ' estratégia')
  await expect('jogador confirma que entendeu', () => q(`select ack_tactic($1)`, [te1]))
  await as(id('j2'))
  await expect('outro time não vê a estratégia', async () => {
    const r = await one(`select count(*)::int n from team_tactics where team_id=$1`, [te1])
    if (r.n) throw new Error('viu')
    return 'escondida'
  })
  await expect('capitão de outro time não mexe', () => save(te1, [mem.j1, null, null, null, null]), true)
  await expect('outro time não confirma a estratégia', () => q(`select ack_tactic($1)`, [te1]), true)
  await as(id('j5'))
  await expect('jogador pede para trocar de posição com um colega', () => q(`select request_swap($1,$2)`, [te1, mem.j3]))
  await expect('não pede troca com alguém de outro time', () => q(`select request_swap($1,$2)`, [te1, mem.j4]), true)
  await expect('capitão é avisado do pedido de troca', async () => {
    const to = await pushedTo('Pedido de troca de posição')
    if (to.length !== 1 || to[0] !== id('j1')) throw new Error(JSON.stringify(to))
    return 'j1'
  })
  await as(id('j3'))
  await expect('só o capitão aceita a troca', async () => q(`select answer_swap($1,true)`, [(await one(`select id from tactic_swaps where team_id=$1 and status='pendente'`, [te1])).id]), true)
  await as(id('j1'))
  await expect('capitão aceita: j5 fica na posição de j3', async () => {
    await q(`select answer_swap($1,true)`, [(await one(`select id from tactic_swaps where team_id=$1 and status='pendente'`, [te1])).id])
    const s = (await one(`select slots from team_tactics where team_id=$1`, [te1])).slots.map(Number)
    if (s[1] !== Number(mem.j5) || s.includes(Number(mem.j3))) throw new Error(JSON.stringify(s))
    return 'trocado'
  })
  await expect('quem pediu é avisado que a troca foi aceita', async () => {
    const to = await pushedTo('Troca aceita')
    if (to.length !== 1 || to[0] !== id('j5')) throw new Error(JSON.stringify(to))
    return 'j5'
  })
  await expect('pelada encerrada: a estratégia some', async () => {
    await as(id('adm'))
    await q(`select close_pelada($1)`, [pe])
    await as(null)
    const r = await one(`select count(*)::int n from team_tactics where team_id in ($1,$2)`, [te1, te2])
    if (r.n) throw new Error(`${r.n} ainda existem`)
    return 'apagada'
  })

  // capitães invertidos: capitães j1..j4; os outros mensalistas escolhem o time
  await as(id('adm'))
  const pi = (await one(`insert into peladas (date, start_time, location, max_slots) values (current_date + 42,'08:00','Campo',20) returning id`)).id
  await expect('admin define capitães no modo invertido', () => q(`select define_captains_inverted($1,$2)`, [pi, [id('j1'), id('j2'), id('j3'), id('j4')]]))
  const ti = async (order) => (await one(`select id from teams where pelada_id=$1 and captain_order=$2`, [pi, order])).id
  const avail = (await q(`select a.profile_id from draft_available($1) a join profiles p on p.id = a.profile_id where p.type='mensalista' order by p.username`, [pi])).rows.map((r) => r.profile_id)
  await expect('mensalistas disponíveis são avisados para escolher o time', async () => {
    const to = await pushedTo('Escolha o seu time!')
    if (to.length !== avail.length) throw new Error(`${to.length} avisados de ${avail.length}`)
    return `${to.length} avisados`
  })
  const choose = async (who, order) => { await as(who); return q(`select invert_choose($1)`, [await ti(order)]) }
  await expect('6 mensalistas escolhem o time 1 e 1 escolhe o time 2', async () => {
    for (const who of avail.slice(0, 6)) await choose(who, 1)
    await choose(avail[6], 2)
    return `${avail.length} disponíveis`
  })
  await expect('capitão é avisado quando o time passa de 4', async () => {
    const to = await pushedTo('Seu time tem mais de 4 querendo jogar')
    if (to.length !== 1 || to[0] !== id('j1')) throw new Error(JSON.stringify(to))
    return 'j1'
  })
  await expect('capitão não escolhe jogador no modo invertido', async () => { await as(id('j1')); return q(`select draft_pick($1,$2)`, [pi, avail[7]]) }, true)
  await expect('capitão de outro time não corta', async () => { await as(id('j2')); return q(`select invert_cut($1,$2)`, [pi, avail[0]]) }, true)
  await expect('capitão corta dois e o time fica com 4', async () => {
    await as(id('j1'))
    await q(`select invert_cut($1,$2)`, [pi, avail[0]])
    await q(`select invert_cut($1,$2)`, [pi, avail[1]])
    return (await one(`select count(*)::int n from invert_choices where team_id=$1`, [await ti(1)])).n + ' no time 1'
  })
  await expect('com 4, o capitão não corta mais', async () => { await as(id('j1')); return q(`select invert_cut($1,$2)`, [pi, avail[2]]) }, true)
  await expect('quem foi cortado é avisado', async () => {
    const to = await pushedTo('Você ficou fora do time')
    if (!to.includes(avail[0]) || !to.includes(avail[1])) throw new Error(JSON.stringify(to))
    return '2 avisados'
  })
  await expect('cortado não volta para o mesmo time', () => choose(avail[0], 1), true)
  await expect('cortado escolhe outro time', () => choose(avail[0], 3))
  await expect('capitão escolhe kit e cor sem esperar vez', async () => { await as(id('j3')); return q(`select choose_identity($1,null,'laranja')`, [await ti(3)]) })
  await expect('fim das 24 h: times fechados com 5, sobra vai para onde falta', async () => {
    await as(null)
    await q(`update drafts set free_until = now() - interval '1 minute' where pelada_id=$1`, [pi])
    await q(`select draft_tick()`)
    const d = await one(`select phase from drafts where pelada_id=$1`, [pi])
    const sizes = (await q(`select count(*)::int n from team_members where pelada_id=$1 and not is_out group by team_id order by team_id`, [pi])).rows.map((r) => r.n)
    const t1 = (await q(`select profile_id from team_members where team_id=$1 and not is_captain`, [await ti(1)])).rows.map((r) => r.profile_id)
    const cutPlaced = await one(`select team_id from team_members where pelada_id=$1 and profile_id=$2`, [pi, avail[1]])
    if (d.phase !== 'concluida' || sizes.some((n) => n !== 5)) throw new Error(`fase=${d.phase} tamanhos=${sizes}`)
    if (!avail.slice(2, 6).every((p) => t1.includes(p))) throw new Error('escolhas do time 1 não entraram')
    if (cutPlaced && Number(cutPlaced.team_id) === Number(await ti(1))) throw new Error('cortado voltou para o time 1')
    const slots = (await one(`select count(*)::int n from team_members where pelada_id=$1 and is_slot`, [pi])).n
    return `tamanhos ${sizes.join(',')}, ${slots} vaga(s) de diarista`
  })

  // bilhete dourado com sorteio: j5 escolhe 4 e o app sorteia o resto
  await as(id('adm'))
  const pgd = (await one(`insert into peladas (date, start_time, location, max_slots) values (current_date + 49,'08:00','Campo',20) returning id`)).id
  await expect('admin dá o bilhete dourado a j5 (resto por sorteio)', () => q(`select define_golden($1,$2,'sorteio')`, [pgd, id('j5')]))
  await expect('dono do bilhete é avisado', async () => ((await pushedTo('Bilhete dourado!')).includes(id('j5')) ? 'j5' : Promise.reject(new Error('sem aviso'))))
  const goldPool = (await q(`select a.profile_id from draft_available($1) a order by 1`, [pgd])).rows.map((r) => r.profile_id)
  await expect('outro jogador não escolhe pelo dono do bilhete', async () => { await as(id('j6')); return q(`select draft_pick($1,$2)`, [pgd, goldPool[0]]) }, true)
  await expect('dono do bilhete escolhe os 4 e os outros times saem no sorteio', async () => {
    await as(id('j5'))
    for (const p of goldPool.slice(0, 4)) await q(`select draft_pick($1,$2)`, [pgd, p])
    const d = await one(`select phase from drafts where pelada_id=$1`, [pgd])
    const sizes = (await q(`select count(*)::int n from team_members where pelada_id=$1 and not is_out group by team_id order by team_id`, [pgd])).rows.map((r) => r.n)
    const mine = (await q(`select profile_id from team_members m join teams t on t.id = m.team_id where m.pelada_id=$1 and t.captain_order=1`, [pgd])).rows.map((r) => r.profile_id)
    if (d.phase !== 'concluida' || sizes.some((n) => n !== 5)) throw new Error(`fase=${d.phase} tamanhos=${sizes}`)
    if (!goldPool.slice(0, 4).every((p) => mine.includes(p))) throw new Error('escolhas do bilhete fora do time 1')
    return `tamanhos ${sizes.join(',')}`
  })

  // bilhete dourado com capitães: sorteado; capitães j1, j2, j3 escolhem na ordem 2-3-4 · 4-2-3
  await as(id('adm'))
  const pgc = (await one(`insert into peladas (date, start_time, location, max_slots) values (current_date + 56,'08:00','Campo',20) returning id`)).id
  await expect('capitães do resto precisam ser 3', () => q(`select define_golden($1,null,'capitaes',$2)`, [pgc, [id('j1'), id('j2')]]), true)
  let golden
  await expect('bilhete dourado sorteado (resto com 3 capitães)', async () => {
    golden = (await one(`select define_golden($1,null,'capitaes',$2) g`, [pgc, [id('j1'), id('j2'), id('j3')]])).g
    if ([id('j1'), id('j2'), id('j3')].includes(golden)) throw new Error('capitão ganhou o bilhete')
    return 'sorteado'
  })
  await expect('capitão espera o dono do bilhete', async () => {
    await as(id('j1'))
    return q(`select draft_pick($1,(select profile_id from draft_available($1) limit 1))`, [pgc])
  }, true)
  await expect('depois das 4 do bilhete, a vez é do capitão do time 2, depois 3, 4, 4, 2', async () => {
    await as(golden)
    for (let i = 0; i < 4; i++) await q(`select draft_pick($1,(select profile_id from draft_available($1) limit 1))`, [pgc])
    const order = []
    for (const cap of ['j1', 'j2', 'j3', 'j3', 'j1']) {
      await as(id(cap))
      await q(`select draft_pick($1,(select profile_id from draft_available($1) limit 1))`, [pgc])
      order.push(cap)
    }
    const n = (await one(`select next_pick from drafts where pelada_id=$1`, [pgc])).next_pick
    if (n !== 10) throw new Error('próxima escolha ' + n)
    return order.join(' ')
  })

  // rodízio: 12 chegam (11 com conta + 1 avulso), 5 contra 5, quem ganha fica
  await as(id('adm'))
  const pr = (await one(`insert into peladas (date, start_time, location, max_slots, format) values (current_date + 63,'08:00','Campo',30,'rodizio') returning id`)).id
  const rod = ['j1', 'j2', 'j3', 'j4', 'j5', 'j6', 'j7', 'j8', 'j9', 'j10', 'dia']
  await as(id('j5'))
  await expect('jogador comum não marca chegada', () => q(`select rodizio_arrive($1,$2)`, [pr, id('j5')]), true)
  await as(id('adm'))
  await expect('admin marca quem chegou (com conta e avulso)', async () => {
    for (const n of rod) await q(`select rodizio_arrive($1,$2)`, [pr, id(n)])
    await q(`select rodizio_arrive($1,null,'Zé da Esquina')`, [pr])
    return (await one(`select count(*)::int n from rodizio_queue($1)`, [pr])).n + ' na fila'
  })
  await expect('não marca a mesma chegada duas vezes', () => q(`select rodizio_arrive($1,$2)`, [pr, id('j1')]), true)
  const guestZe = (await one(`select id from guests where pelada_id=$1 and name='Zé da Esquina'`, [pr])).id
  const side = (names) => JSON.stringify(names.map((n) => (n === 'ze' ? { guest_id: Number(guestZe) } : { profile_id: id(n) })))
  await expect('time com 6 é recusado', () => q(`select rodizio_create_game($1,null,$2,$3)`, [pr, side(['j1', 'j2', 'j3', 'j4', 'j5', 'j6']), side(['j7'])]), true)
  await expect('mesmo jogador nos dois times é recusado', () => q(`select rodizio_create_game($1,null,$2,$3)`, [pr, side(['j1']), side(['j1'])]), true)
  await expect('quem não chegou não joga', () => q(`select rodizio_create_game($1,null,$2,$3)`, [pr, side(['dono']), side(['j1'])]), true)
  let rg1
  await expect('jogo 1: 5 contra 5', async () => {
    rg1 = (await one(`select rodizio_create_game($1,null,$2,$3) g`, [pr, side(['j1', 'j2', 'j3', 'j4', 'j5']), side(['j6', 'j7', 'j8', 'j9', 'ze'])])).g
    return (await one(`select count(*)::int n from game_lineup where game_id=$1`, [rg1])).n + ' em campo'
  })
  await expect('não cria outro jogo com um marcado', () => q(`select rodizio_create_game($1,null,$2,$3)`, [pr, side(['j10']), side(['dia'])]), true)
  await expect('jogo 1 termina: time A ganha', async () => {
    const g = await one(`select team1_id from games where id=$1`, [rg1])
    await q(`select start_game($1)`, [rg1])
    await q(`insert into game_events (game_id, type, team_id, player_id) values ($1,'gol',$2,$3)`, [rg1, g.team1_id, id('j1')])
    await q(`select finish_game($1)`, [rg1])
    return 'A 1 x 0 B'
  })
  await expect('fila: j10 e dia estão há 1 jogo sem jogar; quem jogou, 0', async () => {
    const r = (await q(`select profile_id, waiting, played from rodizio_queue($1) where profile_id is not null`, [pr])).rows
    const w = (n) => r.find((x) => x.profile_id === id(n))
    if (w('j10').waiting !== 1 || w('dia').waiting !== 1 || w('j6').waiting !== 0 || w('j1').played !== 1) throw new Error(JSON.stringify(r))
    return 'ok'
  })
  let rg2
  await expect('jogo 2: o time A fica e encara os que estavam fora', async () => {
    const keep = (await one(`select team1_id from games where id=$1`, [rg1])).team1_id
    rg2 = (await one(`select rodizio_create_game($1,$2,$3,$4) g`, [pr, keep, side(['j1', 'j2', 'j3', 'j4', 'j5']), side(['j10', 'dia', 'j6', 'j7', 'j8'])])).g
    const g = await one(`select number, team1_id = $2 as ficou from games where id=$1`, [rg2, keep])
    if (!g.ficou) throw new Error('time não ficou')
    return `jogo ${g.number}`
  })
  await expect('cancela o jogo que não começou', async () => {
    await q(`select rodizio_cancel_game($1)`, [rg2])
    return (await one(`select count(*)::int n from games where pelada_id=$1`, [pr])).n + ' jogo(s)'
  })
  await expect('vitória do rodízio conta no mês de quem jogou', async () => {
    await q(`select close_pelada($1)`, [pr])
    const r = await one(`select coalesce(sum(wins),0)::int wins from player_month_stats where profile_id=$1 and month = public.month_of(current_date + 63)`, [id('j2')])
    if (r.wins !== 1) throw new Error(JSON.stringify(r))
    return '1 vitória'
  })
  await expect('pelada de times não aceita chegada de rodízio', async () => { await as(id('adm')); return q(`select rodizio_arrive($1,$2)`, [pgc, id('j1')]) }, true)
  await expect('trocar para rodízio apaga os times da escolha', async () => {
    await as(id('adm'))
    await q(`select set_pelada_format($1,'rodizio')`, [pgc])
    const r = await one(`select (select count(*)::int from teams where pelada_id=$1) times, (select format from peladas where id=$1) formato`, [pgc])
    if (r.times || r.formato !== 'rodizio') throw new Error(JSON.stringify(r))
    return JSON.stringify(r)
  })
  await expect('com jogo, o formato não muda mais', async () => {
    await as(id('adm'))
    const [a, b] = (await q(`select id from teams where pelada_id=$1 order by captain_order limit 2`, [pgd])).rows.map((r) => r.id)
    await q(`select set_next_game($1,$2,$3)`, [pgd, a, b])
    return q(`select set_pelada_format($1,'rodizio')`, [pgd])
  }, true)
  await expect('jogador não troca o formato', async () => { await as(id('j5')); return q(`select set_pelada_format($1,'times')`, [pgc]) }, true)

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
