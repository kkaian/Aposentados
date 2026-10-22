-- Novo evento de jogo: defesa difícil do goleiro (registrada como um gol).
-- Fica sozinho nesta migração: o valor novo do enum só pode ser usado depois de gravado.
alter type public.event_type add value 'defesa_dificil';
