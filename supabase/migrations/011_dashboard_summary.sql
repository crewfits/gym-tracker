-- Accurate dashboard aggregates without loading entire growing tables.

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
      where ms.member_id = m.id and ms.gym_id = m.gym_id
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
    join public.memberships ms on ms.id = cb.membership_id and ms.gym_id = cb.gym_id
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
    'overdue_paise', coalesce((select sum(cb.balance_paise) from public.charge_balances cb join public.memberships ms on ms.id = cb.membership_id and ms.gym_id = cb.gym_id join public.members m on m.id = ms.member_id and m.gym_id = cb.gym_id and not m.is_archived where cb.gym_id = public.current_gym_id() and cb.balance_paise > 0 and cb.due_on < p_today), 0),
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

revoke execute on function public.get_dashboard_summary(date) from public, anon;
grant execute on function public.get_dashboard_summary(date) to authenticated, service_role;

notify pgrst, 'reload schema';
