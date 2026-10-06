-- Mensagem certa para quem tenta avaliar a si mesmo
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
  if tg_op = 'UPDATE'
     and public.month_of((old.updated_at at time zone 'America/Sao_Paulo')::date)
       = public.month_of((now() at time zone 'America/Sao_Paulo')::date) then
    raise exception 'Você já alterou a nota deste jogador neste mês';
  end if;
  new.updated_at := now();
  return new;
end $$;
