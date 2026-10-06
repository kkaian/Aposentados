-- "Esqueci minha senha": o admin gera uma senha temporária e passa por fora do app;
-- o jogador troca no primeiro acesso (profiles.must_change_password).

create function public.admin_reset_password(p_profile uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  temp text := lower(public.random_code(4)) || '-' || lower(public.random_code(4));
begin
  if not public.is_admin() then raise exception 'Só admin'; end if;
  if not exists (select 1 from public.profiles where id = p_profile and status = 'ativo') then
    raise exception 'Jogador não encontrado';
  end if;
  if exists (select 1 from public.profiles where id = p_profile and role = 'dono') and not public.is_owner() then
    raise exception 'Só o dono troca a própria senha';
  end if;

  update auth.users
  set encrypted_password = extensions.crypt(temp, extensions.gen_salt('bf')), updated_at = now()
  where id = p_profile;

  update public.profiles set must_change_password = true where id = p_profile;
  update public.password_requests set resolved_at = now(), resolved_by = auth.uid()
  where profile_id = p_profile and resolved_at is null;
  return temp;
end $$;

-- Depois de trocar a senha (supabase.auth.updateUser), o app libera o acesso
create function public.password_changed() returns void
language sql security definer set search_path = '' as $$
  update public.profiles set must_change_password = false where id = auth.uid()
$$;

revoke execute on function public.admin_reset_password(uuid), public.password_changed() from public, anon;
