-- Escolha dos times da pelada: capitães, vez de cada um, prazos e sorteio automático.
-- Regras: especificação seção 5 ("Times da pelada") e seção 11.
--   * 24 h livres depois de definir os capitães (respeitando a ordem);
--   * depois, 10 min por escolha; sem escolha, o app sorteia um disponível;
--   * ordem 1234 · 4123 · 1234 · 1234 (draft_captain_for_pick);
--   * a escolha precisa terminar até o horário da pelada.
-- Disponíveis: quem confirmou presença ("vou", fora da espera) e ainda não está em um time.

-- Times do sorteio (dia atípico) não têm capitão
alter table public.teams alter column captain_id drop not null;

create function public.pelada_starts_at(p public.peladas) returns timestamptz
language sql stable as $$
  select (p.date + p.start_time) at time zone 'America/Sao_Paulo'
$$;

-- Jogadores que ainda podem ser escolhidos
create function public.draft_available(p_pelada bigint)
returns table (profile_id uuid)
language sql stable security definer set search_path = '' as $$
  select pl.profile_id
  from public.presence_list pl
  join public.profiles pr on pr.id = pl.profile_id and pr.status = 'ativo'
  where pl.pelada_id = p_pelada and pl.answer = 'vou' and not pl.waitlisted
    and (pr.type = 'mensalista'
         or exists (select 1 from public.pelada_diaristas d where d.pelada_id = p_pelada and d.profile_id = pl.profile_id))
    and not exists (select 1 from public.team_members m where m.pelada_id = p_pelada and m.profile_id = pl.profile_id)
$$;

-- Registra uma escolha e passa a vez (uso interno)
create function public.draft_apply_pick(p_pelada bigint, p_profile uuid, p_source public.pick_source) returns void
language plpgsql security definer set search_path = '' as $$
declare
  d public.drafts;
  t public.teams;
begin
  select * into d from public.drafts where pelada_id = p_pelada for update;
  select * into t from public.teams
  where pelada_id = p_pelada and captain_order = public.draft_captain_for_pick(d.next_pick);

  insert into public.team_members (pelada_id, team_id, profile_id, pick_number, source)
  values (p_pelada, t.id, p_profile, d.next_pick, p_source);

  update public.drafts
  set next_pick = d.next_pick + 1,
      turn_deadline = case when d.phase = 'turnos' then greatest(coalesce(d.turn_deadline, now()), now()) + interval '10 minutes' end
  where pelada_id = p_pelada;

  perform public.draft_check_done(p_pelada);
end $$;

-- Termina a escolha quando acabam as 16 escolhas ou os disponíveis
create function public.draft_check_done(p_pelada bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.drafts set phase = 'concluida', finished_at = now(), turn_deadline = null
  where pelada_id = p_pelada and phase <> 'concluida'
    and (next_pick > 16 or not exists (select 1 from public.draft_available(p_pelada)));
end $$;

-- Sorteia um disponível para a vez atual (uso interno)
create function public.draft_auto_pick(p_pelada bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare
  chosen uuid;
begin
  select profile_id into chosen from public.draft_available(p_pelada) order by random() limit 1;
  if chosen is null then
    perform public.draft_check_done(p_pelada);
  else
    perform public.draft_apply_pick(p_pelada, chosen, 'sorteio');
  end if;
end $$;

-- Aplica as regras de tempo. Roda a cada minuto (pg_cron) e quando o app vê um prazo vencido.
create function public.draft_tick() returns void
language plpgsql security definer set search_path = '' as $$
declare
  d record;
  guard integer;
begin
  for d in
    select dr.pelada_id, public.pelada_starts_at(p) as starts_at
    from public.drafts dr join public.peladas p on p.id = dr.pelada_id
    where dr.phase <> 'concluida'
  loop
    -- fim das 24 h livres: começam os turnos de 10 min
    update public.drafts set phase = 'turnos', turn_deadline = free_until + interval '10 minutes'
    where pelada_id = d.pelada_id and phase = 'livre' and free_until <= now();

    -- prazos vencidos (ou pelada começando): sorteia até ficar em dia
    guard := 0;
    while guard < 20 and exists (
      select 1 from public.drafts
      where pelada_id = d.pelada_id and phase <> 'concluida'
        and ((phase = 'turnos' and turn_deadline <= now()) or d.starts_at <= now())
    ) loop
      perform public.draft_auto_pick(d.pelada_id);
      guard := guard + 1;
    end loop;
  end loop;
end $$;

-- Admin define os 4 capitães (na ordem). Refaz a escolha se nenhum jogo começou.
create function public.define_captains(p_pelada bigint, p_captains uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare
  p public.peladas;
  i integer;
begin
  if not public.is_admin() then raise exception 'Só admin'; end if;
  select * into p from public.peladas where id = p_pelada;
  if p.status <> 'agendada' then raise exception 'A pelada já começou ou foi encerrada'; end if;
  if array_length(p_captains, 1) <> 4 or (select count(distinct c) from unnest(p_captains) c) <> 4 then
    raise exception 'Escolha 4 capitães diferentes';
  end if;
  if (select count(*) from public.profiles where id = any (p_captains) and type = 'mensalista' and status = 'ativo') <> 4 then
    raise exception 'Os capitães precisam ser mensalistas';
  end if;
  if exists (select 1 from public.games where pelada_id = p_pelada) then
    raise exception 'Já existem jogos nesta pelada';
  end if;

  delete from public.team_members where pelada_id = p_pelada;
  delete from public.teams where pelada_id = p_pelada;
  delete from public.drafts where pelada_id = p_pelada;

  for i in 1..4 loop
    with t as (
      insert into public.teams (pelada_id, captain_order, captain_id)
      values (p_pelada, i, p_captains[i]) returning id
    )
    insert into public.team_members (pelada_id, team_id, profile_id, is_captain, source)
    select p_pelada, t.id, p_captains[i], true, 'admin' from t;
  end loop;

  insert into public.drafts (pelada_id, phase, started_at, free_until, next_pick)
  values (p_pelada, 'livre', now(), now() + interval '24 hours', 1);

  -- capitão também confirma presença
  insert into public.presence (pelada_id, profile_id, answer)
  select p_pelada, c, 'vou' from unnest(p_captains) c
  on conflict (pelada_id, profile_id) do update set answer = 'vou'
    where public.presence.answer <> 'vou';
end $$;

-- Capitão da vez (ou admin) escolhe um jogador
create function public.draft_pick(p_pelada bigint, p_profile uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  d public.drafts;
  t public.teams;
begin
  perform public.draft_tick();
  select * into d from public.drafts where pelada_id = p_pelada for update;
  if d is null or d.phase = 'concluida' then raise exception 'A escolha dos times já terminou'; end if;
  select * into t from public.teams
  where pelada_id = p_pelada and captain_order = public.draft_captain_for_pick(d.next_pick);
  if t.captain_id is distinct from auth.uid() and not public.is_admin() then
    raise exception 'Não é a sua vez';
  end if;
  if not exists (select 1 from public.draft_available(p_pelada) a where a.profile_id = p_profile) then
    raise exception 'Jogador não está disponível';
  end if;
  perform public.draft_apply_pick(p_pelada, p_profile, case when t.captain_id = auth.uid() then 'capitao' else 'admin' end::public.pick_source);
end $$;

-- Kit e cor do time (capitão do time ou admin). Únicos na pelada.
create function public.choose_identity(p_team bigint, p_kit bigint, p_color text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  t public.teams;
begin
  select * into t from public.teams where id = p_team;
  if t.captain_id is distinct from auth.uid() and not public.is_admin() then
    raise exception 'Só o capitão do time';
  end if;
  if p_kit is not null and not exists (select 1 from public.kits where id = p_kit and active) then
    raise exception 'Kit indisponível';
  end if;
  update public.teams set kit_id = p_kit, color = p_color where id = p_team;
exception
  when unique_violation then
    raise exception 'Outro time já escolheu esse kit ou essa cor';
end $$;

-- Sorteio (dia atípico, só admin): substitui os times da pelada. p_teams = [[uuid, ...], ...]
create function public.save_sorteio(p_pelada bigint, p_teams jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  colors text[] := array['azul', 'vermelho', 'branco', 'preto'];
  i integer;
  team_id bigint;
begin
  if not public.is_admin() then raise exception 'Só admin'; end if;
  if jsonb_array_length(p_teams) not between 2 and 4 then raise exception 'De 2 a 4 times'; end if;
  if exists (select 1 from public.games where pelada_id = p_pelada) then
    raise exception 'Já existem jogos nesta pelada';
  end if;

  delete from public.team_members where pelada_id = p_pelada;
  delete from public.teams where pelada_id = p_pelada;
  delete from public.drafts where pelada_id = p_pelada;

  for i in 0..jsonb_array_length(p_teams) - 1 loop
    insert into public.teams (pelada_id, captain_order, color)
    values (p_pelada, i + 1, colors[i + 1]) returning id into team_id;
    insert into public.team_members (pelada_id, team_id, profile_id, source)
    select p_pelada, team_id, value::uuid, 'admin' from jsonb_array_elements_text(p_teams -> i);
  end loop;

  insert into public.drafts (pelada_id, phase, started_at, free_until, next_pick, finished_at)
  values (p_pelada, 'concluida', now(), now(), 17, now());
end $$;

-- Substituição integral (admin): alguém de fora entra no lugar de um jogador do time.
-- p_profile = diarista cadastrado; ou p_guest_name = avulso sem perfil.
create function public.replace_member(p_member bigint, p_profile uuid, p_guest_name text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  m public.team_members;
  guest bigint;
begin
  if not public.is_admin() then raise exception 'Só admin'; end if;
  select * into m from public.team_members where id = p_member and not is_out;
  if m is null then raise exception 'Jogador não está no time'; end if;
  if num_nonnulls(p_profile, nullif(trim(p_guest_name), '')) <> 1 then raise exception 'Escolha quem entra'; end if;

  if p_profile is null then
    insert into public.guests (pelada_id, name, created_by) values (m.pelada_id, trim(p_guest_name), auth.uid()) returning id into guest;
  end if;

  update public.team_members set is_out = true where id = p_member;
  insert into public.team_members (pelada_id, team_id, profile_id, guest_id, source, replaces_member_id)
  values (m.pelada_id, m.team_id, p_profile, guest, 'admin', p_member);
end $$;

-- Admin coloca alguém num time (time incompleto, avulso de última hora)
create function public.add_member(p_team bigint, p_profile uuid, p_guest_name text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  t public.teams;
  guest bigint;
begin
  if not public.is_admin() then raise exception 'Só admin'; end if;
  select * into t from public.teams where id = p_team;
  if num_nonnulls(p_profile, nullif(trim(p_guest_name), '')) <> 1 then raise exception 'Escolha quem entra'; end if;
  if p_profile is null then
    insert into public.guests (pelada_id, name, created_by) values (t.pelada_id, trim(p_guest_name), auth.uid()) returning id into guest;
  end if;
  insert into public.team_members (pelada_id, team_id, profile_id, guest_id, source)
  values (t.pelada_id, p_team, p_profile, guest, 'admin');
end $$;

revoke execute on function
  public.draft_apply_pick(bigint, uuid, public.pick_source), public.draft_check_done(bigint), public.draft_auto_pick(bigint)
from public, anon, authenticated;

revoke execute on function
  public.draft_available(bigint), public.draft_tick(), public.define_captains(bigint, uuid[]),
  public.draft_pick(bigint, uuid), public.choose_identity(bigint, bigint, text),
  public.save_sorteio(bigint, jsonb), public.replace_member(bigint, uuid, text), public.add_member(bigint, uuid, text)
from public, anon;

-- Relógio da escolha: a cada minuto
create extension if not exists pg_cron;
select cron.schedule('draft-tick', '* * * * *', 'select public.draft_tick()');
