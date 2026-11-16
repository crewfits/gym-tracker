-- Payment follow-up dates define the end of temporary QR access. Attempts
-- remain in the denied-access ledger and never count as attendance.
alter table public.denied_access_attempts
  drop constraint denied_access_attempts_reason_check,
  alter column expires_on drop not null,
  add column due_on date,
  add constraint denied_access_attempts_reason_check
    check (reason in ('membership_expired', 'payment_overdue')),
  add constraint denied_access_attempts_reason_dates_check
    check (
      (reason = 'membership_expired' and expires_on is not null and due_on is null)
      or (reason = 'payment_overdue' and expires_on is null and due_on is not null)
    );

-- Keep a durable audit trail because changing this date changes QR access.
create table public.charge_due_date_changes (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id),
  charge_id uuid not null references public.charges(id),
  old_due_on date not null,
  new_due_on date not null,
  changed_by uuid references auth.users(id) on delete set null,
  changed_at timestamptz not null default now(),
  unique (gym_id, id)
);
create index charge_due_date_changes_charge_idx
  on public.charge_due_date_changes(gym_id, charge_id, changed_at desc);
alter table public.charge_due_date_changes enable row level security;
create policy "owner charge due date history read" on public.charge_due_date_changes
  for select to authenticated using (gym_id = public.current_gym_id());
revoke all on public.charge_due_date_changes from public, anon, authenticated;
grant select on public.charge_due_date_changes to authenticated;
grant all on public.charge_due_date_changes to service_role;

create function public.audit_charge_due_date_change()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if old.due_on is distinct from new.due_on then
    insert into public.charge_due_date_changes(gym_id, charge_id, old_due_on, new_due_on, changed_by)
    values(new.gym_id, new.id, old.due_on, new.due_on, auth.uid());
  end if;
  return new;
end;
$$;
create trigger charges_due_date_audit
  after update of due_on on public.charges
  for each row execute function public.audit_charge_due_date_change();

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
  v_membership public.memberships;
  v_expired public.memberships;
  v_attempt public.denied_access_attempts;
  v_event public.attendance_events;
  v_balance bigint;
  v_due_on date;
  v_access_mode text := 'paid';
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

  select * into v_membership from public.memberships
  where gym_id = v_gym and member_id = p_member_id and reverted_at is null
    and starts_on <= v_today and expires_on >= v_today
  order by expires_on desc, id desc limit 1;
  if found then
    select cb.balance_paise, cb.due_on into v_balance, v_due_on
    from public.charge_balances cb
    where cb.gym_id = v_gym and cb.membership_id = v_membership.id;
    if coalesce(v_balance, 0) > 0 then
      if v_due_on is null then raise exception 'Membership payment status unavailable'; end if;
      if v_due_on < v_today then
        insert into public.denied_access_attempts(gym_id, member_id, membership_id, qr_version, reason, due_on, scanned_by, request_id)
        values(v_gym, p_member_id, v_membership.id, p_qr_version, 'payment_overdue', v_due_on, auth.uid(), p_request_id)
        returning * into v_attempt;
        return jsonb_build_object('status', 'denied', 'attempt', to_jsonb(v_attempt), 'duplicate', false);
      end if;
      v_access_mode := 'temporary';
    end if;
    if p_denied_only then return jsonb_build_object('status', 'allowed', 'access_mode', v_access_mode, 'due_on', v_due_on); end if;
    if p_direction is null then
      v_event := public.record_scanner_attendance(p_member_id, p_qr_version, p_request_id);
    else
      v_event := public.record_attendance(p_member_id, p_qr_version, p_direction, p_request_id);
    end if;
    return jsonb_build_object('status', 'recorded', 'event', to_jsonb(v_event), 'access_mode', v_access_mode, 'due_on', v_due_on);
  end if;

  select * into v_expired from public.memberships where gym_id = v_gym and member_id = p_member_id
    and reverted_at is null and expires_on < v_today order by expires_on desc, id desc limit 1;
  if not found then raise exception 'Member does not have an active membership'; end if;
  insert into public.denied_access_attempts(gym_id, member_id, membership_id, qr_version, reason, expires_on, scanned_by, request_id)
    values(v_gym, p_member_id, v_expired.id, p_qr_version, 'membership_expired', v_expired.expires_on, auth.uid(), p_request_id)
    returning * into v_attempt;
  return jsonb_build_object('status', 'denied', 'attempt', to_jsonb(v_attempt), 'duplicate', false);
end;
$$;
revoke all on function public.process_qr_access(uuid, integer, uuid, public.attendance_direction, boolean) from public, anon;
grant execute on function public.process_qr_access(uuid, integer, uuid, public.attendance_direction, boolean) to authenticated;

drop function public.list_denied_access_attempts(text, date, date, integer, integer, text, text);
create function public.list_denied_access_attempts(
  p_query text default null, p_from date default null, p_to date default null,
  p_page integer default 1, p_page_size integer default 10,
  p_sort text default 'occurred_at', p_order text default 'desc'
) returns table(id uuid, member_id uuid, member_code text, member_name text, plan_name text,
  reason text, expires_on date, due_on date, occurred_at timestamptz, business_date date, total_count bigint)
language sql stable security invoker set search_path = public
as $$
  select a.id, a.member_id, m.member_code, m.name, ms.plan_name, a.reason, a.expires_on, a.due_on,
    a.occurred_at, (a.occurred_at at time zone g.timezone)::date, count(*) over()
  from public.denied_access_attempts a
  join public.members m on m.id = a.member_id and m.gym_id = a.gym_id
  join public.memberships ms on ms.id = a.membership_id and ms.gym_id = a.gym_id and ms.member_id = a.member_id
  join public.gyms g on g.id = a.gym_id
  where a.gym_id = public.current_gym_id()
    and (nullif(trim(p_query), '') is null or m.name ilike '%' || trim(p_query) || '%'
      or m.member_code ilike '%' || trim(p_query) || '%' or m.phone ilike '%' || trim(p_query) || '%')
    and (p_from is null or a.occurred_at >= (p_from::timestamp at time zone g.timezone))
    and (p_to is null or a.occurred_at < ((p_to + 1)::timestamp at time zone g.timezone))
  order by
    case when p_sort = 'member_name' and p_order = 'asc' then m.name end asc,
    case when p_sort = 'member_name' and p_order = 'desc' then m.name end desc,
    case when p_sort = 'occurred_at' and p_order = 'asc' then a.occurred_at end asc,
    a.occurred_at desc, a.id desc
  limit greatest(1, least(coalesce(p_page_size, 10), 100))
  offset ((greatest(1, coalesce(p_page, 1)) - 1)::bigint * greatest(1, least(coalesce(p_page_size, 10), 100)));
$$;
revoke all on function public.list_denied_access_attempts(text, date, date, integer, integer, text, text) from public, anon;
grant execute on function public.list_denied_access_attempts(text, date, date, integer, integer, text, text) to authenticated;
notify pgrst, 'reload schema';
