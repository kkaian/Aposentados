-- Corrigir e desfazer (14/10/2026): o que antes não tinha volta.
-- - Dono exclui pelada ou jogo, confirmando ao digitar "aposentados fc".
-- - "Faltou": tira o jogador dos jogos (e do time) mesmo depois de encerrada a pelada.
-- - Editar os times: trocar, mover, tirar, adicionar, desfazer saída, criar e excluir vaga.
-- - Desfazer a última escolha, reabrir pelada, jogadores (desativar, renomear, aprovar recusado)
--   e pagamentos (desfazer "Já paguei", editar e excluir cobrança).

-- ============================================================
-- Excluir sem desfazer a troca em campo
-- ============================================================

-- Excluir uma substituição desfaz a troca em campo. Ao excluir um jogo inteiro, ou ao tirar
-- de um jogo quem não jogou, a troca precisa ficar: a flag app.keep_lineup pula o desfazer.
create or replace function public.revert_substitution() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.type = 'substituicao' and coalesce(current_setting('app.keep_lineup', true), '') <> 'on' then
    delete from public.game_lineup
    where id = (
      select id from public.game_lineup
      where game_id = old.game_id and team_id = old.team_id and entered_minute = old.minute
        and (profile_id = old.sub_in_id or guest_id = old.sub_in_guest_id)
      order by id desc limit 1
    );
    update public.game_lineup set left_minute = null
    where id = (
      select id from public.game_lineup
      where game_id = old.game_id and team_id = old.team_id and left_minute = old.minute
        and (profile_id = old.player_id or guest_id = old.player_guest_id)
      order by id desc limit 1
    );
  end if;
  return old;
end $$;

-- ============================================================
-- Dono exclui pelada ou jogo
-- ============================================================

create function private.check_owner_confirm(p_confirm text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_owner() then raise exception 'Só o dono'; end if;
  if lower(regexp_replace(trim(coalesce(p_confirm, '')), '\s+', ' ', 'g')) <> 'aposentados fc' then
    raise exception 'Digite "aposentados fc" para confirmar';
  end if;
end $$;

-- Leva junto times, jogos, eventos, presença e avulsos. O dinheiro de diarista lançado
-- no caixa é estornado (o lançamento fica, com o motivo).
create function public.delete_pelada(p_pelada bigint, p_confirm text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  e bigint;
begin
  perform private.check_owner_confirm(p_confirm);
  if not exists (select 1 from public.peladas where id = p_pelada) then raise exception 'Pelada não encontrada'; end if;
  for e in select id from public.cash_entries where pelada_id = p_pelada and voided_at is null loop
    perform public.cash_void(e, 'Pelada excluída');
  end loop;
  perform set_config('app.keep_lineup', 'on', true);
  delete from public.peladas where id = p_pelada;
  perform set_config('app.keep_lineup', 'off', true);
end $$;

-- Os jogos seguintes são renumerados (Jogo 1, 2, 3... sem buraco)
create function public.delete_game(p_game bigint, p_confirm text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  g public.games;
begin
  perform private.check_owner_confirm(p_confirm);
  select * into g from public.games where id = p_game for update;
  if g.id is null then raise exception 'Jogo não encontrado'; end if;
  perform set_config('app.keep_lineup', 'on', true);
  delete from public.games where id = p_game;
  perform set_config('app.keep_lineup', 'off', true);
  -- em dois passos por causa do unique (pelada_id, number)
  update public.games set number = number + 1000 where pelada_id = g.pelada_id and number > g.number;
  update public.games set number = number - 1001 where pelada_id = g.pelada_id and number > 1000;
end $$;

-- ============================================================
-- Faltou: tirar dos jogos quem não jogou
-- ============================================================

-- Tira a pessoa do elenco do jogo. Substituições dela (saindo ou entrando) somem da linha do
-- tempo, mas quem entrou no lugar dela continua em campo. Gol, assistência ou cartão bloqueiam.
create function private.drop_from_game(p_game bigint, p_profile uuid, p_guest bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare
  n smallint;
begin
  select number into n from public.games where id = p_game;
  if exists (
    select 1 from public.game_events e
    where e.game_id = p_game and e.type <> 'substituicao'
      and (p_profile in (e.player_id, e.assist_id) or p_guest in (e.player_guest_id, e.assist_guest_id))
  ) then
    raise exception 'Tem gol, assistência ou cartão dele no jogo %: exclua esses eventos antes', n;
  end if;
  perform set_config('app.keep_lineup', 'on', true);
  delete from public.game_events e
  where e.game_id = p_game and e.type = 'substituicao'
    and (p_profile in (e.player_id, e.sub_in_id) or p_guest in (e.player_guest_id, e.sub_in_guest_id));
  perform set_config('app.keep_lineup', 'off', true);
  delete from public.game_lineup l
  where l.game_id = p_game and (l.profile_id = p_profile or l.guest_id = p_guest);
end $$;

-- "Não jogou este jogo": admin (jogo ao vivo: também o ajudante, para desfazer um empréstimo)
create function public.remove_from_game(p_game bigint, p_profile uuid, p_guest bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare
  g public.games;
begin
  select * into g from public.games where id = p_game;
  if g.id is null then raise exception 'Jogo não encontrado'; end if;
  if not (public.is_admin() or (g.status = 'ao_vivo' and public.is_helper(g.pelada_id))) then
    raise exception 'Só admin (ou ajudante, com o jogo ao vivo)';
  end if;
  if num_nonnulls(p_profile, p_guest) <> 1 then raise exception 'Escolha o jogador'; end if;
  if not exists (select 1 from public.game_lineup where game_id = p_game and (profile_id = p_profile or guest_id = p_guest)) then
    raise exception 'Ele não está neste jogo';
  end if;
  perform private.drop_from_game(p_game, p_profile, p_guest);
end $$;

-- "Faltou à pelada": sai de todos os jogos e do time (não conta jogo, vitória nem Seleção do mês).
-- Pelada em andamento: fica vaga de diarista no lugar, como no "Não vou". Encerrada: só sai.
create function public.mark_absent(p_pelada bigint, p_profile uuid, p_guest bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare
  p public.peladas;
  m public.team_members;
  g bigint;
  list text;
begin
  if not public.is_admin() then raise exception 'Só admin'; end if;
  if num_nonnulls(p_profile, p_guest) <> 1 then raise exception 'Escolha o jogador'; end if;
  select * into p from public.peladas where id = p_pelada;
  if p.id is null then raise exception 'Pelada não encontrada'; end if;

  -- confere todos os jogos antes de mexer em qualquer um
  select string_agg(distinct gm.number::text, ', ') into list
  from public.games gm join public.game_events e on e.game_id = gm.id
  where gm.pelada_id = p_pelada and e.type <> 'substituicao'
    and (p_profile in (e.player_id, e.assist_id) or p_guest in (e.player_guest_id, e.assist_guest_id));
  if list is not null then
    raise exception 'Tem gol, assistência ou cartão dele (jogo %): exclua esses eventos antes', list;
  end if;

  for g in
    select distinct l.game_id from public.game_lineup l join public.games gm on gm.id = l.game_id
    where gm.pelada_id = p_pelada and (l.profile_id = p_profile or l.guest_id = p_guest)
  loop
    perform private.drop_from_game(g, p_profile, p_guest);
  end loop;

  select * into m from public.team_members
  where pelada_id = p_pelada and not is_out and (profile_id = p_profile or guest_id = p_guest);

  if m.id is not null and (p.status = 'encerrada' or p_guest is not null) then
    update public.team_members set is_out = true,
      pick_number = case when p.status = 'encerrada' then pick_number end
    where id = m.id;
    if p.status <> 'encerrada' then
      insert into public.team_members (pelada_id, team_id, pick_number, source, is_slot, replaces_member_id)
      values (m.pelada_id, m.team_id, m.pick_number, m.source, true, m.id);
    end if;
  end if;

  -- presença: "não vai" (em andamento, o gatilho da presença cria a vaga e avisa os admins)
  if p_profile is not null then
    insert into public.presence (pelada_id, profile_id, answer) values (p_pelada, p_profile, 'nao_vou')
    on conflict (pelada_id, profile_id) do update set answer = 'nao_vou';
  end if;
end $$;

-- ============================================================
-- Editar os times (admin), fora da escolha dos capitães
-- ============================================================

create function private.check_team_edit(p_pelada bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Só admin'; end if;
  if exists (select 1 from public.drafts where pelada_id = p_pelada and phase <> 'concluida') then
    raise exception 'A escolha dos times ainda está rolando: espere terminar (ou desfaça a última escolha)';
  end if;
end $$;

-- A pessoa não pode estar (nem ter estado) em outro time da pelada
create function private.check_not_in_pelada(p_pelada bigint, p_profile uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  was_out boolean;
begin
  if p_profile is null then return; end if;
  select is_out into was_out from public.team_members where pelada_id = p_pelada and profile_id = p_profile;
  if was_out then raise exception 'Ele saiu de um time nesta pelada: use "Desfazer saída" no time dele'; end if;
  if was_out is not null then raise exception 'Esse jogador já está em um time desta pelada'; end if;
end $$;

-- Jogo ao vivo do time: quem sai deixa o campo e quem entra já entra
create function private.live_lineup_swap(p_team bigint, p_out_profile uuid, p_out_guest bigint, p_in_profile uuid, p_in_guest bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare
  g public.games;
  mins integer;
begin
  select * into g from public.games where status = 'ao_vivo' and p_team in (team1_id, team2_id) limit 1;
  if g.id is null then return; end if;
  mins := least(60, extract(epoch from (now() - g.started_at))::int / 60);
  if num_nonnulls(p_out_profile, p_out_guest) = 1 then
    update public.game_lineup set left_minute = mins
    where game_id = g.id and team_id = p_team and left_minute is null
      and (profile_id = p_out_profile or guest_id = p_out_guest);
  end if;
  if num_nonnulls(p_in_profile, p_in_guest) = 1 then
    insert into public.game_lineup (game_id, team_id, profile_id, guest_id, entered_minute)
    values (g.id, p_team, p_in_profile, p_in_guest, mins);
  end if;
end $$;

-- Troca quem está nesta posição do time (corrige a vaga preenchida com a pessoa errada)
create function public.swap_member(p_member bigint, p_profile uuid, p_guest_name text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  m public.team_members;
  guest bigint;
begin
  select * into m from public.team_members where id = p_member and not is_out and not is_slot;
  if m.id is null then raise exception 'Jogador não está no time'; end if;
  perform private.check_team_edit(m.pelada_id);
  if m.is_captain then raise exception 'Para o capitão, use "Trocar capitão"'; end if;
  if num_nonnulls(p_profile, nullif(trim(p_guest_name), '')) <> 1 then raise exception 'Escolha quem entra'; end if;
  perform private.check_not_in_pelada(m.pelada_id, p_profile);
  if p_profile is null then
    insert into public.guests (pelada_id, name, created_by) values (m.pelada_id, trim(p_guest_name), auth.uid()) returning id into guest;
  end if;
  update public.team_members set profile_id = p_profile, guest_id = guest, source = 'admin' where id = p_member;
  perform private.live_lineup_swap(m.team_id, m.profile_id, m.guest_id, p_profile, guest);
end $$;

-- Tira do time: a posição vira vaga de diarista
create function public.vacate_member(p_member bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare
  m public.team_members;
begin
  select * into m from public.team_members where id = p_member and not is_out and not is_slot;
  if m.id is null then raise exception 'Jogador não está no time'; end if;
  perform private.check_team_edit(m.pelada_id);
  if m.is_captain then raise exception 'Para o capitão, use "Trocar capitão"'; end if;
  update public.team_members set is_slot = true, profile_id = null, guest_id = null, source = 'admin' where id = p_member;
  perform private.live_lineup_swap(m.team_id, m.profile_id, m.guest_id, null, null);
end $$;

create function public.move_member(p_member bigint, p_team bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare
  m public.team_members;
begin
  select * into m from public.team_members where id = p_member and not is_out;
  if m.id is null then raise exception 'Jogador não está no time'; end if;
  perform private.check_team_edit(m.pelada_id);
  if m.is_captain then raise exception 'O capitão não muda de time (troque o capitão antes)'; end if;
  if m.team_id = p_team then raise exception 'Ele já está neste time'; end if;
  if not exists (select 1 from public.teams where id = p_team and pelada_id = m.pelada_id) then
    raise exception 'Time não é desta pelada';
  end if;
  update public.team_members set team_id = p_team where id = p_member;
  perform private.live_lineup_swap(m.team_id, m.profile_id, m.guest_id, null, null);
  perform private.live_lineup_swap(p_team, null, null, m.profile_id, m.guest_id);
end $$;

-- Desfaz a saída (disse "não vou", faltou ou substituição integral): quem entrou no lugar sai
create function public.restore_member(p_member bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare
  o public.team_members;
  cur bigint;
  nxt public.team_members;
  chain bigint[] := '{}';
  pick smallint;
  active public.team_members;
begin
  select * into o from public.team_members where id = p_member and is_out;
  if o.id is null then raise exception 'Ele não saiu do time'; end if;
  perform private.check_team_edit(o.pelada_id);

  -- segue a corrente de quem entrou no lugar (ex.: vaga preenchida e depois trocada)
  cur := o.id;
  loop
    select * into nxt from public.team_members where replaces_member_id = cur order by id desc limit 1;
    exit when nxt.id is null;
    chain := chain || nxt.id;
    pick := coalesce(pick, nxt.pick_number);
    if not nxt.is_out then active := nxt; end if;
    cur := nxt.id;
    nxt := null;
  end loop;

  delete from public.team_members where id = any (chain);
  update public.team_members set is_out = false, pick_number = coalesce(pick_number, pick) where id = o.id;
  if active.id is not null then
    perform private.live_lineup_swap(o.team_id, active.profile_id, active.guest_id, o.profile_id, o.guest_id);
  else
    perform private.live_lineup_swap(o.team_id, null, null, o.profile_id, o.guest_id);
  end if;
  -- volta a constar como "vai" (o gatilho não acha vaga, porque ele já voltou ao time)
  if o.profile_id is not null then
    update public.presence set answer = 'vou' where pelada_id = o.pelada_id and profile_id = o.profile_id and answer = 'nao_vou';
  end if;
end $$;

create function public.add_slot(p_team bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare
  t public.teams;
begin
  select * into t from public.teams where id = p_team;
  if t.id is null then raise exception 'Time não encontrado'; end if;
  perform private.check_team_edit(t.pelada_id);
  insert into public.team_members (pelada_id, team_id, source, is_slot) values (t.pelada_id, p_team, 'admin', true);
end $$;

create function public.delete_slot(p_member bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare
  m public.team_members;
begin
  select * into m from public.team_members where id = p_member and is_slot;
  if m.id is null then raise exception 'Vaga não encontrada'; end if;
  perform private.check_team_edit(m.pelada_id);
  delete from public.team_members where id = p_member;
end $$;

-- Admin coloca alguém num time (com conta ou avulso)
create or replace function public.add_member(p_team bigint, p_profile uuid, p_guest_name text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  t public.teams;
  guest bigint;
begin
  select * into t from public.teams where id = p_team;
  if t.id is null then raise exception 'Time não encontrado'; end if;
  perform private.check_team_edit(t.pelada_id);
  if num_nonnulls(p_profile, nullif(trim(p_guest_name), '')) <> 1 then raise exception 'Escolha quem entra'; end if;
  perform private.check_not_in_pelada(t.pelada_id, p_profile);
  if p_profile is null then
    insert into public.guests (pelada_id, name, created_by) values (t.pelada_id, trim(p_guest_name), auth.uid()) returning id into guest;
  end if;
  insert into public.team_members (pelada_id, team_id, profile_id, guest_id, source)
  values (t.pelada_id, p_team, p_profile, guest, 'admin');
  perform private.live_lineup_swap(p_team, null, null, p_profile, guest);
end $$;

-- ============================================================
-- Desfazer a última escolha (capitão tocou errado)
-- ============================================================

create function public.draft_undo(p_pelada bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare
  d public.drafts;
  p public.peladas;
  m public.team_members;
begin
  if not public.is_admin() then raise exception 'Só admin'; end if;
  select * into d from public.drafts where pelada_id = p_pelada for update;
  if d.pelada_id is null then raise exception 'Esta pelada não tem escolha dos times'; end if;
  if d.next_pick <= 1 then raise exception 'Nenhuma escolha para desfazer'; end if;
  if exists (select 1 from public.games where pelada_id = p_pelada) then raise exception 'Já existem jogos nesta pelada'; end if;
  select * into p from public.peladas where id = p_pelada;
  if public.pelada_starts_at(p) <= now() then
    raise exception 'A pelada já começou: ajuste os times direto no time';
  end if;
  -- a escolha (ou a vaga deixada por quem foi escolhido e depois disse "não vou")
  select * into m from public.team_members where pelada_id = p_pelada and pick_number = d.next_pick - 1;
  if m.id is null then raise exception 'Não há escolha para desfazer (times do sorteio ou montados na mão)'; end if;
  delete from public.team_members where id = m.id;
  update public.drafts
  set next_pick = d.next_pick - 1,
      phase = case when free_until > now() then 'livre' else 'turnos' end::public.draft_phase,
      turn_deadline = case when free_until > now() then null else now() + interval '10 minutes' end,
      finished_at = null
  where pelada_id = p_pelada;
end $$;

-- ============================================================
-- Reabrir pelada
-- ============================================================

-- Encerrada (só o dono): volta para "em andamento" e os números saem do mês até encerrar de novo.
-- Cancelada (admin): volta para "agendada".
create function public.reopen_pelada(p_pelada bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare
  p public.peladas;
begin
  select * into p from public.peladas where id = p_pelada for update;
  if p.id is null then raise exception 'Pelada não encontrada'; end if;
  if p.status = 'encerrada' then
    if not public.is_owner() then raise exception 'Só o dono reabre uma pelada encerrada'; end if;
    update public.peladas set status = 'em_andamento', closed_at = null, closed_by = null where id = p_pelada;
  elsif p.status = 'cancelada' then
    if not public.is_admin() then raise exception 'Só admin'; end if;
    update public.peladas set status = 'agendada' where id = p_pelada;
  else
    raise exception 'A pelada não está encerrada nem cancelada';
  end if;
end $$;

-- ============================================================
-- Jogadores
-- ============================================================

-- Desativar quem saiu do grupo (some das listas e não entra mais; o histórico fica). Reativar volta.
create function public.set_player_active(p_profile uuid, p_active boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.app_role;
begin
  if not public.is_admin() then raise exception 'Só admin'; end if;
  select role into r from public.profiles where id = p_profile and status in ('ativo', 'inativo');
  if r is null then raise exception 'Jogador não encontrado'; end if;
  if r = 'dono' then raise exception 'O dono não pode ser desativado'; end if;
  if r = 'admin' and not public.is_owner() then raise exception 'Só o dono desativa um admin'; end if;
  update public.profiles set status = case when p_active then 'ativo' else 'inativo' end::public.profile_status
  where id = p_profile;
end $$;

create function public.admin_rename(p_profile uuid, p_name text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Só admin'; end if;
  if length(trim(coalesce(p_name, ''))) not between 1 and 40 then raise exception 'Nome de 1 a 40 letras'; end if;
  if exists (select 1 from public.profiles where id = p_profile and role = 'dono') and not public.is_owner() then
    raise exception 'Só o dono muda o próprio nome';
  end if;
  update public.profiles set name = trim(p_name) where id = p_profile;
  if not found then raise exception 'Jogador não encontrado'; end if;
end $$;

-- Aprovar também quem foi recusado por engano
create or replace function public.review_signup(p_profile uuid, p_approve boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Só admin'; end if;
  update public.profiles
  set status = case when p_approve then 'ativo' else 'recusado' end::public.profile_status,
      approved_at = now(), approved_by = auth.uid()
  where id = p_profile and (status = 'pendente' or (p_approve and status = 'recusado'));
  if not found then raise exception 'Cadastro não está pendente'; end if;
end $$;

-- ============================================================
-- Pagamentos
-- ============================================================

-- "Já paguei" tocado sem querer: o jogador desfaz; o admin também (aviso que não se confirmou)
create function public.uninform_payment(p_charge bigint, p_profile uuid default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  target uuid := coalesce(p_profile, auth.uid());
begin
  if target <> auth.uid() and not public.is_admin() then raise exception 'Só admin'; end if;
  update public.payments set status = 'pendente', informed_at = null
  where charge_id = p_charge and profile_id = target and status = 'informado';
  if not found then raise exception 'Não há aviso de pagamento para desfazer'; end if;
end $$;

-- Valor só muda se ninguém tiver pagado (as entradas do caixa usam o valor antigo)
create function public.update_charge(p_charge bigint, p_title text, p_amount numeric, p_due date) returns void
language plpgsql security definer set search_path = '' as $$
declare
  c public.charges;
begin
  if not public.is_admin() then raise exception 'Só admin'; end if;
  select * into c from public.charges where id = p_charge;
  if c.id is null then raise exception 'Cobrança não encontrada'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Valor inválido'; end if;
  if c.kind = 'cotinha' and length(trim(coalesce(p_title, ''))) = 0 then raise exception 'Informe o nome da cotinha'; end if;
  if p_amount <> c.amount and exists (select 1 from public.payments where charge_id = p_charge and status = 'confirmado') then
    raise exception 'Já tem pagamento confirmado: o valor não muda (desfaça as confirmações antes)';
  end if;
  update public.charges
  set title = case when kind = 'cotinha' then trim(p_title) else title end, amount = p_amount, due_date = p_due
  where id = p_charge;
end $$;

-- Cotinha, ou mensalidade de mês futuro criada antes da hora; nunca com pagamento confirmado
create function public.delete_charge(p_charge bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare
  c public.charges;
begin
  if not public.is_admin() then raise exception 'Só admin'; end if;
  select * into c from public.charges where id = p_charge;
  if c.id is null then raise exception 'Cobrança não encontrada'; end if;
  if c.kind = 'mensalidade' and c.month <= public.current_month() then
    raise exception 'Só dá para excluir mensalidade de mês que ainda não chegou';
  end if;
  if exists (select 1 from public.payments where charge_id = p_charge and status = 'confirmado') then
    raise exception 'Já tem pagamento confirmado: desfaça as confirmações antes';
  end if;
  delete from public.charges where id = p_charge;
end $$;

revoke execute on function
  private.check_owner_confirm(text), private.drop_from_game(bigint, uuid, bigint), private.check_team_edit(bigint),
  private.check_not_in_pelada(bigint, uuid), private.live_lineup_swap(bigint, uuid, bigint, uuid, bigint)
from public, anon, authenticated;

revoke execute on function
  public.delete_pelada(bigint, text), public.delete_game(bigint, text),
  public.remove_from_game(bigint, uuid, bigint), public.mark_absent(bigint, uuid, bigint),
  public.swap_member(bigint, uuid, text), public.vacate_member(bigint), public.move_member(bigint, bigint),
  public.restore_member(bigint), public.add_slot(bigint), public.delete_slot(bigint), public.add_member(bigint, uuid, text),
  public.draft_undo(bigint), public.reopen_pelada(bigint), public.set_player_active(uuid, boolean),
  public.admin_rename(uuid, text), public.uninform_payment(bigint, uuid),
  public.update_charge(bigint, text, numeric, date), public.delete_charge(bigint)
from public, anon;
