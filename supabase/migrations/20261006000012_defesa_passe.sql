-- Notas: defesa e passe (antes do overall). Notas antigas ficam sem essas duas
-- até o avaliador completar; completar não conta como a mudança do mês.

alter table public.ratings
  add column defense smallint check (defense between 1 and 5),
  add column passing smallint check (passing between 1 and 5);

create or replace function public.check_rating() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.rater_id := auth.uid();
  if new.rater_id = new.rated_id then
    raise exception 'Não dá para avaliar a si mesmo';
  end if;
  if (select count(*) from public.profiles
      where id in (new.rater_id, new.rated_id) and type = 'mensalista' and status = 'ativo') <> 2 then
    raise exception 'Só mensalistas avaliam e são avaliados';
  end if;
  if new.defense is null or new.passing is null then
    raise exception 'Dê nota para defesa e passe também';
  end if;
  if tg_op = 'UPDATE'
     and old.defense is not null and old.passing is not null
     and public.month_of((old.updated_at at time zone 'America/Sao_Paulo')::date)
       = public.month_of((now() at time zone 'America/Sao_Paulo')::date) then
    raise exception 'Você já alterou a nota deste jogador neste mês';
  end if;
  new.updated_at := now();
  return new;
end $$;

drop view public.rating_summary;
create view public.rating_summary as
select
  rated_id as profile_id,
  count(*)::int as votes,
  case when count(*) >= 3 then round(avg(dribble), 1) end as dribble,
  case when count(*) >= 3 then round(avg(shot), 1) end as shot,
  case when count(*) >= 3 then round(avg(speed), 1) end as speed,
  case when count(defense) >= 3 then round(avg(defense), 1) end as defense,
  case when count(passing) >= 3 then round(avg(passing), 1) end as passing,
  case when count(*) >= 3 then round(avg(overall), 1) end as overall
from public.ratings
group by rated_id;

revoke all on public.rating_summary from anon;
