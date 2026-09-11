create type public.gym_role as enum ('owner', 'receptionist', 'trainer', 'admin');
create type public.gym_user_status as enum ('active', 'disabled');

create table public.gym_users (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.gym_role not null,
  status public.gym_user_status not null default 'active',
  display_name text not null default '',
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(gym_id, user_id),
  unique(gym_id, id),
  check (role <> 'trainer' or length(trim(display_name)) > 0)
);

create index gym_users_user_idx on public.gym_users(user_id, status);
create index gym_users_role_idx on public.gym_users(gym_id, role, status);

insert into public.gym_users(gym_id, user_id, role, status, display_name)
select id, owner_id, 'owner', 'active', 'Owner'
from public.gyms
on conflict (gym_id, user_id) do nothing;

create table public.gym_feature_flags (
  gym_id uuid not null references public.gyms(id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_]*$'),
  enabled boolean not null default false,
  admin_enabled boolean not null default false,
  config_json jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key(gym_id, key)
);

insert into public.gym_feature_flags(gym_id, key, enabled, admin_enabled, config_json)
select id, 'staff_roles', false, true, '{"trainerLimit":5,"receptionistLimit":1}'::jsonb from public.gyms
on conflict do nothing;
insert into public.gym_feature_flags(gym_id, key, enabled, admin_enabled)
select id, 'trainer_assignment', false, true from public.gyms
on conflict do nothing;
insert into public.gym_feature_flags(gym_id, key, enabled, admin_enabled)
select id, 'csv_exports', true, true from public.gyms
on conflict do nothing;

alter table public.members
  add column assigned_trainer_user_id uuid,
  add constraint members_assigned_trainer_user_fk foreign key(gym_id, assigned_trainer_user_id) references public.gym_users(gym_id, id);
create index members_assigned_trainer_idx on public.members(gym_id, assigned_trainer_user_id) where assigned_trainer_user_id is not null;

create or replace function public.current_gym_id()
returns uuid language sql stable security definer set search_path = public as $$
  select g.id
  from public.gyms g
  where g.owner_id = auth.uid()
  union
  select gu.gym_id
  from public.gym_users gu
  join public.gyms g on g.id = gu.gym_id
  where gu.user_id = auth.uid() and gu.status = 'active' and g.is_active
  limit 1
$$;

create or replace function public.current_gym_role()
returns public.gym_role language sql stable security definer set search_path = public as $$
  select coalesce(
    (
      select gu.role
      from public.gym_users gu
      where gu.user_id = auth.uid() and gu.status = 'active' and gu.gym_id = public.current_gym_id()
      limit 1
    ),
    (
      select 'owner'::public.gym_role
      from public.gyms g
      where g.owner_id = auth.uid() and g.id = public.current_gym_id()
      limit 1
    )
  )
$$;

alter table public.gym_users enable row level security;
alter table public.gym_feature_flags enable row level security;

create policy "active gym users read staff" on public.gym_users for select to authenticated
  using (gym_id = public.current_gym_id());
create policy "owner manages staff" on public.gym_users for all to authenticated
  using (gym_id = public.current_gym_id() and public.current_gym_role() in ('owner','admin'))
  with check (gym_id = public.current_gym_id() and public.current_gym_role() in ('owner','admin'));

create policy "active gym users read flags" on public.gym_feature_flags for select to authenticated
  using (gym_id = public.current_gym_id());
create policy "owner manages flags" on public.gym_feature_flags for all to authenticated
  using (gym_id = public.current_gym_id() and public.current_gym_role() in ('owner','admin'))
  with check (gym_id = public.current_gym_id() and public.current_gym_role() in ('owner','admin'));

create policy "active staff gym read" on public.gyms for select to authenticated
  using (id = public.current_gym_id());

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
