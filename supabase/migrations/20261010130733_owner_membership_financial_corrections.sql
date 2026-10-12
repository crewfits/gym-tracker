create or replace function public.correct_membership_financial_history(
  p_member_id uuid,
  p_membership_id uuid,
  p_plan_id uuid,
  p_starts_on date,
  p_expires_on date,
  p_subtotal_paise bigint,
  p_discount_paise bigint,
  p_gst_rate_basis_points integer,
  p_tax_paise bigint,
  p_total_paise bigint,
  p_reason text
) returns jsonb
language plpgsql
set search_path to 'public'
as $$
declare
  g_id uuid;
  selected_plan public.plans;
  selected_membership public.memberships;
  selected_charge public.charges;
  paid bigint;
  balance bigint;
  excess bigint;
  reversal_amount bigint;
  reversed_total bigint := 0;
  payment_row record;
  already_reversed bigint;
begin
  g_id := public.current_gym_id();
  if g_id is null or auth.uid() is null then
    raise exception 'Active gym profile not found';
  end if;

  if public.current_gym_role() is distinct from 'owner'::public.gym_role then
    raise exception 'Only the gym owner can correct saved membership history';
  end if;

  if p_expires_on < p_starts_on then
    raise exception 'Membership end date cannot be before the start date';
  end if;

  if p_subtotal_paise < 0
    or p_discount_paise < 0
    or p_discount_paise > p_subtotal_paise
    or p_gst_rate_basis_points not between 0 and 10000
    or p_tax_paise < 0
    or p_total_paise != p_subtotal_paise - p_discount_paise + p_tax_paise
    or p_tax_paise != round(((p_subtotal_paise - p_discount_paise) * p_gst_rate_basis_points)::numeric / 10000)
  then
    raise exception 'Invalid corrected charge';
  end if;

  if length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Correction reason is required';
  end if;

  select * into selected_plan
  from public.plans
  where id = p_plan_id and gym_id = g_id;
  if selected_plan.id is null then
    raise exception 'Selected plan was not found for this gym';
  end if;

  select * into selected_membership
  from public.memberships
  where id = p_membership_id
    and member_id = p_member_id
    and gym_id = g_id
    and reverted_at is null
  for update;
  if selected_membership.id is null then
    raise exception 'Membership record not found';
  end if;

  select * into selected_charge
  from public.charges
  where membership_id = selected_membership.id and gym_id = g_id
  for update;
  if selected_charge.id is null then
    raise exception 'Membership charge not found';
  end if;

  select coalesce(sum(case when p.voided_at is not null then 0 else p.amount_paise - coalesce(r.reversed_paise, 0) end), 0)
  into paid
  from public.payments p
  left join (
    select payment_id, sum(amount_paise) reversed_paise
    from public.payment_reversals
    group by payment_id
  ) r on r.payment_id = p.id
  where p.charge_id = selected_charge.id;

  update public.memberships
  set plan_id = selected_plan.id,
      plan_name = selected_plan.name,
      duration_value = selected_plan.duration_value,
      duration_unit = selected_plan.duration_unit,
      starts_on = p_starts_on,
      expires_on = p_expires_on,
      date_overridden = p_expires_on <> case
        when selected_plan.duration_unit = 'months'::public.duration_unit then (p_starts_on + (selected_plan.duration_value || ' months')::interval - interval '1 day')::date
        else p_starts_on + selected_plan.duration_value - 1
      end
  where id = selected_membership.id;

  update public.charges
  set subtotal_paise = p_subtotal_paise,
      discount_paise = p_discount_paise,
      gst_rate_basis_points = p_gst_rate_basis_points,
      tax_paise = p_tax_paise,
      total_paise = p_total_paise
  where id = selected_charge.id;

  excess := greatest(0, paid - p_total_paise);
  if excess > 0 then
    for payment_row in
      select p.id, p.amount_paise, p.voided_at, p.created_at
      from public.payments p
      where p.charge_id = selected_charge.id and p.gym_id = g_id
      order by p.created_at desc
      for update
    loop
      exit when excess <= 0;
      if payment_row.voided_at is not null then
        continue;
      end if;
      select coalesce(sum(amount_paise), 0)::bigint
      into already_reversed
      from public.payment_reversals
      where payment_id = payment_row.id;
      reversal_amount := least(excess, payment_row.amount_paise - already_reversed);
      if reversal_amount <= 0 then
        continue;
      end if;
      insert into public.payment_reversals(gym_id, payment_id, amount_paise, reason)
      values(g_id, payment_row.id, reversal_amount, trim(p_reason));
      if already_reversed + reversal_amount = payment_row.amount_paise then
        update public.payments
        set voided_at = now(), void_reason = trim(p_reason)
        where id = payment_row.id;
      end if;
      excess := excess - reversal_amount;
      reversed_total := reversed_total + reversal_amount;
    end loop;
  end if;

  balance := greatest(0, p_total_paise - (paid - reversed_total));

  return jsonb_build_object(
    'membership_id', selected_membership.id,
    'charge_id', selected_charge.id,
    'previous_total_paise', selected_charge.total_paise,
    'corrected_total_paise', p_total_paise,
    'reversed_paise', reversed_total,
    'balance_paise', balance
  );
end;
$$;

revoke execute on function public.correct_membership_financial_history(uuid, uuid, uuid, date, date, bigint, bigint, integer, bigint, bigint, text) from public, anon;
grant execute on function public.correct_membership_financial_history(uuid, uuid, uuid, date, date, bigint, bigint, integer, bigint, bigint, text) to authenticated, service_role;
