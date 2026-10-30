-- O mês fecha depois do último domingo dele, e não mais no dia 1º do mês seguinte. Os troféus continuam
-- calculados na hora: outra pelada encerrada no mesmo mês atualiza os números e os premiados.

-- Último domingo do mês
create function public.month_close_date(p_month date) returns date
language sql immutable set search_path = '' as $$
  select d - extract(dow from d)::integer
  from (select (date_trunc('month', p_month) + interval '1 month - 1 day')::date as d) x
$$;

create function public.month_closed(p_month date) returns boolean
language sql stable set search_path = '' as $$
  select (now() at time zone 'America/Sao_Paulo')::date > public.month_close_date(p_month)
$$;

create or replace view public.awards with (security_invoker = true) as
with closed as (
  select * from public.podium where public.month_closed(month)
), best_team as (
  select r.pelada_id, r.month, r.team_id, r.wins, r.goals,
    rank() over (partition by r.month order by r.wins desc, r.goals desc) as pos
  from public.pelada_team_results r
  where public.month_closed(r.month) and r.wins > 0
)
select month, profile_id, 'melhor_mes'::text as award, rank_total::integer as position from closed where rank_total <= 3 and total > 0
union all
select month, profile_id, 'artilheiro', 1 from closed where rank_goals = 1 and goals > 0
union all
select month, profile_id, 'garcom', 1 from closed where rank_assists = 1 and assists > 0
union all
select month, profile_id, 'mais_vitorias', 1 from closed where rank_wins = 1 and wins > 0
union all
select distinct b.month, m.profile_id, 'selecao', 1
from best_team b
join public.team_members m on m.team_id = b.team_id and not m.is_out and m.profile_id is not null
where b.pos = 1 and public.was_mensalista(m.profile_id, b.month);

-- Números de cada jogador em cada pelada (mesmas regras de player_month_stats, somando também a pelada
-- em andamento): filtro de jogador do Histórico e exportação do mês
create view public.player_pelada_stats with (security_invoker = true) as
with counted as (
  select g.id, g.pelada_id, s.winner_id
  from public.games g
  join public.peladas p on p.id = g.pelada_id and p.status in ('em_andamento', 'encerrada')
  join public.game_scores s on s.game_id = g.id
  where g.status = 'finalizado'
),
played as (
  select distinct c.id as game_id, c.pelada_id, l.profile_id,
    c.winner_id is not null and l.team_id = c.winner_id as won
  from counted c
  join public.game_lineup l on l.game_id = c.id and l.profile_id is not null
  where not exists (select 1 from public.game_keepers k where k.game_id = c.id and k.profile_id = l.profile_id)
),
goals as (
  select c.pelada_id, e.player_id as profile_id, count(*)::int as n
  from counted c join public.game_events e on e.game_id = c.id and e.type = 'gol' and e.player_id is not null
  group by 1, 2
),
assists as (
  select c.pelada_id, e.assist_id as profile_id, count(*)::int as n
  from counted c join public.game_events e on e.game_id = c.id and e.type = 'gol' and e.assist_id is not null
  where public.keeper_at(e.game_id, e.team_id, e.minute) is distinct from e.assist_id
  group by 1, 2
),
games_won as (
  select pelada_id, profile_id, count(*)::int as games, (count(*) filter (where won))::int as wins
  from played group by 1, 2
)
select
  coalesce(w.pelada_id, g.pelada_id, a.pelada_id) as pelada_id,
  coalesce(w.profile_id, g.profile_id, a.profile_id) as profile_id,
  coalesce(w.games, 0) as games,
  coalesce(w.wins, 0) as wins,
  coalesce(g.n, 0) as goals,
  coalesce(a.n, 0) as assists,
  coalesce(g.n, 0) + coalesce(a.n, 0) as total
from games_won w
full join goals g on g.pelada_id = w.pelada_id and g.profile_id = w.profile_id
full join assists a on a.pelada_id = coalesce(w.pelada_id, g.pelada_id) and a.profile_id = coalesce(w.profile_id, g.profile_id);

-- Definir ou trocar capitão: também serve para os times do bilhete dourado saídos do sorteio, que nascem
-- sem capitão. Com a escolha terminada, ele não tem vez a esperar: o aviso leva para a estratégia.
create or replace function public.change_captain(p_team bigint, p_profile uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  t public.teams;
  p public.peladas;
  drafting boolean;
begin
  if not public.is_admin() then raise exception 'Só admin'; end if;
  select * into t from public.teams where id = p_team;
  if t.id is null then raise exception 'Time não encontrado'; end if;
  select * into p from public.peladas where id = t.pelada_id;
  if p.status = 'encerrada' then raise exception 'A pelada já foi encerrada'; end if;
  if t.captain_id = p_profile then raise exception 'Ele já é o capitão'; end if;
  if not exists (
    select 1 from public.team_members
    where team_id = p_team and profile_id = p_profile and not is_out and not is_slot
  ) then
    raise exception 'O novo capitão precisa estar neste time';
  end if;
  if not exists (select 1 from public.profiles where id = p_profile and status = 'ativo' and type = 'mensalista') then
    raise exception 'O capitão precisa ser mensalista';
  end if;

  update public.team_members set is_captain = false where team_id = p_team and is_captain;
  update public.team_members set is_captain = true where team_id = p_team and profile_id = p_profile;
  update public.teams set captain_id = p_profile where id = p_team;

  select exists (select 1 from public.drafts where pelada_id = t.pelada_id and phase <> 'concluida') into drafting;
  if drafting then
    perform private.push(array[p_profile], 'Você é capitão!',
      'Agora o time é seu na pelada de ' || private.day(p.date) || '. Fique de olho na sua vez de escolher.', '/times');
  else
    perform private.push(array[p_profile], 'Você é capitão!',
      'Agora o time é seu na pelada de ' || private.day(p.date) || '. Já dá para montar a estratégia.', '/estrategia');
  end if;
end $$;
