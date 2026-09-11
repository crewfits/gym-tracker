-- Manual QR share tracking.
--
-- WhatsApp delivery is not available in V1, so this records only that the
-- owner/operator confirmed the current QR was shared manually.

alter table public.member_qr_credentials
  add column if not exists shared_at timestamptz,
  add column if not exists shared_by uuid,
  add column if not exists share_method text;

create or replace function public.issue_member_qr(p_member_id uuid)
returns public.member_qr_credentials
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_gym uuid;
  result public.member_qr_credentials;
begin
  current_gym := public.current_gym_id();
  if current_gym is null then raise exception 'Gym profile not found'; end if;

  if not exists (
    select 1 from public.members
    where id = p_member_id and members.gym_id = current_gym and not is_archived
  ) then
    raise exception 'Active member not found';
  end if;

  insert into public.member_qr_credentials(member_id, gym_id, public_code, version, enabled, changed_by, shared_at, shared_by, share_method)
  values (p_member_id, current_gym, public.new_qr_public_code(), 1, true, auth.uid(), null, null, null)
  on conflict (member_id) do update
    set version = member_qr_credentials.version + 1,
        public_code = public.new_qr_public_code(),
        enabled = true,
        shared_at = null,
        shared_by = null,
        share_method = null,
        rotated_at = now(),
        changed_by = auth.uid(),
        updated_at = now()
  returning * into result;

  return result;
end;
$$;

create or replace function public.disable_member_qr(p_member_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_gym uuid;
begin
  current_gym := public.current_gym_id();
  if current_gym is null then raise exception 'Gym profile not found'; end if;

  update public.member_qr_credentials
  set enabled = false,
      shared_at = null,
      shared_by = null,
      share_method = null,
      changed_by = auth.uid(),
      updated_at = now()
  where member_id = p_member_id
    and gym_id = current_gym;

  if not found then raise exception 'QR credential not found'; end if;
end;
$$;

drop function if exists public.list_members(text, text, date, integer, integer);

create function public.list_members(
  p_query text default null,
  p_status text default null,
  p_today date default current_date,
  p_page integer default 1,
  p_page_size integer default 50
)
returns table (
  id uuid,
  member_code text,
  name text,
  phone text,
  email text,
  profile_photo_path text,
  is_archived boolean,
  created_at timestamptz,
  membership_id uuid,
  plan_name text,
  starts_on date,
  expires_on date,
  membership_status text,
  balance_paise bigint,
  qr_version integer,
  qr_enabled boolean,
  qr_shared_at timestamptz,
  total_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with candidates as (
    select
      m.id,
      m.member_code,
      m.name,
      m.phone,
      m.email,
      m.profile_photo_path,
      m.is_archived,
      m.created_at,
      effective.id as membership_id,
      effective.plan_name,
      effective.starts_on,
      effective.expires_on,
      case
        when effective.id is null then 'not_enrolled'
        when effective.starts_on > p_today then 'upcoming'
        when effective.expires_on < p_today then 'expired'
        when effective.expires_on <= p_today + 7 then 'expiring'
        else 'active'
      end as membership_status,
      coalesce(member_balance.balance_paise, 0)::bigint as balance_paise,
      qr.version as qr_version,
      coalesce(qr.enabled, false) as qr_enabled,
      qr.shared_at as qr_shared_at
    from public.members m
    left join lateral (
      select ms.id, ms.plan_name, ms.starts_on, ms.expires_on
      from public.memberships ms
      where ms.member_id = m.id
        and ms.gym_id = m.gym_id
      order by
        case
          when ms.starts_on <= p_today and ms.expires_on >= p_today then 0
          when ms.starts_on > p_today then 1
          else 2
        end,
        case when ms.starts_on > p_today then ms.starts_on end asc,
        ms.expires_on desc,
        ms.created_at desc
      limit 1
    ) effective on true
    left join lateral (
      select coalesce(sum(cb.balance_paise), 0)::bigint as balance_paise
      from public.memberships ms
      join public.charge_balances cb on cb.membership_id = ms.id
      where ms.member_id = m.id
        and ms.gym_id = m.gym_id
    ) member_balance on true
    left join public.member_qr_credentials qr
      on qr.member_id = m.id and qr.gym_id = m.gym_id
    where m.gym_id = public.current_gym_id()
      and (
        nullif(trim(coalesce(p_query, '')), '') is null
        or m.name ilike '%' || trim(p_query) || '%'
        or m.phone ilike '%' || trim(p_query) || '%'
        or m.member_code ilike '%' || trim(p_query) || '%'
      )
  ),
  filtered as (
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
    filtered.id,
    filtered.member_code,
    filtered.name,
    filtered.phone,
    filtered.email,
    filtered.profile_photo_path,
    filtered.is_archived,
    filtered.created_at,
    filtered.membership_id,
    filtered.plan_name,
    filtered.starts_on,
    filtered.expires_on,
    filtered.membership_status,
    filtered.balance_paise,
    filtered.qr_version,
    filtered.qr_enabled,
    filtered.qr_shared_at,
    filtered.total_count
  from filtered
  order by filtered.created_at desc, filtered.id
  offset (greatest(coalesce(p_page, 1), 1) - 1) * least(greatest(coalesce(p_page_size, 50), 1), 100)
  limit least(greatest(coalesce(p_page_size, 50), 1), 100)
$$;

revoke execute on function public.list_members(text, text, date, integer, integer) from public, anon;
grant execute on function public.list_members(text, text, date, integer, integer) to authenticated, service_role;

notify pgrst, 'reload schema';
