-- Registro do jogo: qualquer admin ou ajudante da pelada registra os eventos e encerra o jogo
-- (antes era um responsável por vez). Editar e excluir eventos continua só com admin.

drop policy game_events_recorder on public.game_events;
create policy game_events_recorder on public.game_events for insert to authenticated
  with check (exists (
    select 1 from public.games g
    where g.id = game_id and g.status = 'ao_vivo'
      and (g.recorder_id = auth.uid() or public.is_helper(g.pelada_id))
  ));

create or replace function public.finish_game(p_game bigint, p_penalty_winner bigint default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  s public.game_scores;
  cur public.games;
begin
  select * into cur from public.games where id = p_game;
  if not (public.is_admin() or public.is_helper(cur.pelada_id) or cur.recorder_id = auth.uid()) then
    raise exception 'Só admin ou ajudante da pelada encerra o jogo';
  end if;
  select * into s from public.game_scores where game_id = p_game;
  if p_penalty_winner is not null then
    if s.team1_goals <> s.team2_goals then raise exception 'Pênaltis só em jogo empatado'; end if;
    if p_penalty_winner not in (s.team1_id, s.team2_id) then raise exception 'Time não está neste jogo'; end if;
  end if;

  update public.games
  set status = 'finalizado', ended_at = now(), recorder_id = null, recorder_since = null,
      penalty_winner_id = p_penalty_winner
  where id = p_game and status = 'ao_vivo';
  if not found then raise exception 'Este jogo já foi encerrado'; end if;

  update public.game_lineup l set left_minute = coalesce(l.left_minute,
    least(60, extract(epoch from (now() - g.started_at))::int / 60))
  from public.games g where g.id = p_game and l.game_id = p_game and l.left_minute is null;
end $$;
