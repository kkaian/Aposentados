-- Aposentados FC: ações do app (RPC), consultas (views), arquivos e tempo real

-- ============================================================
-- Funções abertas (tela de login/cadastro, antes de entrar)
-- ============================================================

create function public.invite_is_valid(p_code text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.invites where code = upper(trim(p_code)) and active)
$$;

create function public.username_available(p_username text) returns boolean
language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from public.profiles where username = lower(trim(p_username)))
$$;

-- Não revela se o usuário existe: sempre responde igual
create function public.request_password_reset(p_username text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.password_requests (profile_id)
  select id from public.profiles where username = lower(trim(p_username)) and status = 'ativo'
  on conflict do nothing;
end $$;

grant execute on function public.invite_is_valid(text), public.username_available(text),
  public.request_password_reset(text) to anon, authenticated;

-- ============================================================
-- Cadastro e aprovação
-- ============================================================

-- Quem entrou pelo Google informa convite, usuário e nome
create function public.complete_signup(p_invite text, p_username text, p_name text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.invite_is_valid(p_invite) then
    raise exception 'Código de convite inválido';
  end if;
  update public.profiles
  set username = lower(trim(p_username)), name = trim(p_name), status = 'pendente'
  where id = auth.uid() and status = 'incompleto';
  if not found then
    raise exception 'Cadastro já foi completado';
  end if;
end $$;

-- Gerar um novo invalida o anterior
create function public.generate_invite() returns text
language plpgsql security definer set search_path = '' as $$
declare
  new_code text := public.random_code(8);
begin
  if not public.is_admin() then raise exception 'Só admin'; end if;
  update public.invites set active = false where active;
  insert into public.invites (code, created_by) values (new_code, auth.uid());
  return new_code;
end $$;

create function public.review_signup(p_profile uuid, p_approve boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Só admin'; end if;
  update public.profiles
  set status = case when p_approve then 'ativo' else 'recusado' end::public.profile_status,
      approved_at = now(), approved_by = auth.uid()
  where id = p_profile and status = 'pendente';
  if not found then raise exception 'Cadastro não está pendente'; end if;
end $$;

-- ============================================================
-- Papéis, tipos e posse
-- ============================================================

-- Mensalista <-> diarista (respeita a cota pelo trigger)
create function public.set_player_type(p_profile uuid, p_type public.player_type) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Só admin'; end if;
  update public.profiles set type = p_type where id = p_profile and status = 'ativo';
  if not found then raise exception 'Jogador não encontrado'; end if;
end $$;

-- Só o dono escolhe e remove admins. Quem vira admin começa como mensalista.
create function public.set_admin(p_profile uuid, p_admin boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_owner() then raise exception 'Só o dono define admins'; end if;
  update public.profiles
  set role = case when p_admin then 'admin' else 'jogador' end::public.app_role,
      type = case when p_admin then 'mensalista'::public.player_type else type end
  where id = p_profile and status = 'ativo' and role <> 'dono';
  if not found then raise exception 'Jogador não encontrado'; end if;
end $$;

-- O dono passa a posse para outro admin e continua como admin
create function public.transfer_ownership(p_new_owner uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_owner() then raise exception 'Só o dono passa a posse'; end if;
  if not exists (select 1 from public.profiles where id = p_new_owner and role = 'admin' and status = 'ativo') then
    raise exception 'O novo dono precisa ser admin';
  end if;
  update public.profiles set role = 'admin' where id = auth.uid();
  update public.profiles set role = 'dono' where id = p_new_owner;
end $$;

-- ============================================================
-- Jogo ao vivo e responsável pelo registro
-- ============================================================

create function public.can_record(p_pelada bigint) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_admin() or public.is_helper(p_pelada)
$$;

-- Inicia o jogo: quem inicia vira o responsável e o elenco entra em campo
create function public.start_game(p_game bigint) returns void
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
  where m.team_id in (g.team1_id, g.team2_id) and not m.is_out;

  update public.peladas set status = 'em_andamento' where id = g.pelada_id and status = 'agendada';
end $$;

-- Assumir: admin sempre; ajudante só se ninguém estiver registrando
create function public.take_recorder(p_game bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare
  g public.games;
begin
  select * into g from public.games where id = p_game for update;
  if g.status <> 'ao_vivo' then raise exception 'Jogo não está ao vivo'; end if;
  if not (public.is_admin() or (public.is_helper(g.pelada_id) and g.recorder_id is null)) then
    raise exception 'Outra pessoa está registrando';
  end if;
  update public.games set recorder_id = auth.uid(), recorder_since = now() where id = p_game;
end $$;

create function public.pass_recorder(p_game bigint, p_to uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  g public.games;
begin
  select * into g from public.games where id = p_game for update;
  if not (public.is_admin() or g.recorder_id = auth.uid()) then
    raise exception 'Só o responsável ou um admin passa o registro';
  end if;
  if not (
    exists (select 1 from public.pelada_helpers where pelada_id = g.pelada_id and profile_id = p_to)
    or exists (select 1 from public.profiles where id = p_to and role in ('dono', 'admin') and status = 'ativo')
  ) then
    raise exception 'O registro só passa para ajudante da pelada ou admin';
  end if;
  update public.games set recorder_id = p_to, recorder_since = now() where id = p_game;
end $$;

create function public.release_recorder(p_game bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.games set recorder_id = null, recorder_since = null
  where id = p_game and (recorder_id = auth.uid() or public.is_admin());
  if not found then raise exception 'Você não é o responsável'; end if;
end $$;

-- Salvar resultado: depois disso só admin edita
create function public.finish_game(p_game bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.games
  set status = 'finalizado', ended_at = now(), recorder_id = null, recorder_since = null
  where id = p_game and status = 'ao_vivo' and (recorder_id = auth.uid() or public.is_admin());
  if not found then raise exception 'Só o responsável ou um admin encerra o jogo'; end if;

  update public.game_lineup l set left_minute = coalesce(l.left_minute,
    least(60, extract(epoch from (now() - g.started_at))::int / 60))
  from public.games g where g.id = p_game and l.game_id = p_game and l.left_minute is null;
end $$;

-- Encerrar pelada: os números do dia entram nas estatísticas do mês
create function public.close_pelada(p_pelada bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Só admin'; end if;
  if exists (select 1 from public.games where pelada_id = p_pelada and status <> 'finalizado') then
    raise exception 'Ainda há jogos não encerrados';
  end if;
  update public.peladas set status = 'encerrada', closed_at = now(), closed_by = auth.uid()
  where id = p_pelada and status in ('agendada', 'em_andamento');
  if not found then raise exception 'Pelada já encerrada ou cancelada'; end if;
end $$;

-- ============================================================
-- Pagamentos
-- ============================================================

create function public.inform_payment(p_charge bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_active() then raise exception 'Conta não ativa'; end if;
  insert into public.payments (charge_id, profile_id, status, informed_at)
  values (p_charge, auth.uid(), 'informado', now())
  on conflict (charge_id, profile_id) do update
    set status = 'informado', informed_at = now()
    where public.payments.status = 'pendente';
end $$;

create function public.confirm_payment(p_charge bigint, p_profile uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Só admin'; end if;
  insert into public.payments (charge_id, profile_id, status, confirmed_at, confirmed_by)
  values (p_charge, p_profile, 'confirmado', now(), auth.uid())
  on conflict (charge_id, profile_id) do update
    set status = 'confirmado', confirmed_at = now(), confirmed_by = auth.uid();
end $$;

-- As ações acima são só para quem está logado
revoke execute on function
  public.complete_signup(text, text, text), public.generate_invite(), public.review_signup(uuid, boolean),
  public.set_player_type(uuid, public.player_type), public.set_admin(uuid, boolean),
  public.transfer_ownership(uuid), public.start_game(bigint), public.take_recorder(bigint),
  public.pass_recorder(bigint, uuid), public.release_recorder(bigint), public.finish_game(bigint),
  public.close_pelada(bigint), public.inform_payment(bigint), public.confirm_payment(bigint, uuid)
from public, anon;

-- ============================================================
-- Consultas: placar, estatísticas do mês, pódio, notas, presença
-- ============================================================

-- Placar calculado dos eventos (gol contra conta para o adversário)
create view public.game_scores with (security_invoker = true) as
select
  g.id as game_id,
  g.pelada_id,
  g.team1_id,
  g.team2_id,
  count(*) filter (where (e.type = 'gol' and e.team_id = g.team1_id) or (e.type = 'gol_contra' and e.team_id = g.team2_id))::int as team1_goals,
  count(*) filter (where (e.type = 'gol' and e.team_id = g.team2_id) or (e.type = 'gol_contra' and e.team_id = g.team1_id))::int as team2_goals
from public.games g
left join public.game_events e on e.game_id = g.id
group by g.id;

-- Estatísticas individuais por mês (só jogos finalizados de peladas encerradas)
create view public.player_month_stats with (security_invoker = true) as
with counted as (
  select g.id, p.date, s.team1_goals, s.team2_goals, g.team1_id, g.team2_id
  from public.games g
  join public.peladas p on p.id = g.pelada_id and p.status = 'encerrada'
  join public.game_scores s on s.game_id = g.id
  where g.status = 'finalizado'
),
played as (
  select distinct c.id as game_id, public.month_of(c.date) as month, l.profile_id,
    (l.team_id = c.team1_id and c.team1_goals > c.team2_goals)
    or (l.team_id = c.team2_id and c.team2_goals > c.team1_goals) as won
  from counted c
  join public.game_lineup l on l.game_id = c.id and l.profile_id is not null
),
goals as (
  select public.month_of(c.date) as month, e.player_id as profile_id, count(*)::int as n
  from counted c join public.game_events e on e.game_id = c.id and e.type = 'gol' and e.player_id is not null
  group by 1, 2
),
assists as (
  select public.month_of(c.date) as month, e.assist_id as profile_id, count(*)::int as n
  from counted c join public.game_events e on e.game_id = c.id and e.type = 'gol' and e.assist_id is not null
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

-- Pódio: só mensalistas. Desempate por vitórias; empate em tudo divide a posição (1, 2, 2, 4)
create view public.podium with (security_invoker = true) as
select
  s.*,
  pr.name,
  pr.photo_path,
  rank() over (partition by s.month order by s.wins desc) as rank_wins,
  rank() over (partition by s.month order by s.goals desc, s.wins desc) as rank_goals,
  rank() over (partition by s.month order by s.assists desc, s.wins desc) as rank_assists,
  rank() over (partition by s.month order by s.total desc, s.wins desc) as rank_total
from public.player_month_stats s
join public.profiles pr on pr.id = s.profile_id and pr.type = 'mensalista' and pr.status = 'ativo';

-- Médias das notas (voto anônimo): só aparecem com 3 ou mais avaliações
create view public.rating_summary as
select
  rated_id as profile_id,
  count(*)::int as votes,
  case when count(*) >= 3 then round(avg(dribble), 1) end as dribble,
  case when count(*) >= 3 then round(avg(shot), 1) end as shot,
  case when count(*) >= 3 then round(avg(speed), 1) end as speed,
  case when count(*) >= 3 then round(avg(overall), 1) end as overall
from public.ratings
group by rated_id;

revoke all on public.rating_summary from anon;

-- Presença com vagas e lista de espera pela ordem de resposta
create view public.presence_list with (security_invoker = true) as
select
  pr.pelada_id,
  pr.profile_id,
  pr.answer,
  pr.answered_at,
  case when pr.answer = 'vou' then row_number() over (partition by pr.pelada_id, pr.answer order by pr.answered_at) end as position,
  pr.answer = 'vou'
    and row_number() over (partition by pr.pelada_id, pr.answer order by pr.answered_at) > p.max_slots as waitlisted
from public.presence pr
join public.peladas p on p.id = pr.pelada_id;

-- ============================================================
-- Arquivos: fotos (cada um na própria pasta) e escudos (admin)
-- ============================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('avatars', 'avatars', true, 204800, array['image/jpeg', 'image/png', 'image/webp']),
  ('kits', 'kits', true, 204800, array['image/jpeg', 'image/png', 'image/webp']);

create policy avatars_own_folder on storage.objects for all to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text and public.is_active());

create policy kits_admin on storage.objects for all to authenticated
  using (bucket_id = 'kits' and public.is_admin())
  with check (bucket_id = 'kits' and public.is_admin());

-- Sugestão de escudo: o capitão envia para kits/sugestoes/<id>/ (só se a criação estiver liberada)
create policy kits_suggestions on storage.objects for insert to authenticated
  with check (
    bucket_id = 'kits'
    and (storage.foldername(name))[1] = 'sugestoes'
    and (storage.foldername(name))[2] = auth.uid()::text
    and public.is_active()
    and (select kit_creation_enabled from public.app_settings)
  );

-- ============================================================
-- Tempo real: placar ao vivo, escolha dos times e presença
-- ============================================================

alter publication supabase_realtime add table
  public.games, public.game_events, public.game_lineup,
  public.drafts, public.teams, public.team_members, public.presence;
