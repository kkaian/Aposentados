-- Goleiro.
-- O admin marca quem é goleiro: "só goleiro" (fica fora de escolha, vagas, pódio, troféus e mensalidade;
-- é sempre diarista) ou "também goleiro" (jogador que às vezes agarra, num jogo em que o time dele
-- não está em campo). Antes de cada jogo, admin ou
-- ajudante define o goleiro de cada time; "goleiro avulso" (sem ninguém ligado) não gera estatística.
-- Quem agarra num jogo tem os números daquele jogo como goleiro: vitórias, gols sofridos (de quem
-- estava no gol na hora), assistências e defesas difíceis. Notas de goleiro: mãos, pés, alcance, salto e overall.

-- ------------------------------------------------------------
-- Quem é goleiro
-- ------------------------------------------------------------
alter table public.profiles
  add column goalkeeper text constraint profiles_goalkeeper_mode check (goalkeeper in ('so_goleiro', 'tambem')),
  add constraint profiles_so_goleiro_diarista check (goalkeeper is distinct from 'so_goleiro' or type = 'diarista');

create function public.set_goalkeeper(p_profile uuid, p_mode text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  pr public.profiles;
begin
  if not public.is_admin() then raise exception 'Só admin'; end if;
  if p_mode is not null and p_mode not in ('so_goleiro', 'tambem') then raise exception 'Opção inválida'; end if;
  select * into pr from public.profiles where id = p_profile;
  if pr.id is null then raise exception 'Jogador não encontrado'; end if;
  if p_mode = 'so_goleiro' and pr.type = 'mensalista' then
    raise exception 'Mensalista não pode ser "só goleiro". Marque "também goleiro" ou retire da mensalidade antes.';
  end if;
  update public.profiles set goalkeeper = p_mode where id = p_profile;
end $$;

-- Só goleiro não vira mensalista (precisa tirar o "só goleiro" antes)
create or replace function public.set_player_type(p_profile uuid, p_type public.player_type) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Só admin'; end if;
  if p_type = 'mensalista' and (select goalkeeper from public.profiles where id = p_profile) = 'so_goleiro' then
    raise exception 'Este jogador é "só goleiro". Mude para "também goleiro" antes de torná-lo mensalista.';
  end if;
  update public.profiles set type = p_type where id = p_profile and status = 'ativo';
  if not found then raise exception 'Jogador não encontrado'; end if;
end $$;

-- Só goleiro não é chamado como diarista (não entra na escolha dos times)
create function private.guard_goalkeeper_called() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select goalkeeper from public.profiles where id = new.profile_id) = 'so_goleiro' then
    raise exception 'Goleiro não entra na escolha dos times: ele só confirma presença e o time é definido em cada jogo';
  end if;
  return new;
end $$;

create trigger pelada_diaristas_goalkeeper before insert on public.pelada_diaristas
for each row execute function private.guard_goalkeeper_called();

-- ------------------------------------------------------------
-- Presença: só goleiro também confirma; fica fora da contagem de vagas
-- ------------------------------------------------------------
drop policy presence_self on public.presence;
create policy presence_self on public.presence for all to authenticated
  using (profile_id = auth.uid())
  with check (
    profile_id = auth.uid()
    and exists (
      select 1 from public.peladas p
      where p.id = pelada_id and p.status in ('agendada', 'em_andamento')
        and (presence.answer = 'nao_vou' or (p.presence_open and p.status = 'agendada'))
    )
    and (
      exists (select 1 from public.profiles where id = auth.uid() and status = 'ativo' and (type = 'mensalista' or goalkeeper = 'so_goleiro'))
      or exists (select 1 from public.pelada_diaristas d where d.pelada_id = presence.pelada_id and d.profile_id = auth.uid())
    )
  );

create or replace view public.presence_list with (security_invoker = true) as
select
  pr.pelada_id,
  pr.profile_id,
  pr.answer,
  pr.answered_at,
  case when pr.answer = 'vou' then row_number() over (partition by pr.pelada_id, pr.answer order by pr.answered_at) end as position,
  pr.answer = 'vou'
    and row_number() over (partition by pr.pelada_id, pr.answer order by pr.answered_at) > p.max_slots as waitlisted
from public.presence pr
join public.peladas p on p.id = pr.pelada_id
join public.profiles pf on pf.id = pr.profile_id
where pf.goalkeeper is distinct from 'so_goleiro';

-- Avisos de pelada nova e lembrete de presença também chegam ao só goleiro
create or replace function private.pelada_invited(p_pelada bigint) returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(id), '{}') from public.profiles
  where status = 'ativo'
    and (type = 'mensalista' or goalkeeper = 'so_goleiro'
         or id in (select profile_id from public.pelada_diaristas where pelada_id = p_pelada))
$$;

-- ------------------------------------------------------------
-- Goleiro de cada time em cada jogo (trocas no meio do jogo viram outro período)
-- ------------------------------------------------------------
create table public.game_keepers (
  id bigint generated always as identity primary key,
  game_id bigint not null references public.games (id) on delete cascade,
  team_id bigint not null references public.teams (id) on delete cascade,
  -- nulo: goleiro avulso (sem estatística)
  profile_id uuid references public.profiles (id),
  entered_minute smallint not null default 0,
  left_minute smallint,
  created_at timestamptz not null default now()
);

create unique index game_keepers_one_open on public.game_keepers (game_id, team_id) where left_minute is null;
create index game_keepers_profile on public.game_keepers (profile_id) where profile_id is not null;

alter table public.game_keepers enable row level security;
create policy game_keepers_read on public.game_keepers for select to authenticated using (public.is_active());
revoke insert, update, delete on public.game_keepers from authenticated, anon;

alter publication supabase_realtime add table public.game_keepers;

-- Quem estava no gol de um time num minuto do jogo
create function public.keeper_at(p_game bigint, p_team bigint, p_minute integer) returns uuid
language sql stable security definer set search_path = '' as $$
  select k.profile_id from public.game_keepers k
  where k.game_id = p_game and k.team_id = p_team
    and k.entered_minute <= p_minute and (k.left_minute is null or p_minute < k.left_minute)
  order by k.entered_minute desc, k.id desc
  limit 1
$$;

create function public.set_keeper(p_game bigint, p_team bigint, p_profile uuid, p_avulso boolean default false) returns void
language plpgsql security definer set search_path = '' as $$
declare
  g public.games;
  m smallint;
begin
  select * into g from public.games where id = p_game for update;
  if g.id is null then raise exception 'Jogo não encontrado'; end if;
  if p_team not in (g.team1_id, g.team2_id) then raise exception 'Time não está neste jogo'; end if;
  if g.status = 'finalizado' then
    if not public.is_admin() then raise exception 'Jogo encerrado: só admin altera o goleiro'; end if;
  elsif not public.can_record(g.pelada_id) then
    raise exception 'Só admin ou ajudante da pelada';
  end if;

  if p_profile is not null then
    if not exists (select 1 from public.profiles where id = p_profile and status = 'ativo' and goalkeeper is not null) then
      raise exception 'Essa pessoa não está marcada como goleiro';
    end if;
    if not exists (select 1 from public.presence where pelada_id = g.pelada_id and profile_id = p_profile and answer = 'vou')
       and not exists (select 1 from public.team_members where pelada_id = g.pelada_id and profile_id = p_profile and not is_out) then
      raise exception 'O goleiro precisa ter confirmado que vai (o admin pode marcar a presença dele)';
    end if;
    -- quem está num dos dois times do jogo joga na linha: não vai para o gol (senão aparece duas vezes)
    if exists (select 1 from public.team_members where team_id in (g.team1_id, g.team2_id) and profile_id = p_profile and not is_out)
       or exists (select 1 from public.game_lineup where game_id = p_game and profile_id = p_profile and left_minute is null) then
      raise exception 'Ele está num dos times deste jogo: não pode agarrar';
    end if;
    if exists (select 1 from public.game_keepers where game_id = p_game and team_id <> p_team and profile_id = p_profile and left_minute is null) then
      raise exception 'Ele já está no gol do outro time';
    end if;
  end if;

  if g.status = 'ao_vivo' then
    -- mesmo goleiro: nada muda
    if exists (select 1 from public.game_keepers where game_id = p_game and team_id = p_team and left_minute is null
               and profile_id is not distinct from p_profile and (p_profile is not null or p_avulso)) then
      return;
    end if;
    m := least(60, floor(extract(epoch from now() - g.started_at) / 60));
    update public.game_keepers set left_minute = m where game_id = p_game and team_id = p_team and left_minute is null;
    -- troca no mesmo minuto em que entrou (correção): o período vazio some
    delete from public.game_keepers where game_id = p_game and team_id = p_team and entered_minute = m and left_minute = m;
    if p_profile is not null or p_avulso then
      insert into public.game_keepers (game_id, team_id, profile_id, entered_minute) values (p_game, p_team, p_profile, m);
    end if;
  else
    -- antes de começar (ou admin corrigindo jogo encerrado): vale o jogo todo
    delete from public.game_keepers where game_id = p_game and team_id = p_team;
    if p_profile is not null or p_avulso then
      insert into public.game_keepers (game_id, team_id, profile_id, entered_minute) values (p_game, p_team, p_profile, 0);
    end if;
  end if;
end $$;

-- Ao iniciar o jogo: elenco do time e, sem goleiro definido, repete o goleiro do jogo anterior do time
create or replace function public.start_game(p_game bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare
  g public.games;
  t bigint;
  prev public.game_keepers;
begin
  select * into g from public.games where id = p_game for update;
  if not public.can_record(g.pelada_id) then raise exception 'Só admin ou ajudante da pelada'; end if;
  if g.status <> 'agendado' then raise exception 'Jogo já começou'; end if;
  if exists (select 1 from public.games where pelada_id = g.pelada_id and status = 'ao_vivo') then
    raise exception 'Já existe um jogo ao vivo nesta pelada';
  end if;

  update public.games
  set status = 'ao_vivo', started_at = now(), recorder_id = auth.uid(), recorder_since = now()
  where id = p_game;

  insert into public.game_lineup (game_id, team_id, profile_id, guest_id)
  select p_game, m.team_id, m.profile_id, m.guest_id
  from public.team_members m
  where m.team_id in (g.team1_id, g.team2_id) and not m.is_out and not m.is_slot;

  foreach t in array array[g.team1_id, g.team2_id] loop
    continue when exists (select 1 from public.game_keepers where game_id = p_game and team_id = t);
    select k.* into prev from public.game_keepers k join public.games g2 on g2.id = k.game_id
    where g2.pelada_id = g.pelada_id and g2.id <> p_game and k.team_id = t
    order by g2.number desc, k.entered_minute desc, k.id desc limit 1;
    continue when prev.id is null;
    -- não repete quem já está no gol ou joga por um dos times deste jogo
    continue when prev.profile_id is not null and (
      exists (select 1 from public.game_keepers where game_id = p_game and profile_id = prev.profile_id)
      or exists (select 1 from public.game_lineup where game_id = p_game and profile_id = prev.profile_id));
    insert into public.game_keepers (game_id, team_id, profile_id) values (p_game, t, prev.profile_id);
  end loop;

  update public.peladas set status = 'em_andamento' where id = g.pelada_id and status = 'agendada';
end $$;

-- ------------------------------------------------------------
-- Eventos: o goleiro (que pode não estar no elenco) faz gol, dá assistência e faz defesa difícil
-- ------------------------------------------------------------
create or replace function public.check_game_event() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  g public.games;
  in_team boolean;
begin
  select * into g from public.games where id = new.game_id;
  if new.team_id not in (g.team1_id, g.team2_id) then
    raise exception 'Time não está neste jogo';
  end if;
  if new.type = 'defesa_dificil' then
    if new.player_id is null or not exists (
      select 1 from public.game_keepers k where k.game_id = new.game_id and k.team_id = new.team_id and k.profile_id = new.player_id
    ) then
      raise exception 'Defesa difícil é só do goleiro deste time';
    end if;
  else
    in_team := exists (
      select 1 from public.game_lineup l
      where l.game_id = new.game_id and l.team_id = new.team_id
        and (l.profile_id = new.player_id or l.guest_id = new.player_guest_id)
    ) or exists (
      select 1 from public.game_keepers k where k.game_id = new.game_id and k.team_id = new.team_id and k.profile_id = new.player_id
    );
    if not in_team then
      raise exception 'Jogador não está em campo por este time';
    end if;
  end if;
  if num_nonnulls(new.assist_id, new.assist_guest_id) = 1 then
    if new.assist_id = new.player_id or new.assist_guest_id = new.player_guest_id
       or not (exists (
         select 1 from public.game_lineup l
         where l.game_id = new.game_id and l.team_id = new.team_id
           and (l.profile_id = new.assist_id or l.guest_id = new.assist_guest_id)
       ) or exists (
         select 1 from public.game_keepers k where k.game_id = new.game_id and k.team_id = new.team_id and k.profile_id = new.assist_id
       )) then
      raise exception 'Assistência precisa ser de outro jogador do mesmo time';
    end if;
  end if;
  if tg_op = 'UPDATE' then
    new.updated_by := auth.uid();
    new.updated_at := now();
  end if;
  return new;
end $$;

-- ------------------------------------------------------------
-- Estatísticas
-- ------------------------------------------------------------
-- Jogo de goleiro: quem agarrou (com perfil) em algum momento do jogo
create view public.goalkeeper_month_stats with (security_invoker = true) as
with counted as (
  select g.id, public.month_of(p.date) as month, g.team1_id, g.team2_id, s.winner_id
  from public.games g
  join public.peladas p on p.id = g.pelada_id and p.status = 'encerrada'
  join public.game_scores s on s.game_id = g.id
  where g.status = 'finalizado'
),
stints as (
  select k.*, c.month, c.winner_id, case when k.team_id = c.team1_id then c.team2_id else c.team1_id end as rival_id
  from public.game_keepers k join counted c on c.id = k.game_id
  where k.profile_id is not null
),
per_game as (
  select s.game_id, s.month, s.profile_id,
    bool_or(s.winner_id is not null and s.winner_id = s.team_id) as won,
    (select count(*) from public.game_events e
     where e.game_id = s.game_id
       and exists (
         select 1 from stints s2
         where s2.game_id = s.game_id and s2.profile_id = s.profile_id
           and ((e.type = 'gol' and e.team_id = s2.rival_id) or (e.type = 'gol_contra' and e.team_id = s2.team_id))
           and e.minute >= s2.entered_minute and (s2.left_minute is null or e.minute < s2.left_minute)
       ))::int as conceded,
    (select count(*) from public.game_events e
     where e.game_id = s.game_id and e.type = 'gol' and e.assist_id = s.profile_id
       and exists (
         select 1 from stints s2
         where s2.game_id = s.game_id and s2.profile_id = s.profile_id and e.team_id = s2.team_id
           and e.minute >= s2.entered_minute and (s2.left_minute is null or e.minute < s2.left_minute)
       ))::int as assists,
    (select count(*) from public.game_events e
     where e.game_id = s.game_id and e.type = 'defesa_dificil' and e.player_id = s.profile_id)::int as saves
  from stints s
  group by s.game_id, s.month, s.profile_id
)
select month, profile_id,
  count(*)::int as games,
  (count(*) filter (where won))::int as wins,
  sum(conceded)::int as conceded,
  sum(assists)::int as assists,
  sum(saves)::int as saves
from per_game
group by month, profile_id;

-- Estatísticas de jogador: o jogo em que ele agarrou não conta como jogo de linha,
-- e a assistência dada no gol vai para as de goleiro (Assistências*)
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
  where not exists (select 1 from public.game_keepers k where k.game_id = c.id and k.profile_id = l.profile_id)
),
goals as (
  select public.month_of(c.date) as month, e.player_id as profile_id, count(*)::int as n
  from counted c join public.game_events e on e.game_id = c.id and e.type = 'gol' and e.player_id is not null
  group by 1, 2
),
assists as (
  select public.month_of(c.date) as month, e.assist_id as profile_id, count(*)::int as n
  from counted c join public.game_events e on e.game_id = c.id and e.type = 'gol' and e.assist_id is not null
  where public.keeper_at(e.game_id, e.team_id, e.minute) is distinct from e.assist_id
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

-- ------------------------------------------------------------
-- Notas de goleiro (mesmos avaliadores: mensalistas; muda 1 vez por pelada)
-- ------------------------------------------------------------
create table public.goalkeeper_ratings (
  rater_id uuid not null references public.profiles (id) on delete cascade,
  rated_id uuid not null references public.profiles (id) on delete cascade,
  hands smallint not null check (hands between 1 and 5),
  feet smallint not null check (feet between 1 and 5),
  reach smallint not null check (reach between 1 and 5),
  jump smallint not null check (jump between 1 and 5),
  overall smallint not null check (overall between 1 and 5),
  updated_at timestamptz not null default now(),
  primary key (rater_id, rated_id),
  check (rater_id <> rated_id)
);

create function public.check_goalkeeper_rating() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.rater_id := auth.uid();
  if new.rater_id = new.rated_id then
    raise exception 'Não dá para avaliar a si mesmo';
  end if;
  if not exists (select 1 from public.profiles where id = new.rater_id and type = 'mensalista' and status = 'ativo') then
    raise exception 'Só mensalistas avaliam';
  end if;
  if not exists (select 1 from public.profiles where id = new.rated_id and goalkeeper is not null and status = 'ativo') then
    raise exception 'Esse jogador não é goleiro';
  end if;
  if tg_op = 'UPDATE' and old.updated_at >= public.last_pelada_closed_at() then
    raise exception 'Você já mudou a nota deste goleiro nesta rodada. Libera de novo quando a próxima pelada for encerrada.';
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger goalkeeper_ratings_check before insert or update on public.goalkeeper_ratings
for each row execute function public.check_goalkeeper_rating();

alter table public.goalkeeper_ratings enable row level security;
create policy goalkeeper_ratings_own on public.goalkeeper_ratings for select to authenticated using (rater_id = auth.uid());
create policy goalkeeper_ratings_insert on public.goalkeeper_ratings for insert to authenticated with check (rater_id = auth.uid());
create policy goalkeeper_ratings_update on public.goalkeeper_ratings for update to authenticated using (rater_id = auth.uid()) with check (rater_id = auth.uid());
revoke delete on public.goalkeeper_ratings from authenticated;
revoke all on public.goalkeeper_ratings from anon;

-- Média (aparece com 3 ou mais avaliações, como a de jogador)
create view public.goalkeeper_rating_summary as
select
  rated_id as profile_id,
  count(*)::int as votes,
  case when count(*) >= 3 then round(avg(hands), 1) end as hands,
  case when count(*) >= 3 then round(avg(feet), 1) end as feet,
  case when count(*) >= 3 then round(avg(reach), 1) end as reach,
  case when count(*) >= 3 then round(avg(jump), 1) end as jump,
  case when count(*) >= 3 then round(avg(overall), 1) end as overall
from public.goalkeeper_ratings
group by rated_id;

revoke all on public.goalkeeper_rating_summary from anon;

revoke execute on function
  public.set_goalkeeper(uuid, text), public.set_keeper(bigint, bigint, uuid, boolean), public.keeper_at(bigint, bigint, integer)
from public, anon;
