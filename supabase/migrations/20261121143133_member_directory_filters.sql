-- Composable member search. Existing list_members remains for older clients.
-- Security invoker preserves table/view RLS; no caller-provided tenant identifier.
create function public.search_members(
  p_query text default null, p_field text default 'all', p_records text default 'current',
  p_membership text[] default '{}', p_payment text default null, p_attendance text default null,
  p_qr text[] default '{}', p_plans text[] default '{}', p_no_membership boolean default false,
  p_expiry text default null, p_from date default null, p_to date default null,
  p_today date default current_date, p_page integer default 1, p_page_size integer default 50,
  p_sort text default 'created_at', p_order text default 'desc'
) returns jsonb
language plpgsql stable security invoker set search_path = public
as $$
begin
  if p_field is null or p_field not in ('all', 'name', 'phone', 'member_code', 'old_member_id')
    or p_records is null or p_records not in ('current', 'archived', 'all')
    or p_membership is null or not p_membership <@ array['active','expiring','expired','upcoming','not_enrolled']::text[]
    or array_position(p_membership, null) is not null
    or (p_payment is not null and p_payment not in ('due','clear'))
    or (p_attendance is not null and p_attendance not in ('this_week','no_this_week','last_week'))
    or p_qr is null or not p_qr <@ array['not_generated','not_shared','shared','disabled']::text[]
    or array_position(p_qr, null) is not null
    or p_plans is null or array_position(p_plans, null) is not null or cardinality(p_plans) > 100
    or p_no_membership is null
    or (p_expiry is not null and p_expiry not in ('today','next7','next30','custom'))
    or (p_expiry = 'custom' and (p_from is null or p_to is null or p_from > p_to))
    or p_today is null
    or p_sort is null or p_sort not in ('created_at','member_code','old_member_id','name','expires_on','balance','status')
    or p_order is null or p_order not in ('asc','desc')
  then raise exception 'Invalid member search criteria' using errcode = '22023'; end if;
  return (
  with context as (
    select id, timezone, date_trunc('week', p_today::timestamp)::date as week_start,
      lower(trim(coalesce(p_query, ''))) as query,
      regexp_replace(coalesce(p_query, ''), '[^0-9]', '', 'g') as phone_query
    from public.gyms where id = public.current_gym_id()
  ), candidates as (
    select
      m.id, m.member_code, m.old_member_id, m.name, m.phone, m.email, m.profile_photo_path,
      m.is_archived, m.created_at,
      coalesce(future_access.id, current_access.id, expired_access.id) as membership_id,
      coalesce(future_access.plan_name, current_access.plan_name, expired_access.plan_name) as plan_name,
      coalesce(future_access.starts_on, current_access.starts_on, expired_access.starts_on) as starts_on,
      coalesce(future_access.expires_on, current_access.expires_on, expired_access.expires_on) as expires_on,
      case
        when current_access.id is not null then
          case when future_access.id is not null then 'active'
               when current_access.expires_on <= p_today + 7 then 'expiring'
               else 'active' end
        when future_access.id is not null then 'upcoming'
        when expired_access.id is not null then 'expired'
        else 'not_enrolled'
      end as membership_status,
      coalesce(member_balance.balance_paise, 0)::bigint as balance_paise,
      qr.version as qr_version, coalesce(qr.enabled, false) as qr_enabled,
      qr.shared_at as qr_shared_at
    from public.members m
    cross join context g
    left join lateral (
      select ms.id, ms.plan_name, ms.starts_on, ms.expires_on
      from public.memberships ms
      where ms.member_id = m.id and ms.gym_id = m.gym_id and ms.reverted_at is null
        and ms.starts_on <= p_today and ms.expires_on >= p_today
      order by ms.expires_on desc, ms.created_at desc, ms.id desc limit 1
    ) current_access on true
    left join lateral (
      select ms.id, ms.plan_name, ms.starts_on, ms.expires_on
      from public.memberships ms
      where ms.member_id = m.id and ms.gym_id = m.gym_id and ms.reverted_at is null and ms.starts_on > p_today
      order by ms.starts_on asc, ms.created_at asc, ms.id asc limit 1
    ) future_access on true
    left join lateral (
      select ms.id, ms.plan_name, ms.starts_on, ms.expires_on
      from public.memberships ms
      where ms.member_id = m.id and ms.gym_id = m.gym_id and ms.reverted_at is null and ms.expires_on < p_today
      order by ms.expires_on desc, ms.created_at desc, ms.id desc limit 1
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
        g.query = ''
        or (p_field in ('all','name') and strpos(lower(m.name), g.query) > 0)
        or (p_field in ('all','member_code') and strpos(lower(m.member_code), g.query) > 0)
        or (p_field in ('all','old_member_id') and strpos(lower(coalesce(m.old_member_id, '')), g.query) > 0)
        or (p_field in ('all','phone') and g.phone_query <> '' and g.query ~ '^[+0-9(). -]+$' and strpos(regexp_replace(m.phone, '[^0-9]', '', 'g'), g.phone_query) > 0)
      )
  ), filtered as (
    select c.* from candidates c cross join context g
    where (p_records = 'all' or c.is_archived = (p_records = 'archived'))
      and (cardinality(p_membership) = 0 or c.membership_status = any(p_membership))
      and (p_payment is null or (p_payment = 'due' and c.balance_paise > 0) or (p_payment = 'clear' and c.balance_paise <= 0))
      and (cardinality(p_qr) = 0 or
        (case when c.qr_version is null then 'not_generated' when not c.qr_enabled then 'disabled'
              when c.qr_shared_at is null then 'not_shared' else 'shared' end) = any(p_qr))
      and ((cardinality(p_plans) = 0 and not p_no_membership) or c.plan_name = any(p_plans) or (p_no_membership and c.membership_id is null))
      and (p_expiry is null or
        c.expires_on between (case when p_expiry = 'custom' then p_from else p_today end)
          and (case p_expiry when 'custom' then p_to when 'next7' then p_today + 7 when 'next30' then p_today + 30 else p_today end))
      and (p_attendance is null or
        exists (
          select 1 from public.attendance_events ae
          where ae.gym_id = g.id and ae.member_id = c.id and ae.direction = 'entry' and ae.voided_at is null
            and ae.occurred_at >= ((case when p_attendance = 'last_week' then g.week_start - 7 else g.week_start end)::timestamp at time zone g.timezone)
            and ae.occurred_at < ((case when p_attendance = 'last_week' then g.week_start else p_today + 1 end)::timestamp at time zone g.timezone)
        ) = (p_attendance <> 'no_this_week'))
  ), paged as (
    select f.* from filtered f
  order by
    case when p_sort = 'member_code' and lower(p_order) = 'asc' then f.member_code end asc,
    case when p_sort = 'member_code' and lower(p_order) = 'desc' then f.member_code end desc,
    case when p_sort = 'old_member_id' and lower(p_order) = 'asc' then lower(f.old_member_id) end asc nulls last,
    case when p_sort = 'old_member_id' and lower(p_order) = 'desc' then lower(f.old_member_id) end desc nulls last,
    case when p_sort = 'name' and lower(p_order) = 'asc' then lower(f.name) end asc,
    case when p_sort = 'name' and lower(p_order) = 'desc' then lower(f.name) end desc,
    case when p_sort = 'expires_on' and lower(p_order) = 'asc' then f.expires_on end asc nulls last,
    case when p_sort = 'expires_on' and lower(p_order) = 'desc' then f.expires_on end desc nulls last,
    case when p_sort = 'balance' and lower(p_order) = 'asc' then f.balance_paise end asc,
    case when p_sort = 'balance' and lower(p_order) = 'desc' then f.balance_paise end desc,
    case when p_sort = 'status' and lower(p_order) = 'asc' then (case when f.is_archived then 'archived' else f.membership_status end) end asc,
    case when p_sort = 'status' and lower(p_order) = 'desc' then (case when f.is_archived then 'archived' else f.membership_status end) end desc,
    case when coalesce(p_sort, 'created_at') not in ('member_code', 'old_member_id', 'name', 'expires_on', 'balance', 'status') and lower(coalesce(p_order, 'desc')) = 'asc' then f.created_at end asc,
    case when coalesce(p_sort, 'created_at') not in ('member_code', 'old_member_id', 'name', 'expires_on', 'balance', 'status') and lower(coalesce(p_order, 'desc')) <> 'asc' then f.created_at end desc,
    f.created_at desc, f.id
  offset (greatest(coalesce(p_page, 1), 1) - 1) * least(greatest(coalesce(p_page_size, 50), 1), 100)
  limit least(greatest(coalesce(p_page_size, 50), 1), 100)
  )
  select jsonb_build_object('rows', coalesce((select jsonb_agg(to_jsonb(paged)) from paged), '[]'::jsonb),
    'total', (select count(*) from filtered))
  );
end
$$;
revoke execute on function public.search_members(text,text,text,text[],text,text,text[],text[],boolean,text,date,date,date,integer,integer,text,text) from public, anon;
grant execute on function public.search_members(text,text,text,text[],text,text,text[],text[],boolean,text,date,date,date,integer,integer,text,text) to authenticated;

-- Include historical/renamed and inactive plan names, without a REST row cap.
create function public.list_member_filter_plans() returns table(plan_name text)
language sql stable security invoker set search_path = public
as $$
  select names.plan_name from (
    select p.name as plan_name from public.plans p where p.gym_id = public.current_gym_id()
    union
    select ms.plan_name from public.memberships ms where ms.gym_id = public.current_gym_id() and ms.reverted_at is null
  ) names order by names.plan_name
$$;
revoke execute on function public.list_member_filter_plans() from public, anon;
grant execute on function public.list_member_filter_plans() to authenticated;

create index if not exists attendance_member_filter_entry_idx
  on public.attendance_events (gym_id, member_id, occurred_at)
  where direction = 'entry' and voided_at is null;
notify pgrst, 'reload schema';
