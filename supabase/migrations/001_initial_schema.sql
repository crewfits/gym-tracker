create extension if not exists pgcrypto;

create type public.duration_unit as enum ('days', 'months');
create type public.payment_method as enum ('cash', 'upi', 'card', 'bank_transfer');
create type public.delivery_status as enum ('sent', 'skipped', 'failed');

create table public.gyms (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references auth.users(id) on delete cascade,
  name text not null default 'My Gym',
  phone text, email text, address text, gstin text,
  timezone text not null default 'Asia/Kolkata',
  receipt_prefix text not null default 'RCT',
  next_member_number bigint not null default 1 check (next_member_number > 0),
  next_receipt_number bigint not null default 1 check (next_receipt_number > 0),
  reminder_subject text not null default 'Your gym membership expires soon',
  reminder_body text not null default 'Hi {{name}}, your membership expires on {{expiry_date}}. Please contact us to renew.',
  created_at timestamptz not null default now()
);

create table public.members (
  id uuid primary key default gen_random_uuid(), gym_id uuid not null references public.gyms(id) on delete cascade,
  member_code text not null, name text not null check (length(trim(name)) > 0), phone text not null check (length(trim(phone)) >= 7),
  email text, notes text, is_archived boolean not null default false, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(gym_id, member_code)
);
create index members_search_idx on public.members(gym_id, name, phone);

create table public.plans (
  id uuid primary key default gen_random_uuid(), gym_id uuid not null references public.gyms(id) on delete cascade,
  name text not null, duration_value integer not null check (duration_value > 0), duration_unit public.duration_unit not null,
  default_fee_paise bigint not null check (default_fee_paise >= 0), is_active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(gym_id, name)
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(), gym_id uuid not null references public.gyms(id) on delete cascade,
  member_id uuid not null references public.members(id), plan_id uuid references public.plans(id) on delete set null,
  plan_name text not null, duration_value integer not null check (duration_value > 0), duration_unit public.duration_unit not null,
  starts_on date not null, expires_on date not null, date_overridden boolean not null default false,
  created_at timestamptz not null default now(), check (expires_on >= starts_on)
);
create index memberships_member_idx on public.memberships(member_id, expires_on desc);
create index memberships_expiry_idx on public.memberships(gym_id, expires_on);

create table public.charges (
  id uuid primary key default gen_random_uuid(), gym_id uuid not null references public.gyms(id) on delete cascade,
  membership_id uuid not null unique references public.memberships(id), subtotal_paise bigint not null check (subtotal_paise >= 0),
  discount_paise bigint not null default 0 check (discount_paise >= 0 and discount_paise <= subtotal_paise),
  gst_rate_basis_points integer not null default 0 check (gst_rate_basis_points between 0 and 10000),
  tax_paise bigint not null check (tax_paise >= 0), total_paise bigint not null check (total_paise >= 0), created_at timestamptz not null default now(),
  check (total_paise = subtotal_paise - discount_paise + tax_paise),
  check (tax_paise = round(((subtotal_paise - discount_paise) * gst_rate_basis_points)::numeric / 10000))
);

create table public.payments (
  id uuid primary key default gen_random_uuid(), gym_id uuid not null references public.gyms(id) on delete cascade,
  charge_id uuid not null references public.charges(id), amount_paise bigint not null check (amount_paise > 0), method public.payment_method not null,
  reference text, paid_on date not null default current_date, notes text, receipt_number text not null,
  voided_at timestamptz, void_reason text, created_at timestamptz not null default now(), unique(gym_id, receipt_number),
  check ((voided_at is null and void_reason is null) or (voided_at is not null and length(trim(void_reason)) > 0))
);
create index payments_charge_idx on public.payments(charge_id, created_at);

create table public.reminder_rules (
  id uuid primary key default gen_random_uuid(), gym_id uuid not null references public.gyms(id) on delete cascade,
  days_before integer not null check (days_before between 0 and 365), enabled boolean not null default true, unique(gym_id, days_before)
);
create table public.reminder_deliveries (
  id uuid primary key default gen_random_uuid(), gym_id uuid not null references public.gyms(id) on delete cascade,
  membership_id uuid not null references public.memberships(id), rule_id uuid not null references public.reminder_rules(id),
  scheduled_for date not null, status public.delivery_status not null, provider_id text, error text, created_at timestamptz not null default now(),
  unique(membership_id, rule_id, scheduled_for)
);

create or replace function public.current_gym_id() returns uuid language sql stable security definer set search_path = public as $$
  select id from public.gyms where owner_id = auth.uid() limit 1
$$;

alter table public.gyms enable row level security;
alter table public.members enable row level security;
alter table public.plans enable row level security;
alter table public.memberships enable row level security;
alter table public.charges enable row level security;
alter table public.payments enable row level security;
alter table public.reminder_rules enable row level security;
alter table public.reminder_deliveries enable row level security;

create policy "owner gym" on public.gyms for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "owner members" on public.members for all using (gym_id = public.current_gym_id()) with check (gym_id = public.current_gym_id());
create policy "owner plans" on public.plans for all using (gym_id = public.current_gym_id()) with check (gym_id = public.current_gym_id());
create policy "owner memberships" on public.memberships for all using (gym_id = public.current_gym_id()) with check (gym_id = public.current_gym_id());
create policy "owner charges" on public.charges for all using (gym_id = public.current_gym_id()) with check (gym_id = public.current_gym_id());
create policy "owner payments" on public.payments for all using (gym_id = public.current_gym_id()) with check (gym_id = public.current_gym_id());
create policy "owner reminder rules" on public.reminder_rules for all using (gym_id = public.current_gym_id()) with check (gym_id = public.current_gym_id());
create policy "owner reminder deliveries" on public.reminder_deliveries for all using (gym_id = public.current_gym_id()) with check (gym_id = public.current_gym_id());

create or replace function public.bootstrap_gym(gym_name text default 'My Gym') returns uuid language plpgsql security definer set search_path = public as $$
declare new_id uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  insert into public.gyms(owner_id, name) values(auth.uid(), coalesce(nullif(trim(gym_name), ''), 'My Gym'))
  on conflict(owner_id) do update set name = excluded.name returning id into new_id;
  insert into public.reminder_rules(gym_id, days_before) values(new_id, 7), (new_id, 3), (new_id, 1) on conflict do nothing;
  return new_id;
end $$;

create or replace function public.create_member(p_name text, p_phone text, p_email text default null, p_notes text default null)
returns public.members language plpgsql security invoker set search_path = public as $$
declare g public.gyms; result public.members;
begin
  select * into g from public.gyms where owner_id = auth.uid() for update;
  if g.id is null then raise exception 'Gym profile not found'; end if;
  insert into public.members(gym_id, member_code, name, phone, email, notes)
  values(g.id, 'MEM-' || lpad(g.next_member_number::text, 5, '0'), trim(p_name), trim(p_phone), nullif(trim(p_email), ''), nullif(trim(p_notes), '')) returning * into result;
  update public.gyms set next_member_number = next_member_number + 1 where id = g.id;
  return result;
end $$;

create or replace function public.record_payment(p_charge_id uuid, p_amount_paise bigint, p_method public.payment_method, p_reference text, p_paid_on date, p_notes text)
returns public.payments language plpgsql security invoker set search_path = public as $$
declare g public.gyms; c public.charges; paid bigint; result public.payments;
begin
  select * into g from public.gyms where owner_id = auth.uid() for update;
  select * into c from public.charges where id = p_charge_id and gym_id = g.id for update;
  if c.id is null then raise exception 'Charge not found'; end if;
  select coalesce(sum(amount_paise) filter(where voided_at is null), 0) into paid from public.payments where charge_id = c.id;
  if p_amount_paise <= 0 or paid + p_amount_paise > c.total_paise then raise exception 'Payment exceeds outstanding balance'; end if;
  insert into public.payments(gym_id, charge_id, amount_paise, method, reference, paid_on, notes, receipt_number)
  values(g.id, c.id, p_amount_paise, p_method, nullif(trim(p_reference), ''), p_paid_on, nullif(trim(p_notes), ''), g.receipt_prefix || '-' || lpad(g.next_receipt_number::text, 6, '0')) returning * into result;
  update public.gyms set next_receipt_number = next_receipt_number + 1 where id = g.id;
  return result;
end $$;

create or replace function public.create_membership_charge(
  p_member_id uuid, p_plan_id uuid, p_starts_on date, p_expires_on date, p_date_overridden boolean,
  p_subtotal_paise bigint, p_discount_paise bigint, p_gst_rate_basis_points integer, p_tax_paise bigint, p_total_paise bigint
) returns uuid language plpgsql security invoker set search_path = public as $$
declare g_id uuid; selected_plan public.plans; membership_id uuid;
begin
  g_id := public.current_gym_id();
  select * into selected_plan from public.plans where id = p_plan_id and gym_id = g_id and is_active;
  if selected_plan.id is null then raise exception 'Active plan not found'; end if;
  if not exists(select 1 from public.members where id = p_member_id and gym_id = g_id and not is_archived) then raise exception 'Member not found'; end if;
  if p_expires_on < p_starts_on then raise exception 'Invalid membership dates'; end if;
  if p_subtotal_paise < 0 or p_discount_paise < 0 or p_discount_paise > p_subtotal_paise or p_gst_rate_basis_points not between 0 and 10000 or p_tax_paise < 0 or p_total_paise != p_subtotal_paise - p_discount_paise + p_tax_paise or p_tax_paise != round(((p_subtotal_paise - p_discount_paise) * p_gst_rate_basis_points)::numeric / 10000) then raise exception 'Invalid charge'; end if;
  insert into public.memberships(gym_id, member_id, plan_id, plan_name, duration_value, duration_unit, starts_on, expires_on, date_overridden)
  values(g_id, p_member_id, selected_plan.id, selected_plan.name, selected_plan.duration_value, selected_plan.duration_unit, p_starts_on, p_expires_on, p_date_overridden)
  returning id into membership_id;
  insert into public.charges(gym_id, membership_id, subtotal_paise, discount_paise, gst_rate_basis_points, tax_paise, total_paise)
  values(g_id, membership_id, p_subtotal_paise, p_discount_paise, p_gst_rate_basis_points, p_tax_paise, p_total_paise);
  return membership_id;
end $$;

create or replace view public.charge_balances with (security_invoker = true) as
select c.*, coalesce(sum(p.amount_paise) filter(where p.voided_at is null), 0)::bigint as paid_paise,
       (c.total_paise - coalesce(sum(p.amount_paise) filter(where p.voided_at is null), 0))::bigint as balance_paise
from public.charges c left join public.payments p on p.charge_id = c.id group by c.id;
