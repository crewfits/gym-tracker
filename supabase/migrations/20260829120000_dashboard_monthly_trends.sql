-- Dashboard trends and reminder delivery metadata.

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

revoke execute on function public.get_dashboard_monthly_trends(date, integer) from public, anon;
grant execute on function public.get_dashboard_monthly_trends(date, integer) to authenticated, service_role;

alter table public.gyms
  add column if not exists automatic_payment_emails_enabled boolean not null default false,
  add column if not exists payment_reminder_subject text not null default 'Payment follow-up from {{gym_name}}';

alter table public.reminder_deliveries
  alter column rule_id drop not null,
  add column if not exists charge_id uuid references public.charges(id) on delete set null,
  add column if not exists channel text not null default 'email' check (channel in ('email')),
  add column if not exists recipient_snapshot text,
  add column if not exists subject_snapshot text,
  add column if not exists message_snapshot text;

alter table public.reminder_deliveries drop constraint if exists reminder_deliveries_target_check;
alter table public.reminder_deliveries add constraint reminder_deliveries_target_check check (
  (rule_id is not null and charge_id is null) or (rule_id is null and charge_id is not null)
);

create unique index if not exists reminder_deliveries_payment_email_once_idx
  on public.reminder_deliveries(charge_id, scheduled_for, channel);
create index if not exists reminder_deliveries_gym_created_idx
  on public.reminder_deliveries(gym_id, created_at desc);

grant select, insert, update on table public.reminder_deliveries to service_role;

notify pgrst, 'reload schema';
