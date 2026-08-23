-- Show unpaid balances in the reminder queue before they become overdue.

create or replace function public.list_reminder_candidates(
  p_filter text default null,
  p_today date default current_date,
  p_page integer default 1,
  p_page_size integer default 50
)
returns table (
  candidate_kind text,
  member_id uuid,
  member_code text,
  member_name text,
  phone text,
  membership_id uuid,
  charge_id uuid,
  plan_name text,
  candidate_date date,
  balance_paise bigint,
  total_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with payment_candidates as (
    select
      case when cb.due_on < p_today then 'overdue' else 'partial_payment' end as candidate_kind,
      m.id as member_id,
      m.member_code,
      m.name as member_name,
      m.phone,
      ms.id as membership_id,
      cb.id as charge_id,
      ms.plan_name,
      cb.due_on as candidate_date,
      cb.balance_paise
    from public.charge_balances cb
    join public.memberships ms on ms.id = cb.membership_id and ms.gym_id = cb.gym_id
    join public.members m on m.id = ms.member_id and m.gym_id = cb.gym_id
    where cb.gym_id = public.current_gym_id()
      and not m.is_archived
      and cb.balance_paise > 0
      and cb.due_on <= p_today + 7
  ),
  renewal_candidates as (
    select distinct on (m.id)
      'expiring'::text as candidate_kind,
      m.id as member_id,
      m.member_code,
      m.name as member_name,
      m.phone,
      ms.id as membership_id,
      null::uuid as charge_id,
      ms.plan_name,
      ms.expires_on as candidate_date,
      0::bigint as balance_paise
    from public.memberships ms
    join public.members m on m.id = ms.member_id and m.gym_id = ms.gym_id
    where ms.gym_id = public.current_gym_id()
      and not m.is_archived
      and ms.starts_on <= p_today
      and ms.expires_on between p_today and p_today + 7
      and not exists (
        select 1 from public.memberships future
        where future.member_id = ms.member_id
          and future.gym_id = ms.gym_id
          and future.starts_on > p_today
      )
    order by m.id, ms.expires_on desc, ms.created_at desc
  ),
  candidates as (
    select * from payment_candidates
    union all
    select * from renewal_candidates
  ),
  filtered as (
    select candidates.*, count(*) over() as total_count
    from candidates
    where nullif(trim(coalesce(p_filter, '')), '') is null or candidate_kind = p_filter
  )
  select * from filtered
  order by candidate_date, member_name, member_id
  offset (greatest(coalesce(p_page, 1), 1) - 1) * least(greatest(coalesce(p_page_size, 50), 1), 100)
  limit least(greatest(coalesce(p_page_size, 50), 1), 100)
$$;

revoke execute on function public.list_reminder_candidates(text, date, integer, integer) from public, anon;
grant execute on function public.list_reminder_candidates(text, date, integer, integer) to authenticated, service_role;

notify pgrst, 'reload schema';
