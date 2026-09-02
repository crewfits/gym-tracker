-- Atomically choose scanner direction and suppress rapid rescans.

create or replace function public.record_scanner_attendance(
  p_member_id uuid,
  p_qr_version integer,
  p_request_id uuid
)
returns public.attendance_events
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_gym uuid;
  gym_timezone text;
  credential public.member_qr_credentials;
  active_membership_id uuid;
  local_date date;
  last_direction public.attendance_direction;
  next_direction public.attendance_direction;
  existing public.attendance_events;
  recent public.attendance_events;
  result public.attendance_events;
begin
  current_gym := public.current_gym_id();
  if current_gym is null then raise exception 'Gym profile not found'; end if;

  select timezone into gym_timezone from public.gyms where id = current_gym;
  local_date := (now() at time zone gym_timezone)::date;

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
    and occurred_at >= now() - interval '30 seconds'
  order by occurred_at desc, id desc
  limit 1;
  if recent.id is not null then return recent; end if;

  select direction into last_direction from public.attendance_events
  where member_id = p_member_id
    and attendance_events.gym_id = current_gym
    and (occurred_at at time zone gym_timezone)::date = local_date
  order by occurred_at desc, id desc
  limit 1;
  next_direction := case when last_direction = 'entry' then 'exit'::public.attendance_direction else 'entry'::public.attendance_direction end;

  insert into public.attendance_events(
    gym_id, member_id, membership_id, direction, qr_version, scanned_by, request_id
  ) values (
    current_gym, p_member_id, active_membership_id, next_direction, p_qr_version, auth.uid(), p_request_id
  ) returning * into result;

  return result;
end;
$$;

revoke execute on function public.record_scanner_attendance(uuid, integer, uuid) from public, anon;
grant execute on function public.record_scanner_attendance(uuid, integer, uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
