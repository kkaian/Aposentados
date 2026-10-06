-- Aposentados FC: estrutura base (tabelas, regras e permissões)
-- Ver docs/especificacao.md, seções 4, 5, 7, 8 e 11.

-- ============================================================
-- Tipos
-- ============================================================

create type public.app_role as enum ('dono', 'admin', 'jogador');
create type public.player_type as enum ('mensalista', 'diarista');
-- incompleto: entrou pelo Google e ainda não informou convite/usuário
create type public.profile_status as enum ('incompleto', 'pendente', 'ativo', 'recusado', 'inativo');
create type public.pelada_status as enum ('agendada', 'em_andamento', 'encerrada', 'cancelada');
create type public.draft_phase as enum ('livre', 'turnos', 'concluida');
create type public.pick_source as enum ('capitao', 'sorteio', 'admin');
create type public.game_status as enum ('agendado', 'ao_vivo', 'finalizado');
create type public.event_type as enum ('gol', 'gol_contra', 'amarelo', 'vermelho', 'substituicao');
create type public.presence_answer as enum ('vou', 'nao_vou');
create type public.charge_kind as enum ('mensalidade', 'cotinha');
create type public.payment_status as enum ('pendente', 'informado', 'confirmado');
create type public.review_status as enum ('pendente', 'aprovada', 'recusada');

-- ============================================================
-- Pessoas e acesso
-- ============================================================

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text unique check (username ~ '^[a-z0-9._]{3,20}$'),
  name text not null check (length(trim(name)) between 1 and 40),
  photo_path text,
  role public.app_role not null default 'jogador',
  type public.player_type not null default 'diarista',
  status public.profile_status not null default 'pendente',
  must_change_password boolean not null default false,
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by uuid references public.profiles (id)
);

-- Só existe um dono
create unique index profiles_one_owner on public.profiles (role) where role = 'dono';

create table public.invites (
  code text primary key check (code ~ '^[A-Z0-9]{6,12}$'),
  active boolean not null default true,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

-- Só um código de convite vale por vez
create unique index invites_one_active on public.invites (active) where active;

create table public.password_requests (
  id bigint generated always as identity primary key,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles (id)
);

create unique index password_requests_one_open on public.password_requests (profile_id) where resolved_at is null;

-- Configurações gerais (linha única)
create table public.app_settings (
  id boolean primary key default true check (id),
  mensalista_quota integer not null default 20 check (mensalista_quota >= 0),
  fee_amount numeric(10, 2) not null default 0 check (fee_amount >= 0),
  fee_due_day integer not null default 10 check (fee_due_day between 1 and 28),
  pix_key text,
  kit_creation_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

insert into public.app_settings default values;

-- ============================================================
-- Kits (nome + escudo) e sugestões
-- ============================================================

create table public.kits (
  id bigint generated always as identity primary key,
  name text not null unique check (length(trim(name)) between 1 and 40),
  shield_path text not null,
  active boolean not null default true,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

create table public.kit_suggestions (
  id bigint generated always as identity primary key,
  name text not null check (length(trim(name)) between 1 and 40),
  shield_path text,
  suggested_by uuid not null references public.profiles (id) on delete cascade,
  status public.review_status not null default 'pendente',
  reviewed_by uuid references public.profiles (id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

-- ============================================================
-- Peladas (um evento por data, todo domingo)
-- ============================================================

create table public.peladas (
  id bigint generated always as identity primary key,
  date date not null unique,
  start_time time not null,
  location text not null,
  max_slots integer not null default 20 check (max_slots > 0),
  presence_open boolean not null default true,
  status public.pelada_status not null default 'agendada',
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  closed_by uuid references public.profiles (id)
);

-- Ajudantes valem só para esta pelada
create table public.pelada_helpers (
  pelada_id bigint not null references public.peladas (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  primary key (pelada_id, profile_id)
);

-- Diaristas cadastrados que o admin chamou para esta pelada
create table public.pelada_diaristas (
  pelada_id bigint not null references public.peladas (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  primary key (pelada_id, profile_id)
);

-- Avulsos: sem perfil, existem só dentro da pelada
create table public.guests (
  id bigint generated always as identity primary key,
  pelada_id bigint not null references public.peladas (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 40),
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

create table public.presence (
  pelada_id bigint not null references public.peladas (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  answer public.presence_answer not null,
  -- ordem de chegada na lista de "vou" (define vaga x espera)
  answered_at timestamptz not null default now(),
  primary key (pelada_id, profile_id)
);

-- ============================================================
-- Times da pelada (refeitos a cada pelada)
-- ============================================================

create table public.teams (
  id bigint generated always as identity primary key,
  pelada_id bigint not null references public.peladas (id) on delete cascade,
  captain_order smallint not null check (captain_order between 1 and 4),
  captain_id uuid not null references public.profiles (id),
  kit_id bigint references public.kits (id),
  color text check (color in ('azul', 'vermelho', 'branco', 'preto', 'verde', 'amarelo', 'laranja', 'roxo', 'cinza', 'grena')),
  unique (pelada_id, captain_order),
  unique (pelada_id, captain_id),
  -- na mesma pelada, quem escolhe primeiro bloqueia kit e cor
  unique (pelada_id, kit_id),
  unique (pelada_id, color)
);

create table public.team_members (
  id bigint generated always as identity primary key,
  pelada_id bigint not null references public.peladas (id) on delete cascade,
  team_id bigint not null references public.teams (id) on delete cascade,
  profile_id uuid references public.profiles (id),
  guest_id bigint references public.guests (id) on delete cascade,
  is_captain boolean not null default false,
  -- número da escolha no draft (1 a 16); nulo para capitão e entradas do admin
  pick_number smallint check (pick_number between 1 and 16),
  source public.pick_source not null default 'capitao',
  -- substituição integral: o mensalista fica de fora e alguém entra no lugar
  is_out boolean not null default false,
  replaces_member_id bigint references public.team_members (id),
  created_at timestamptz not null default now(),
  check ((profile_id is null) <> (guest_id is null)),
  unique (pelada_id, pick_number)
);

create unique index team_members_profile_once on public.team_members (pelada_id, profile_id) where profile_id is not null;
create unique index team_members_guest_once on public.team_members (pelada_id, guest_id) where guest_id is not null;

create table public.drafts (
  pelada_id bigint primary key references public.peladas (id) on delete cascade,
  phase public.draft_phase not null default 'livre',
  started_at timestamptz not null default now(),
  free_until timestamptz not null,
  -- próxima escolha (1 a 16); a ordem dos capitães sai de DRAFT_ORDER
  next_pick smallint not null default 1 check (next_pick between 1 and 17),
  turn_deadline timestamptz,
  finished_at timestamptz
);

-- ============================================================
-- Jogos e eventos
-- ============================================================

create table public.games (
  id bigint generated always as identity primary key,
  pelada_id bigint not null references public.peladas (id) on delete cascade,
  number smallint not null check (number > 0),
  team1_id bigint not null references public.teams (id),
  team2_id bigint not null references public.teams (id),
  status public.game_status not null default 'agendado',
  started_at timestamptz,
  ended_at timestamptz,
  -- responsável pelo registro: só ele (ou um admin) marca eventos
  recorder_id uuid references public.profiles (id),
  recorder_since timestamptz,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  unique (pelada_id, number),
  check (team1_id <> team2_id)
);

-- Quem esteve em campo (para creditar vitórias, inclusive substituições)
create table public.game_lineup (
  id bigint generated always as identity primary key,
  game_id bigint not null references public.games (id) on delete cascade,
  team_id bigint not null references public.teams (id),
  profile_id uuid references public.profiles (id),
  guest_id bigint references public.guests (id) on delete cascade,
  entered_minute smallint not null default 0,
  left_minute smallint,
  check ((profile_id is null) <> (guest_id is null))
);

create table public.game_events (
  id bigint generated always as identity primary key,
  game_id bigint not null references public.games (id) on delete cascade,
  type public.event_type not null,
  -- time do jogador que fez o evento (gol contra conta para o adversário)
  team_id bigint not null references public.teams (id),
  minute smallint not null default 0 check (minute between 0 and 60),
  player_id uuid references public.profiles (id),
  player_guest_id bigint references public.guests (id) on delete cascade,
  assist_id uuid references public.profiles (id),
  assist_guest_id bigint references public.guests (id) on delete cascade,
  -- substituição: player_* sai, sub_in_* entra
  sub_in_id uuid references public.profiles (id),
  sub_in_guest_id bigint references public.guests (id) on delete cascade,
  created_by uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id),
  updated_at timestamptz,
  check ((player_id is null) <> (player_guest_id is null)),
  check (num_nonnulls(assist_id, assist_guest_id) <= 1),
  check (type = 'gol' or num_nonnulls(assist_id, assist_guest_id) = 0),
  check ((type = 'substituicao') = (num_nonnulls(sub_in_id, sub_in_guest_id) = 1))
);

create index game_events_game on public.game_events (game_id);

-- ============================================================
-- Notas (voto anônimo)
-- ============================================================

create table public.ratings (
  rater_id uuid not null references public.profiles (id) on delete cascade,
  rated_id uuid not null references public.profiles (id) on delete cascade,
  dribble smallint not null check (dribble between 1 and 5),
  shot smallint not null check (shot between 1 and 5),
  speed smallint not null check (speed between 1 and 5),
  overall smallint not null check (overall between 1 and 5),
  updated_at timestamptz not null default now(),
  primary key (rater_id, rated_id),
  check (rater_id <> rated_id)
);

-- ============================================================
-- Dinheiro
-- ============================================================

create table public.charges (
  id bigint generated always as identity primary key,
  kind public.charge_kind not null,
  title text not null,
  amount numeric(10, 2) not null check (amount > 0),
  -- mensalidade: primeiro dia do mês de referência
  month date check (month is null or extract(day from month) = 1),
  due_date date,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  check ((kind = 'mensalidade') = (month is not null))
);

create unique index charges_one_fee_per_month on public.charges (month) where kind = 'mensalidade';

create table public.payments (
  charge_id bigint not null references public.charges (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  status public.payment_status not null default 'pendente',
  informed_at timestamptz,
  confirmed_at timestamptz,
  confirmed_by uuid references public.profiles (id),
  primary key (charge_id, profile_id)
);
