-- Dados FICTÍCIOS para o Supabase local (npx supabase start / db reset). Nunca roda na produção.
-- Todas as contas entram com a senha 123456: dono, admin, admin2, e jogadores j01..j22 (mensalistas)
-- d01..d03 (diaristas) e g01 (só goleiro; j08 também é goleiro). Datas relativas a hoje: 3 domingos encerrados e o próximo agendado.

set session_replication_role = replica; -- sem gatilhos (nem notificações) durante a carga
select setseed(0.42);

-- ------------------------------------------------------------
-- Contas
-- ------------------------------------------------------------
create temp table seed_people (n int, username text, name text, role public.app_role, type public.player_type, id uuid default gen_random_uuid());
insert into seed_people (n, username, name, role, type) values
  (1, 'dono', 'Dono Teste', 'dono', 'mensalista'),
  (2, 'admin', 'Admin Teste', 'admin', 'mensalista'),
  (3, 'admin2', 'Admin Diarista', 'admin', 'diarista'),
  (4, 'j01', 'Zé Bigode', 'jogador', 'mensalista'),
  (5, 'j02', 'Toninho Canela', 'jogador', 'mensalista'),
  (6, 'j03', 'Baixinho', 'jogador', 'mensalista'),
  (7, 'j04', 'Paulão', 'jogador', 'mensalista'),
  (8, 'j05', 'Careca', 'jogador', 'mensalista'),
  (9, 'j06', 'Juninho Pé Torto', 'jogador', 'mensalista'),
  (10, 'j07', 'Neguinho', 'jogador', 'mensalista'),
  (11, 'j08', 'Tião Goleiro', 'jogador', 'mensalista'),
  (12, 'j09', 'Marcão', 'jogador', 'mensalista'),
  (13, 'j10', 'Fumaça', 'jogador', 'mensalista'),
  (14, 'j11', 'Dedé', 'jogador', 'mensalista'),
  (15, 'j12', 'Russo', 'jogador', 'mensalista'),
  (16, 'j13', 'Tatu', 'jogador', 'mensalista'),
  (17, 'j14', 'Galego', 'jogador', 'mensalista'),
  (18, 'j15', 'Bolacha', 'jogador', 'mensalista'),
  (19, 'j16', 'Pernambuco', 'jogador', 'mensalista'),
  (20, 'j17', 'Biro-Biro', 'jogador', 'mensalista'),
  (21, 'j18', 'Chico Bala', 'jogador', 'mensalista'),
  (22, 'j19', 'Serginho', 'jogador', 'mensalista'),
  (23, 'j20', 'Magrão', 'jogador', 'mensalista'),
  (24, 'j21', 'Pipoca', 'jogador', 'mensalista'),
  (25, 'j22', 'Vovô', 'jogador', 'mensalista'),
  (26, 'd01', 'Diarista Um', 'jogador', 'diarista'),
  (27, 'd02', 'Diarista Dois', 'jogador', 'diarista'),
  (28, 'd03', 'Diarista Três', 'jogador', 'diarista'),
  (29, 'g01', 'Paredão', 'jogador', 'diarista');

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change, email_change_token_current, reauthentication_token)
select '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated', username || '@aposentados.app',
  extensions.crypt('123456', extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}', jsonb_build_object('username', username, 'name', name),
  now() - interval '60 days', now(), '', '', '', '', '', ''
from seed_people;

insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select id::text, id, jsonb_build_object('sub', id::text, 'email', username || '@aposentados.app', 'email_verified', true),
  'email', now(), now(), now()
from seed_people;

insert into public.profiles (id, username, name, role, type, status, created_at, approved_at)
select id, username, name, role, type, 'ativo', now() - interval '60 days', now() - interval '60 days' from seed_people;

-- Um cadastro esperando aprovação
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change, email_change_token_current, reauthentication_token)
values ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated',
  'novato@aposentados.app', extensions.crypt('123456', extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}', '{"username":"novato","name":"Novato Pendente"}', now(), now(), '', '', '', '', '', '');
insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
values ('11111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111',
  '{"sub":"11111111-1111-1111-1111-111111111111","email":"novato@aposentados.app","email_verified":true}', 'email', now(), now(), now());
insert into public.profiles (id, username, name, status) values ('11111111-1111-1111-1111-111111111111', 'novato', 'Novato Pendente', 'pendente');

-- Funções variadas (alguns ficam sem, para ver o perfil vazio)
update public.profiles pr set positions = (case sp.n % 8
  when 0 then '{atacante_central}' when 1 then '{atacante_ponta,meio_ofensivo}' when 2 then '{meio_defensivo}'
  when 3 then '{meio_ofensivo}' when 4 then '{defensor_central}' when 5 then '{defensor_lateral,meio_defensivo}'
  when 6 then '{atacante_ponta}' else '{}' end)::text[]
from seed_people sp where sp.id = pr.id and sp.n > 1; -- o dono fica sem, para testar o "Adicionar"

update public.profiles set goalkeeper = 'so_goleiro', positions = '{}' where username = 'g01';
update public.profiles set goalkeeper = 'tambem' where username = 'j08';

insert into public.mensalista_periods (profile_id, started_on)
select id, (current_date - 60) from seed_people where type = 'mensalista';

insert into public.invites (code, created_by) select 'LOCAL123', id from seed_people where n = 1;
update public.app_settings set fee_amount = 30, pix_key = 'pix-ficticio@exemplo.com', fee_due_day = 10;

-- ------------------------------------------------------------
-- Peladas: 3 domingos encerrados com 4 times de 5 e jogos; o próximo domingo agendado
-- ------------------------------------------------------------
do $$
declare
  next_sunday date := current_date + ((7 - extract(dow from current_date)::int) % 7);
  owner uuid := (select id from seed_people where n = 1);
  keeper uuid := (select id from seed_people where username = 'g01');
  colors text[] := array['azul', 'vermelho', 'branco', 'preto', 'verde', 'amarelo'];
  kit_ids bigint[] := array(select id from public.kits order by id limit 4);
  pairs int[][] := array[[1,2],[3,4],[1,3],[2,4],[1,4],[2,3],[1,2],[3,4]];
  pid bigint; tid bigint; gid bigint; t int; k int; w int; g int; goals int; ga int; gb int;
  team_ids bigint[]; roster uuid[]; side bigint; scorer uuid; helper uuid; day date;
begin
  if next_sunday = current_date then next_sunday := next_sunday + 7; end if;

  for w in 1..3 loop
    day := next_sunday - 7 * (4 - w);
    insert into public.peladas (date, start_time, location, status, created_by, created_at, closed_at, closed_by, presence_open)
    values (day, '15:30', 'Campo de Teste', 'encerrada', owner, day - 6, day + time '18:30', owner, false)
    returning id into pid;

    -- 20 dos 22 mensalistas + donos/admins mensalistas (2 ficam de fora a cada semana)
    roster := array(select id from seed_people where type = 'mensalista' order by random() limit 20);
    insert into public.presence (pelada_id, profile_id, answer, answered_at)
    select pid, unnest(roster), 'vou', day - 3;
    insert into public.presence (pelada_id, profile_id, answer, answered_at) values (pid, keeper, 'vou', day - 2);

    team_ids := '{}';
    for t in 1..4 loop
      insert into public.teams (pelada_id, captain_order, captain_id, kit_id, color)
      values (pid, t, roster[t], kit_ids[t], colors[1 + (t + w) % 6]) returning id into tid;
      team_ids := team_ids || tid;
      insert into public.team_members (pelada_id, team_id, profile_id, is_captain, source)
      values (pid, tid, roster[t], true, 'capitao');
    end loop;
    -- escolhas 1..16 na ordem 1234 · 4123 · 1234 · 1234
    for k in 1..16 loop
      t := (array[1,2,3,4, 4,1,2,3, 1,2,3,4, 1,2,3,4])[k];
      insert into public.team_members (pelada_id, team_id, profile_id, pick_number, source)
      values (pid, team_ids[t], roster[4 + k], k, (case when k % 7 = 0 then 'sorteio' else 'capitao' end)::public.pick_source);
    end loop;
    insert into public.drafts (pelada_id, phase, started_at, free_until, next_pick, finished_at)
    values (pid, 'concluida', day - 3, day - 2, 17, day - 1);

    for g in 1..8 loop
      insert into public.games (pelada_id, number, team1_id, team2_id, status, started_at, ended_at, created_by)
      values (pid, g, team_ids[pairs[g][1]], team_ids[pairs[g][2]], 'finalizado',
        day + time '15:30' + (g - 1) * interval '15 minutes', day + time '15:40' + (g - 1) * interval '15 minutes', owner)
      returning id into gid;
      insert into public.game_lineup (game_id, team_id, profile_id)
      select gid, m.team_id, m.profile_id from public.team_members m
      where m.team_id in (team_ids[pairs[g][1]], team_ids[pairs[g][2]]);

      -- Paredão agarra pelo primeiro time de cada jogo; o outro time joga com goleiro avulso
      insert into public.game_keepers (game_id, team_id, profile_id) values (gid, team_ids[pairs[g][1]], keeper), (gid, team_ids[pairs[g][2]], null);
      if random() < 0.6 then
        insert into public.game_events (game_id, type, team_id, minute, player_id, created_by)
        values (gid, 'defesa_dificil', team_ids[pairs[g][1]], 1 + floor(random() * 9), keeper, owner);
      end if;

      ga := floor(random() * 4); gb := floor(random() * 4);
      for goals in 1..(ga + gb) loop
        side := case when goals <= ga then team_ids[pairs[g][1]] else team_ids[pairs[g][2]] end;
        select profile_id into scorer from public.team_members where team_id = side order by random() limit 1;
        select profile_id into helper from public.team_members where team_id = side and profile_id <> scorer order by random() limit 1;
        insert into public.game_events (game_id, type, team_id, minute, player_id, assist_id, created_by)
        values (gid, 'gol', side, 1 + floor(random() * 10), scorer, case when random() < 0.6 then helper end, owner);
      end loop;
      -- empate: decide nos pênaltis
      if ga = gb then
        update public.games set penalty_winner_id = team_ids[pairs[g][(1 + floor(random() * 2))::int]] where id = gid;
      end if;
    end loop;

    insert into public.cash_entries (kind, category, description, amount, date, holder_id, pelada_id, created_by)
    values ('saida', 'gasto', 'Aluguel do campo', 200, day, owner, pid, owner);
  end loop;

  -- Próxima pelada: agendada, presença aberta, sem capitães ainda
  insert into public.peladas (date, start_time, location, created_by, created_at)
  values (next_sunday, '15:30', 'Campo de Teste', owner, now()) returning id into pid;
  insert into public.presence (pelada_id, profile_id, answer, answered_at)
  select pid, id, case when n % 6 = 0 then 'nao_vou'::public.presence_answer else 'vou' end, now() - (n || ' minutes')::interval
  from seed_people where type = 'mensalista' and n % 3 <> 1;
  insert into public.presence (pelada_id, profile_id, answer) values (pid, keeper, 'vou');

  -- times já escolhidos (para testar a estratégia): capitães dono, admin, j01 e j02, nessa ordem
  roster := array(select id from seed_people where n in (1, 2, 4, 5) order by n)
    || array(select sp.id from seed_people sp where sp.type = 'mensalista' and sp.n not in (1, 2, 4, 5)
             and not exists (select 1 from public.presence x where x.pelada_id = pid and x.profile_id = sp.id and x.answer = 'nao_vou')
             order by sp.n limit 16);
  team_ids := '{}';
  for t in 1..4 loop
    insert into public.teams (pelada_id, captain_order, captain_id, kit_id, color)
    values (pid, t, roster[t], kit_ids[t], colors[t]) returning id into tid;
    team_ids := team_ids || tid;
    insert into public.team_members (pelada_id, team_id, profile_id, is_captain, source) values (pid, tid, roster[t], true, 'capitao');
  end loop;
  for k in 1..least(16, cardinality(roster) - 4) loop
    t := (array[1,2,3,4, 4,1,2,3, 1,2,3,4, 1,2,3,4])[k];
    insert into public.team_members (pelada_id, team_id, profile_id, pick_number, source)
    values (pid, team_ids[t], roster[4 + k], k, 'capitao');
  end loop;
  insert into public.drafts (pelada_id, phase, started_at, free_until, next_pick, finished_at)
  values (pid, 'concluida', now() - interval '2 days', now() - interval '1 day', 17, now() - interval '1 hour');
end $$;

-- ------------------------------------------------------------
-- Dinheiro: mensalidade do mês com pagamentos variados e caixa
-- ------------------------------------------------------------
insert into public.charges (kind, title, amount, month, due_date, created_by)
select 'mensalidade', 'Mensalidade ' || to_char(current_date, 'MM/YYYY'), 30, date_trunc('month', current_date)::date,
  date_trunc('month', current_date)::date + 9, id
from seed_people where n = 1;

insert into public.payments (charge_id, profile_id, status, informed_at, confirmed_at, confirmed_by)
select c.id, p.id,
  (case when p.n % 4 = 0 then 'pendente' when p.n % 4 = 1 then 'informado' else 'confirmado' end)::public.payment_status,
  case when p.n % 4 <> 0 then now() - interval '5 days' end,
  case when p.n % 4 in (2, 3) then now() - interval '4 days' end,
  case when p.n % 4 in (2, 3) then (select id from seed_people where n = 1) end
from public.charges c cross join seed_people p
where c.kind = 'mensalidade' and p.type = 'mensalista';

insert into public.cash_entries (kind, category, description, amount, holder_id, charge_id, payer_id, created_by)
select 'entrada', 'mensalidade', 'Mensalidade ' || p.name, 30, (select id from seed_people where n = 1), c.id, p.id, (select id from seed_people where n = 1)
from public.payments pay join public.charges c on c.id = pay.charge_id join seed_people p on p.id = pay.profile_id
where pay.status = 'confirmado';

set session_replication_role = origin;
