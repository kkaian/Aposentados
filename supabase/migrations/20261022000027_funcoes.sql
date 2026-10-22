-- Funções do jogador: uma ou mais, cada uma com a característica (o próprio jogador escolhe).
-- Atacante (central / ponta), meio-campista (defensivo / ofensivo), defensor (central / lateral).

alter table public.profiles
  add column positions text[] not null default '{}'
  constraint profiles_positions_valid check (
    positions <@ array['atacante_central', 'atacante_ponta', 'meio_defensivo', 'meio_ofensivo', 'defensor_central', 'defensor_lateral']
  );

grant update (positions) on public.profiles to authenticated;
