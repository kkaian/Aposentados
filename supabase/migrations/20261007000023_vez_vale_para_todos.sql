-- Durante a escolha, só o capitão da vez escolhe jogador, vaga de diarista, kit e cor
-- (antes o admin podia a qualquer hora). Depois que a escolha termina, o admin ajusta kit e cor normalmente.

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
  where pelada_id = p_pelada and captain_order = public.draft_captain_for_pick(d.next_pick);
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
  where pelada_id = p_pelada and captain_order = public.draft_captain_for_pick(d.next_pick);
  if t.captain_id is distinct from auth.uid() then raise exception 'Não é a sua vez'; end if;
  if exists (select 1 from public.draft_available(p_pelada)) then
    raise exception 'Ainda há jogadores disponíveis';
  end if;
  perform public.draft_apply_pick(p_pelada, null, 'capitao');
end $$;

create or replace function public.choose_identity(p_team bigint, p_kit bigint, p_color text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  t public.teams;
  d public.drafts;
begin
  select * into t from public.teams where id = p_team;
  perform public.draft_tick();
  select * into d from public.drafts where pelada_id = t.pelada_id;
  if d.phase is not null and d.phase <> 'concluida' then
    -- escolha em andamento: só o capitão do time, na vez dele
    if t.captain_id is distinct from auth.uid() then raise exception 'Só o capitão do time, na vez dele'; end if;
    if public.draft_captain_for_pick(d.next_pick) <> t.captain_order then
      raise exception 'Kit e cor só na sua vez de escolher';
    end if;
  elsif t.captain_id is distinct from auth.uid() and not public.is_admin() then
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
