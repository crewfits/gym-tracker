create table if not exists public.payment_reversals (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id) on delete cascade,
  payment_id uuid not null references public.payments(id),
  amount_paise bigint not null check (amount_paise > 0),
  reason text not null check (length(trim(reason)) > 0),
  created_at timestamptz not null default now()
);

create index if not exists payment_reversals_payment_idx on public.payment_reversals(payment_id, created_at);
alter table public.payment_reversals enable row level security;
create policy "owner payment reversals" on public.payment_reversals for all
  using (gym_id = public.current_gym_id()) with check (gym_id = public.current_gym_id());

create or replace function public.reverse_payment(p_payment_id uuid, p_amount_paise bigint, p_reason text)
returns public.payment_reversals language plpgsql security invoker set search_path = public as $$
declare g_id uuid; selected_payment public.payments; already_reversed bigint; result public.payment_reversals;
begin
  g_id := public.current_gym_id();
  select * into selected_payment from public.payments where id = p_payment_id and gym_id = g_id for update;
  if selected_payment.id is null then raise exception 'Payment not found'; end if;
  select coalesce(sum(amount_paise), 0) into already_reversed from public.payment_reversals where payment_id = selected_payment.id;
  if p_amount_paise <= 0 or p_amount_paise > selected_payment.amount_paise - already_reversed then raise exception 'Reversal exceeds the remaining payment amount'; end if;
  insert into public.payment_reversals(gym_id, payment_id, amount_paise, reason)
  values(g_id, selected_payment.id, p_amount_paise, trim(p_reason)) returning * into result;
  if already_reversed + p_amount_paise = selected_payment.amount_paise then
    update public.payments set voided_at = now(), void_reason = trim(p_reason) where id = selected_payment.id;
  end if;
  return result;
end $$;

create or replace function public.record_payment(p_charge_id uuid, p_amount_paise bigint, p_method public.payment_method, p_reference text, p_paid_on date, p_notes text)
returns public.payments language plpgsql security invoker set search_path = public as $$
declare g public.gyms; c public.charges; paid bigint; result public.payments;
begin
  select * into g from public.gyms where owner_id = auth.uid() for update;
  select * into c from public.charges where id = p_charge_id and gym_id = g.id for update;
  if c.id is null then raise exception 'Charge not found'; end if;
  select coalesce(sum(case when p.voided_at is not null then 0 else p.amount_paise - coalesce(r.reversed_paise, 0) end), 0)
  into paid from public.payments p left join (select payment_id, sum(amount_paise) reversed_paise from public.payment_reversals group by payment_id) r on r.payment_id = p.id
  where p.charge_id = c.id;
  if p_amount_paise <= 0 or paid + p_amount_paise > c.total_paise then raise exception 'Payment exceeds outstanding balance'; end if;
  insert into public.payments(gym_id, charge_id, amount_paise, method, reference, paid_on, notes, receipt_number)
  values(g.id, c.id, p_amount_paise, p_method, nullif(trim(p_reference), ''), p_paid_on, nullif(trim(p_notes), ''), g.receipt_prefix || '-' || lpad(g.next_receipt_number::text, 6, '0')) returning * into result;
  update public.gyms set next_receipt_number = next_receipt_number + 1 where id = g.id;
  return result;
end $$;

create or replace view public.charge_balances with (security_invoker = true) as
select c.*,
  coalesce(sum(case when p.voided_at is not null then 0 else p.amount_paise - coalesce(r.reversed_paise, 0) end), 0)::bigint as paid_paise,
  (c.total_paise - coalesce(sum(case when p.voided_at is not null then 0 else p.amount_paise - coalesce(r.reversed_paise, 0) end), 0))::bigint as balance_paise
from public.charges c
left join public.payments p on p.charge_id = c.id
left join (select payment_id, sum(amount_paise) reversed_paise from public.payment_reversals group by payment_id) r on r.payment_id = p.id
group by c.id;
