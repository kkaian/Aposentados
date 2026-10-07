-- Trocar capitão (admin): outro mensalista do mesmo time vira capitão, sem refazer a escolha.
-- O time, as escolhas, a ordem e o kit/cor continuam iguais; a vez do time passa a ser do novo capitão.

create function public.change_captain(p_team bigint, p_profile uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  t public.teams;
  p public.peladas;
begin
  if not public.is_admin() then raise exception 'Só admin'; end if;
  select * into t from public.teams where id = p_team;
  if t.id is null then raise exception 'Time não encontrado'; end if;
  select * into p from public.peladas where id = t.pelada_id;
  if p.status = 'encerrada' then raise exception 'A pelada já foi encerrada'; end if;
  if t.captain_id = p_profile then raise exception 'Ele já é o capitão'; end if;
  if not exists (
    select 1 from public.team_members
    where team_id = p_team and profile_id = p_profile and not is_out and not is_slot
  ) then
    raise exception 'O novo capitão precisa estar neste time';
  end if;
  if not exists (select 1 from public.profiles where id = p_profile and status = 'ativo' and type = 'mensalista') then
    raise exception 'O capitão precisa ser mensalista';
  end if;

  update public.team_members set is_captain = false where team_id = p_team and is_captain;
  update public.team_members set is_captain = true where team_id = p_team and profile_id = p_profile;
  update public.teams set captain_id = p_profile where id = p_team;

  perform private.push(array[p_profile], 'Você é capitão!',
    'Agora o time é seu na pelada de ' || private.day(p.date) || '. Fique de olho na sua vez de escolher.', '/times');
end $$;

revoke execute on function public.change_captain(bigint, uuid) from public, anon;
