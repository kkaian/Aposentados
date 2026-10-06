-- Kits genéricos com o escudo do Aposentados FC, até chegarem os definitivos.
-- shield_path começando com "/" aponta para um arquivo do próprio app (public/);
-- os demais são caminhos no bucket "kits" do Storage.
comment on column public.kits.shield_path is 'Caminho no bucket kits, ou arquivo do app quando começa com /';

insert into public.kits (name, shield_path) values
  ('Aposentados I', '/escudo.jpg'),
  ('Aposentados II', '/escudo.jpg'),
  ('Aposentados III', '/escudo.jpg'),
  ('Aposentados IV', '/escudo.jpg');
