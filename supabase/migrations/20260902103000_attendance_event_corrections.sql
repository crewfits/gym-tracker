-- Keep attendance corrections audited while removing undone events from
-- operational direction, occupancy, history, and export calculations.

alter table public.attendance_events
  alter column qr_version drop not null,
  add column source text not null default 'qr',
  add column voided_at timestamptz,
  add column void_reason text,
  add column voided_by uuid references auth.users(id) on delete set null,
  add column replacement_event_id uuid references public.attendance_events(id) on delete set null,
  add column correction_request_id uuid unique;

alter table public.attendance_events
  add constraint attendance_events_source_check
    check (source in ('qr', 'manual')),
  add constraint attendance_events_qr_source_check
    check (source <> 'qr' or qr_version is not null),
  add constraint attendance_events_correction_check
    check (
      (voided_at is null and void_reason is null and voided_by is null and replacement_event_id is null and correction_request_id is null)
      or
      (voided_at is not null and length(trim(coalesce(void_reason, ''))) between 3 and 240 and correction_request_id is not null)
    ),
  add constraint attendance_events_replacement_not_self_check
    check (replacement_event_id is null or replacement_event_id <> id),
  add constraint attendance_events_replacement_unique unique (replacement_event_id);

create index attendance_events_active_gym_time_idx
  on public.attendance_events(gym_id, occurred_at desc)
  where voided_at is null;
create index attendance_events_active_member_time_idx
  on public.attendance_events(member_id, occurred_at desc)
  where voided_at is null;

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
  if existing.id is not null then
    if existing.voided_at is not null then raise exception 'Attendance request was already undone'; end if;
    return existing;
  end if;

  perform 1 from public.members
  where id = p_member_id and members.gym_id = current_gym and not is_archived
  for update;
  if not found then raise exception 'Active member not found'; end if;

  select * into credential from public.member_qr_credentials
  where member_id = p_member_id and member_qr_credentials.gym_id = current_gym
  for update;
  if p_qr_version is null or credential.member_id is null or not credential.enabled or credential.version <> p_qr_version then
    raise exception 'QR has been disabled or replaced';
  end if;

  select id into active_membership_id from public.memberships
  where member_id = p_member_id
    and memberships.gym_id = current_gym
    and reverted_at is null
    and starts_on <= local_date
    and expires_on >= local_date
  order by expires_on desc
  limit 1;
  if active_membership_id is null then raise exception 'Member does not have an active membership'; end if;

  select ae.* into recent from public.attendance_events ae
  where ae.member_id = p_member_id
    and ae.gym_id = current_gym
    and ae.direction = p_direction
    and ae.occurred_at >= now() - interval '15 seconds'
    and ae.voided_at is null
  order by ae.occurred_at desc, ae.id desc
  limit 1;
  if recent.id is not null then return recent; end if;

  insert into public.attendance_events(
    gym_id, member_id, membership_id, direction, qr_version, source, scanned_by, request_id
  ) values (
    current_gym, p_member_id, active_membership_id, p_direction, p_qr_version, 'qr', auth.uid(), p_request_id
  ) returning * into result;

  return result;
end;
$$;

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
  if existing.id is not null then
    if existing.voided_at is not null then raise exception 'Attendance request was already undone'; end if;
    return existing;
  end if;

  perform 1 from public.members
  where id = p_member_id and members.gym_id = current_gym and not is_archived
  for update;
  if not found then raise exception 'Active member not found'; end if;

  select * into credential from public.member_qr_credentials
  where member_id = p_member_id and member_qr_credentials.gym_id = current_gym
  for update;
  if p_qr_version is null or credential.member_id is null or not credential.enabled or credential.version <> p_qr_version then
    raise exception 'QR has been disabled or replaced';
  end if;

  select id into active_membership_id from public.memberships
  where member_id = p_member_id
    and memberships.gym_id = current_gym
    and reverted_at is null
    and starts_on <= local_date
    and expires_on >= local_date
  order by expires_on desc
  limit 1;
  if active_membership_id is null then raise exception 'Member does not have an active membership'; end if;

  select ae.* into recent from public.attendance_events ae
  where ae.member_id = p_member_id
    and ae.gym_id = current_gym
    and ae.occurred_at >= now() - interval '30 seconds'
    and ae.voided_at is null
  order by ae.occurred_at desc, ae.id desc
  limit 1;
  if recent.id is not null then return recent; end if;

  select ae.direction into last_direction from public.attendance_events ae
  where ae.member_id = p_member_id
    and ae.gym_id = current_gym
    and (ae.occurred_at at time zone gym_timezone)::date = local_date
    and ae.voided_at is null
  order by ae.occurred_at desc, ae.id desc
  limit 1;
  next_direction := case when last_direction = 'entry' then 'exit'::public.attendance_direction else 'entry'::public.attendance_direction end;

  insert into public.attendance_events(
    gym_id, member_id, membership_id, direction, qr_version, source, scanned_by, request_id
  ) values (
    current_gym, p_member_id, active_membership_id, next_direction, p_qr_version, 'qr', auth.uid(), p_request_id
  ) returning * into result;

  return result;
end;
$$;

create or replace function public.correct_latest_attendance_event(
  p_event_id uuid,
  p_replacement_direction public.attendance_direction,
  p_request_id uuid,
  p_reason text
)
returns public.attendance_events
language plpgsql
security definer
set search_path = public
as $$
declare
  current_gym uuid;
  gym_timezone text;
  local_date date;
  target public.attendance_events;
  latest_event_id uuid;
  prior_direction public.attendance_direction;
  expected_direction public.attendance_direction;
  active_membership_id uuid;
  replacement public.attendance_events;
  existing public.attendance_events;
  result public.attendance_events;
begin
  current_gym := public.current_gym_id();
  if auth.uid() is null or current_gym is null then raise exception 'Gym profile not found'; end if;
  if p_request_id is null then raise exception 'Correction request ID is required'; end if;
  if length(trim(coalesce(p_reason, ''))) not between 3 and 240 then raise exception 'Correction reason must be between 3 and 240 characters'; end if;

  select * into existing from public.attendance_events
  where correction_request_id = p_request_id and attendance_events.gym_id = current_gym;
  if existing.id is not null then return existing; end if;

  select ae.* into target from public.attendance_events ae
  where ae.id = p_event_id and ae.gym_id = current_gym and ae.voided_at is null;
  if target.id is null then raise exception 'Attendance event was not found or is already undone'; end if;

  perform 1 from public.members
  where id = target.member_id and members.gym_id = current_gym
  for update;
  if not found then raise exception 'Member not found'; end if;

  select timezone into gym_timezone from public.gyms where id = current_gym;
  local_date := (now() at time zone gym_timezone)::date;
  if (target.occurred_at at time zone gym_timezone)::date <> local_date then
    raise exception 'Only today''s latest attendance event can be undone';
  end if;
  if target.occurred_at > now() - interval '30 seconds' then
    raise exception 'Use the scanner result to change attendance during the first 30 seconds';
  end if;

  select ae.id into latest_event_id from public.attendance_events ae
  where ae.member_id = target.member_id and ae.gym_id = current_gym and ae.voided_at is null
  order by ae.occurred_at desc, ae.id desc
  limit 1;
  if latest_event_id is distinct from target.id then
    raise exception 'Only this member''s latest attendance event can be undone';
  end if;

  if p_replacement_direction is not null then
    if exists (
      select 1 from public.members
      where id = target.member_id and members.gym_id = current_gym and is_archived
    ) then raise exception 'Archived members cannot receive replacement attendance'; end if;

    select ae.direction into prior_direction from public.attendance_events ae
    where ae.member_id = target.member_id
      and ae.gym_id = current_gym
      and ae.id <> target.id
      and ae.voided_at is null
      and (ae.occurred_at at time zone gym_timezone)::date = local_date
    order by ae.occurred_at desc, ae.id desc
    limit 1;
    expected_direction := case when prior_direction = 'entry' then 'exit'::public.attendance_direction else 'entry'::public.attendance_direction end;
    if p_replacement_direction <> expected_direction then
      raise exception 'Replacement would create an invalid attendance sequence';
    end if;

    select id into active_membership_id from public.memberships
    where member_id = target.member_id
      and memberships.gym_id = current_gym
      and reverted_at is null
      and starts_on <= local_date
      and expires_on >= local_date
    order by expires_on desc
    limit 1;
    if active_membership_id is null then raise exception 'Member does not have an active membership'; end if;

    insert into public.attendance_events(
      gym_id, member_id, membership_id, direction, qr_version, source, scanned_by, request_id
    ) values (
      current_gym, target.member_id, active_membership_id, p_replacement_direction, null, 'manual', auth.uid(), p_request_id
    ) returning * into replacement;
  end if;

  update public.attendance_events
  set voided_at = now(),
      void_reason = trim(p_reason),
      voided_by = auth.uid(),
      replacement_event_id = replacement.id,
      correction_request_id = p_request_id
  where id = target.id and gym_id = current_gym and voided_at is null
  returning * into result;
  if result.id is null then raise exception 'Attendance event could not be undone'; end if;

  return result;
end;
$$;

drop function if exists public.list_attendance_events(text, public.attendance_direction, text, date, date, date, integer, integer, text, text);

create function public.list_attendance_events(
  p_query text default null,
  p_direction public.attendance_direction default null,
  p_view text default 'today',
  p_from date default null,
  p_to date default null,
  p_today date default current_date,
  p_page integer default 1,
  p_page_size integer default 50,
  p_sort text default 'occurred_at',
  p_order text default 'desc'
)
returns table (
  id uuid, member_id uuid, member_code text, member_name text,
  membership_id uuid, plan_name text, direction public.attendance_direction,
  qr_version integer, source text, occurred_at timestamptz, business_date date,
  can_undo boolean, replacement_direction public.attendance_direction,
  total_count bigint
)
language sql stable security invoker set search_path = public
as $$
  with candidates as (
    select
      ae.id, ae.member_id, m.member_code, m.name as member_name,
      ae.membership_id, ms.plan_name, ae.direction, ae.qr_version, ae.source, ae.occurred_at,
      (ae.occurred_at at time zone g.timezone)::date as business_date
    from public.attendance_events ae
    join public.gyms g on g.id = ae.gym_id
    join public.members m on m.id = ae.member_id and m.gym_id = ae.gym_id
    left join public.memberships ms on ms.id = ae.membership_id and ms.gym_id = ae.gym_id
    where ae.gym_id = public.current_gym_id()
      and ae.voided_at is null
      and (
        nullif(trim(coalesce(p_query, '')), '') is null
        or m.name ilike '%' || trim(p_query) || '%'
        or m.member_code ilike '%' || trim(p_query) || '%'
        or m.phone ilike '%' || trim(p_query) || '%'
      )
  ), ranked as (
    select
      candidates.*,
      row_number() over (partition by member_id, business_date order by occurred_at desc, id desc) as day_rank,
      row_number() over (partition by member_id order by occurred_at desc, id desc) as member_rank,
      lead(direction) over (partition by member_id, business_date order by occurred_at desc, id desc) as prior_direction
    from candidates
  ), filtered as (
    select ranked.*, count(*) over() as total_count
    from ranked
    where (p_direction is null or direction = p_direction)
      and case
        when p_view = 'today' then business_date = p_today
        when p_view = 'inside' then business_date = p_today and day_rank = 1 and direction = 'entry'
        when p_view = 'missed' then business_date = p_today - 1 and day_rank = 1 and direction = 'entry'
        else (p_from is null or business_date >= p_from) and (p_to is null or business_date <= p_to)
      end
  )
  select
    filtered.id, filtered.member_id, filtered.member_code, filtered.member_name,
    filtered.membership_id, filtered.plan_name, filtered.direction,
    filtered.qr_version, filtered.source, filtered.occurred_at, filtered.business_date,
    (filtered.member_rank = 1 and filtered.business_date = p_today and filtered.occurred_at <= now() - interval '30 seconds') as can_undo,
    case when filtered.prior_direction = 'entry' then 'exit'::public.attendance_direction else 'entry'::public.attendance_direction end as replacement_direction,
    filtered.total_count
  from filtered
  order by
    case when p_sort = 'member_name' and lower(p_order) = 'asc' then lower(filtered.member_name) end asc,
    case when p_sort = 'member_name' and lower(p_order) = 'desc' then lower(filtered.member_name) end desc,
    case when coalesce(p_sort, 'occurred_at') <> 'member_name' and lower(coalesce(p_order, 'desc')) = 'asc' then filtered.occurred_at end asc,
    case when coalesce(p_sort, 'occurred_at') <> 'member_name' and lower(coalesce(p_order, 'desc')) <> 'asc' then filtered.occurred_at end desc,
    filtered.occurred_at desc, filtered.id desc
  offset (greatest(coalesce(p_page, 1), 1) - 1) * least(greatest(coalesce(p_page_size, 50), 1), 100)
  limit least(greatest(coalesce(p_page_size, 50), 1), 100)
$$;

create or replace function public.get_dashboard_summary(p_today date default current_date)
returns jsonb
language sql stable security invoker set search_path = public
as $$
  with gym_context as (
    select id, timezone from public.gyms where id = public.current_gym_id()
  ), member_states as (
    select m.id, m.created_at,
      case
        when current_access.id is not null then case when future_access.id is not null then 'active' when current_access.expires_on <= p_today + 7 then 'expiring' else 'active' end
        when future_access.id is not null then 'upcoming'
        when expired_access.id is not null then 'expired'
        else 'not_enrolled'
      end as membership_status
    from public.members m
    join gym_context g on g.id = m.gym_id
    left join lateral (
      select ms.id, ms.starts_on, ms.expires_on from public.memberships ms
      where ms.member_id = m.id and ms.gym_id = m.gym_id and ms.reverted_at is null and ms.starts_on <= p_today and ms.expires_on >= p_today
      order by ms.expires_on desc, ms.created_at desc, ms.id desc limit 1
    ) current_access on true
    left join lateral (
      select ms.id from public.memberships ms
      where ms.member_id = m.id and ms.gym_id = m.gym_id and ms.reverted_at is null and ms.starts_on > p_today
      order by ms.starts_on asc, ms.created_at asc, ms.id asc limit 1
    ) future_access on true
    left join lateral (
      select ms.id from public.memberships ms
      where ms.member_id = m.id and ms.gym_id = m.gym_id and ms.reverted_at is null and ms.expires_on < p_today
      order by ms.expires_on desc, ms.created_at desc, ms.id desc limit 1
    ) expired_access on true
    where not m.is_archived
  ), member_balances as (
    select ms.member_id, sum(cb.balance_paise)::bigint as balance_paise
    from public.charge_balances cb
    join public.memberships ms on ms.id = cb.membership_id and ms.gym_id = cb.gym_id and ms.reverted_at is null
    join public.members m on m.id = ms.member_id and m.gym_id = cb.gym_id and not m.is_archived
    where cb.gym_id = public.current_gym_id()
    group by ms.member_id
  ), reversal_totals as (
    select payment_id, sum(amount_paise)::bigint as reversed_paise
    from public.payment_reversals where gym_id = public.current_gym_id() group by payment_id
  ), payment_rows as (
    select p.paid_on, p.method,
      case when p.voided_at is not null then 0 else p.amount_paise - coalesce(rt.reversed_paise, 0) end::bigint as net_paise
    from public.payments p left join reversal_totals rt on rt.payment_id = p.id
    where p.gym_id = public.current_gym_id()
  ), membership_sequence as (
    select ms.created_at, row_number() over (partition by ms.member_id order by ms.created_at, ms.id) as sequence_number
    from public.memberships ms where ms.gym_id = public.current_gym_id() and ms.reverted_at is null
  ), attendance_today as (
    select ae.member_id, ae.direction, ae.occurred_at,
      row_number() over (partition by ae.member_id order by ae.occurred_at desc, ae.id desc) as member_rank
    from public.attendance_events ae join gym_context g on g.id = ae.gym_id
    where ae.voided_at is null and (ae.occurred_at at time zone g.timezone)::date = p_today
  )
  select jsonb_build_object(
    'active_members', (select count(*) from member_states where membership_status in ('active', 'expiring')),
    'expiring_members', (select count(*) from member_states where membership_status = 'expiring'),
    'expired_members', (select count(*) from member_states where membership_status = 'expired'),
    'total_members', (select count(*) from member_states),
    'new_members_month', (select count(*) from member_states ms cross join gym_context g where (ms.created_at at time zone g.timezone)::date >= date_trunc('month', p_today)::date),
    'outstanding_paise', coalesce((select sum(balance_paise) from member_balances), 0),
    'overdue_paise', coalesce((select sum(cb.balance_paise) from public.charge_balances cb join public.memberships ms on ms.id = cb.membership_id and ms.gym_id = cb.gym_id and ms.reverted_at is null join public.members m on m.id = ms.member_id and m.gym_id = cb.gym_id and not m.is_archived where cb.gym_id = public.current_gym_id() and cb.balance_paise > 0 and cb.due_on < p_today), 0),
    'pending_accounts', (select count(*) from member_balances where balance_paise > 0),
    'today_collected_paise', coalesce((select sum(net_paise) from payment_rows where paid_on = p_today), 0),
    'today_payment_count', (select count(*) from payment_rows where paid_on = p_today and net_paise > 0),
    'month_collected_paise', coalesce((select sum(net_paise) from payment_rows where paid_on >= date_trunc('month', p_today)::date and paid_on <= p_today), 0),
    'month_payment_count', (select count(*) from payment_rows where paid_on >= date_trunc('month', p_today)::date and paid_on <= p_today and net_paise > 0),
    'renewals_month', (select count(*) from membership_sequence ms cross join gym_context g where ms.sequence_number > 1 and (ms.created_at at time zone g.timezone)::date >= date_trunc('month', p_today)::date),
    'attendance_entries_today', (select count(*) from attendance_today where direction = 'entry'),
    'attendance_exits_today', (select count(*) from attendance_today where direction = 'exit'),
    'attendance_inside_now', (select count(*) from attendance_today where member_rank = 1 and direction = 'entry'),
    'method_cash_paise', coalesce((select sum(net_paise) from payment_rows where method = 'cash' and paid_on >= date_trunc('month', p_today)::date and paid_on <= p_today), 0),
    'method_upi_paise', coalesce((select sum(net_paise) from payment_rows where method = 'upi' and paid_on >= date_trunc('month', p_today)::date and paid_on <= p_today), 0),
    'method_card_paise', coalesce((select sum(net_paise) from payment_rows where method = 'card' and paid_on >= date_trunc('month', p_today)::date and paid_on <= p_today), 0),
    'method_bank_transfer_paise', coalesce((select sum(net_paise) from payment_rows where method = 'bank_transfer' and paid_on >= date_trunc('month', p_today)::date and paid_on <= p_today), 0)
  )
$$;

revoke execute on function public.correct_latest_attendance_event(uuid, public.attendance_direction, uuid, text) from public, anon;
grant execute on function public.correct_latest_attendance_event(uuid, public.attendance_direction, uuid, text) to authenticated, service_role;
revoke execute on function public.list_attendance_events(text, public.attendance_direction, text, date, date, date, integer, integer, text, text) from public, anon;
grant execute on function public.list_attendance_events(text, public.attendance_direction, text, date, date, date, integer, integer, text, text) to authenticated, service_role;

notify pgrst, 'reload schema';
