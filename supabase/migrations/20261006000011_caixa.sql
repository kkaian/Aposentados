-- Caixa da pelada (só admins): entradas, gastos e transferências entre admins.
-- Auditável: nada é apagado; lançamento errado é estornado com motivo.

create type public.cash_kind as enum ('entrada', 'saida', 'transferencia');

create table public.cash_entries (
  id bigint generated always as identity primary key,
  kind public.cash_kind not null,
  -- mensalidade, cotinha, diarista, avulsa, gasto, transferencia
  category text not null,
  description text not null check (length(trim(description)) between 1 and 80),
  amount numeric(10, 2) not null check (amount > 0),
  date date not null default (now() at time zone 'America/Sao_Paulo')::date,
  -- entrada: quem recebeu; saída: quem pagou; transferência: quem passou o dinheiro
  holder_id uuid not null references public.profiles (id),
  -- transferência: quem recebeu
  to_holder_id uuid references public.profiles (id),
  -- origem (quando veio de um pagamento ou de um diarista)
  charge_id bigint references public.charges (id) on delete set null,
  payer_id uuid references public.profiles (id) on delete set null,
  payer_name text,
  pelada_id bigint references public.peladas (id) on delete set null,
  created_by uuid not null references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid references public.profiles (id),
  void_reason text,
  check ((kind = 'transferencia') = (to_holder_id is not null)),
  check (to_holder_id is null or to_holder_id <> holder_id)
);

create index cash_entries_date on public.cash_entries (date);
-- um pagamento confirmado gera uma entrada ativa só
create unique index cash_entries_one_per_payment on public.cash_entries (charge_id, payer_id)
  where charge_id is not null and voided_at is null;

alter table public.cash_entries enable row level security;
-- admins leem; escrita só pelas funções abaixo (sem update/delete direto)
create policy cash_read on public.cash_entries for select to authenticated using (public.is_admin());
revoke insert, update, delete on public.cash_entries from authenticated, anon;

create function public.is_holder(p uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = p and status = 'ativo' and role in ('dono', 'admin'))
$$;

-- Lançamento manual: entrada avulsa, gasto ou transferência entre admins
create function public.cash_add(
  p_kind public.cash_kind, p_description text, p_amount numeric, p_holder uuid,
  p_to_holder uuid default null, p_date date default null
) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  new_id bigint;
begin
  if not public.is_admin() then raise exception 'Só admin'; end if;
  if not public.is_holder(p_holder) or (p_to_holder is not null and not public.is_holder(p_to_holder)) then
    raise exception 'O dinheiro precisa ficar com um admin ou o dono';
  end if;
  insert into public.cash_entries (kind, category, description, amount, holder_id, to_holder_id, date)
  values (
    p_kind,
    case p_kind when 'entrada' then 'avulsa' when 'saida' then 'gasto' else 'transferencia' end,
    trim(p_description), p_amount, p_holder,
    case when p_kind = 'transferencia' then p_to_holder end,
    coalesce(p_date, (now() at time zone 'America/Sao_Paulo')::date)
  ) returning id into new_id;
  return new_id;
end $$;

-- Estornar um lançamento (fica no histórico, riscado, com o motivo)
create function public.cash_void(p_entry bigint, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  e public.cash_entries;
begin
  if not public.is_admin() then raise exception 'Só admin'; end if;
  select * into e from public.cash_entries where id = p_entry and voided_at is null;
  if e is null then raise exception 'Lançamento não encontrado ou já estornado'; end if;
  update public.cash_entries
  set voided_at = now(), voided_by = auth.uid(), void_reason = nullif(trim(p_reason), '')
  where id = p_entry;
  -- estornar a entrada de um pagamento volta o pagamento para pendente
  if e.charge_id is not null and e.payer_id is not null then
    update public.payments set status = 'pendente', confirmed_at = null, confirmed_by = null
    where charge_id = e.charge_id and profile_id = e.payer_id;
  end if;
end $$;

-- Confirmar pagamento agora diz quem recebeu e lança no caixa
drop function public.confirm_payment(bigint, uuid);
create function public.confirm_payment(p_charge bigint, p_profile uuid, p_holder uuid default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  c public.charges;
  holder uuid := coalesce(p_holder, auth.uid());
begin
  if not public.is_admin() then raise exception 'Só admin'; end if;
  if not public.is_holder(holder) then raise exception 'O dinheiro precisa ficar com um admin ou o dono'; end if;
  select * into c from public.charges where id = p_charge;
  insert into public.payments (charge_id, profile_id, status, confirmed_at, confirmed_by)
  values (p_charge, p_profile, 'confirmado', now(), auth.uid())
  on conflict (charge_id, profile_id) do update
    set status = 'confirmado', confirmed_at = now(), confirmed_by = auth.uid();
  insert into public.cash_entries (kind, category, description, amount, holder_id, charge_id, payer_id)
  values (
    'entrada', c.kind::text,
    case when c.kind = 'mensalidade'
      then 'Mensalidade ' || to_char(c.month, 'MM/YYYY') || ' · ' || (select name from public.profiles where id = p_profile)
      else c.title || ' · ' || (select name from public.profiles where id = p_profile) end,
    c.amount, holder, p_charge, p_profile
  )
  on conflict do nothing;
end $$;

-- Desfazer confirmação (apertou por engano): estorna a entrada e volta para pendente
create function public.unconfirm_payment(p_charge bigint, p_profile uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  entry bigint;
begin
  if not public.is_admin() then raise exception 'Só admin'; end if;
  select id into entry from public.cash_entries
  where charge_id = p_charge and payer_id = p_profile and voided_at is null;
  if entry is not null then
    perform public.cash_void(entry, coalesce(nullif(trim(p_reason), ''), 'Confirmação desfeita'));
  else
    update public.payments set status = 'pendente', confirmed_at = null, confirmed_by = null
    where charge_id = p_charge and profile_id = p_profile;
  end if;
end $$;

-- Substituição integral com pagamento do diarista/avulso para jogar
drop function public.replace_member(bigint, uuid, text);
create function public.replace_member(
  p_member bigint, p_profile uuid, p_guest_name text, p_paid numeric default null, p_holder uuid default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  m public.team_members;
  guest bigint;
  who text;
begin
  if not public.is_admin() then raise exception 'Só admin'; end if;
  select * into m from public.team_members where id = p_member and not is_out;
  if m is null then raise exception 'Jogador não está no time'; end if;
  if num_nonnulls(p_profile, nullif(trim(p_guest_name), '')) <> 1 then raise exception 'Escolha quem entra'; end if;
  if p_paid is not null and p_paid > 0 and not public.is_holder(coalesce(p_holder, auth.uid())) then
    raise exception 'O dinheiro precisa ficar com um admin ou o dono';
  end if;

  if p_profile is null then
    insert into public.guests (pelada_id, name, created_by) values (m.pelada_id, trim(p_guest_name), auth.uid()) returning id into guest;
  end if;

  update public.team_members set is_out = true where id = p_member;
  insert into public.team_members (pelada_id, team_id, profile_id, guest_id, source, replaces_member_id)
  values (m.pelada_id, m.team_id, p_profile, guest, 'admin', p_member);

  if p_paid is not null and p_paid > 0 then
    who := coalesce((select name from public.profiles where id = p_profile), trim(p_guest_name));
    insert into public.cash_entries (kind, category, description, amount, holder_id, payer_id, payer_name, pelada_id, date)
    select 'entrada', 'diarista', 'Diarista · ' || who, p_paid, coalesce(p_holder, auth.uid()), p_profile,
      case when p_profile is null then trim(p_guest_name) end, m.pelada_id, p.date
    from public.peladas p where p.id = m.pelada_id;
  end if;
end $$;

revoke execute on function
  public.cash_add(public.cash_kind, text, numeric, uuid, uuid, date), public.cash_void(bigint, text),
  public.confirm_payment(bigint, uuid, uuid), public.unconfirm_payment(bigint, uuid, text),
  public.replace_member(bigint, uuid, text, numeric, uuid)
from public, anon;
