-- Jogos da pelada: próximo jogo, avulsos na hora e edição segura de substituições

-- Admin ou ajudante escolhe os dois times do próximo jogo.
-- Se já existe um jogo "a seguir" (não começou), troca os times dele.
create function public.set_next_game(p_pelada bigint, p_team1 bigint, p_team2 bigint) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  g public.games;
  n smallint;
begin
  if not public.can_record(p_pelada) then raise exception 'Só admin ou ajudante da pelada'; end if;
  if (select status from public.peladas where id = p_pelada) not in ('agendada', 'em_andamento') then
    raise exception 'Pelada encerrada';
  end if;
  select * into g from public.games where pelada_id = p_pelada and status = 'agendado' order by number limit 1;
  if g.id is not null then
    update public.games set team1_id = p_team1, team2_id = p_team2 where id = g.id;
    return g.id;
  end if;
  select coalesce(max(number), 0) + 1 into n from public.games where pelada_id = p_pelada;
  insert into public.games (pelada_id, number, team1_id, team2_id, created_by)
  values (p_pelada, n, p_team1, p_team2, auth.uid()) returning id into g.id;
  return g.id;
end $$;

-- Avulso criado na hora (substituição parcial) por quem registra o jogo
create function public.add_guest(p_pelada bigint, p_name text) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  new_id bigint;
begin
  if not public.can_record(p_pelada) then raise exception 'Só admin ou ajudante da pelada'; end if;
  if nullif(trim(p_name), '') is null then raise exception 'Informe o nome do avulso'; end if;
  insert into public.guests (pelada_id, name, created_by) values (p_pelada, trim(p_name), auth.uid()) returning id into new_id;
  return new_id;
end $$;

revoke execute on function public.set_next_game(bigint, bigint, bigint), public.add_guest(bigint, text) from public, anon;

-- Substituição: não vira outro tipo de evento nem troca de jogadores (exclua e registre de novo)
create function public.guard_substitution_edit() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (old.type = 'substituicao') <> (new.type = 'substituicao')
     or (old.type = 'substituicao' and (
       old.player_id is distinct from new.player_id or old.player_guest_id is distinct from new.player_guest_id
       or old.sub_in_id is distinct from new.sub_in_id or old.sub_in_guest_id is distinct from new.sub_in_guest_id
       or old.team_id <> new.team_id)) then
    raise exception 'Para mudar uma substituição, exclua e registre de novo';
  end if;
  return new;
end $$;

create trigger game_events_guard_sub before update on public.game_events
for each row execute function public.guard_substitution_edit();

-- Excluir uma substituição desfaz a troca em campo
create function public.revert_substitution() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.type = 'substituicao' then
    delete from public.game_lineup
    where id = (
      select id from public.game_lineup
      where game_id = old.game_id and team_id = old.team_id and entered_minute = old.minute
        and (profile_id = old.sub_in_id or guest_id = old.sub_in_guest_id)
      order by id desc limit 1
    );
    update public.game_lineup set left_minute = null
    where id = (
      select id from public.game_lineup
      where game_id = old.game_id and team_id = old.team_id and left_minute = old.minute
        and (profile_id = old.player_id or guest_id = old.player_guest_id)
      order by id desc limit 1
    );
  end if;
  return old;
end $$;

create trigger game_events_revert_sub after delete on public.game_events
for each row execute function public.revert_substitution();
