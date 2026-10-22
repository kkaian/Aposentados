-- Estratégia do time (gramadinho): o capitão escolhe a formação, põe os jogadores nas 5 posições
-- e deixa até 5 instruções de 80 caracteres. Só o próprio time vê. Jogador confirma "entendi" ou pede
-- para trocar de posição com um colega; o capitão aceita ou recusa. Edita até a pelada acabar:
-- ao encerrar, a estratégia é apagada (não fica no histórico).
-- As posições guardam o membro do time (team_members): quem substitui herda a posição pela cadeia
-- replaces_member_id, resolvida no app; vaga sem ninguém fica vazia.

create table public.team_tactics (
  team_id bigint primary key references public.teams (id) on delete cascade,
  formation text not null default '2-1-2' check (formation in ('2-1-2', '1-3-1', '2-2-1', '1-2-2', '3-1-1', '2-3')),
  -- 5 posições, da defesa para o ataque e da esquerda para a direita; nulo = vazia
  slots bigint[] not null default array[null, null, null, null, null]::bigint[] check (cardinality(slots) = 5),
  instructions text[] not null default '{}' check (cardinality(instructions) <= 5),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id)
);

-- "Entendi": vale para a versão da estratégia (acked_at depois do updated_at)
create table public.tactic_acks (
  team_id bigint not null references public.team_tactics (team_id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  acked_at timestamptz not null default now(),
  primary key (team_id, profile_id)
);

create table public.tactic_swaps (
  id bigint generated always as identity primary key,
  team_id bigint not null references public.team_tactics (team_id) on delete cascade,
  requester_id uuid not null references public.profiles (id) on delete cascade,
  -- com quem quer trocar de posição
  target_member_id bigint not null references public.team_members (id) on delete cascade,
  status text not null default 'pendente' check (status in ('pendente', 'aceita', 'recusada')),
  created_at timestamptz not null default now(),
  answered_at timestamptz
);

-- um pedido aberto por jogador
create unique index tactic_swaps_one_open on public.tactic_swaps (team_id, requester_id) where status = 'pendente';

-- Está no time (ou é o capitão)
create function private.in_team(p_team bigint) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.teams where id = p_team and captain_id = auth.uid())
      or exists (select 1 from public.team_members where team_id = p_team and profile_id = auth.uid() and not is_out)
$$;

-- Capitão de um time de pelada ainda aberta
create function private.captain_open(p_team bigint) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.teams t join public.peladas p on p.id = t.pelada_id
    where t.id = p_team and t.captain_id = auth.uid() and p.status in ('agendada', 'em_andamento')
  )
$$;

alter table public.team_tactics enable row level security;
alter table public.tactic_acks enable row level security;
alter table public.tactic_swaps enable row level security;
create policy team_tactics_team on public.team_tactics for select to authenticated using (private.in_team(team_id));
create policy tactic_acks_team on public.tactic_acks for select to authenticated using (private.in_team(team_id));
create policy tactic_swaps_team on public.tactic_swaps for select to authenticated using (private.in_team(team_id));
-- escrita só pelas funções abaixo
revoke insert, update, delete on public.team_tactics, public.tactic_acks, public.tactic_swaps from authenticated;
revoke all on public.team_tactics, public.tactic_acks, public.tactic_swaps from anon;

alter publication supabase_realtime add table public.team_tactics, public.tactic_acks, public.tactic_swaps;

create function public.save_tactic(p_team bigint, p_formation text, p_slots bigint[], p_instructions text[]) returns void
language plpgsql security definer set search_path = '' as $$
declare
  clean text[];
  existed boolean;
begin
  if not private.captain_open(p_team) then
    raise exception 'Só o capitão do time edita a estratégia, até a pelada acabar';
  end if;
  if cardinality(p_slots) <> 5 then raise exception 'A formação tem 5 posições'; end if;
  if exists (
    select 1 from unnest(p_slots) s(member_id)
    where member_id is not null and not exists (select 1 from public.team_members m where m.id = s.member_id and m.team_id = p_team)
  ) then
    raise exception 'Só jogadores do time entram no gramado';
  end if;
  if (select count(member_id) - count(distinct member_id) from unnest(p_slots) s(member_id)) > 0 then
    raise exception 'Cada jogador ocupa uma posição só';
  end if;
  select coalesce(array_agg(trim(i) order by n), '{}') into clean
  from unnest(coalesce(p_instructions, '{}')) with ordinality as x(i, n) where trim(i) <> '';
  if cardinality(clean) > 5 then raise exception 'No máximo 5 instruções'; end if;
  if exists (select 1 from unnest(clean) i where length(i) > 80) then raise exception 'Cada instrução tem no máximo 80 caracteres'; end if;

  select exists (select 1 from public.team_tactics where team_id = p_team) into existed;
  insert into public.team_tactics (team_id, formation, slots, instructions, updated_at, updated_by)
  values (p_team, p_formation, p_slots, clean, now(), auth.uid())
  on conflict (team_id) do update
  set formation = excluded.formation, slots = excluded.slots, instructions = excluded.instructions,
      updated_at = now(), updated_by = auth.uid();

  perform private.push(
    array(select profile_id from public.team_members where team_id = p_team and profile_id is not null and not is_out and profile_id <> auth.uid()),
    case when existed then 'Estratégia atualizada' else 'Estratégia do time' end,
    case when existed then 'O capitão mudou o plano de jogo. Confira e confirme que entendeu.'
         else 'O capitão montou o plano de jogo (formação ' || p_formation || '). Confira e confirme que entendeu.' end,
    '/estrategia');
end $$;

-- Capitão apaga a estratégia (some para o time todo)
create function public.delete_tactic(p_team bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.captain_open(p_team) then
    raise exception 'Só o capitão do time apaga a estratégia, até a pelada acabar';
  end if;
  delete from public.team_tactics where team_id = p_team;
end $$;

create function public.ack_tactic(p_team bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.in_team(p_team) then raise exception 'Só jogadores do time'; end if;
  if not exists (select 1 from public.team_tactics where team_id = p_team) then raise exception 'O capitão ainda não montou a estratégia'; end if;
  insert into public.tactic_acks (team_id, profile_id) values (p_team, auth.uid())
  on conflict (team_id, profile_id) do update set acked_at = now();
end $$;

create function public.request_swap(p_team bigint, p_target bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.in_team(p_team) then raise exception 'Só jogadores do time'; end if;
  if not exists (select 1 from public.team_tactics t join public.teams tm on tm.id = t.team_id join public.peladas p on p.id = tm.pelada_id
                 where t.team_id = p_team and p.status in ('agendada', 'em_andamento')) then
    raise exception 'Não há estratégia aberta para este time';
  end if;
  if not exists (select 1 from public.team_members where id = p_target and team_id = p_team and not is_out)
     or exists (select 1 from public.team_members where id = p_target and profile_id = auth.uid()) then
    raise exception 'Escolha um colega do seu time';
  end if;
  -- novo pedido substitui o anterior ainda aberto
  delete from public.tactic_swaps where team_id = p_team and requester_id = auth.uid() and status = 'pendente';
  insert into public.tactic_swaps (team_id, requester_id, target_member_id) values (p_team, auth.uid(), p_target);

  perform private.push(
    array(select captain_id from public.teams where id = p_team and captain_id is not null),
    'Pedido de troca de posição',
    (select name from public.profiles where id = auth.uid()) || ' quer a posição de '
      || coalesce((select coalesce(pr.name, g.name) from public.team_members m
                   left join public.profiles pr on pr.id = m.profile_id left join public.guests g on g.id = m.guest_id
                   where m.id = p_target), 'um colega') || '.',
    '/estrategia');
end $$;

create function public.cancel_swap(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.tactic_swaps where id = p_id and requester_id = auth.uid() and status = 'pendente';
end $$;

-- Quem ocupa hoje o lugar de um membro (segue a cadeia de substituições)
create function private.current_member(p_member bigint) returns bigint
language sql stable security definer set search_path = '' as $$
  with recursive chain (id, is_out, depth) as (
    select id, is_out, 0 from public.team_members where id = p_member
    union all
    select m.id, m.is_out, c.depth + 1 from chain c join public.team_members m on m.replaces_member_id = c.id
    where c.is_out and c.depth < 20
  )
  select id from chain where not is_out order by depth limit 1
$$;

-- Capitão aceita (troca as duas posições) ou recusa
create function public.answer_swap(p_id bigint, p_accept boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  s public.tactic_swaps;
  t public.team_tactics;
  mine bigint;
  i int;
  a int;
  b int;
begin
  select * into s from public.tactic_swaps where id = p_id and status = 'pendente';
  if s.id is null then raise exception 'Pedido não encontrado'; end if;
  if not private.captain_open(s.team_id) then raise exception 'Só o capitão responde'; end if;

  if p_accept then
    select * into t from public.team_tactics where team_id = s.team_id for update;
    select id into mine from public.team_members where team_id = s.team_id and profile_id = s.requester_id and not is_out;
    for i in 1..5 loop
      t.slots[i] := private.current_member(t.slots[i]);
    end loop;
    for i in 1..5 loop
      if t.slots[i] = mine then a := i; end if;
      if t.slots[i] = s.target_member_id then b := i; end if;
    end loop;
    if b is null then raise exception 'O colega não está no gramado: ajuste as posições na mão'; end if;
    t.slots[b] := mine;
    if a is not null then t.slots[a] := s.target_member_id; end if;
    update public.team_tactics set slots = t.slots, updated_at = now(), updated_by = auth.uid() where team_id = s.team_id;
  end if;
  update public.tactic_swaps set status = case when p_accept then 'aceita' else 'recusada' end, answered_at = now() where id = p_id;

  perform private.push(array[s.requester_id],
    case when p_accept then 'Troca aceita' else 'Troca recusada' end,
    case when p_accept then 'O capitão aceitou: você está na nova posição.' else 'O capitão manteve as posições.' end,
    '/estrategia');
end $$;

-- Pelada encerrada: as estratégias somem
create function private.on_pelada_closed_tactics() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.team_tactics where team_id in (select id from public.teams where pelada_id = new.id);
  return null;
end $$;

create trigger peladas_drop_tactics after update of status on public.peladas
for each row when (new.status in ('encerrada', 'cancelada') and old.status is distinct from new.status)
execute function private.on_pelada_closed_tactics();

revoke execute on function
  public.save_tactic(bigint, text, bigint[], text[]), public.delete_tactic(bigint), public.ack_tactic(bigint),
  public.request_swap(bigint, bigint), public.cancel_swap(bigint), public.answer_swap(bigint, boolean)
from public, anon;
