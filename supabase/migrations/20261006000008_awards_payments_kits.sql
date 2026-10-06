-- Troféus do mês, mensalidade automática e kits criados/sugeridos pelos capitães

-- ============================================================
-- Troféus (meses já fechados, só mensalistas)
-- ============================================================

create function public.current_month() returns date
language sql stable as $$ select public.month_of((now() at time zone 'America/Sao_Paulo')::date) $$;

-- Gols e vitórias de cada time em cada pelada encerrada (para a Seleção do mês)
create view public.pelada_team_results with (security_invoker = true) as
select
  t.pelada_id,
  public.month_of(p.date) as month,
  t.id as team_id,
  count(*) filter (where (t.id = g.team1_id and s.team1_goals > s.team2_goals) or (t.id = g.team2_id and s.team2_goals > s.team1_goals))::int as wins,
  coalesce(sum(case when t.id = g.team1_id then s.team1_goals else s.team2_goals end), 0)::int as goals
from public.teams t
join public.peladas p on p.id = t.pelada_id and p.status = 'encerrada'
join public.games g on g.pelada_id = t.pelada_id and g.status = 'finalizado' and t.id in (g.team1_id, g.team2_id)
join public.game_scores s on s.game_id = g.id
group by t.pelada_id, p.date, t.id;

create view public.awards with (security_invoker = true) as
with closed as (
  select * from public.podium where month < public.current_month()
),
best_team as (
  select r.*, rank() over (partition by r.month order by r.wins desc, r.goals desc) as pos
  from public.pelada_team_results r
  where r.month < public.current_month() and r.wins > 0
)
select month, profile_id, 'melhor_mes'::text as award, rank_total::int as position from closed where rank_total <= 3 and total > 0
union all
select month, profile_id, 'artilheiro', 1 from closed where rank_goals = 1 and goals > 0
union all
select month, profile_id, 'garcom', 1 from closed where rank_assists = 1 and assists > 0
union all
select month, profile_id, 'mais_vitorias', 1 from closed where rank_wins = 1 and wins > 0
union all
select distinct b.month, m.profile_id, 'selecao', 1
from best_team b
join public.team_members m on m.team_id = b.team_id and not m.is_out and m.profile_id is not null
join public.profiles pr on pr.id = m.profile_id and pr.type = 'mensalista' and pr.status = 'ativo'
where b.pos = 1;

-- ============================================================
-- Mensalidade do mês: criada sozinha quando há valor configurado
-- ============================================================

create function public.ensure_current_fee() returns void
language plpgsql security definer set search_path = '' as $$
declare
  s public.app_settings;
  m date := public.current_month();
begin
  select * into s from public.app_settings;
  if s.fee_amount > 0 then
    insert into public.charges (kind, title, amount, month, due_date)
    values ('mensalidade', 'Mensalidade', s.fee_amount, m, m + (s.fee_due_day - 1))
    on conflict do nothing;
  end if;
end $$;

revoke execute on function public.ensure_current_fee() from public, anon;
select cron.schedule('monthly-fee', '5 3 * * *', 'select public.ensure_current_fee()');

-- Cotinha criada pelo admin; vale para os mensalistas
create function public.create_cotinha(p_title text, p_amount numeric, p_due date) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  new_id bigint;
begin
  if not public.is_admin() then raise exception 'Só admin'; end if;
  insert into public.charges (kind, title, amount, due_date, created_by)
  values ('cotinha', trim(p_title), p_amount, p_due, auth.uid()) returning id into new_id;
  return new_id;
end $$;

revoke execute on function public.create_cotinha(text, numeric, date) from public, anon;

-- ============================================================
-- Kits: sugestão (sempre) e criação pelo capitão (se o admin liberar)
-- ============================================================

-- Sugestão com escudo pode ser enviada mesmo com a criação desligada
drop policy kits_suggestions on storage.objects;
create policy kits_suggestions on storage.objects for insert to authenticated
  with check (
    bucket_id = 'kits'
    and (storage.foldername(name))[1] = 'sugestoes'
    and (storage.foldername(name))[2] = auth.uid()::text
    and public.is_active()
  );

create function public.is_current_captain() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.teams t join public.peladas p on p.id = t.pelada_id
    where t.captain_id = auth.uid() and p.status in ('agendada', 'em_andamento')
  )
$$;

create function public.create_kit_by_captain(p_name text, p_shield_path text) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  new_id bigint;
begin
  if not (select kit_creation_enabled from public.app_settings) then raise exception 'Criação de kit desativada pelo admin'; end if;
  if not (public.is_current_captain() or public.is_admin()) then raise exception 'Só capitães'; end if;
  if p_shield_path not like 'sugestoes/' || auth.uid()::text || '/%' then raise exception 'Escudo inválido'; end if;
  insert into public.kits (name, shield_path, created_by) values (trim(p_name), p_shield_path, auth.uid()) returning id into new_id;
  return new_id;
end $$;

create function public.review_kit_suggestion(p_id bigint, p_approve boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  s public.kit_suggestions;
begin
  if not public.is_admin() then raise exception 'Só admin'; end if;
  select * into s from public.kit_suggestions where id = p_id and status = 'pendente';
  if s is null then raise exception 'Sugestão não encontrada'; end if;
  if p_approve then
    if s.shield_path is null then raise exception 'A sugestão não tem escudo: adicione o kit com uma imagem'; end if;
    insert into public.kits (name, shield_path, created_by) values (s.name, s.shield_path, s.suggested_by);
  end if;
  update public.kit_suggestions
  set status = case when p_approve then 'aprovada' else 'recusada' end::public.review_status,
      reviewed_by = auth.uid(), reviewed_at = now()
  where id = p_id;
end $$;

revoke execute on function public.create_kit_by_captain(text, text), public.review_kit_suggestion(bigint, boolean) from public, anon;
