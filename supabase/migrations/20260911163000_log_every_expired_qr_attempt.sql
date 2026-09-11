create or replace function public.process_qr_access(
  p_member_id uuid, p_qr_version integer, p_request_id uuid,
  p_direction public.attendance_direction default null,
  p_denied_only boolean default false
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_gym uuid := public.current_gym_id();
  v_today date;
  v_credential public.member_qr_credentials;
  v_expired public.memberships;
  v_attempt public.denied_access_attempts;
  v_event public.attendance_events;
begin
  if auth.uid() is null or v_gym is null then raise exception 'Gym profile not found'; end if;
  if p_request_id is null then raise exception 'Request ID is required'; end if;
  select (now() at time zone timezone)::date into v_today from public.gyms where id = v_gym;
  perform 1 from public.members where id = p_member_id and gym_id = v_gym and not is_archived for update;
  if not found then raise exception 'Active member not found'; end if;
  select * into v_credential from public.member_qr_credentials where member_id = p_member_id and gym_id = v_gym for update;
  if p_qr_version is null or v_credential.member_id is null or not v_credential.enabled or v_credential.version <> p_qr_version then
    raise exception 'QR has been disabled or replaced';
  end if;

  select * into v_attempt from public.denied_access_attempts where gym_id = v_gym and request_id = p_request_id;
  if found then
    if v_attempt.member_id <> p_member_id or v_attempt.qr_version <> p_qr_version then raise exception 'Request ID already used'; end if;
    return jsonb_build_object('status', 'denied', 'attempt', to_jsonb(v_attempt), 'duplicate', true);
  end if;
  select * into v_event from public.attendance_events where gym_id = v_gym and request_id = p_request_id;
  if found then
    if v_event.member_id <> p_member_id or v_event.qr_version <> p_qr_version then raise exception 'Request ID already used'; end if;
    if v_event.voided_at is not null then raise exception 'Attendance request was already undone'; end if;
    return jsonb_build_object('status', 'recorded', 'event', to_jsonb(v_event));
  end if;

  if exists (select 1 from public.memberships where gym_id = v_gym and member_id = p_member_id
      and reverted_at is null and starts_on <= v_today and expires_on >= v_today) then
    if p_denied_only then return jsonb_build_object('status', 'allowed'); end if;
    if p_direction is null then
      v_event := public.record_scanner_attendance(p_member_id, p_qr_version, p_request_id);
    else
      v_event := public.record_attendance(p_member_id, p_qr_version, p_direction, p_request_id);
    end if;
    return jsonb_build_object('status', 'recorded', 'event', to_jsonb(v_event));
  end if;

  select * into v_expired from public.memberships where gym_id = v_gym and member_id = p_member_id
    and reverted_at is null and expires_on < v_today order by expires_on desc, id desc limit 1;
  if not found then raise exception 'Member does not have an active membership'; end if;
  insert into public.denied_access_attempts(gym_id, member_id, membership_id, qr_version, expires_on, scanned_by, request_id)
    values(v_gym, p_member_id, v_expired.id, p_qr_version, v_expired.expires_on, auth.uid(), p_request_id)
    returning * into v_attempt;
  return jsonb_build_object('status', 'denied', 'attempt', to_jsonb(v_attempt), 'duplicate', false);
end;
$$;

revoke all on function public.process_qr_access(uuid, integer, uuid, public.attendance_direction, boolean) from public, anon;
grant execute on function public.process_qr_access(uuid, integer, uuid, public.attendance_direction, boolean) to authenticated;
notify pgrst, 'reload schema';
