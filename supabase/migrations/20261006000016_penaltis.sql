-- Vitória nos pênaltis: jogo empatado pode ter um vencedor nos pênaltis.
-- Conta como vitória (pódio, troféus, Seleção do mês), mas os gols dos pênaltis não entram no placar.

alter table public.games
  add column penalty_winner_id bigint references public.teams (id),
  add constraint games_penalty_winner check (penalty_winner_id is null or penalty_winner_id in (team1_id, team2_id));

-- Placar calculado dos eventos + vencedor (pelos gols; no empate, quem ganhou nos pênaltis)
create or replace view public.game_scores with (security_invoker = true) as
with s as (
  select
    g.id as game_id,
    g.pelada_id,
    g.team1_id,
    g.team2_id,
    count(*) filter (where (e.type = 'gol' and e.team_id = g.team1_id) or (e.type = 'gol_contra' and e.team_id = g.team2_id))::int as team1_goals,
    count(*) filter (where (e.type = 'gol' and e.team_id = g.team2_id) or (e.type = 'gol_contra' and e.team_id = g.team1_id))::int as team2_goals,
    g.penalty_winner_id
  from public.games g
  left join public.game_events e on e.game_id = g.id
  group by g.id
)
select
  game_id, pelada_id, team1_id, team2_id, team1_goals, team2_goals,
  case
    when team1_goals > team2_goals then team1_id
    when team2_goals > team1_goals then team2_id
    else penalty_winner_id
  end as winner_id,
  team1_goals = team2_goals and penalty_winner_id is not null as penalties
from s;

-- Estatísticas individuais por mês: vitória = time vencedor (inclui pênaltis)
create or replace view public.player_month_stats with (security_invoker = true) as
with counted as (
  select g.id, p.date, s.winner_id
  from public.games g
  join public.peladas p on p.id = g.pelada_id and p.status = 'encerrada'
  join public.game_scores s on s.game_id = g.id
  where g.status = 'finalizado'
),
played as (
  select distinct c.id as game_id, public.month_of(c.date) as month, l.profile_id,
    c.winner_id is not null and l.team_id = c.winner_id as won
  from counted c
  join public.game_lineup l on l.game_id = c.id and l.profile_id is not null
),
goals as (
  select public.month_of(c.date) as month, e.player_id as profile_id, count(*)::int as n
  from counted c join public.game_events e on e.game_id = c.id and e.type = 'gol' and e.player_id is not null
  group by 1, 2
),
assists as (
  select public.month_of(c.date) as month, e.assist_id as profile_id, count(*)::int as n
  from counted c join public.game_events e on e.game_id = c.id and e.type = 'gol' and e.assist_id is not null
  group by 1, 2
),
games_won as (
  select month, profile_id, count(*)::int as games, (count(*) filter (where won))::int as wins
  from played group by 1, 2
)
select
  coalesce(w.month, g.month, a.month) as month,
  coalesce(w.profile_id, g.profile_id, a.profile_id) as profile_id,
  coalesce(w.games, 0) as games,
  coalesce(w.wins, 0) as wins,
  coalesce(g.n, 0) as goals,
  coalesce(a.n, 0) as assists,
  coalesce(g.n, 0) + coalesce(a.n, 0) as total
from games_won w
full join goals g on g.month = w.month and g.profile_id = w.profile_id
full join assists a on a.month = coalesce(w.month, g.month) and a.profile_id = coalesce(w.profile_id, g.profile_id);

-- Vitórias e gols de cada time por pelada (Seleção do mês), com pênaltis
create or replace view public.pelada_team_results with (security_invoker = true) as
select
  t.pelada_id,
  public.month_of(p.date) as month,
  t.id as team_id,
  count(*) filter (where s.winner_id = t.id)::int as wins,
  coalesce(sum(case when t.id = g.team1_id then s.team1_goals else s.team2_goals end), 0)::int as goals
from public.teams t
join public.peladas p on p.id = t.pelada_id and p.status = 'encerrada'
join public.games g on g.pelada_id = t.pelada_id and g.status = 'finalizado' and t.id in (g.team1_id, g.team2_id)
join public.game_scores s on s.game_id = g.id
group by t.pelada_id, p.date, t.id;

-- Salvar resultado: no empate, pode informar quem venceu nos pênaltis
drop function public.finish_game(bigint);
create function public.finish_game(p_game bigint, p_penalty_winner bigint default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  s public.game_scores;
begin
  select * into s from public.game_scores where game_id = p_game;
  if p_penalty_winner is not null then
    if s.team1_goals <> s.team2_goals then raise exception 'Pênaltis só em jogo empatado'; end if;
    if p_penalty_winner not in (s.team1_id, s.team2_id) then raise exception 'Time não está neste jogo'; end if;
  end if;

  update public.games
  set status = 'finalizado', ended_at = now(), recorder_id = null, recorder_since = null,
      penalty_winner_id = p_penalty_winner
  where id = p_game and status = 'ao_vivo' and (recorder_id = auth.uid() or public.is_admin());
  if not found then raise exception 'Só o responsável ou um admin encerra o jogo'; end if;

  update public.game_lineup l set left_minute = coalesce(l.left_minute,
    least(60, extract(epoch from (now() - g.started_at))::int / 60))
  from public.games g where g.id = p_game and l.game_id = p_game and l.left_minute is null;
end $$;

revoke execute on function public.finish_game(bigint, bigint) from public, anon;
grant execute on function public.finish_game(bigint, bigint) to authenticated;
