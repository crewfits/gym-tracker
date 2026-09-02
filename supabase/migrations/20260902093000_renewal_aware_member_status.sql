-- A member with a current membership and a future renewal should not be
-- treated as expiring. Show the renewed plan/end date, but keep the overall
-- access status active until the current period actually ends.

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
        when current_access.id is not null then
          case
            when future_access.id is not null then 'active'
            when current_access.expires_on <= p_today + 7 then 'expiring'
            else 'active'
          end
        when future_access.id is not null then 'upcoming'
        when expired_access.id is not null then 'expired'
        else 'not_enrolled'
      end as membership_status
    from public.members m
    join gym_context g on g.id = m.gym_id
    left join lateral (
      select ms.id, ms.starts_on, ms.expires_on
      from public.memberships ms
      where ms.member_id = m.id
        and ms.gym_id = m.gym_id
        and ms.reverted_at is null
        and ms.starts_on <= p_today
        and ms.expires_on >= p_today
      order by ms.expires_on desc, ms.created_at desc, ms.id desc
      limit 1
    ) current_access on true
    left join lateral (
      select ms.id
      from public.memberships ms
      where ms.member_id = m.id
        and ms.gym_id = m.gym_id
        and ms.reverted_at is null
        and ms.starts_on > p_today
      order by ms.starts_on asc, ms.created_at asc, ms.id asc
      limit 1
    ) future_access on true
    left join lateral (
      select ms.id
      from public.memberships ms
      where ms.member_id = m.id
        and ms.gym_id = m.gym_id
        and ms.reverted_at is null
        and ms.expires_on < p_today
      order by ms.expires_on desc, ms.created_at desc, ms.id desc
      limit 1
    ) expired_access on true
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
      m.is_archived, m.created_at,
      coalesce(future_access.id, current_access.id, expired_access.id) as membership_id,
      coalesce(future_access.plan_name, current_access.plan_name, expired_access.plan_name) as plan_name,
      coalesce(future_access.starts_on, current_access.starts_on, expired_access.starts_on) as starts_on,
      coalesce(future_access.expires_on, current_access.expires_on, expired_access.expires_on) as expires_on,
      case
        when current_access.id is not null then
          case
            when future_access.id is not null then 'active'
            when current_access.expires_on <= p_today + 7 then 'expiring'
            else 'active'
          end
        when future_access.id is not null then 'upcoming'
        when expired_access.id is not null then 'expired'
        else 'not_enrolled'
      end as membership_status,
      coalesce(member_balance.balance_paise, 0)::bigint as balance_paise,
      qr.version as qr_version, coalesce(qr.enabled, false) as qr_enabled,
      qr.shared_at as qr_shared_at
    from public.members m
    left join lateral (
      select ms.id, ms.plan_name, ms.starts_on, ms.expires_on
      from public.memberships ms
      where ms.member_id = m.id and ms.gym_id = m.gym_id and ms.reverted_at is null and ms.starts_on <= p_today and ms.expires_on >= p_today
      order by ms.expires_on desc, ms.created_at desc, ms.id desc
      limit 1
    ) current_access on true
    left join lateral (
      select ms.id, ms.plan_name, ms.starts_on, ms.expires_on
      from public.memberships ms
      where ms.member_id = m.id and ms.gym_id = m.gym_id and ms.reverted_at is null and ms.starts_on > p_today
      order by ms.starts_on asc, ms.created_at asc, ms.id asc
      limit 1
    ) future_access on true
    left join lateral (
      select ms.id, ms.plan_name, ms.starts_on, ms.expires_on
      from public.memberships ms
      where ms.member_id = m.id and ms.gym_id = m.gym_id and ms.reverted_at is null and ms.expires_on < p_today
      order by ms.expires_on desc, ms.created_at desc, ms.id desc
      limit 1
    ) expired_access on true
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

revoke execute on function public.get_dashboard_summary(date) from public, anon;
grant execute on function public.get_dashboard_summary(date) to authenticated, service_role;
revoke execute on function public.list_members(text, text, date, integer, integer, text, text) from public, anon;
grant execute on function public.list_members(text, text, date, integer, integer, text, text) to authenticated, service_role;

notify pgrst, 'reload schema';
