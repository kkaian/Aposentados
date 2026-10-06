-- Mensalidades organizadas: cada cobrança vale para os mensalistas daquele momento
-- (uma linha "pendente" por pessoa), o admin cria a do mês seguinte quando quiser,
-- quem vira mensalista entra nas cobranças do mês e futuras, e dá para dispensar alguém.

-- Cria (se faltar) a mensalidade do mês e as cobranças pendentes dos mensalistas
create function public.ensure_fee(p_month date) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  s public.app_settings;
  charge bigint;
begin
  select * into s from public.app_settings;
  select id into charge from public.charges where kind = 'mensalidade' and month = p_month;
  if charge is null then
    if s.fee_amount <= 0 then return null; end if;
    insert into public.charges (kind, title, amount, month, due_date)
    values ('mensalidade', 'Mensalidade', s.fee_amount, p_month, p_month + (s.fee_due_day - 1))
    returning id into charge;
  end if;
  insert into public.payments (charge_id, profile_id, status)
  select charge, id, 'pendente' from public.profiles where type = 'mensalista' and status = 'ativo'
  on conflict do nothing;
  return charge;
end $$;

-- Rotina diária e abertura de Pagamentos: só o mês atual
create or replace function public.ensure_current_fee() returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.ensure_fee(public.current_month());
end $$;

-- Admin cria a mensalidade de um mês (atual ou até 2 meses à frente)
create function public.create_month_fee(p_month date) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  m date := public.month_of(p_month);
begin
  if not public.is_admin() then raise exception 'Só admin'; end if;
  if m < public.current_month() or m > (public.current_month() + interval '2 months')::date then
    raise exception 'Escolha o mês atual ou um dos próximos 2';
  end if;
  if (select fee_amount from public.app_settings) <= 0 then
    raise exception 'Defina o valor da mensalidade em Mensalistas e cota';
  end if;
  return public.ensure_fee(m);
end $$;

-- Cotinha nova cobra os mensalistas de agora
create or replace function public.create_cotinha(p_title text, p_amount numeric, p_due date) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  new_id bigint;
begin
  if not public.is_admin() then raise exception 'Só admin'; end if;
  insert into public.charges (kind, title, amount, due_date, created_by)
  values ('cotinha', trim(p_title), p_amount, p_due, auth.uid()) returning id into new_id;
  insert into public.payments (charge_id, profile_id, status)
  select new_id, id, 'pendente' from public.profiles where type = 'mensalista' and status = 'ativo';
  return new_id;
end $$;

-- Virou mensalista: entra na mensalidade do mês atual e nas já criadas para frente
create function public.join_open_fees() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.type = 'mensalista' and new.status = 'ativo'
     and (old.type is distinct from 'mensalista' or old.status is distinct from 'ativo') then
    insert into public.payments (charge_id, profile_id, status)
    select c.id, new.id, 'pendente' from public.charges c
    where c.kind = 'mensalidade' and c.month >= public.current_month()
    on conflict do nothing;
  end if;
  return new;
end $$;

create trigger profiles_join_fees after update of type, status on public.profiles
for each row execute function public.join_open_fees();

-- Admin dispensa alguém de uma cobrança (ainda não confirmada)
create function public.dismiss_payment(p_charge bigint, p_profile uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Só admin'; end if;
  if exists (select 1 from public.payments where charge_id = p_charge and profile_id = p_profile and status = 'confirmado') then
    raise exception 'Pagamento já confirmado: desfaça a confirmação antes';
  end if;
  delete from public.payments where charge_id = p_charge and profile_id = p_profile;
end $$;

revoke execute on function public.ensure_fee(date) from public, anon, authenticated;
revoke execute on function public.create_month_fee(date), public.dismiss_payment(bigint, uuid) from public, anon;

-- Cobranças que já existem passam a valer para os mensalistas de hoje
insert into public.payments (charge_id, profile_id, status)
select c.id, p.id, 'pendente'
from public.charges c cross join public.profiles p
where p.type = 'mensalista' and p.status = 'ativo' and (c.kind = 'cotinha' or c.month >= public.current_month())
on conflict do nothing;
