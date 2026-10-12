create function public.correct_membership_with_final_payment(
  p_request_id uuid,
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
  p_target_paid_paise bigint,
  p_method public.payment_method,
  p_paid_on date,
  p_reference text,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
<<final_correction>>
declare
  g public.gyms;
  selected_charge public.charges;
  prior public.payment_operations;
  current_paid bigint;
  adjustment bigint;
  already_reversed bigint;
  reversal_amount bigint;
  reversed_total bigint := 0;
  payment_row record;
  derived_payments jsonb := '[]'::jsonb;
  result jsonb;
  operation_id uuid;
begin
  select * into g
  from public.gyms
  where id = public.current_gym_id() and is_active
  for update;
  if g.id is null or auth.uid() is null then
    raise exception 'Active gym profile not found';
  end if;
  if public.current_gym_role() is distinct from 'owner'::public.gym_role then
    raise exception 'Only the gym owner can correct saved membership history';
  end if;
  if p_request_id is null then
    raise exception 'Request ID is required';
  end if;
  if p_target_paid_paise < 0 or p_target_paid_paise > p_total_paise then
    raise exception 'Amount paid must be between zero and the corrected plan total'
      using hint = 'amount_paid';
  end if;

  select * into prior
  from public.payment_operations
  where gym_id = g.id and request_id = p_request_id;
  if found then
    if coalesce((prior.payload->>'target_paid_paise')::bigint, -1) <> p_target_paid_paise
      or coalesce(prior.payload->>'membership_id', '') <> p_membership_id::text
      or coalesce((prior.payload->>'total_paise')::bigint, -1) <> p_total_paise
    then
      raise exception 'This correction was already saved with different details. Reload before trying again.';
    end if;
    return prior.result;
  end if;

  select c.* into selected_charge
  from public.charges c
  join public.memberships m on m.id = c.membership_id and m.gym_id = c.gym_id
  where c.gym_id = g.id
    and c.membership_id = p_membership_id
    and m.member_id = p_member_id
    and m.reverted_at is null
  for update of c;
  if selected_charge.id is null then
    raise exception 'Membership charge not found';
  end if;

  perform 1
  from public.payments
  where gym_id = g.id and charge_id = selected_charge.id
  for update;

  select coalesce(sum(case when p.voided_at is not null then 0 else p.amount_paise - coalesce(r.reversed_paise, 0) end), 0)
  into current_paid
  from public.payments p
  left join (
    select payment_id, sum(amount_paise) reversed_paise
    from public.payment_reversals
    group by payment_id
  ) r on r.payment_id = p.id
  where p.gym_id = g.id and p.charge_id = selected_charge.id;

  if p_target_paid_paise < current_paid then
    adjustment := current_paid - p_target_paid_paise;
    for payment_row in
      select p.id, p.amount_paise, p.voided_at, p.created_at
      from public.payments p
      where p.charge_id = selected_charge.id and p.gym_id = g.id
      order by p.created_at desc
      for update
    loop
      exit when adjustment <= 0;
      if payment_row.voided_at is not null then continue; end if;
      select coalesce(sum(amount_paise), 0)::bigint into already_reversed
      from public.payment_reversals where payment_id = payment_row.id;
      reversal_amount := least(adjustment, payment_row.amount_paise - already_reversed);
      if reversal_amount <= 0 then continue; end if;
      insert into public.payment_reversals(gym_id, payment_id, amount_paise, reason)
      values(g.id, payment_row.id, reversal_amount, trim(p_reason));
      if already_reversed + reversal_amount = payment_row.amount_paise then
        update public.payments
        set voided_at = now(), void_reason = trim(p_reason)
        where id = payment_row.id and gym_id = g.id;
      end if;
      adjustment := adjustment - reversal_amount;
      reversed_total := reversed_total + reversal_amount;
    end loop;
    current_paid := p_target_paid_paise;
  end if;

  if p_target_paid_paise > current_paid then
    derived_payments := jsonb_build_array(jsonb_build_object(
      'amount_paise', p_target_paid_paise - current_paid,
      'method', p_method,
      'paid_on', p_paid_on,
      'reference', coalesce(p_reference, '')
    ));
  end if;

  result := public.correct_membership_with_payment(
    p_request_id,
    p_member_id,
    p_membership_id,
    p_plan_id,
    p_starts_on,
    p_expires_on,
    p_subtotal_paise,
    p_discount_paise,
    p_gst_rate_basis_points,
    p_tax_paise,
    p_total_paise,
    p_reason,
    derived_payments
  );

  operation_id := (result->>'operation_id')::uuid;
  result := result || jsonb_build_object(
    'reversed_paise', reversed_total + coalesce((result->>'reversed_paise')::bigint, 0),
    'balance_paise', greatest(0, p_total_paise - p_target_paid_paise),
    'final_paid_paise', p_target_paid_paise
  );
  update public.payment_operations
  set payload = payload || jsonb_build_object('target_paid_paise', p_target_paid_paise),
      result = final_correction.result
  where id = operation_id and gym_id = g.id;
  return result;
end;
$$;

revoke all on function public.correct_membership_with_final_payment(uuid, uuid, uuid, uuid, date, date, bigint, bigint, integer, bigint, bigint, bigint, public.payment_method, date, text, text) from public, anon;
grant execute on function public.correct_membership_with_final_payment(uuid, uuid, uuid, uuid, date, date, bigint, bigint, integer, bigint, bigint, bigint, public.payment_method, date, text, text) to authenticated, service_role;

notify pgrst, 'reload schema';
