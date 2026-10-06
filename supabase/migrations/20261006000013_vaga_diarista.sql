-- "Vaga de diarista": quando acabam os disponíveis, a escolha segue com vagas a preencher
-- no dia (avulso, diarista com conta ou mensalista de última hora), por admin ou ajudante.
-- "Emprestar jogador": alguém de outro time (ou avulso) completa um time só naquele jogo.

alter table public.team_members add column is_slot boolean not null default false;
alter table public.team_members drop constraint team_members_check;
alter table public.team_members add constraint team_members_who check (
  (is_slot and profile_id is null and guest_id is null)
  or (not is_slot and (profile_id is null) <> (guest_id is null))
);

-- Escolha (ou vaga, com p_profile nulo) e passa a vez
create or replace function public.draft_apply_pick(p_pelada bigint, p_profile uuid, p_source public.pick_source) returns void
language plpgsql security definer set search_path = '' as $$
declare
  d public.drafts;
  t public.teams;
begin
  select * into d from public.drafts where pelada_id = p_pelada for update;
  select * into t from public.teams
  where pelada_id = p_pelada and captain_order = public.draft_captain_for_pick(d.next_pick);

  insert into public.team_members (pelada_id, team_id, profile_id, pick_number, source, is_slot)
  values (p_pelada, t.id, p_profile, d.next_pick, p_source, p_profile is null);

  update public.drafts
  set next_pick = d.next_pick + 1,
      turn_deadline = case when d.phase = 'turnos' then greatest(coalesce(d.turn_deadline, now()), now()) + interval '10 minutes' end
  where pelada_id = p_pelada;

  perform public.draft_check_done(p_pelada);
end $$;

-- A escolha só termina com as 16 escolhas (vagas contam)
create or replace function public.draft_check_done(p_pelada bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.drafts set phase = 'concluida', finished_at = now(), turn_deadline = null
  where pelada_id = p_pelada and phase <> 'concluida' and next_pick > 16;
end $$;

-- Prazo vencido: sorteia um disponível; sem ninguém, vira vaga de diarista
create or replace function public.draft_auto_pick(p_pelada bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare
  chosen uuid;
begin
  select profile_id into chosen from public.draft_available(p_pelada) order by random() limit 1;
  perform public.draft_apply_pick(p_pelada, chosen, 'sorteio');
end $$;

-- Capitão da vez (ou admin) escolhe "Vaga de diarista": só quando não sobra ninguém
create function public.draft_pick_slot(p_pelada bigint) returns void
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
  if exists (select 1 from public.draft_available(p_pelada)) then
    raise exception 'Ainda há jogadores disponíveis';
  end if;
  perform public.draft_apply_pick(p_pelada, null, case when t.captain_id = auth.uid() then 'capitao' else 'admin' end::public.pick_source);
end $$;

-- Preencher a vaga no dia (admin ou ajudante), com pagamento opcional para o caixa
create function public.fill_slot(
  p_member bigint, p_profile uuid, p_guest_name text, p_paid numeric default null, p_holder uuid default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  m public.team_members;
  guest bigint;
  live bigint;
  who text;
begin
  select * into m from public.team_members where id = p_member and is_slot;
  if m is null then raise exception 'Vaga não encontrada ou já preenchida'; end if;
  if not public.can_record(m.pelada_id) then raise exception 'Só admin ou ajudante da pelada'; end if;
  if num_nonnulls(p_profile, nullif(trim(p_guest_name), '')) <> 1 then raise exception 'Escolha quem entra'; end if;
  if p_paid is not null and p_paid > 0 and not public.is_holder(coalesce(p_holder, auth.uid())) then
    raise exception 'O dinheiro precisa ficar com um admin ou o dono';
  end if;
  if p_profile is not null and exists (
    select 1 from public.team_members where pelada_id = m.pelada_id and profile_id = p_profile and not is_out
  ) then
    raise exception 'Esse jogador já está em um time desta pelada';
  end if;

  if p_profile is null then
    insert into public.guests (pelada_id, name, created_by) values (m.pelada_id, trim(p_guest_name), auth.uid()) returning id into guest;
  end if;
  update public.team_members set is_slot = false, profile_id = p_profile, guest_id = guest, source = 'admin' where id = p_member;

  -- time em campo agora: já entra no jogo ao vivo
  select g.id into live from public.games g
  where g.pelada_id = m.pelada_id and g.status = 'ao_vivo' and m.team_id in (g.team1_id, g.team2_id);
  if live is not null then
    insert into public.game_lineup (game_id, team_id, profile_id, guest_id, entered_minute)
    select live, m.team_id, p_profile, guest, least(60, extract(epoch from (now() - started_at))::int / 60)
    from public.games where id = live;
  end if;

  if p_paid is not null and p_paid > 0 then
    who := coalesce((select name from public.profiles where id = p_profile), trim(p_guest_name));
    insert into public.cash_entries (kind, category, description, amount, holder_id, payer_id, payer_name, pelada_id, date)
    select 'entrada', 'diarista', 'Diarista · ' || who, p_paid, coalesce(p_holder, auth.uid()), p_profile,
      case when p_profile is null then trim(p_guest_name) end, m.pelada_id, p.date
    from public.peladas p where p.id = m.pelada_id;
  end if;
end $$;

-- Emprestar jogador: entra só neste jogo, sem tirar ninguém (lesão, time com 4)
create function public.lend_player(p_game bigint, p_team bigint, p_profile uuid, p_guest_name text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  g public.games;
  guest bigint;
begin
  select * into g from public.games where id = p_game;
  if not (public.is_admin() or g.recorder_id = auth.uid() or public.is_helper(g.pelada_id)) then
    raise exception 'Só admin, ajudante ou o responsável pelo jogo';
  end if;
  if g.status <> 'ao_vivo' then raise exception 'Inicie o jogo antes de emprestar um jogador'; end if;
  if p_team not in (g.team1_id, g.team2_id) then raise exception 'Time não está neste jogo'; end if;
  if num_nonnulls(p_profile, nullif(trim(p_guest_name), '')) <> 1 then raise exception 'Escolha quem entra'; end if;
  if p_profile is not null and exists (
    select 1 from public.game_lineup where game_id = p_game and profile_id = p_profile and left_minute is null
  ) then
    raise exception 'Esse jogador já está em campo';
  end if;
  if p_profile is null then
    insert into public.guests (pelada_id, name, created_by) values (g.pelada_id, trim(p_guest_name), auth.uid()) returning id into guest;
  end if;
  insert into public.game_lineup (game_id, team_id, profile_id, guest_id, entered_minute)
  values (p_game, p_team, p_profile, guest, least(60, extract(epoch from (now() - g.started_at))::int / 60));
end $$;

-- Vagas não preenchidas não entram em campo
create or replace function public.start_game(p_game bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare
  g public.games;
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

  update public.peladas set status = 'em_andamento' where id = g.pelada_id and status = 'agendada';
end $$;

-- Troca integral não se aplica a vaga vazia (use preencher vaga)
create or replace function public.guard_slot_replace() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.replaces_member_id is not null and (select is_slot from public.team_members where id = new.replaces_member_id) then
    raise exception 'Para vaga de diarista, use "Preencher vaga"';
  end if;
  return new;
end $$;

create trigger team_members_guard_slot before insert on public.team_members
for each row execute function public.guard_slot_replace();

revoke execute on function
  public.draft_pick_slot(bigint), public.fill_slot(bigint, uuid, text, numeric, uuid),
  public.lend_player(bigint, bigint, uuid, text)
from public, anon;
