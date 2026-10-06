-- Apagar uma pelada leva junto times, jogos, elencos e eventos dela
alter table public.games drop constraint games_team1_id_fkey,
  add constraint games_team1_id_fkey foreign key (team1_id) references public.teams (id) on delete cascade;
alter table public.games drop constraint games_team2_id_fkey,
  add constraint games_team2_id_fkey foreign key (team2_id) references public.teams (id) on delete cascade;
alter table public.game_lineup drop constraint game_lineup_team_id_fkey,
  add constraint game_lineup_team_id_fkey foreign key (team_id) references public.teams (id) on delete cascade;
alter table public.game_events drop constraint game_events_team_id_fkey,
  add constraint game_events_team_id_fkey foreign key (team_id) references public.teams (id) on delete cascade;
alter table public.team_members drop constraint team_members_replaces_member_id_fkey,
  add constraint team_members_replaces_member_id_fkey foreign key (replaces_member_id) references public.team_members (id) on delete set null;
