-- Soft-revert mistaken renewals while preserving payment and receipt audit history.

alter table public.memberships
  add column if not exists reverted_at timestamptz,
  add column if not exists reverted_reason text,
  add column if not exists reverted_by uuid references auth.users(id) on delete set null;

create index if not exists memberships_active_period_idx
  on public.memberships(gym_id, member_id, starts_on, expires_on)
  where reverted_at is null;

drop view if exists public.charge_balances;

create view public.charge_balances with (security_invoker = true) as
select
  c.id,
  c.gym_id,
  c.membership_id,
  c.subtotal_paise,
  c.discount_paise,
  c.gst_rate_basis_points,
  c.tax_paise,
  c.total_paise,
  c.created_at,
  coalesce(sum(case when p.voided_at is not null then 0 else p.amount_paise - coalesce(r.reversed_paise, 0) end), 0)::bigint as paid_paise,
  (c.total_paise - coalesce(sum(case when p.voided_at is not null then 0 else p.amount_paise - coalesce(r.reversed_paise, 0) end), 0))::bigint as balance_paise,
  c.due_on
from public.charges c
join public.memberships ms on ms.id = c.membership_id and ms.gym_id = c.gym_id and ms.reverted_at is null
left join public.payments p on p.charge_id = c.id
left join (select payment_id, sum(amount_paise) reversed_paise from public.payment_reversals group by payment_id) r on r.payment_id = p.id
group by c.id;

create or replace function public.record_payment(
  p_charge_id uuid,
  p_amount_paise bigint,
  p_method public.payment_method,
  p_reference text,
  p_paid_on date,
  p_notes text
)
returns public.payments
language plpgsql
security invoker
set search_path = public
as $$
declare
  g public.gyms;
  selected_charge public.charges;
  paid bigint;
  result public.payments;
begin
  select * into g from public.gyms where owner_id = auth.uid() for update;

  select ch.* into selected_charge
  from public.charges ch
  join public.memberships ms on ms.id = ch.membership_id and ms.gym_id = ch.gym_id
  where ch.id = p_charge_id
    and ch.gym_id = g.id
    and ms.reverted_at is null
  for update of ch;

  if selected_charge.id is null then raise exception 'Charge not found'; end if;

  select coalesce(sum(case when p.voided_at is not null then 0 else p.amount_paise - coalesce(r.reversed_paise, 0) end), 0)
  into paid
  from public.payments p
  left join (select payment_id, sum(amount_paise) reversed_paise from public.payment_reversals group by payment_id) r on r.payment_id = p.id
  where p.charge_id = selected_charge.id;

  if p_amount_paise <= 0 or paid + p_amount_paise > selected_charge.total_paise then
    raise exception 'Payment exceeds outstanding balance';
  end if;

  insert into public.payments(gym_id, charge_id, amount_paise, method, reference, paid_on, notes, receipt_number)
  values(g.id, selected_charge.id, p_amount_paise, p_method, nullif(trim(p_reference), ''), p_paid_on, nullif(trim(p_notes), ''), g.receipt_prefix || '-' || lpad(g.next_receipt_number::text, 6, '0'))
  returning * into result;

  update public.gyms set next_receipt_number = next_receipt_number + 1 where id = g.id;
  return result;
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
    and reverted_at is null
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

create or replace function public.get_dashboard_summary(p_today date default current_date)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with gym_context as (
    select id, timezone
    from public.gyms
    where id = public.current_gym_id()
  ),
  member_states as (
    select
      m.id,
      m.created_at,
      case
        when effective.id is null then 'not_enrolled'
        when effective.starts_on > p_today then 'upcoming'
        when effective.expires_on < p_today then 'expired'
        when effective.expires_on <= p_today + 7 then 'expiring'
        else 'active'
      end as membership_status
    from public.members m
    join gym_context g on g.id = m.gym_id
    left join lateral (
      select ms.id, ms.starts_on, ms.expires_on
      from public.memberships ms
      where ms.member_id = m.id and ms.gym_id = m.gym_id and ms.reverted_at is null
      order by
        case when ms.starts_on <= p_today and ms.expires_on >= p_today then 0 when ms.starts_on > p_today then 1 else 2 end,
        case when ms.starts_on > p_today then ms.starts_on end asc,
        ms.expires_on desc,
        ms.created_at desc
      limit 1
    ) effective on true
    where not m.is_archived
  ),
  member_balances as (
    select ms.member_id, sum(cb.balance_paise)::bigint as balance_paise
    from public.charge_balances cb
    join public.memberships ms on ms.id = cb.membership_id and ms.gym_id = cb.gym_id and ms.reverted_at is null
    join public.members m on m.id = ms.member_id and m.gym_id = cb.gym_id and not m.is_archived
    where cb.gym_id = public.current_gym_id()
    group by ms.member_id
  ),
  reversal_totals as (
    select payment_id, sum(amount_paise)::bigint as reversed_paise
    from public.payment_reversals
    where gym_id = public.current_gym_id()
    group by payment_id
  ),
  payment_rows as (
    select
      p.paid_on,
      p.method,
      case when p.voided_at is not null then 0 else p.amount_paise - coalesce(rt.reversed_paise, 0) end::bigint as net_paise
    from public.payments p
    left join reversal_totals rt on rt.payment_id = p.id
    where p.gym_id = public.current_gym_id()
  ),
  membership_sequence as (
    select
      ms.created_at,
      row_number() over (partition by ms.member_id order by ms.created_at, ms.id) as sequence_number
    from public.memberships ms
    where ms.gym_id = public.current_gym_id()
      and ms.reverted_at is null
  ),
  attendance_today as (
    select
      ae.member_id,
      ae.direction,
      ae.occurred_at,
      row_number() over (partition by ae.member_id order by ae.occurred_at desc, ae.id desc) as member_rank
    from public.attendance_events ae
    join gym_context g on g.id = ae.gym_id
    where (ae.occurred_at at time zone g.timezone)::date = p_today
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

create or replace function public.get_dashboard_monthly_trends(
  p_today date default current_date,
  p_months integer default 6
)
returns table (
  month_start date,
  new_members bigint,
  collected_paise bigint,
  payment_count bigint,
  renewals bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with gym_context as (
    select id, timezone from public.gyms where id = public.current_gym_id()
  ),
  months as (
    select generate_series(
      date_trunc('month', p_today)::date - (least(greatest(coalesce(p_months, 6), 2), 24) - 1) * interval '1 month',
      date_trunc('month', p_today)::date,
      interval '1 month'
    )::date as month_start
  ),
  reversal_totals as (
    select payment_id, sum(amount_paise)::bigint as reversed_paise
    from public.payment_reversals
    where gym_id = public.current_gym_id()
    group by payment_id
  ),
  payments_by_month as (
    select
      date_trunc('month', p.paid_on)::date as month_start,
      sum(case when p.voided_at is not null then 0 else p.amount_paise - coalesce(rt.reversed_paise, 0) end)::bigint as collected_paise,
      count(*) filter (where p.voided_at is null and p.amount_paise - coalesce(rt.reversed_paise, 0) > 0)::bigint as payment_count
    from public.payments p
    left join reversal_totals rt on rt.payment_id = p.id
    where p.gym_id = public.current_gym_id()
      and p.paid_on >= (select min(month_start) from months)
      and p.paid_on <= p_today
    group by 1
  ),
  members_by_month as (
    select date_trunc('month', m.created_at at time zone g.timezone)::date as month_start, count(*)::bigint as new_members
    from public.members m
    join gym_context g on g.id = m.gym_id
    where (m.created_at at time zone g.timezone)::date >= (select min(month_start) from months)
      and (m.created_at at time zone g.timezone)::date <= p_today
    group by 1
  ),
  membership_sequence as (
    select
      ms.created_at,
      g.timezone,
      row_number() over (partition by ms.member_id order by ms.created_at, ms.id) as sequence_number
    from public.memberships ms
    join gym_context g on g.id = ms.gym_id
    where ms.reverted_at is null
  ),
  renewals_by_month as (
    select date_trunc('month', created_at at time zone timezone)::date as month_start, count(*)::bigint as renewals
    from membership_sequence
    where sequence_number > 1
      and (created_at at time zone timezone)::date >= (select min(month_start) from months)
      and (created_at at time zone timezone)::date <= p_today
    group by 1
  )
  select
    mo.month_start,
    coalesce(mm.new_members, 0)::bigint,
    coalesce(pm.collected_paise, 0)::bigint,
    coalesce(pm.payment_count, 0)::bigint,
    coalesce(rm.renewals, 0)::bigint
  from months mo
  left join members_by_month mm using (month_start)
  left join payments_by_month pm using (month_start)
  left join renewals_by_month rm using (month_start)
  order by mo.month_start;
$$;

drop function if exists public.list_members(text, text, date, integer, integer);

create or replace function public.list_members(
  p_query text default null,
  p_status text default null,
  p_today date default current_date,
  p_page integer default 1,
  p_page_size integer default 50,
  p_sort text default 'created_at',
  p_order text default 'desc'
)
returns table (
  id uuid, member_code text, name text, phone text, email text,
  profile_photo_path text, is_archived boolean, created_at timestamptz,
  membership_id uuid, plan_name text, starts_on date, expires_on date,
  membership_status text, balance_paise bigint, qr_version integer,
  qr_enabled boolean, qr_shared_at timestamptz, total_count bigint
)
language sql stable security invoker set search_path = public
as $$
  with candidates as (
    select
      m.id, m.member_code, m.name, m.phone, m.email, m.profile_photo_path,
      m.is_archived, m.created_at, effective.id as membership_id,
      effective.plan_name, effective.starts_on, effective.expires_on,
      case
        when effective.id is null then 'not_enrolled'
        when effective.starts_on > p_today then 'upcoming'
        when effective.expires_on < p_today then 'expired'
        when effective.expires_on <= p_today + 7 then 'expiring'
        else 'active'
      end as membership_status,
      coalesce(member_balance.balance_paise, 0)::bigint as balance_paise,
      qr.version as qr_version, coalesce(qr.enabled, false) as qr_enabled,
      qr.shared_at as qr_shared_at
    from public.members m
    left join lateral (
      select ms.id, ms.plan_name, ms.starts_on, ms.expires_on
      from public.memberships ms
      where ms.member_id = m.id and ms.gym_id = m.gym_id and ms.reverted_at is null
      order by
        case when ms.starts_on <= p_today and ms.expires_on >= p_today then 0 when ms.starts_on > p_today then 1 else 2 end,
        case when ms.starts_on > p_today then ms.starts_on end asc,
        ms.expires_on desc, ms.created_at desc
      limit 1
    ) effective on true
    left join lateral (
      select coalesce(sum(cb.balance_paise), 0)::bigint as balance_paise
      from public.memberships ms
      join public.charge_balances cb on cb.membership_id = ms.id
      where ms.member_id = m.id and ms.gym_id = m.gym_id and ms.reverted_at is null
    ) member_balance on true
    left join public.member_qr_credentials qr on qr.member_id = m.id and qr.gym_id = m.gym_id
    where m.gym_id = public.current_gym_id()
      and (
        nullif(trim(coalesce(p_query, '')), '') is null
        or m.name ilike '%' || trim(p_query) || '%'
        or m.phone ilike '%' || trim(p_query) || '%'
        or m.member_code ilike '%' || trim(p_query) || '%'
      )
  ), filtered as (
    select candidates.*, count(*) over() as total_count
    from candidates
    where case
      when p_status = 'archived' then is_archived
      when p_status = 'all' then true
      when p_status = 'qr_not_generated' then not is_archived and qr_version is null
      when p_status = 'qr_not_shared' then not is_archived and qr_enabled and qr_shared_at is null
      when p_status = 'qr_shared' then not is_archived and qr_enabled and qr_shared_at is not null
      when p_status = 'qr_disabled' then not is_archived and qr_version is not null and not qr_enabled
      when is_archived then false
      when nullif(trim(coalesce(p_status, '')), '') is null then true
      when p_status = 'outstanding' then balance_paise > 0
      else membership_status = p_status
    end
  )
  select
    filtered.id, filtered.member_code, filtered.name, filtered.phone, filtered.email,
    filtered.profile_photo_path, filtered.is_archived, filtered.created_at,
    filtered.membership_id, filtered.plan_name, filtered.starts_on, filtered.expires_on,
    filtered.membership_status, filtered.balance_paise, filtered.qr_version,
    filtered.qr_enabled, filtered.qr_shared_at, filtered.total_count
  from filtered
  order by
    case when p_sort = 'name' and lower(p_order) = 'asc' then lower(filtered.name) end asc,
    case when p_sort = 'name' and lower(p_order) = 'desc' then lower(filtered.name) end desc,
    case when p_sort = 'expires_on' and lower(p_order) = 'asc' then filtered.expires_on end asc nulls last,
    case when p_sort = 'expires_on' and lower(p_order) = 'desc' then filtered.expires_on end desc nulls last,
    case when p_sort = 'balance' and lower(p_order) = 'asc' then filtered.balance_paise end asc,
    case when p_sort = 'balance' and lower(p_order) = 'desc' then filtered.balance_paise end desc,
    case when p_sort = 'status' and lower(p_order) = 'asc' then (case when filtered.is_archived then 'archived' else filtered.membership_status end) end asc,
    case when p_sort = 'status' and lower(p_order) = 'desc' then (case when filtered.is_archived then 'archived' else filtered.membership_status end) end desc,
    case when coalesce(p_sort, 'created_at') not in ('name', 'expires_on', 'balance', 'status') and lower(coalesce(p_order, 'desc')) = 'asc' then filtered.created_at end asc,
    case when coalesce(p_sort, 'created_at') not in ('name', 'expires_on', 'balance', 'status') and lower(coalesce(p_order, 'desc')) <> 'asc' then filtered.created_at end desc,
    filtered.created_at desc, filtered.id
  offset (greatest(coalesce(p_page, 1), 1) - 1) * least(greatest(coalesce(p_page_size, 50), 1), 100)
  limit least(greatest(coalesce(p_page_size, 50), 1), 100)
$$;

create or replace function public.list_reminder_candidates(
  p_filter text default null,
  p_today date default current_date,
  p_page integer default 1,
  p_page_size integer default 50,
  p_sort text default 'candidate_date',
  p_order text default 'asc'
)
returns table (
  candidate_kind text, member_id uuid, member_code text, member_name text,
  phone text, membership_id uuid, charge_id uuid, plan_name text,
  candidate_date date, balance_paise bigint, total_count bigint
)
language sql stable security invoker set search_path = public
as $$
  with payment_candidates as (
    select
      case when cb.due_on < p_today then 'overdue' else 'partial_payment' end as candidate_kind,
      m.id as member_id, m.member_code, m.name as member_name, m.phone,
      ms.id as membership_id, cb.id as charge_id, ms.plan_name,
      cb.due_on as candidate_date, cb.balance_paise
    from public.charge_balances cb
    join public.memberships ms on ms.id = cb.membership_id and ms.gym_id = cb.gym_id and ms.reverted_at is null
    join public.members m on m.id = ms.member_id and m.gym_id = cb.gym_id
    where cb.gym_id = public.current_gym_id()
      and not m.is_archived and cb.balance_paise > 0 and cb.due_on <= p_today + 7
  ), renewal_candidates as (
    select distinct on (m.id)
      'expiring'::text as candidate_kind, m.id as member_id, m.member_code,
      m.name as member_name, m.phone, ms.id as membership_id,
      null::uuid as charge_id, ms.plan_name, ms.expires_on as candidate_date,
      0::bigint as balance_paise
    from public.memberships ms
    join public.members m on m.id = ms.member_id and m.gym_id = ms.gym_id
    where ms.gym_id = public.current_gym_id()
      and ms.reverted_at is null
      and not m.is_archived
      and ms.starts_on <= p_today
      and ms.expires_on between p_today and p_today + 7
      and not exists (
        select 1 from public.memberships future
        where future.member_id = ms.member_id and future.gym_id = ms.gym_id and future.reverted_at is null and future.starts_on > p_today
      )
    order by m.id, ms.expires_on desc, ms.created_at desc
  ), candidates as (
    select * from payment_candidates
    union all
    select * from renewal_candidates
  ), filtered as (
    select candidates.*, count(*) over() as total_count
    from candidates
    where nullif(trim(coalesce(p_filter, '')), '') is null or candidate_kind = p_filter
  )
  select * from filtered
  order by
    case when p_sort = 'member_name' and lower(p_order) = 'asc' then lower(member_name) end asc,
    case when p_sort = 'member_name' and lower(p_order) = 'desc' then lower(member_name) end desc,
    case when p_sort = 'balance' and lower(p_order) = 'asc' then balance_paise end asc,
    case when p_sort = 'balance' and lower(p_order) = 'desc' then balance_paise end desc,
    case when coalesce(p_sort, 'candidate_date') not in ('member_name', 'balance') and lower(coalesce(p_order, 'asc')) = 'desc' then candidate_date end desc,
    case when coalesce(p_sort, 'candidate_date') not in ('member_name', 'balance') and lower(coalesce(p_order, 'asc')) <> 'desc' then candidate_date end asc,
    candidate_date, member_name, member_id
  offset (greatest(coalesce(p_page, 1), 1) - 1) * least(greatest(coalesce(p_page_size, 50), 1), 100)
  limit least(greatest(coalesce(p_page_size, 50), 1), 100)
$$;

revoke execute on function public.record_attendance(uuid, integer, public.attendance_direction, uuid) from public, anon;
grant execute on function public.record_attendance(uuid, integer, public.attendance_direction, uuid) to authenticated, service_role;
revoke execute on function public.get_dashboard_summary(date) from public, anon;
grant execute on function public.get_dashboard_summary(date) to authenticated, service_role;
revoke execute on function public.get_dashboard_monthly_trends(date, integer) from public, anon;
grant execute on function public.get_dashboard_monthly_trends(date, integer) to authenticated, service_role;
revoke execute on function public.list_members(text, text, date, integer, integer, text, text) from public, anon;
grant execute on function public.list_members(text, text, date, integer, integer, text, text) to authenticated, service_role;
revoke execute on function public.list_reminder_candidates(text, date, integer, integer, text, text) from public, anon;
grant execute on function public.list_reminder_candidates(text, date, integer, integer, text, text) to authenticated, service_role;

notify pgrst, 'reload schema';
