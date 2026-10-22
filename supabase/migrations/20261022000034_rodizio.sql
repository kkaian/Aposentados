-- Rodízio (dias atípicos): a pelada não tem 4 times fixos. Admin ou ajudante marca quem chegou
-- (mensalista, diarista ou avulso); cada jogo tem 5 contra 5, quem ganha fica e o próximo time sai da
-- fila, com vantagem para quem está há mais jogos sem jogar (o app propõe; admin/ajudante ajusta na mão).
-- Os times do rodízio existem só para os jogos (sem capitão, sem team_members): quem jogou fica em game_lineup,
-- então jogos, vitórias, gols e pódio contam normalmente.

alter table public.peladas
  add column format text not null default 'times' constraint peladas_format_valid check (format in ('times', 'rodizio'));

-- Times do rodízio: sem posição de capitão, com nome próprio ("Time 3")
alter table public.teams alter column captain_order drop not null;
alter table public.teams add column label text check (label is null or length(trim(label)) between 1 and 40);

create table public.rodizio_arrivals (
  id bigint generated always as identity primary key,
  pelada_id bigint not null references public.peladas (id) on delete cascade,
  profile_id uuid references public.profiles (id) on delete cascade,
  guest_id bigint references public.guests (id) on delete cascade,
  arrived_at timestamptz not null default now(),
  -- foi embora: sai da fila
  left_at timestamptz,
  check ((profile_id is null) <> (guest_id is null))
);

create unique index rodizio_arrivals_profile_once on public.rodizio_arrivals (pelada_id, profile_id) where profile_id is not null and left_at is null;
create unique index rodizio_arrivals_guest_once on public.rodizio_arrivals (pelada_id, guest_id) where guest_id is not null and left_at is null;

alter table public.rodizio_arrivals enable row level security;
create policy rodizio_arrivals_read on public.rodizio_arrivals for select to authenticated using (public.is_active());
revoke insert, update, delete on public.rodizio_arrivals from authenticated;
revoke all on public.rodizio_arrivals from anon;

alter publication supabase_realtime add table public.rodizio_arrivals;

create function private.rodizio_open(p_pelada bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.peladas where id = p_pelada and format = 'rodizio' and status in ('agendada', 'em_andamento')) then
    raise exception 'Esta pelada não está em rodízio (ou já foi encerrada)';
  end if;
  if not public.can_record(p_pelada) then raise exception 'Só admin ou ajudante da pelada'; end if;
end $$;

-- Chegou: perfil (qualquer jogador ativo) ou avulso pelo nome
create function public.rodizio_arrive(p_pelada bigint, p_profile uuid, p_guest_name text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  guest bigint;
begin
  perform private.rodizio_open(p_pelada);
  if p_profile is not null then
    if not exists (select 1 from public.profiles where id = p_profile and status = 'ativo') then raise exception 'Jogador não encontrado'; end if;
    if exists (select 1 from public.rodizio_arrivals where pelada_id = p_pelada and profile_id = p_profile and left_at is null) then
      raise exception 'Ele já está na lista de quem chegou';
    end if;
    insert into public.rodizio_arrivals (pelada_id, profile_id) values (p_pelada, p_profile);
  else
    if coalesce(trim(p_guest_name), '') = '' then raise exception 'Digite o nome do avulso'; end if;
    insert into public.guests (pelada_id, name, created_by) values (p_pelada, trim(p_guest_name), auth.uid()) returning id into guest;
    insert into public.rodizio_arrivals (pelada_id, guest_id) values (p_pelada, guest);
  end if;
end $$;

-- Foi embora (sai da fila; o que já jogou continua valendo)
create function public.rodizio_leave(p_arrival bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare
  a public.rodizio_arrivals;
begin
  select * into a from public.rodizio_arrivals where id = p_arrival and left_at is null;
  if a.id is null then raise exception 'Não encontrado na lista'; end if;
  perform private.rodizio_open(a.pelada_id);
  update public.rodizio_arrivals set left_at = now() where id = p_arrival;
end $$;

-- Fila: quem chegou e não foi embora, com quantos jogos seguidos está sem jogar (desde que chegou)
create function public.rodizio_queue(p_pelada bigint)
returns table (arrival_id bigint, profile_id uuid, guest_id bigint, arrived_at timestamptz, waiting integer, played integer)
language sql stable security definer set search_path = '' as $$
  with mine as (
    select a.*,
      (select max(g.started_at) from public.games g join public.game_lineup l on l.game_id = g.id
       where g.pelada_id = p_pelada and (l.profile_id = a.profile_id or l.guest_id = a.guest_id)) as last_played,
      (select count(distinct g.id)::int from public.games g join public.game_lineup l on l.game_id = g.id
       where g.pelada_id = p_pelada and g.status = 'finalizado' and (l.profile_id = a.profile_id or l.guest_id = a.guest_id)) as played
    from public.rodizio_arrivals a
    where a.pelada_id = p_pelada and a.left_at is null
  )
  select m.id, m.profile_id, m.guest_id, m.arrived_at,
    (select count(*)::int from public.games g
     where g.pelada_id = p_pelada and g.status = 'finalizado'
       and g.started_at >= m.arrived_at and g.started_at > coalesce(m.last_played, '-infinity'::timestamptz)),
    m.played
  from mine m
$$;

-- Cria o próximo jogo: lado A (o time que ficou, se houver) e lado B; cada lado com até 5 de quem chegou
create function public.rodizio_create_game(p_pelada bigint, p_keep_team bigint, p_side_a jsonb, p_side_b jsonb) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  team_a bigint := p_keep_team;
  team_b bigint;
  n smallint;
  next_label integer;
  game bigint;
  people jsonb := coalesce(p_side_a, '[]') || coalesce(p_side_b, '[]');
  person jsonb;
begin
  perform private.rodizio_open(p_pelada);
  if exists (select 1 from public.games where pelada_id = p_pelada and status in ('agendado', 'ao_vivo')) then
    raise exception 'Já existe um jogo marcado ou ao vivo: termine ou cancele antes';
  end if;
  if jsonb_array_length(coalesce(p_side_a, '[]')) not between 1 and 5 or jsonb_array_length(coalesce(p_side_b, '[]')) not between 1 and 5 then
    raise exception 'Cada time precisa de 1 a 5 jogadores';
  end if;
  if (select count(distinct coalesce(x ->> 'profile_id', 'g' || (x ->> 'guest_id'))) from jsonb_array_elements(people) x) <> jsonb_array_length(people) then
    raise exception 'O mesmo jogador está nos dois times (ou repetido)';
  end if;
  for person in select * from jsonb_array_elements(people) loop
    if not exists (
      select 1 from public.rodizio_arrivals a
      where a.pelada_id = p_pelada and a.left_at is null
        and (a.profile_id = (person ->> 'profile_id')::uuid or a.guest_id = (person ->> 'guest_id')::bigint)
    ) then
      raise exception 'Só entra no jogo quem está na lista de quem chegou';
    end if;
  end loop;

  select count(*) + 1 into next_label from public.teams where pelada_id = p_pelada;
  if team_a is null then
    insert into public.teams (pelada_id, label) values (p_pelada, 'Time ' || next_label) returning id into team_a;
    next_label := next_label + 1;
  elsif not exists (select 1 from public.teams where id = team_a and pelada_id = p_pelada) then
    raise exception 'Time não é desta pelada';
  end if;
  insert into public.teams (pelada_id, label) values (p_pelada, 'Time ' || next_label) returning id into team_b;

  select coalesce(max(number), 0) + 1 into n from public.games where pelada_id = p_pelada;
  insert into public.games (pelada_id, number, team1_id, team2_id, created_by)
  values (p_pelada, n, team_a, team_b, auth.uid()) returning id into game;

  insert into public.game_lineup (game_id, team_id, profile_id, guest_id)
  select game, team_a, (x ->> 'profile_id')::uuid, (x ->> 'guest_id')::bigint from jsonb_array_elements(p_side_a) x
  union all
  select game, team_b, (x ->> 'profile_id')::uuid, (x ->> 'guest_id')::bigint from jsonb_array_elements(p_side_b) x;

  perform private.push(
    array(select (x ->> 'profile_id')::uuid from jsonb_array_elements(people) x where x ? 'profile_id'),
    'Você joga o próximo', 'Jogo ' || n || ' do rodízio: se prepara!', '/jogo/' || game);
  return game;
end $$;

-- Cancela o jogo marcado (ainda não começou); times que ficaram sem jogo somem
create function public.rodizio_cancel_game(p_game bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare
  g public.games;
begin
  select * into g from public.games where id = p_game;
  if g.id is null then raise exception 'Jogo não encontrado'; end if;
  perform private.rodizio_open(g.pelada_id);
  if g.status <> 'agendado' then raise exception 'Só dá para cancelar jogo que ainda não começou'; end if;
  delete from public.games where id = p_game;
  delete from public.teams t where t.pelada_id = g.pelada_id
    and not exists (select 1 from public.games x where x.team1_id = t.id or x.team2_id = t.id);
end $$;

-- Troca o formato (times <-> rodízio) antes do primeiro jogo: apaga os times, a escolha e as chegadas
create function public.set_pelada_format(p_pelada bigint, p_format text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Só admin'; end if;
  if p_format not in ('times', 'rodizio') then raise exception 'Formato inválido'; end if;
  if not exists (select 1 from public.peladas where id = p_pelada and status in ('agendada', 'em_andamento')) then
    raise exception 'A pelada já foi encerrada ou cancelada';
  end if;
  if exists (select 1 from public.games where pelada_id = p_pelada) then
    raise exception 'Já existem jogos nesta pelada: o formato não muda mais';
  end if;
  delete from public.drafts where pelada_id = p_pelada;
  delete from public.team_members where pelada_id = p_pelada;
  delete from public.teams where pelada_id = p_pelada;
  delete from public.rodizio_arrivals where pelada_id = p_pelada;
  update public.peladas set format = p_format where id = p_pelada;
end $$;

-- O jogo do rodízio já nasce com quem joga: ao iniciar, não há elenco de time para copiar
-- (start_game copia team_members, que no rodízio é vazio), então nada muda nele.

revoke execute on function
  public.rodizio_arrive(bigint, uuid, text), public.rodizio_leave(bigint), public.rodizio_queue(bigint),
  public.rodizio_create_game(bigint, bigint, jsonb, jsonb), public.rodizio_cancel_game(bigint), public.set_pelada_format(bigint, text)
from public, anon;
grant execute on function public.rodizio_queue(bigint) to authenticated;
