-- Regra de fim de jogo definida em cada pelada (antes fixa no app: 10 min ou 2 gols). O admin altera quando quiser.
alter table public.peladas
  add column game_minutes smallint not null default 10 constraint peladas_game_minutes check (game_minutes between 1 and 60),
  add column game_goals smallint not null default 2 constraint peladas_game_goals check (game_goals between 1 and 20);
