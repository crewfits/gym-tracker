-- QR attendance was deployed to the first linked project before the payment
-- migrations occupied versions 003 and 004. These guards support both a clean
-- install and recording version 005 against that already-provisioned project.
do $$
begin
  create type public.attendance_direction as enum ('entry', 'exit');
exception
  when duplicate_object then null;
end;
$$;

create table if not exists public.member_qr_credentials (
  member_id uuid primary key references public.members(id) on delete cascade,
  gym_id uuid not null references public.gyms(id) on delete cascade,
  version integer not null check (version > 0),
  enabled boolean not null default true,
  issued_at timestamptz not null default now(),
  rotated_at timestamptz,
  changed_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (gym_id, member_id)
);

create table if not exists public.attendance_events (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  membership_id uuid references public.memberships(id) on delete set null,
  direction public.attendance_direction not null,
  qr_version integer not null check (qr_version > 0),
  scanned_by uuid references auth.users(id) on delete set null,
  request_id uuid not null unique,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists attendance_events_gym_time_idx
  on public.attendance_events(gym_id, occurred_at desc);
create index if not exists attendance_events_member_time_idx
  on public.attendance_events(member_id, occurred_at desc);

alter table public.member_qr_credentials enable row level security;
alter table public.attendance_events enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'member_qr_credentials' and policyname = 'owner qr credentials'
  ) then
    create policy "owner qr credentials" on public.member_qr_credentials
      for all
      using (gym_id = public.current_gym_id())
      with check (gym_id = public.current_gym_id());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'attendance_events' and policyname = 'owner attendance read'
  ) then
    create policy "owner attendance read" on public.attendance_events
      for select
      using (gym_id = public.current_gym_id());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'attendance_events' and policyname = 'owner attendance insert'
  ) then
    create policy "owner attendance insert" on public.attendance_events
      for insert
      with check (gym_id = public.current_gym_id());
  end if;
end;
$$;

create or replace function public.issue_member_qr(p_member_id uuid)
returns public.member_qr_credentials
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_gym uuid;
  result public.member_qr_credentials;
begin
  current_gym := public.current_gym_id();
  if current_gym is null then raise exception 'Gym profile not found'; end if;

  if not exists (
    select 1 from public.members
    where id = p_member_id and members.gym_id = current_gym and not is_archived
  ) then
    raise exception 'Active member not found';
  end if;

  insert into public.member_qr_credentials(member_id, gym_id, version, enabled, changed_by)
  values (p_member_id, current_gym, 1, true, auth.uid())
  on conflict (member_id) do update
    set version = member_qr_credentials.version + 1,
        enabled = true,
        rotated_at = now(),
        changed_by = auth.uid(),
        updated_at = now()
  returning * into result;

  return result;
end;
$$;

create or replace function public.disable_member_qr(p_member_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_gym uuid;
begin
  current_gym := public.current_gym_id();
  update public.member_qr_credentials
  set enabled = false, changed_by = auth.uid(), updated_at = now()
  where member_id = p_member_id and member_qr_credentials.gym_id = current_gym;

  if not found then raise exception 'QR credential not found'; end if;
end;
$$;

create or replace function public.record_attendance(
  p_member_id uuid,
  p_qr_version integer,
  p_direction public.attendance_direction,
  p_request_id uuid
)
returns public.attendance_events
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_gym uuid;
  credential public.member_qr_credentials;
  active_membership_id uuid;
  local_date date;
  existing public.attendance_events;
  recent public.attendance_events;
  result public.attendance_events;
begin
  current_gym := public.current_gym_id();
  if current_gym is null then raise exception 'Gym profile not found'; end if;

  select (now() at time zone timezone)::date into local_date
  from public.gyms where id = current_gym;

  select * into existing from public.attendance_events
  where request_id = p_request_id and attendance_events.gym_id = current_gym;
  if existing.id is not null then return existing; end if;

  perform 1 from public.members
  where id = p_member_id and members.gym_id = current_gym and not is_archived
  for update;
  if not found then raise exception 'Active member not found'; end if;

  select * into credential from public.member_qr_credentials
  where member_id = p_member_id and member_qr_credentials.gym_id = current_gym
  for update;
  if credential.member_id is null or not credential.enabled or credential.version <> p_qr_version then
    raise exception 'QR has been disabled or replaced';
  end if;

  select id into active_membership_id from public.memberships
  where member_id = p_member_id
    and memberships.gym_id = current_gym
    and starts_on <= local_date
    and expires_on >= local_date
  order by expires_on desc
  limit 1;
  if active_membership_id is null then raise exception 'Member does not have an active membership'; end if;

  select * into recent from public.attendance_events
  where member_id = p_member_id
    and attendance_events.gym_id = current_gym
    and direction = p_direction
    and occurred_at >= now() - interval '15 seconds'
  order by occurred_at desc
  limit 1;
  if recent.id is not null then return recent; end if;

  insert into public.attendance_events(
    gym_id, member_id, membership_id, direction, qr_version, scanned_by, request_id
  ) values (
    current_gym, p_member_id, active_membership_id, p_direction, p_qr_version, auth.uid(), p_request_id
  ) returning * into result;

  return result;
end;
$$;
