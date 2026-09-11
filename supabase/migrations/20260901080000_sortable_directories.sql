-- Allowlisted server-side sorting for paginated operational directories.
-- Sorting happens before OFFSET/LIMIT so every page belongs to one stable order.

drop function if exists public.list_members(text, text, date, integer, integer);

create function public.list_members(
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
      where ms.member_id = m.id and ms.gym_id = m.gym_id
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
      where ms.member_id = m.id and ms.gym_id = m.gym_id
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

revoke execute on function public.list_members(text, text, date, integer, integer, text, text) from public, anon;
grant execute on function public.list_members(text, text, date, integer, integer, text, text) to authenticated, service_role;

drop function if exists public.list_attendance_events(text, public.attendance_direction, text, date, date, date, integer, integer);

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
  qr_version integer, occurred_at timestamptz, business_date date, total_count bigint
)
language sql stable security invoker set search_path = public
as $$
  with ranked as (
    select
      ae.id, ae.member_id, m.member_code, m.name as member_name,
      ae.membership_id, ms.plan_name, ae.direction, ae.qr_version, ae.occurred_at,
      (ae.occurred_at at time zone g.timezone)::date as business_date,
      row_number() over (
        partition by ae.member_id, (ae.occurred_at at time zone g.timezone)::date
        order by ae.occurred_at desc, ae.id desc
      ) as day_rank
    from public.attendance_events ae
    join public.gyms g on g.id = ae.gym_id
    join public.members m on m.id = ae.member_id and m.gym_id = ae.gym_id
    left join public.memberships ms on ms.id = ae.membership_id and ms.gym_id = ae.gym_id
    where ae.gym_id = public.current_gym_id()
      and (
        nullif(trim(coalesce(p_query, '')), '') is null
        or m.name ilike '%' || trim(p_query) || '%'
        or m.member_code ilike '%' || trim(p_query) || '%'
        or m.phone ilike '%' || trim(p_query) || '%'
      )
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
    filtered.qr_version, filtered.occurred_at, filtered.business_date, filtered.total_count
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

revoke execute on function public.list_attendance_events(text, public.attendance_direction, text, date, date, date, integer, integer, text, text) from public, anon;
grant execute on function public.list_attendance_events(text, public.attendance_direction, text, date, date, date, integer, integer, text, text) to authenticated, service_role;

drop function if exists public.list_transactions(text, public.payment_method, text, date, date, integer, integer);

create function public.list_transactions(
  p_query text default null,
  p_method public.payment_method default null,
  p_status text default null,
  p_from date default null,
  p_to date default null,
  p_page integer default 1,
  p_page_size integer default 50,
  p_sort text default 'paid_on',
  p_order text default 'desc'
)
returns table (
  id uuid, receipt_number text, paid_on date, method public.payment_method,
  reference text, amount_paise bigint, reversed_paise bigint, net_paise bigint,
  voided_at timestamptz, void_reason text, member_id uuid, member_code text,
  member_name text, plan_name text, total_count bigint, view_collected_paise bigint,
  view_reversed_paise bigint, view_completed_count bigint
)
language sql stable security invoker set search_path = public
as $$
  with candidates as (
    select
      p.id, p.receipt_number, p.paid_on, p.method, p.reference, p.amount_paise,
      coalesce(sum(pr.amount_paise), 0)::bigint as reversed_paise,
      case when p.voided_at is not null then 0 else p.amount_paise - coalesce(sum(pr.amount_paise), 0) end::bigint as net_paise,
      p.voided_at, p.void_reason, m.id as member_id, m.member_code,
      m.name as member_name, ms.plan_name, p.created_at
    from public.payments p
    join public.charges c on c.id = p.charge_id and c.gym_id = p.gym_id
    join public.memberships ms on ms.id = c.membership_id and ms.gym_id = p.gym_id
    join public.members m on m.id = ms.member_id and m.gym_id = p.gym_id
    left join public.payment_reversals pr on pr.payment_id = p.id and pr.gym_id = p.gym_id
    where p.gym_id = public.current_gym_id()
      and (p_method is null or p.method = p_method)
      and (p_from is null or p.paid_on >= p_from)
      and (p_to is null or p.paid_on <= p_to)
      and (
        nullif(trim(coalesce(p_query, '')), '') is null
        or m.name ilike '%' || trim(p_query) || '%'
        or m.member_code ilike '%' || trim(p_query) || '%'
        or p.receipt_number ilike '%' || trim(p_query) || '%'
        or p.reference ilike '%' || trim(p_query) || '%'
      )
    group by p.id, m.id, ms.id
  ), filtered as (
    select
      candidates.*, count(*) over() as total_count,
      coalesce(sum(net_paise) over(), 0)::bigint as view_collected_paise,
      coalesce(sum(reversed_paise) over(), 0)::bigint as view_reversed_paise,
      count(*) filter (where net_paise > 0) over() as view_completed_count
    from candidates
    where nullif(trim(coalesce(p_status, '')), '') is null
      or (p_status = 'completed' and voided_at is null)
      or (p_status = 'reversed' and voided_at is not null)
      or (p_status = 'partial_reversal' and voided_at is null and reversed_paise > 0)
  )
  select
    filtered.id, filtered.receipt_number, filtered.paid_on, filtered.method,
    filtered.reference, filtered.amount_paise, filtered.reversed_paise, filtered.net_paise,
    filtered.voided_at, filtered.void_reason, filtered.member_id, filtered.member_code,
    filtered.member_name, filtered.plan_name, filtered.total_count,
    filtered.view_collected_paise, filtered.view_reversed_paise, filtered.view_completed_count
  from filtered
  order by
    case when p_sort = 'member_name' and lower(p_order) = 'asc' then lower(filtered.member_name) end asc,
    case when p_sort = 'member_name' and lower(p_order) = 'desc' then lower(filtered.member_name) end desc,
    case when p_sort = 'amount' and lower(p_order) = 'asc' then filtered.net_paise end asc,
    case when p_sort = 'amount' and lower(p_order) = 'desc' then filtered.net_paise end desc,
    case when coalesce(p_sort, 'paid_on') not in ('member_name', 'amount') and lower(coalesce(p_order, 'desc')) = 'asc' then filtered.paid_on end asc,
    case when coalesce(p_sort, 'paid_on') not in ('member_name', 'amount') and lower(coalesce(p_order, 'desc')) <> 'asc' then filtered.paid_on end desc,
    filtered.created_at desc, filtered.id desc
  offset (greatest(coalesce(p_page, 1), 1) - 1) * least(greatest(coalesce(p_page_size, 50), 1), 100)
  limit least(greatest(coalesce(p_page_size, 50), 1), 100)
$$;

revoke execute on function public.list_transactions(text, public.payment_method, text, date, date, integer, integer, text, text) from public, anon;
grant execute on function public.list_transactions(text, public.payment_method, text, date, date, integer, integer, text, text) to authenticated, service_role;

drop function if exists public.list_reminder_candidates(text, date, integer, integer);

create function public.list_reminder_candidates(
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
    join public.memberships ms on ms.id = cb.membership_id and ms.gym_id = cb.gym_id
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
      and not m.is_archived
      and ms.starts_on <= p_today
      and ms.expires_on between p_today and p_today + 7
      and not exists (
        select 1 from public.memberships future
        where future.member_id = ms.member_id and future.gym_id = ms.gym_id and future.starts_on > p_today
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

revoke execute on function public.list_reminder_candidates(text, date, integer, integer, text, text) from public, anon;
grant execute on function public.list_reminder_candidates(text, date, integer, integer, text, text) to authenticated, service_role;

notify pgrst, 'reload schema';
