-- Pódio e troféus de cada mês ficam com quem era mensalista naquele mês.
-- Antes, quem virava diarista (ou era desativado) sumia do pódio dos meses passados,
-- que são a prova dos títulos. Agora o app guarda os períodos de mensalista.

create table public.mensalista_periods (
  id bigint generated always as identity primary key,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  started_on date not null,
  -- nulo: ainda é mensalista
  ended_on date,
  check (ended_on is null or ended_on >= started_on)
);

create unique index mensalista_periods_one_open on public.mensalista_periods (profile_id) where ended_on is null;

alter table public.mensalista_periods enable row level security;
-- todos leem (o pódio usa); só o gatilho escreve
create policy mensalista_periods_read on public.mensalista_periods for select to authenticated using (public.is_active());
revoke insert, update, delete on public.mensalista_periods from authenticated, anon;

-- Abre o período quando vira mensalista ativo e fecha quando deixa de ser (diarista ou desativado)
create function private.on_mensalista_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  today date := (now() at time zone 'America/Sao_Paulo')::date;
  is_m boolean := new.type = 'mensalista' and new.status = 'ativo';
  was_m boolean := tg_op = 'UPDATE' and old.type = 'mensalista' and old.status = 'ativo';
begin
  if is_m and not was_m then
    insert into public.mensalista_periods (profile_id, started_on) values (new.id, today)
    on conflict do nothing;
  elsif was_m and not is_m then
    update public.mensalista_periods set ended_on = today where profile_id = new.id and ended_on is null;
  end if;
  return null;
end $$;

create trigger mensalista_periods_track after insert or update of type, status on public.profiles
for each row execute function private.on_mensalista_change();

-- Os mensalistas de hoje contam desde o começo do app (1ª pelada em 04/10/2026)
insert into public.mensalista_periods (profile_id, started_on)
select id, date '2026-10-01' from public.profiles where type = 'mensalista' and status = 'ativo';

-- Foi mensalista em algum momento do mês
create function public.was_mensalista(p_profile uuid, p_month date) returns boolean
language sql stable set search_path = '' as $$
  select exists (
    select 1 from public.mensalista_periods m
    where m.profile_id = p_profile
      and m.started_on < (p_month + interval '1 month')::date
      and (m.ended_on is null or m.ended_on >= p_month)
  )
$$;

create or replace view public.podium with (security_invoker = true) as
select s.month, s.profile_id, s.games, s.wins, s.goals, s.assists, s.total, pr.name, pr.photo_path,
  rank() over (partition by s.month order by s.wins desc) as rank_wins,
  rank() over (partition by s.month order by s.goals desc, s.wins desc) as rank_goals,
  rank() over (partition by s.month order by s.assists desc, s.wins desc) as rank_assists,
  rank() over (partition by s.month order by s.total desc, s.wins desc) as rank_total
from public.player_month_stats s
join public.profiles pr on pr.id = s.profile_id
where public.was_mensalista(s.profile_id, s.month);

create or replace view public.awards with (security_invoker = true) as
with closed as (
  select * from public.podium where month < public.current_month()
), best_team as (
  select r.pelada_id, r.month, r.team_id, r.wins, r.goals,
    rank() over (partition by r.month order by r.wins desc, r.goals desc) as pos
  from public.pelada_team_results r
  where r.month < public.current_month() and r.wins > 0
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
