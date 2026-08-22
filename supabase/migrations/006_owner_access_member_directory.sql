-- V1 owner provisioning and scalable member-directory foundation.

alter table public.gyms
  add column if not exists is_active boolean not null default true;

create or replace function public.current_gym_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id
  from public.gyms
  where owner_id = auth.uid()
    and is_active
  limit 1
$$;

drop policy if exists "owner gym" on public.gyms;
drop policy if exists "owner gym read" on public.gyms;
drop policy if exists "active owner gym update" on public.gyms;

create policy "owner gym read" on public.gyms
  for select
  using (owner_id = auth.uid());

create policy "active owner gym update" on public.gyms
  for update
  using (owner_id = auth.uid() and is_active)
  with check (owner_id = auth.uid() and is_active);

-- Gym records are provisioned with the service role. Interactive users must
-- never be able to create or rename a gym by calling the legacy bootstrap RPC.
revoke execute on function public.bootstrap_gym(text) from public, anon, authenticated;

create or replace function public.list_members(
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
      coalesce(qr.enabled, false) as qr_enabled
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
    filtered.total_count
  from filtered
  order by filtered.created_at desc, filtered.id
  offset (greatest(coalesce(p_page, 1), 1) - 1) * least(greatest(coalesce(p_page_size, 50), 1), 100)
  limit least(greatest(coalesce(p_page_size, 50), 1), 100)
$$;

revoke execute on function public.list_members(text, text, date, integer, integer) from public, anon;
grant execute on function public.list_members(text, text, date, integer, integer) to authenticated, service_role;

notify pgrst, 'reload schema';
