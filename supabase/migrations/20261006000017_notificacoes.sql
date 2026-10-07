-- Notificações no celular (Web Push).
-- O banco decide quem avisar e manda o pedido (pg_net) para /api/push na Vercel, que criptografa e envia.
-- As chaves VAPID ficam em private.push_config, preenchida fora do git (o repositório é público).

create extension if not exists pg_net;

-- ============================================================
-- Inscrições (um registro por celular/navegador)
-- ============================================================

create table public.push_subscriptions (
  endpoint text primary key,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
create index on public.push_subscriptions (profile_id);
alter table public.push_subscriptions enable row level security;
create policy push_subscriptions_own on public.push_subscriptions for select to authenticated using (profile_id = auth.uid());

-- Ativa neste aparelho (se o aparelho era de outra conta, passa para a atual)
create function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_active() then raise exception 'Conta não ativa'; end if;
  insert into public.push_subscriptions (endpoint, profile_id, p256dh, auth)
  values (p_endpoint, auth.uid(), p_p256dh, p_auth)
  on conflict (endpoint) do update set profile_id = auth.uid(), p256dh = excluded.p256dh, auth = excluded.auth;
end $$;

create function public.remove_push_subscription(p_endpoint text) returns void
language sql security definer set search_path = '' as $$
  delete from public.push_subscriptions where endpoint = p_endpoint and profile_id = auth.uid()
$$;

revoke execute on function public.save_push_subscription(text, text, text), public.remove_push_subscription(text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text), public.remove_push_subscription(text) to authenticated;

-- ============================================================
-- Envio
-- ============================================================

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table private.push_config (
  id boolean primary key default true check (id),
  url text not null,
  vapid_public text not null,
  vapid_private text not null,
  subject text not null,
  token text not null
);

-- Manda uma notificação para estas pessoas (só quem ativou recebe)
create function private.push(p_to uuid[], p_title text, p_body text, p_url text default '/') returns void
language plpgsql security definer set search_path = '' as $$
declare
  cfg private.push_config;
  subs jsonb;
begin
  select * into cfg from private.push_config;
  if cfg is null then return; end if;
  select jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'keys', jsonb_build_object('p256dh', s.p256dh, 'auth', s.auth)))
  into subs
  from public.push_subscriptions s
  join public.profiles p on p.id = s.profile_id and p.status = 'ativo'
  where s.profile_id = any (p_to);
  if subs is null then return; end if;
  perform net.http_post(
    url := cfg.url,
    body := jsonb_build_object(
      'vapid', jsonb_build_object('publicKey', cfg.vapid_public, 'privateKey', cfg.vapid_private, 'subject', cfg.subject),
      'token', cfg.token,
      'subscriptions', subs,
      'message', jsonb_build_object('title', p_title, 'body', p_body, 'url', p_url)
    ),
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 20000
  );
end $$;

-- A Vercel devolve os aparelhos que não existem mais (desinstalou, trocou de celular)
create function public.push_gone(p_token text, p_endpoints text[]) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from private.push_config where token = p_token) then raise exception 'Token inválido'; end if;
  delete from public.push_subscriptions where endpoint = any (p_endpoints);
end $$;
grant execute on function public.push_gone(text, text[]) to anon, authenticated;

-- Quem recebe
create function private.admins() returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(id), '{}') from public.profiles where status = 'ativo' and role in ('dono', 'admin')
$$;

create function private.pelada_invited(p_pelada bigint) returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(id), '{}') from public.profiles
  where status = 'ativo'
    and (type = 'mensalista' or id in (select profile_id from public.pelada_diaristas where pelada_id = p_pelada))
$$;

create function private.day(d date) returns text
language sql stable as $$ select to_char(d, 'DD/MM') $$;

create function private.money(v numeric) returns text
language sql immutable as $$ select 'R$ ' || replace(to_char(v, 'FM999990.00'), '.', ',') $$;

-- ============================================================
-- Pelada criada, diarista chamado e lembrete de presença
-- ============================================================

create function private.on_pelada_created() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.push(private.pelada_invited(new.id),
    'Pelada marcada: ' || private.day(new.date),
    to_char(new.start_time, 'HH24"h"MI') || ' · ' || new.location || '. Confirme sua presença.', '/presenca');
  return null;
end $$;
create trigger push_pelada_created after insert on public.peladas
  for each row when (new.status = 'agendada') execute function private.on_pelada_created();

create function private.on_diarista_called() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  p public.peladas;
begin
  select * into p from public.peladas where id = new.pelada_id;
  if p.status <> 'agendada' then return null; end if;
  perform private.push(array[new.profile_id], 'Você foi chamado para a pelada',
    private.day(p.date) || ' · ' || to_char(p.start_time, 'HH24"h"MI') || ' · ' || p.location || '. Confirme sua presença.', '/presenca');
  return null;
end $$;
create trigger push_diarista_called after insert on public.pelada_diaristas
  for each row execute function private.on_diarista_called();

-- Véspera, meio-dia: quem ainda não respondeu
create function private.presence_reminder() returns void
language plpgsql security definer set search_path = '' as $$
declare
  p public.peladas;
begin
  for p in
    select * from public.peladas
    where status = 'agendada' and presence_open
      and date = (now() at time zone 'America/Sao_Paulo')::date + 1
  loop
    perform private.push(
      array(select unnest(private.pelada_invited(p.id))
            except select profile_id from public.presence where pelada_id = p.id),
      'Pelada amanhã', 'Você ainda não respondeu se vai. ' || to_char(p.start_time, 'HH24"h"MI') || ' · ' || p.location, '/presenca');
  end loop;
end $$;
select cron.schedule('push-presence-reminder', '0 15 * * *', 'select private.presence_reminder()');

-- ============================================================
-- Escolha dos times
-- ============================================================

-- Capitão definido / jogador escolhido ou sorteado
create function private.on_team_member() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  p public.peladas;
  captain text;
begin
  if new.profile_id is null then return null; end if;
  select * into p from public.peladas where id = new.pelada_id;
  if new.is_captain then
    perform private.push(array[new.profile_id], 'Você é capitão!',
      'Pelada de ' || private.day(p.date) || '. Fique de olho na sua vez de escolher.', '/times');
  elsif new.source in ('capitao', 'sorteio') then
    select pr.name into captain from public.teams t join public.profiles pr on pr.id = t.captain_id where t.id = new.team_id;
    perform private.push(array[new.profile_id],
      case when new.source = 'sorteio' then 'Você foi sorteado' else 'Você foi escolhido' end,
      'Está no time de ' || coalesce(captain, 'um capitão') || ' na pelada de ' || private.day(p.date) || '.', '/times');
  end if;
  return null;
end $$;
create trigger push_team_member after insert on public.team_members
  for each row execute function private.on_team_member();

-- Sua vez: roda no fim da transação e só avisa sobre a vez final
-- (no sorteio automático várias escolhas acontecem de uma vez)
create function private.on_draft_turn() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  d public.drafts;
  captain uuid;
  p public.peladas;
begin
  select * into d from public.drafts where pelada_id = new.pelada_id;
  if d is null or d.next_pick <> new.next_pick or d.phase = 'concluida' then return null; end if;
  select t.captain_id into captain from public.teams t
  where t.pelada_id = d.pelada_id and t.captain_order = public.draft_captain_for_pick(d.next_pick);
  if captain is null then return null; end if;
  select * into p from public.peladas where id = d.pelada_id;
  perform private.push(array[captain], 'Sua vez de escolher!',
    case when d.phase = 'turnos' then 'Você tem 10 min, senão o app sorteia.'
         else 'Escolha ' || d.next_pick || ' de 16 · pelada de ' || private.day(p.date) || '.' end, '/times');
  return null;
end $$;
create constraint trigger push_draft_turn after insert or update of next_pick, phase on public.drafts
  deferrable initially deferred
  for each row execute function private.on_draft_turn();

-- Times fechados (fim da escolha ou sorteio)
create function private.on_draft_done() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  p public.peladas;
begin
  select * into p from public.peladas where id = new.pelada_id;
  perform private.push(
    array(select profile_id from public.team_members where pelada_id = new.pelada_id and profile_id is not null and not is_out),
    'Times definidos', 'Os times da pelada de ' || private.day(p.date) || ' estão fechados. Veja o seu.', '/times');
  return null;
end $$;
create trigger push_draft_done after insert or update of phase on public.drafts
  for each row when (new.phase = 'concluida') execute function private.on_draft_done();

-- ============================================================
-- Admin: cadastro novo, pedido de senha, "Já paguei"
-- ============================================================

create function private.on_signup() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.push(private.admins(), 'Novo cadastro', new.name || ' está esperando aprovação.', '/admin/cadastros');
  return null;
end $$;
create trigger push_signup after insert or update of status on public.profiles
  for each row when (new.status = 'pendente') execute function private.on_signup();

create function private.on_password_request() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  who text;
begin
  select name into who from public.profiles where id = new.profile_id;
  perform private.push(private.admins(), 'Pedido de senha', coalesce(who, 'Um jogador') || ' esqueceu a senha.', '/admin/cadastros');
  return null;
end $$;
create trigger push_password_request after insert on public.password_requests
  for each row execute function private.on_password_request();

-- Pagamento: avisa os admins quando alguém informa; avisa o jogador quando é confirmado
create function private.on_payment() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  c public.charges;
  who text;
begin
  if tg_op = 'UPDATE' and new.status = old.status then return null; end if;
  select * into c from public.charges where id = new.charge_id;
  if new.status = 'informado' then
    select name into who from public.profiles where id = new.profile_id;
    perform private.push(private.admins(), 'Pagamento para confirmar',
      who || ' informou o pagamento: ' || c.title || ' (' || private.money(c.amount) || ').', '/pagamentos');
  elsif new.status = 'confirmado' then
    perform private.push(array[new.profile_id], 'Pagamento confirmado', c.title || ' · ' || private.money(c.amount), '/pagamentos');
  end if;
  return null;
end $$;
create trigger push_payment after insert or update of status on public.payments
  for each row execute function private.on_payment();

-- Prazo acabando: 3 dias antes e no dia do vencimento, para quem não pagou
create function private.payment_reminder() returns void
language plpgsql security definer set search_path = '' as $$
declare
  today date := (now() at time zone 'America/Sao_Paulo')::date;
  c public.charges;
begin
  for c in select * from public.charges where due_date in (today, today + 3) loop
    perform private.push(
      array(select profile_id from public.payments where charge_id = c.id and status = 'pendente'),
      case when c.due_date = today then c.title || ' vence hoje' else c.title || ' vence em 3 dias' end,
      private.money(c.amount) || ' · vencimento ' || private.day(c.due_date) || '.', '/pagamentos');
  end loop;
end $$;
select cron.schedule('push-payment-reminder', '0 13 * * *', 'select private.payment_reminder()');
