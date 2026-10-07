-- Kit e cor depois da escolha: o capitão que ficou sem kit ou sem cor pode completar até o fim
-- da véspera da pelada (meia-noite do dia, fuso de São Paulo). Depois disso fica o padrão
-- ("Time de Fulano", sem cor). Quem já escolheu os dois não muda mais. O admin ajusta sempre
-- depois da escolha.

create function public.identity_deadline(p public.peladas) returns timestamptz
language sql stable as $$
  select p.date::timestamp at time zone 'America/Sao_Paulo'
$$;

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
  if d.phase is not null and d.phase <> 'concluida' then
    -- escolha em andamento: só o capitão do time, na vez dele
    if t.captain_id is distinct from auth.uid() then raise exception 'Só o capitão do time, na vez dele'; end if;
    if public.draft_captain_for_pick(d.next_pick) <> t.captain_order then
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

-- Times fechados: avisa todos e lembra o capitão que ficou sem kit ou cor
create or replace function private.on_draft_done() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  p public.peladas;
begin
  select * into p from public.peladas where id = new.pelada_id;
  perform private.push(
    array(select profile_id from public.team_members where pelada_id = new.pelada_id and profile_id is not null and not is_out),
    'Times definidos', 'Os times da pelada de ' || private.day(p.date) || ' estão fechados. Veja o seu.', '/times');
  if now() < public.identity_deadline(p) then
    perform private.push(
      array(select captain_id from public.teams
            where pelada_id = new.pelada_id and captain_id is not null and (kit_id is null or color is null)),
      'Falta o kit do seu time', 'Escolha kit e cor até o fim da véspera da pelada. Depois fica o padrão.', '/times/meu');
  end if;
  return null;
end $$;
