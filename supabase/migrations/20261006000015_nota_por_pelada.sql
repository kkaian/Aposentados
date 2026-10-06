-- Notas: cada avaliação muda 1 vez por pelada (libera de novo quando o admin encerra a pelada),
-- em vez de 1 vez por mês.

create function public.last_pelada_closed_at() returns timestamptz
language sql stable security definer set search_path = '' as $$
  select coalesce(max(closed_at), '-infinity'::timestamptz) from public.peladas where status = 'encerrada'
$$;

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
  -- já mudou desde a última pelada encerrada: espera a próxima
  if tg_op = 'UPDATE'
     and old.defense is not null and old.passing is not null
     and old.updated_at >= public.last_pelada_closed_at() then
    raise exception 'Você já mudou a nota deste jogador nesta rodada. Libera de novo quando a próxima pelada for encerrada.';
  end if;
  new.updated_at := now();
  return new;
end $$;

grant execute on function public.last_pelada_closed_at() to authenticated;
