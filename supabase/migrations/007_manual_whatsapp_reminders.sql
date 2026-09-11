-- V1 payment due dates and owner-initiated WhatsApp reminder history.

alter table public.charges add column if not exists due_on date;
update public.charges c
set due_on = ms.starts_on
from public.memberships ms
where ms.id = c.membership_id and c.due_on is null;
alter table public.charges alter column due_on set not null;
create index if not exists charges_due_idx on public.charges(gym_id, due_on);

alter table public.gyms
  add column if not exists payment_reminder_template text not null default 'Hi {{name}}, a payment of {{balance}} for your {{plan_name}} membership was due on {{due_date}}. Please complete the payment. — {{gym_name}}',
  add column if not exists renewal_reminder_template text not null default 'Hi {{name}}, your {{plan_name}} membership expires on {{expiry_date}}. Please contact us to renew. — {{gym_name}}';

create table if not exists public.manual_reminder_events (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  membership_id uuid references public.memberships(id) on delete set null,
  charge_id uuid references public.charges(id) on delete set null,
  kind text not null check (kind in ('payment', 'renewal')),
  status text not null check (status in ('prepared', 'opened')),
  channel text not null default 'whatsapp' check (channel = 'whatsapp'),
  phone_snapshot text not null,
  message_snapshot text not null,
  prepared_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists manual_reminder_events_gym_time_idx
  on public.manual_reminder_events(gym_id, created_at desc);
create index if not exists manual_reminder_events_member_time_idx
  on public.manual_reminder_events(member_id, created_at desc);

alter table public.manual_reminder_events enable row level security;
drop policy if exists "owner manual reminder read" on public.manual_reminder_events;
drop policy if exists "owner manual reminder insert" on public.manual_reminder_events;
create policy "owner manual reminder read" on public.manual_reminder_events
  for select using (gym_id = public.current_gym_id());
create policy "owner manual reminder insert" on public.manual_reminder_events
  for insert with check (gym_id = public.current_gym_id() and prepared_by = auth.uid());

create or replace view public.charge_balances with (security_invoker = true) as
select
  c.id,
  c.gym_id,
  c.membership_id,
  c.subtotal_paise,
  c.discount_paise,
  c.gst_rate_basis_points,
  c.tax_paise,
  c.total_paise,
  c.created_at,
  coalesce(sum(case when p.voided_at is not null then 0 else p.amount_paise - coalesce(r.reversed_paise, 0) end), 0)::bigint as paid_paise,
  (c.total_paise - coalesce(sum(case when p.voided_at is not null then 0 else p.amount_paise - coalesce(r.reversed_paise, 0) end), 0))::bigint as balance_paise,
  c.due_on
from public.charges c
left join public.payments p on p.charge_id = c.id
left join (select payment_id, sum(amount_paise) reversed_paise from public.payment_reversals group by payment_id) r on r.payment_id = p.id
group by c.id;

drop function if exists public.create_member_with_enrollment(text, text, text, text, uuid, date, date, boolean, bigint, bigint, integer, bigint, bigint, bigint, public.payment_method, text, date);
create function public.create_member_with_enrollment(
  p_name text,
  p_phone text,
  p_email text,
  p_notes text,
  p_plan_id uuid,
  p_starts_on date,
  p_expires_on date,
  p_date_overridden boolean,
  p_subtotal_paise bigint,
  p_discount_paise bigint,
  p_gst_rate_basis_points integer,
  p_tax_paise bigint,
  p_total_paise bigint,
  p_due_on date,
  p_payment_paise bigint,
  p_payment_method public.payment_method,
  p_payment_reference text,
  p_paid_on date
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  gym_record public.gyms;
  plan_record public.plans;
  member_record public.members;
  membership_id uuid;
  charge_id uuid;
  payment_id uuid;
begin
  select * into gym_record from public.gyms where owner_id = auth.uid() and is_active for update;
  if gym_record.id is null then raise exception 'Active gym profile not found'; end if;

  select * into plan_record from public.plans
  where id = p_plan_id and gym_id = gym_record.id and is_active;
  if plan_record.id is null then raise exception 'Active plan not found'; end if;

  if p_expires_on < p_starts_on then raise exception 'Invalid membership dates'; end if;
  if p_due_on is null then raise exception 'Payment due date is required'; end if;
  if p_subtotal_paise < 0 or p_discount_paise < 0 or p_discount_paise > p_subtotal_paise
    or p_gst_rate_basis_points not between 0 and 10000
    or p_tax_paise != round(((p_subtotal_paise - p_discount_paise) * p_gst_rate_basis_points)::numeric / 10000)
    or p_total_paise != p_subtotal_paise - p_discount_paise + p_tax_paise
    or p_payment_paise < 0 or p_payment_paise > p_total_paise
  then raise exception 'Invalid charge or payment amount'; end if;

  insert into public.members(gym_id, member_code, name, phone, email, notes)
  values(
    gym_record.id,
    'MEM-' || lpad(gym_record.next_member_number::text, 5, '0'),
    trim(p_name), trim(p_phone), nullif(trim(p_email), ''), nullif(trim(p_notes), '')
  ) returning * into member_record;
  update public.gyms set next_member_number = next_member_number + 1 where id = gym_record.id;

  insert into public.memberships(gym_id, member_id, plan_id, plan_name, duration_value, duration_unit, starts_on, expires_on, date_overridden)
  values(gym_record.id, member_record.id, plan_record.id, plan_record.name, plan_record.duration_value, plan_record.duration_unit, p_starts_on, p_expires_on, p_date_overridden)
  returning id into membership_id;

  insert into public.charges(gym_id, membership_id, subtotal_paise, discount_paise, gst_rate_basis_points, tax_paise, total_paise, due_on)
  values(gym_record.id, membership_id, p_subtotal_paise, p_discount_paise, p_gst_rate_basis_points, p_tax_paise, p_total_paise, p_due_on)
  returning id into charge_id;

  if p_payment_paise > 0 then
    insert into public.payments(gym_id, charge_id, amount_paise, method, reference, paid_on, receipt_number)
    values(
      gym_record.id, charge_id, p_payment_paise, p_payment_method,
      nullif(trim(p_payment_reference), ''), p_paid_on,
      gym_record.receipt_prefix || '-' || lpad(gym_record.next_receipt_number::text, 6, '0')
    ) returning id into payment_id;
    update public.gyms set next_receipt_number = next_receipt_number + 1 where id = gym_record.id;
  end if;

  return jsonb_build_object('member_id', member_record.id, 'membership_id', membership_id, 'payment_id', payment_id);
end;
$$;

drop function if exists public.create_membership_charge(uuid, uuid, date, date, boolean, bigint, bigint, integer, bigint, bigint);
create function public.create_membership_charge(
  p_member_id uuid,
  p_plan_id uuid,
  p_starts_on date,
  p_expires_on date,
  p_date_overridden boolean,
  p_subtotal_paise bigint,
  p_discount_paise bigint,
  p_gst_rate_basis_points integer,
  p_tax_paise bigint,
  p_total_paise bigint,
  p_due_on date
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  g_id uuid;
  selected_plan public.plans;
  membership_id uuid;
begin
  g_id := public.current_gym_id();
  select * into selected_plan from public.plans where id = p_plan_id and gym_id = g_id and is_active;
  if selected_plan.id is null then raise exception 'Active plan not found'; end if;
  if not exists(select 1 from public.members where id = p_member_id and gym_id = g_id and not is_archived) then raise exception 'Member not found'; end if;
  if p_expires_on < p_starts_on then raise exception 'Invalid membership dates'; end if;
  if p_due_on is null then raise exception 'Payment due date is required'; end if;
  if p_subtotal_paise < 0 or p_discount_paise < 0 or p_discount_paise > p_subtotal_paise or p_gst_rate_basis_points not between 0 and 10000 or p_tax_paise < 0 or p_total_paise != p_subtotal_paise - p_discount_paise + p_tax_paise or p_tax_paise != round(((p_subtotal_paise - p_discount_paise) * p_gst_rate_basis_points)::numeric / 10000) then raise exception 'Invalid charge'; end if;

  insert into public.memberships(gym_id, member_id, plan_id, plan_name, duration_value, duration_unit, starts_on, expires_on, date_overridden)
  values(g_id, p_member_id, selected_plan.id, selected_plan.name, selected_plan.duration_value, selected_plan.duration_unit, p_starts_on, p_expires_on, p_date_overridden)
  returning id into membership_id;

  insert into public.charges(gym_id, membership_id, subtotal_paise, discount_paise, gst_rate_basis_points, tax_paise, total_paise, due_on)
  values(g_id, membership_id, p_subtotal_paise, p_discount_paise, p_gst_rate_basis_points, p_tax_paise, p_total_paise, p_due_on);
  return membership_id;
end;
$$;

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
      case when cb.due_on < p_today then 'overdue' else 'due_today' end as candidate_kind,
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
      and cb.due_on <= p_today
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

revoke all on table public.manual_reminder_events from anon;
grant select, insert on table public.manual_reminder_events to authenticated;
grant all on table public.manual_reminder_events to service_role;
grant select on table public.charge_balances to authenticated, service_role;

revoke execute on function public.create_member_with_enrollment(text, text, text, text, uuid, date, date, boolean, bigint, bigint, integer, bigint, bigint, date, bigint, public.payment_method, text, date) from public, anon;
grant execute on function public.create_member_with_enrollment(text, text, text, text, uuid, date, date, boolean, bigint, bigint, integer, bigint, bigint, date, bigint, public.payment_method, text, date) to authenticated, service_role;
revoke execute on function public.create_membership_charge(uuid, uuid, date, date, boolean, bigint, bigint, integer, bigint, bigint, date) from public, anon;
grant execute on function public.create_membership_charge(uuid, uuid, date, date, boolean, bigint, bigint, integer, bigint, bigint, date) to authenticated, service_role;
revoke execute on function public.list_reminder_candidates(text, date, integer, integer) from public, anon;
grant execute on function public.list_reminder_candidates(text, date, integer, integer) to authenticated, service_role;

notify pgrst, 'reload schema';
