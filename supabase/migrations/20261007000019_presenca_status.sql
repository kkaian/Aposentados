-- Presença vira só um status (vai / dúvida / não vai). A escolha dos times não depende mais dela:
--   * disponíveis: mensalistas e diaristas chamados que não disseram "não vou" e ainda não estão em um time;
--   * definir capitães não marca "vou" por eles (cada um responde);
--   * quem já está num time e responde "não vou" sai e deixa uma vaga de diarista no lugar
--     (admin ou ajudante preenche com avulso ou alguém com conta, ou deixa e alguém de outro time completa);
--     se voltar para "vou" antes de a vaga ser preenchida, volta para o time;
--   * "não vou" pode ser respondido até o fim da pelada, mesmo com a lista fechada (emergência);
--   * kit e cor: durante a escolha, o capitão só escolhe na vez dele.

create or replace function public.draft_available(p_pelada bigint)
returns table (profile_id uuid)
language sql stable security definer set search_path = '' as $$
  select pr.id
  from public.profiles pr
  where pr.status = 'ativo'
    and (pr.type = 'mensalista'
         or exists (select 1 from public.pelada_diaristas d where d.pelada_id = p_pelada and d.profile_id = pr.id))
    and not exists (select 1 from public.presence x where x.pelada_id = p_pelada and x.profile_id = pr.id and x.answer = 'nao_vou')
    and not exists (select 1 from public.team_members m where m.pelada_id = p_pelada and m.profile_id = pr.id)
$$;

-- Sorteio: primeiro quem confirmou "vou"; sem ninguém, vira vaga de diarista
create or replace function public.draft_auto_pick(p_pelada bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare
  chosen uuid;
begin
  select a.profile_id into chosen
  from public.draft_available(p_pelada) a
  order by exists (select 1 from public.presence x where x.pelada_id = p_pelada and x.profile_id = a.profile_id and x.answer = 'vou') desc, random()
  limit 1;
  perform public.draft_apply_pick(p_pelada, chosen, 'sorteio');
end $$;

-- Igual à anterior, sem marcar "vou" pelos capitães
create or replace function public.define_captains(p_pelada bigint, p_captains uuid[]) returns void
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
end $$;

-- Kit e cor: durante a escolha, só na vez do capitão (admin pode sempre)
create or replace function public.choose_identity(p_team bigint, p_kit bigint, p_color text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  t public.teams;
  d public.drafts;
begin
  select * into t from public.teams where id = p_team;
  if not public.is_admin() then
    if t.captain_id is distinct from auth.uid() then raise exception 'Só o capitão do time'; end if;
    perform public.draft_tick();
    select * into d from public.drafts where pelada_id = t.pelada_id;
    if d.phase is distinct from 'concluida' and public.draft_captain_for_pick(d.next_pick) <> t.captain_order then
      raise exception 'Kit e cor só na sua vez de escolher';
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

-- Presença: cada um responde a própria. "Vou" com a lista aberta; "não vou" até a pelada acabar.
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
      exists (select 1 from public.profiles where id = auth.uid() and status = 'ativo' and type = 'mensalista')
      or exists (select 1 from public.pelada_diaristas d where d.pelada_id = presence.pelada_id and d.profile_id = auth.uid())
    )
  );

-- Quem está num time e diz "não vou" vira vaga de diarista; voltando para "vou", desfaz (se a vaga ainda estiver livre)
create function private.on_presence_answer() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  m public.team_members;
  slot public.team_members;
  p public.peladas;
  who text;
  team text;
begin
  if new.answer = 'nao_vou' and (tg_op = 'INSERT' or old.answer is distinct from 'nao_vou') then
    select * into m from public.team_members
    where pelada_id = new.pelada_id and profile_id = new.profile_id and not is_out;
    if m.id is null then return null; end if;

    update public.team_members set is_out = true, pick_number = null where id = m.id;
    insert into public.team_members (pelada_id, team_id, pick_number, source, is_slot, replaces_member_id)
    values (m.pelada_id, m.team_id, m.pick_number, m.source, true, m.id);

    select * into p from public.peladas where id = new.pelada_id;
    select name into who from public.profiles where id = new.profile_id;
    select coalesce(k.name, 'Time de ' || split_part(pr.name, ' ', 1), 'Time ' || t.captain_order) into team
    from public.teams t left join public.kits k on k.id = t.kit_id left join public.profiles pr on pr.id = t.captain_id
    where t.id = m.team_id;
    perform private.push(private.admins(), who || ' não vai',
      'Ficou uma vaga de diarista no ' || team || ' (pelada de ' || private.day(p.date) || ').', '/pelada');

  elsif new.answer = 'vou' and tg_op = 'UPDATE' and old.answer = 'nao_vou' then
    select s.* into slot from public.team_members s
    join public.team_members m2 on m2.id = s.replaces_member_id
    where s.pelada_id = new.pelada_id and s.is_slot and m2.profile_id = new.profile_id and m2.is_out;
    if slot.id is null then return null; end if;

    delete from public.team_members where id = slot.id;
    update public.team_members set is_out = false, pick_number = slot.pick_number where id = slot.replaces_member_id;
  end if;
  return null;
end $$;

create trigger presence_answer after insert or update of answer on public.presence
for each row execute function private.on_presence_answer();
