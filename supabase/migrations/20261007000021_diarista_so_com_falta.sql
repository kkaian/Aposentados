-- Diarista só entra quando falta mensalista para fechar os 4 times de 5 (20 lugares):
-- há menos de 20 mensalistas ou algum deles disse "não vou" nesta pelada.
-- Vale para chamar o diarista (pelada_diaristas) e para ele aparecer na escolha dos times.

create function public.diaristas_liberados(p_pelada bigint) returns boolean
language sql stable security definer set search_path = '' as $$
  select count(*) < 20
  from public.profiles pr
  where pr.status = 'ativo' and pr.type = 'mensalista'
    and not exists (select 1 from public.presence x where x.pelada_id = p_pelada and x.profile_id = pr.id and x.answer = 'nao_vou')
$$;

create function private.guard_diarista_called() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not public.diaristas_liberados(new.pelada_id) then
    raise exception 'Diarista só pode ser chamado quando algum mensalista disser que não vai (ou houver menos de 20 mensalistas)';
  end if;
  return new;
end $$;

create trigger pelada_diaristas_guard before insert on public.pelada_diaristas
for each row execute function private.guard_diarista_called();

create or replace function public.draft_available(p_pelada bigint)
returns table (profile_id uuid)
language sql stable security definer set search_path = '' as $$
  select pr.id
  from public.profiles pr
  where pr.status = 'ativo'
    and (pr.type = 'mensalista'
         or (exists (select 1 from public.pelada_diaristas d where d.pelada_id = p_pelada and d.profile_id = pr.id)
             and public.diaristas_liberados(p_pelada)))
    and not exists (select 1 from public.presence x where x.pelada_id = p_pelada and x.profile_id = pr.id and x.answer = 'nao_vou')
    and not exists (select 1 from public.team_members m where m.pelada_id = p_pelada and m.profile_id = pr.id)
$$;

revoke execute on function public.diaristas_liberados(bigint) from public, anon;
