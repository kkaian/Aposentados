-- Capitães invertidos: o admin define os 4 capitães e, em vez dos capitães escolherem, cada mensalista
-- escolhe em qual time quer jogar (24 h). Time com mais de 4 interessados: o capitão corta quem fica fora
-- (sem cortar até o fim das 24 h, corte sorteado). Quem foi cortado escolhe outro time dentro das 24 h;
-- depois disso, quem sobrou vai para os times que precisam de gente (mensalistas antes dos diaristas
-- chamados) e o que ainda faltar vira vaga de diarista. Kit e cor: o capitão escolhe quando quiser, até a
-- véspera (quem escolhe primeiro bloqueia). O admin pode fechar os times antes e ajustar depois.

alter table public.drafts
  add column mode text not null default 'capitaes' constraint drafts_mode_valid check (mode in ('capitaes', 'invertidos'));

create table public.invert_choices (
  pelada_id bigint not null references public.peladas (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  -- nulo: ainda sem time (saiu da lista ou foi cortado)
  team_id bigint references public.teams (id) on delete cascade,
  -- times de onde foi cortado (não volta para eles)
  blocked bigint[] not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (pelada_id, profile_id)
);

alter table public.invert_choices enable row level security;
create policy invert_choices_read on public.invert_choices for select to authenticated using (public.is_active());
revoke insert, update, delete on public.invert_choices from authenticated;
revoke all on public.invert_choices from anon;

alter publication supabase_realtime add table public.invert_choices;

create function private.hhmm(t timestamptz) returns text
language sql stable as $$ select to_char(t at time zone 'America/Sao_Paulo', 'DD/MM "às" HH24:MI') $$;

-- Admin define os capitães no modo invertido
create function public.define_captains_inverted(p_pelada bigint, p_captains uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare
  p public.peladas;
  d public.drafts;
begin
  perform public.define_captains(p_pelada, p_captains);
  update public.drafts set mode = 'invertidos', next_pick = 17 where pelada_id = p_pelada returning * into d;
  select * into p from public.peladas where id = p_pelada;
  perform private.push(
    array(select a.profile_id from public.draft_available(p_pelada) a
          join public.profiles pr on pr.id = a.profile_id and pr.type = 'mensalista'),
    'Escolha o seu time!',
    'Capitães invertidos na pelada de ' || private.day(p.date) || ': escolha em qual time quer jogar até ' || private.hhmm(d.free_until) || '.',
    '/times');
end $$;

-- Escolha do mensalista (dá para trocar até o fim das 24 h)
create function public.invert_choose(p_team bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare
  t public.teams;
  d public.drafts;
  c public.invert_choices;
  total integer;
begin
  perform public.draft_tick();
  select * into t from public.teams where id = p_team;
  select * into d from public.drafts where pelada_id = t.pelada_id;
  if d.mode is distinct from 'invertidos' or d.phase <> 'livre' then raise exception 'A escolha dos times já terminou'; end if;
  if not exists (select 1 from public.profiles where id = auth.uid() and type = 'mensalista' and status = 'ativo') then
    raise exception 'Só mensalistas escolhem o time; diaristas entram onde faltar gente';
  end if;
  if not exists (select 1 from public.draft_available(t.pelada_id) a where a.profile_id = auth.uid()) then
    raise exception 'Você não está disponível para esta pelada (já está num time ou disse que não vai)';
  end if;
  select * into c from public.invert_choices where pelada_id = t.pelada_id and profile_id = auth.uid();
  if p_team = any (coalesce(c.blocked, '{}')) then raise exception 'O capitão já te cortou deste time: escolha outro'; end if;

  insert into public.invert_choices (pelada_id, profile_id, team_id) values (t.pelada_id, auth.uid(), p_team)
  on conflict (pelada_id, profile_id) do update set team_id = p_team, updated_at = now();

  -- passou de 4: o capitão precisa cortar alguém
  select count(*) into total from public.invert_choices where team_id = p_team;
  if total = 5 then
    perform private.push(array[t.captain_id], 'Seu time tem mais de 4 querendo jogar',
      'Escolha quem fica fora até ' || private.hhmm(d.free_until) || '. Se não escolher, o app sorteia.', '/times');
  end if;
end $$;

create function public.invert_leave(p_pelada bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.drafts where pelada_id = p_pelada and mode = 'invertidos' and phase = 'livre') then
    raise exception 'A escolha dos times já terminou';
  end if;
  update public.invert_choices set team_id = null, updated_at = now() where pelada_id = p_pelada and profile_id = auth.uid();
end $$;

-- Capitão corta um interessado (só quando o time passou de 4)
create function public.invert_cut(p_pelada bigint, p_profile uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  c public.invert_choices;
  t public.teams;
  d public.drafts;
begin
  select * into d from public.drafts where pelada_id = p_pelada;
  if d.mode is distinct from 'invertidos' or d.phase <> 'livre' then raise exception 'A escolha dos times já terminou'; end if;
  select * into c from public.invert_choices where pelada_id = p_pelada and profile_id = p_profile;
  select * into t from public.teams where id = c.team_id;
  if t.id is null then raise exception 'Esse jogador não está na lista do seu time'; end if;
  if t.captain_id is distinct from auth.uid() then raise exception 'Só o capitão do time corta'; end if;
  if (select count(*) from public.invert_choices where team_id = t.id) <= 4 then
    raise exception 'O time tem 4 ou menos interessados: ninguém precisa sair';
  end if;
  update public.invert_choices set team_id = null, blocked = blocked || t.id, updated_at = now()
  where pelada_id = p_pelada and profile_id = p_profile;
  perform private.push(array[p_profile], 'Você ficou fora do time',
    coalesce((select name from public.profiles where id = t.captain_id), 'O capitão') || ' não te escolheu. Escolha outro time até '
      || private.hhmm(d.free_until) || '; depois disso, o app te põe onde faltar gente.', '/times');
end $$;

-- Fecha os times: corte sorteado, escolhas viram time, sobra vai para onde falta, o resto vira vaga
create function private.invert_finalize(p_pelada bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare
  d public.drafts;
  t record;
begin
  select * into d from public.drafts where pelada_id = p_pelada for update;
  if d.mode is distinct from 'invertidos' or d.phase = 'concluida' then return; end if;

  -- só vale a escolha de quem continua disponível (não disse "não vou", não entrou em time)
  update public.invert_choices c set team_id = null
  where c.pelada_id = p_pelada and c.team_id is not null
    and not exists (select 1 from public.draft_available(p_pelada) a where a.profile_id = c.profile_id);

  -- time com mais de 4: corte sorteado
  for t in select id from public.teams where pelada_id = p_pelada loop
    update public.invert_choices set team_id = null, blocked = blocked || t.id
    where pelada_id = p_pelada and profile_id in (
      select profile_id from public.invert_choices where team_id = t.id order by random()
      offset 4
    );
  end loop;

  insert into public.team_members (pelada_id, team_id, profile_id, source)
  select p_pelada, c.team_id, c.profile_id, 'capitao'
  from public.invert_choices c where c.pelada_id = p_pelada and c.team_id is not null
  order by c.updated_at;

  perform private.fill_teams(p_pelada);
  update public.drafts set phase = 'concluida', finished_at = now(), turn_deadline = null where pelada_id = p_pelada;
end $$;

-- Completa os times com 5: quem sobrou vai para o time com menos gente (mensalistas e quem confirmou
-- primeiro); o que ainda faltar vira vaga de diarista. Usado pelos capitães invertidos e pelo bilhete dourado.
create function private.fill_teams(p_pelada bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare
  t record;
  extra record;
  target bigint;
begin
  for extra in
    select a.profile_id from public.draft_available(p_pelada) a join public.profiles pr on pr.id = a.profile_id
    order by pr.type = 'mensalista' desc,
      exists (select 1 from public.presence x where x.pelada_id = p_pelada and x.profile_id = a.profile_id and x.answer = 'vou') desc,
      random()
  loop
    select tm.id into target from public.teams tm
    where tm.pelada_id = p_pelada
      and (select count(*) from public.team_members m where m.team_id = tm.id and not m.is_out) < 5
    order by (select count(*) from public.team_members m where m.team_id = tm.id and not m.is_out), random()
    limit 1;
    exit when target is null;
    insert into public.team_members (pelada_id, team_id, profile_id, source) values (p_pelada, target, extra.profile_id, 'sorteio');
  end loop;

  -- o que faltar vira vaga de diarista
  for t in select id from public.teams where pelada_id = p_pelada loop
    insert into public.team_members (pelada_id, team_id, source, is_slot)
    select p_pelada, t.id, 'sorteio', true
    from generate_series(1, 5 - (select count(*) from public.team_members m where m.team_id = t.id and not m.is_out));
  end loop;
end $$;

-- Admin fecha os times antes das 24 h
create function public.invert_close(p_pelada bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Só admin'; end if;
  if not exists (select 1 from public.drafts where pelada_id = p_pelada and mode = 'invertidos' and phase <> 'concluida') then
    raise exception 'Não há escolha de capitães invertidos aberta';
  end if;
  perform private.invert_finalize(p_pelada);
end $$;

-- Quem diz "não vou" sai da lista do time escolhido
create function private.on_presence_invert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.answer = 'nao_vou' then
    update public.invert_choices set team_id = null, updated_at = now() where pelada_id = new.pelada_id and profile_id = new.profile_id;
  end if;
  return null;
end $$;

create trigger presence_invert after insert or update of answer on public.presence
for each row execute function private.on_presence_invert();

-- O relógio da escolha: no modo invertido, fecha tudo no fim das 24 h (ou quando a pelada começa)
create or replace function public.draft_tick() returns void
language plpgsql security definer set search_path = '' as $$
declare
  d record;
  guard integer;
begin
  for d in
    select dr.pelada_id, dr.mode, dr.free_until, public.pelada_starts_at(p) as starts_at
    from public.drafts dr join public.peladas p on p.id = dr.pelada_id
    where dr.phase <> 'concluida'
  loop
    if d.mode = 'invertidos' then
      if d.free_until <= now() or d.starts_at <= now() then
        perform private.invert_finalize(d.pelada_id);
      end if;
      continue;
    end if;

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

-- Kit e cor: na escolha normal, só na vez do capitão; no modo invertido, quando quiser (até a véspera)
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
  if d.phase is not null and d.phase <> 'concluida' and d.mode = 'capitaes' then
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

revoke execute on function
  public.define_captains_inverted(bigint, uuid[]), public.invert_choose(bigint), public.invert_leave(bigint),
  public.invert_cut(bigint, uuid), public.invert_close(bigint)
from public, anon;
