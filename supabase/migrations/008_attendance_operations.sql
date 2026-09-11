-- Searchable, gym-timezone-aware attendance operations for V1.

create or replace function public.list_attendance_events(
  p_query text default null,
  p_direction public.attendance_direction default null,
  p_view text default 'today',
  p_from date default null,
  p_to date default null,
  p_today date default current_date,
  p_page integer default 1,
  p_page_size integer default 50
)
returns table (
  id uuid,
  member_id uuid,
  member_code text,
  member_name text,
  membership_id uuid,
  plan_name text,
  direction public.attendance_direction,
  qr_version integer,
  occurred_at timestamptz,
  business_date date,
  total_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with ranked as (
    select
      ae.id,
      ae.member_id,
      m.member_code,
      m.name as member_name,
      ae.membership_id,
      ms.plan_name,
      ae.direction,
      ae.qr_version,
      ae.occurred_at,
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
  ),
  filtered as (
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
    filtered.id,
    filtered.member_id,
    filtered.member_code,
    filtered.member_name,
    filtered.membership_id,
    filtered.plan_name,
    filtered.direction,
    filtered.qr_version,
    filtered.occurred_at,
    filtered.business_date,
    filtered.total_count
  from filtered
  order by filtered.occurred_at desc, filtered.id desc
  offset (greatest(coalesce(p_page, 1), 1) - 1) * least(greatest(coalesce(p_page_size, 50), 1), 100)
  limit least(greatest(coalesce(p_page_size, 50), 1), 100)
$$;

revoke execute on function public.list_attendance_events(text, public.attendance_direction, text, date, date, date, integer, integer) from public, anon;
grant execute on function public.list_attendance_events(text, public.attendance_direction, text, date, date, date, integer, integer) to authenticated, service_role;

notify pgrst, 'reload schema';
