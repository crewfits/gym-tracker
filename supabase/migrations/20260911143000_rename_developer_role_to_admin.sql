do $$
begin
  if exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'gym_role')
     and exists (select 1 from pg_enum where enumtypid = 'public.gym_role'::regtype and enumlabel = 'developer')
     and not exists (select 1 from pg_enum where enumtypid = 'public.gym_role'::regtype and enumlabel = 'admin') then
    alter type public.gym_role rename value 'developer' to 'admin';
  end if;
end $$;

do $$
begin
  if to_regclass('public.gym_feature_flags') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'gym_feature_flags' and column_name = 'developer_enabled')
     and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'gym_feature_flags' and column_name = 'admin_enabled') then
    alter table public.gym_feature_flags rename column developer_enabled to admin_enabled;
  end if;
end $$;

do $$
begin
  if to_regclass('public.gym_users') is not null then
    drop policy if exists "owner manages staff" on public.gym_users;
    create policy "owner manages staff" on public.gym_users for all to authenticated
      using (gym_id = public.current_gym_id() and public.current_gym_role() in ('owner','admin'))
      with check (gym_id = public.current_gym_id() and public.current_gym_role() in ('owner','admin'));
  end if;
end $$;

do $$
begin
  if to_regclass('public.gym_feature_flags') is not null then
    drop policy if exists "owner manages flags" on public.gym_feature_flags;
    create policy "owner manages flags" on public.gym_feature_flags for all to authenticated
      using (gym_id = public.current_gym_id() and public.current_gym_role() in ('owner','admin'))
      with check (gym_id = public.current_gym_id() and public.current_gym_role() in ('owner','admin'));
  end if;
end $$;

create or replace function public.assign_member_trainer(p_member_id uuid, p_trainer_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  current_gym uuid := public.current_gym_id();
begin
  if auth.uid() is null or current_gym is null then raise exception 'Gym profile not found'; end if;
  if public.current_gym_role() not in ('owner','receptionist','admin') then raise exception 'Only owner or receptionist can assign trainers'; end if;
  if p_trainer_user_id is not null and not exists (
    select 1 from public.gym_users
    where id = p_trainer_user_id and gym_id = current_gym and role = 'trainer' and status = 'active'
  ) then
    raise exception 'Select an active trainer';
  end if;
  update public.members
  set assigned_trainer_user_id = p_trainer_user_id, updated_at = now()
  where id = p_member_id and gym_id = current_gym and not is_archived;
  if not found then raise exception 'Active member not found'; end if;
end $$;

revoke all on function public.assign_member_trainer(uuid, uuid) from public, anon;
grant execute on function public.assign_member_trainer(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
