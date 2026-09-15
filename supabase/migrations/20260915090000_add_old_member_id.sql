-- Preserve a gym's physical-register or previous-system identifier alongside
-- FitKiro's generated member code. It is optional and intentionally not unique.
alter table public.members add column if not exists old_member_id text;
alter table public.members drop constraint if exists members_old_member_id_length;
alter table public.members add constraint members_old_member_id_length
  check (old_member_id is null or length(trim(old_member_id)) between 1 and 100);
create index if not exists members_old_member_id_idx on public.members(gym_id, old_member_id);

-- New-member activation is transactional. Read the validated optional legacy ID
-- from the stored operation payload once the operation result contains its member.
create or replace function public.apply_old_member_id_from_payment_operation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  legacy_id text;
  activated_member_id uuid;
begin
  if new.payload->>'kind' <> 'activate' or coalesce(new.result->>'member_id', '') = '' then
    return new;
  end if;

  legacy_id := nullif(trim(coalesce(new.payload->'details'->>'old_member_id', '')), '');
  activated_member_id := (new.result->>'member_id')::uuid;
  update public.members
    set old_member_id = legacy_id, updated_at = now()
  where id = activated_member_id and gym_id = new.gym_id;
  return new;
end;
$$;

drop trigger if exists payment_operations_apply_old_member_id on public.payment_operations;
create trigger payment_operations_apply_old_member_id
after update of result on public.payment_operations
for each row execute function public.apply_old_member_id_from_payment_operation();

-- The RPC drives the paginated directory, search and CSV export. Recreate it
-- with the extra return column because PostgreSQL does not allow changing a
-- function's table-return shape in place.
drop function if exists public.list_members(text, text, date, integer, integer, text, text);
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
  id uuid, member_code text, old_member_id text, name text, phone text, email text,
  profile_photo_path text, is_archived boolean, created_at timestamptz,
  membership_id uuid, plan_name text, starts_on date, expires_on date,
  membership_status text, balance_paise bigint, qr_version integer,
  qr_enabled boolean, qr_shared_at timestamptz, total_count bigint
)
language sql stable security invoker set search_path = public
as $$
  with candidates as (
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
    left join lateral (
      select ms.id, ms.plan_name, ms.starts_on, ms.expires_on
      from public.memberships ms
      where ms.member_id = m.id and ms.gym_id = m.gym_id and ms.reverted_at is null
        and ms.starts_on <= p_today and ms.expires_on >= p_today
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
        or m.old_member_id ilike '%' || trim(p_query) || '%'
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
    filtered.id, filtered.member_code, filtered.old_member_id, filtered.name, filtered.phone, filtered.email,
    filtered.profile_photo_path, filtered.is_archived, filtered.created_at,
    filtered.membership_id, filtered.plan_name, filtered.starts_on, filtered.expires_on,
    filtered.membership_status, filtered.balance_paise, filtered.qr_version,
    filtered.qr_enabled, filtered.qr_shared_at, filtered.total_count
  from filtered
  order by
    case when p_sort = 'member_code' and lower(p_order) = 'asc' then filtered.member_code end asc,
    case when p_sort = 'member_code' and lower(p_order) = 'desc' then filtered.member_code end desc,
    case when p_sort = 'name' and lower(p_order) = 'asc' then lower(filtered.name) end asc,
    case when p_sort = 'name' and lower(p_order) = 'desc' then lower(filtered.name) end desc,
    case when p_sort = 'expires_on' and lower(p_order) = 'asc' then filtered.expires_on end asc nulls last,
    case when p_sort = 'expires_on' and lower(p_order) = 'desc' then filtered.expires_on end desc nulls last,
    case when p_sort = 'balance' and lower(p_order) = 'asc' then filtered.balance_paise end asc,
    case when p_sort = 'balance' and lower(p_order) = 'desc' then filtered.balance_paise end desc,
    case when p_sort = 'status' and lower(p_order) = 'asc' then (case when filtered.is_archived then 'archived' else filtered.membership_status end) end asc,
    case when p_sort = 'status' and lower(p_order) = 'desc' then (case when filtered.is_archived then 'archived' else filtered.membership_status end) end desc,
    case when coalesce(p_sort, 'created_at') not in ('member_code', 'name', 'expires_on', 'balance', 'status') and lower(coalesce(p_order, 'desc')) = 'asc' then filtered.created_at end asc,
    case when coalesce(p_sort, 'created_at') not in ('member_code', 'name', 'expires_on', 'balance', 'status') and lower(coalesce(p_order, 'desc')) <> 'asc' then filtered.created_at end desc,
    filtered.created_at desc, filtered.id
  offset (greatest(coalesce(p_page, 1), 1) - 1) * least(greatest(coalesce(p_page_size, 50), 1), 100)
  limit least(greatest(coalesce(p_page_size, 50), 1), 100)
$$;

revoke execute on function public.list_members(text, text, date, integer, integer, text, text) from public, anon;
grant execute on function public.list_members(text, text, date, integer, integer, text, text) to authenticated, service_role;

notify pgrst, 'reload schema';
