-- Bilhete dourado: um mensalista (sorteado ou escolhido pelo admin) monta o time dele primeiro,
-- escolhendo os 4 de uma vez (escolhas 1 a 4). Os outros 3 times saem por sorteio, logo depois, ou por
-- 3 capitães em turnos na ordem 2-3-4 · 4-2-3 · 2-3-4 · 2-3-4 (escolhas 5 a 16). Valem as mesmas regras da
-- escolha normal: 24 h livres, depois 10 min por escolha, sorteio quando o prazo vence.

alter table public.drafts drop constraint drafts_mode_valid;
alter table public.drafts
  add constraint drafts_mode_valid check (mode in ('capitaes', 'invertidos', 'dourado')),
  -- bilhete dourado: como saem os outros 3 times
  add column rest text constraint drafts_rest_valid check (rest in ('sorteio', 'capitaes')),
  add constraint drafts_rest_only_golden check ((mode = 'dourado') = (rest is not null));

-- De qual time (captain_order) é cada escolha, conforme o modo
create function public.draft_team_for_pick(p_pelada bigint, p_pick integer) returns smallint
language sql stable security definer set search_path = '' as $$
  select case
    when d.mode = 'dourado' and p_pick <= 4 then 1::smallint
    when d.mode = 'dourado' then (array[2,3,4, 4,2,3, 2,3,4, 2,3,4])[p_pick - 4]::smallint
    else public.draft_captain_for_pick(p_pick)
  end
  from public.drafts d where d.pelada_id = p_pelada
$$;

create function public.define_golden(p_pelada bigint, p_golden uuid, p_rest text, p_captains uuid[] default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  p public.peladas;
  golden uuid := p_golden;
  i integer;
  d public.drafts;
begin
  if not public.is_admin() then raise exception 'Só admin'; end if;
  select * into p from public.peladas where id = p_pelada;
  if p.status <> 'agendada' then raise exception 'A pelada já começou ou foi encerrada'; end if;
  if exists (select 1 from public.games where pelada_id = p_pelada) then raise exception 'Já existem jogos nesta pelada'; end if;
  if p_rest not in ('sorteio', 'capitaes') then raise exception 'Escolha como saem os outros times'; end if;

  delete from public.team_members where pelada_id = p_pelada;
  delete from public.teams where pelada_id = p_pelada;
  delete from public.drafts where pelada_id = p_pelada;

  -- sem escolha do admin: sorteia entre os mensalistas disponíveis (primeiro quem confirmou)
  if golden is null then
    select a.profile_id into golden from public.draft_available(p_pelada) a
    join public.profiles pr on pr.id = a.profile_id and pr.type = 'mensalista'
    where a.profile_id <> all (coalesce(p_captains, '{}'))
    order by exists (select 1 from public.presence x where x.pelada_id = p_pelada and x.profile_id = a.profile_id and x.answer = 'vou') desc, random()
    limit 1;
    if golden is null then raise exception 'Nenhum mensalista disponível para o bilhete dourado'; end if;
  end if;
  if not exists (select 1 from public.profiles where id = golden and type = 'mensalista' and status = 'ativo')
     or exists (select 1 from public.presence where pelada_id = p_pelada and profile_id = golden and answer = 'nao_vou') then
    raise exception 'O bilhete dourado precisa ir para um mensalista que não disse "não vou"';
  end if;

  if p_rest = 'capitaes' then
    if coalesce(array_length(p_captains, 1), 0) <> 3 or (select count(distinct c) from unnest(p_captains) c) <> 3 or golden = any (p_captains) then
      raise exception 'Escolha 3 capitães diferentes (sem o dono do bilhete)';
    end if;
    if (select count(*) from public.profiles where id = any (p_captains) and type = 'mensalista' and status = 'ativo') <> 3 then
      raise exception 'Os capitães precisam ser mensalistas';
    end if;
  end if;

  for i in 1..4 loop
    with t as (
      insert into public.teams (pelada_id, captain_order, captain_id)
      values (p_pelada, i, case when i = 1 then golden when p_rest = 'capitaes' then p_captains[i - 1] end)
      returning id, captain_id
    )
    insert into public.team_members (pelada_id, team_id, profile_id, is_captain, source)
    select p_pelada, t.id, t.captain_id, true, 'admin' from t where t.captain_id is not null;
  end loop;

  insert into public.drafts (pelada_id, phase, started_at, free_until, next_pick, mode, rest)
  values (p_pelada, 'livre', now(), now() + interval '24 hours', 1, 'dourado', p_rest)
  returning * into d;

  perform private.push(array[golden], 'Bilhete dourado!',
    'Você monta o seu time na pelada de ' || private.day(p.date) || ': escolha os seus 4 jogadores até ' || private.hhmm(d.free_until) || '.',
    '/times');
  return golden;
end $$;

-- Aplica a escolha no time da vez; no bilhete dourado com sorteio, fecha os outros times depois da 4ª escolha
create or replace function public.draft_apply_pick(p_pelada bigint, p_profile uuid, p_source public.pick_source) returns void
language plpgsql security definer set search_path = '' as $$
declare
  d public.drafts;
  t public.teams;
begin
  select * into d from public.drafts where pelada_id = p_pelada for update;
  select * into t from public.teams
  where pelada_id = p_pelada and captain_order = public.draft_team_for_pick(p_pelada, d.next_pick);

  insert into public.team_members (pelada_id, team_id, profile_id, pick_number, source, is_slot)
  values (p_pelada, t.id, p_profile, d.next_pick, p_source, p_profile is null);

  update public.drafts
  set next_pick = d.next_pick + 1,
      turn_deadline = case when d.phase = 'turnos' then greatest(coalesce(d.turn_deadline, now()), now()) + interval '10 minutes' end
  where pelada_id = p_pelada;

  if d.mode = 'dourado' and d.rest = 'sorteio' and d.next_pick = 4 then
    perform private.fill_teams(p_pelada);
    update public.drafts set next_pick = 17 where pelada_id = p_pelada;
  end if;

  perform public.draft_check_done(p_pelada);
end $$;

create or replace function public.draft_pick(p_pelada bigint, p_profile uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  d public.drafts;
  t public.teams;
begin
  perform public.draft_tick();
  select * into d from public.drafts where pelada_id = p_pelada for update;
  if d is null or d.phase = 'concluida' then raise exception 'A escolha dos times já terminou'; end if;
  select * into t from public.teams
  where pelada_id = p_pelada and captain_order = public.draft_team_for_pick(p_pelada, d.next_pick);
  if t.captain_id is distinct from auth.uid() then raise exception 'Não é a sua vez'; end if;
  if not exists (select 1 from public.draft_available(p_pelada) a where a.profile_id = p_profile) then
    raise exception 'Jogador não está disponível';
  end if;
  perform public.draft_apply_pick(p_pelada, p_profile, 'capitao');
end $$;

create or replace function public.draft_pick_slot(p_pelada bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare
  d public.drafts;
  t public.teams;
begin
  perform public.draft_tick();
  select * into d from public.drafts where pelada_id = p_pelada for update;
  if d is null or d.phase = 'concluida' then raise exception 'A escolha dos times já terminou'; end if;
  select * into t from public.teams
  where pelada_id = p_pelada and captain_order = public.draft_team_for_pick(p_pelada, d.next_pick);
  if t.captain_id is distinct from auth.uid() then raise exception 'Não é a sua vez'; end if;
  if exists (select 1 from public.draft_available(p_pelada)) then
    raise exception 'Ainda há jogadores disponíveis';
  end if;
  perform public.draft_apply_pick(p_pelada, null, 'capitao');
end $$;

-- Kit e cor: escolha em turnos (normal ou bilhete dourado) só na vez do capitão; invertidos quando quiser
create or replace function public.choose_identity(p_team bigint, p_kit bigint, p_color text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  t public.teams;
  d public.drafts;
  p public.peladas;
begin
  select * into t from public.teams where id = p_team;
  select * into p from public.peladas where id = t.pelada_id;
  perform public.draft_tick();
  select * into d from public.drafts where pelada_id = t.pelada_id;
  if d.phase is not null and d.phase <> 'concluida' and d.mode <> 'invertidos' then
    -- escolha em andamento: só o capitão do time, na vez dele
    if t.captain_id is distinct from auth.uid() then raise exception 'Só o capitão do time, na vez dele'; end if;
    if public.draft_team_for_pick(t.pelada_id, d.next_pick) <> t.captain_order then
      raise exception 'Kit e cor só na sua vez de escolher';
    end if;
  elsif not public.is_admin() then
    if t.captain_id is distinct from auth.uid() then raise exception 'Só o capitão do time'; end if;
    if t.kit_id is not null and t.color is not null then raise exception 'Seu time já tem kit e cor'; end if;
    if now() >= public.identity_deadline(p) then
      raise exception 'O prazo para escolher kit e cor acabou (até a véspera da pelada)';
    end if;
  end if;
  if p_kit is not null and not exists (select 1 from public.kits where id = p_kit and active) then
    raise exception 'Kit indisponível';
  end if;
  update public.teams set kit_id = p_kit, color = p_color where id = p_team;
exception
  when unique_violation then
    raise exception 'Outro time já escolheu esse kit ou essa cor';
end $$;

-- "Sua vez" segue a ordem do modo
create or replace function private.on_draft_turn() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  d public.drafts;
  captain uuid;
  p public.peladas;
begin
  select * into d from public.drafts where pelada_id = new.pelada_id;
  if d is null or d.next_pick <> new.next_pick or d.phase = 'concluida' or d.next_pick > 16 then return null; end if;
  -- o dono do bilhete faz as 4 primeiras de uma vez: só avisa na primeira
  if d.mode = 'dourado' and d.next_pick between 2 and 4 then return null; end if;
  select t.captain_id into captain from public.teams t
  where t.pelada_id = d.pelada_id and t.captain_order = public.draft_team_for_pick(d.pelada_id, d.next_pick);
  if captain is null then return null; end if;
  select * into p from public.peladas where id = d.pelada_id;
  perform private.push(array[captain], 'Sua vez de escolher!',
    case when d.phase = 'turnos' then 'Você tem 10 min, senão o app sorteia.'
         else 'Escolha ' || d.next_pick || ' de 16 · pelada de ' || private.day(p.date) || '.' end, '/times');
  return null;
end $$;

revoke execute on function public.define_golden(bigint, uuid, text, uuid[]), public.draft_team_for_pick(bigint, integer) from public, anon;
grant execute on function public.draft_team_for_pick(bigint, integer) to authenticated;
