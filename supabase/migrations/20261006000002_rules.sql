-- Aposentados FC: funções auxiliares, regras (triggers) e permissões (RLS)

-- ============================================================
-- Auxiliares
-- ============================================================

create function public.is_active() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and status = 'ativo')
$$;

create function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and status = 'ativo' and role in ('dono', 'admin'))
$$;

create function public.is_owner() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and status = 'ativo' and role = 'dono')
$$;

create function public.is_helper(p_pelada bigint) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.pelada_helpers where pelada_id = p_pelada and profile_id = auth.uid())
$$;

-- Mês de referência (fuso de São Paulo) de uma data
create function public.month_of(d date) returns date
language sql immutable as $$ select date_trunc('month', d)::date $$;

-- Ordem das escolhas: 1234 · 4123 · 1234 · 1234 (especificação, seção 11)
create function public.draft_captain_for_pick(p_pick integer) returns smallint
language sql immutable as $$
  select (array[1,2,3,4, 4,1,2,3, 1,2,3,4, 1,2,3,4])[p_pick]::smallint
$$;

create function public.random_code(len integer default 8) returns text
language sql volatile as $$
  -- sem 0/O e 1/I para não confundir ao ditar o código
  select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1), '')
  from generate_series(1, len)
$$;

-- ============================================================
-- Cadastro: cria o perfil quando a conta é criada no Auth
-- ============================================================

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
  if meta ? 'username' then
    -- cadastro por usuário/senha: exige o convite vigente
    if not exists (select 1 from public.invites where code = upper(meta ->> 'invite_code') and active) then
      raise exception 'Código de convite inválido';
    end if;
    insert into public.profiles (id, username, name, status)
    values (new.id, lower(meta ->> 'username'), trim(meta ->> 'name'), 'pendente');
  else
    -- Google: completa convite e usuário depois, em complete_signup()
    insert into public.profiles (id, name, status)
    values (new.id, coalesce(nullif(trim(meta ->> 'full_name'), ''), split_part(new.email, '@', 1)), 'incompleto');
  end if;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

-- ============================================================
-- Regras de perfis
-- ============================================================

-- Cota: não passa do número máximo de mensalistas ativos
create function public.check_mensalista_quota() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  quota integer;
  used integer;
begin
  if new.type = 'mensalista' and new.status = 'ativo'
     and (tg_op = 'INSERT' or old.type is distinct from 'mensalista' or old.status is distinct from 'ativo') then
    select mensalista_quota into quota from public.app_settings;
    select count(*) into used from public.profiles where type = 'mensalista' and status = 'ativo' and id <> new.id;
    if used >= quota then
      raise exception 'Sem vaga na cota de mensalistas (% de %)', used, quota;
    end if;
  end if;
  return new;
end $$;

create trigger profiles_quota before insert or update of type, status on public.profiles
for each row execute function public.check_mensalista_quota();

-- ============================================================
-- Regras de jogos e eventos
-- ============================================================

-- Times do jogo precisam ser da mesma pelada
create function public.check_game_teams() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (select count(*) from public.teams where id in (new.team1_id, new.team2_id) and pelada_id = new.pelada_id) <> 2 then
    raise exception 'Os dois times precisam ser desta pelada';
  end if;
  return new;
end $$;

create trigger games_teams before insert or update of team1_id, team2_id on public.games
for each row execute function public.check_game_teams();

-- Valida o evento: jogador em campo, assistência do mesmo time, carimbo de edição
create function public.check_game_event() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  g public.games;
begin
  select * into g from public.games where id = new.game_id;
  if new.team_id not in (g.team1_id, g.team2_id) then
    raise exception 'Time não está neste jogo';
  end if;
  if not exists (
    select 1 from public.game_lineup l
    where l.game_id = new.game_id and l.team_id = new.team_id
      and (l.profile_id = new.player_id or l.guest_id = new.player_guest_id)
  ) then
    raise exception 'Jogador não está em campo por este time';
  end if;
  if num_nonnulls(new.assist_id, new.assist_guest_id) = 1 then
    if new.assist_id = new.player_id or new.assist_guest_id = new.player_guest_id
       or not exists (
         select 1 from public.game_lineup l
         where l.game_id = new.game_id and l.team_id = new.team_id
           and (l.profile_id = new.assist_id or l.guest_id = new.assist_guest_id)
       ) then
      raise exception 'Assistência precisa ser de outro jogador do mesmo time';
    end if;
  end if;
  if tg_op = 'UPDATE' then
    new.updated_by := auth.uid();
    new.updated_at := now();
  end if;
  return new;
end $$;

create trigger game_events_check before insert or update on public.game_events
for each row execute function public.check_game_event();

-- Substituição parcial: atualiza quem está em campo
create function public.apply_substitution() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.type = 'substituicao' then
    update public.game_lineup set left_minute = new.minute
    where game_id = new.game_id and team_id = new.team_id and left_minute is null
      and (profile_id = new.player_id or guest_id = new.player_guest_id);
    insert into public.game_lineup (game_id, team_id, profile_id, guest_id, entered_minute)
    values (new.game_id, new.team_id, new.sub_in_id, new.sub_in_guest_id, new.minute);
  end if;
  return new;
end $$;

create trigger game_events_substitution after insert on public.game_events
for each row execute function public.apply_substitution();

-- ============================================================
-- Regras de notas
-- ============================================================

-- Só mensalistas avaliam e são avaliados; cada avaliação muda 1 vez por mês
create function public.check_rating() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.rater_id := auth.uid();
  if (select count(*) from public.profiles
      where id in (new.rater_id, new.rated_id) and type = 'mensalista' and status = 'ativo') <> 2 then
    raise exception 'Só mensalistas avaliam e são avaliados';
  end if;
  if tg_op = 'UPDATE'
     and public.month_of((old.updated_at at time zone 'America/Sao_Paulo')::date)
       = public.month_of((now() at time zone 'America/Sao_Paulo')::date) then
    raise exception 'Você já alterou a nota deste jogador neste mês';
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger ratings_check before insert or update on public.ratings
for each row execute function public.check_rating();

-- ============================================================
-- Permissões (RLS)
-- ============================================================

-- Visitante sem login não lê nada; o app usa só funções públicas específicas
revoke all on all tables in schema public from anon;

alter table public.profiles enable row level security;
alter table public.invites enable row level security;
alter table public.password_requests enable row level security;
alter table public.app_settings enable row level security;
alter table public.kits enable row level security;
alter table public.kit_suggestions enable row level security;
alter table public.peladas enable row level security;
alter table public.pelada_helpers enable row level security;
alter table public.pelada_diaristas enable row level security;
alter table public.guests enable row level security;
alter table public.presence enable row level security;
alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.drafts enable row level security;
alter table public.games enable row level security;
alter table public.game_lineup enable row level security;
alter table public.game_events enable row level security;
alter table public.ratings enable row level security;
alter table public.charges enable row level security;
alter table public.payments enable row level security;

-- Perfis: todos os ativos leem; cada um vê o próprio mesmo pendente.
-- Cada um muda só nome e foto; papel, tipo e status só por funções de admin.
create policy profiles_read on public.profiles for select to authenticated
  using (public.is_active() or id = auth.uid());
revoke update on public.profiles from authenticated;
grant update (name, photo_path) on public.profiles to authenticated;
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid() and status = 'ativo');
revoke insert, delete on public.profiles from authenticated;

-- Convite: só admin vê o código
create policy invites_admin on public.invites for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy password_requests_admin on public.password_requests for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy settings_read on public.app_settings for select to authenticated using (public.is_active());
create policy settings_admin on public.app_settings for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Leitura geral para quem está ativo; escrita do admin
create policy kits_read on public.kits for select to authenticated using (public.is_active());
create policy kits_admin on public.kits for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy kit_suggestions_read on public.kit_suggestions for select to authenticated
  using (public.is_admin() or suggested_by = auth.uid());
create policy kit_suggestions_insert on public.kit_suggestions for insert to authenticated
  with check (public.is_active() and suggested_by = auth.uid() and status = 'pendente');
create policy kit_suggestions_admin on public.kit_suggestions for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy peladas_read on public.peladas for select to authenticated using (public.is_active());
create policy peladas_admin on public.peladas for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy pelada_helpers_read on public.pelada_helpers for select to authenticated using (public.is_active());
create policy pelada_helpers_admin on public.pelada_helpers for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy pelada_diaristas_read on public.pelada_diaristas for select to authenticated using (public.is_active());
create policy pelada_diaristas_admin on public.pelada_diaristas for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy guests_read on public.guests for select to authenticated using (public.is_active());
create policy guests_write on public.guests for insert to authenticated
  with check (public.is_admin() or public.is_helper(pelada_id));
create policy guests_admin on public.guests for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Presença: cada um marca a própria, se for elencável e a lista estiver aberta
create policy presence_read on public.presence for select to authenticated using (public.is_active());
create policy presence_self on public.presence for all to authenticated
  using (profile_id = auth.uid())
  with check (
    profile_id = auth.uid()
    and exists (select 1 from public.peladas p where p.id = pelada_id and p.presence_open and p.status = 'agendada')
    and (
      exists (select 1 from public.profiles where id = auth.uid() and status = 'ativo' and type = 'mensalista')
      or exists (select 1 from public.pelada_diaristas d where d.pelada_id = presence.pelada_id and d.profile_id = auth.uid())
    )
  );
create policy presence_admin on public.presence for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Times e draft: leitura geral; escrita por funções (capitão) ou admin
create policy teams_read on public.teams for select to authenticated using (public.is_active());
create policy teams_admin on public.teams for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy team_members_read on public.team_members for select to authenticated using (public.is_active());
create policy team_members_admin on public.team_members for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy drafts_read on public.drafts for select to authenticated using (public.is_active());
create policy drafts_admin on public.drafts for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Jogos: admin ou ajudante da pelada criam; mudanças de responsável por funções
create policy games_read on public.games for select to authenticated using (public.is_active());
create policy games_insert on public.games for insert to authenticated
  with check (public.is_admin() or public.is_helper(pelada_id));
create policy games_admin on public.games for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy game_lineup_read on public.game_lineup for select to authenticated using (public.is_active());
create policy game_lineup_admin on public.game_lineup for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Eventos: o responsável registra no jogo dele (ao vivo); só admin edita ou exclui
create policy game_events_read on public.game_events for select to authenticated using (public.is_active());
create policy game_events_recorder on public.game_events for insert to authenticated
  with check (exists (
    select 1 from public.games g
    where g.id = game_id and g.status = 'ao_vivo' and g.recorder_id = auth.uid()
  ));
create policy game_events_admin on public.game_events for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Notas: anônimas. Cada um lê só as que deu; médias saem de rating_summary
create policy ratings_own on public.ratings for select to authenticated using (rater_id = auth.uid());
create policy ratings_insert on public.ratings for insert to authenticated with check (rater_id = auth.uid());
create policy ratings_update on public.ratings for update to authenticated using (rater_id = auth.uid()) with check (rater_id = auth.uid());

-- Pagamentos: todos veem quem está em dia; o jogador só informa "já paguei"
create policy charges_read on public.charges for select to authenticated using (public.is_active());
create policy charges_admin on public.charges for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy payments_read on public.payments for select to authenticated using (public.is_active());
create policy payments_admin on public.payments for all to authenticated using (public.is_admin()) with check (public.is_admin());
