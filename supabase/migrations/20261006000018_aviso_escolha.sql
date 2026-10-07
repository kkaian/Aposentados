-- "Você foi escolhido" vale para qualquer escolha da lista (também quando o admin escolhe pelo capitão)
create or replace function private.on_team_member() returns trigger
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
  elsif new.pick_number is not null then
    select pr.name into captain from public.teams t join public.profiles pr on pr.id = t.captain_id where t.id = new.team_id;
    perform private.push(array[new.profile_id],
      case when new.source = 'sorteio' then 'Você foi sorteado' else 'Você foi escolhido' end,
      'Está no time de ' || coalesce(captain, 'um capitão') || ' na pelada de ' || private.day(p.date) || '.', '/times');
  end if;
  return null;
end $$;
