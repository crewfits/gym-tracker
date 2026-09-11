create or replace function public.create_member_with_enrollment(
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
  p_payment_paise bigint default 0,
  p_payment_method public.payment_method default 'cash',
  p_payment_reference text default null,
  p_paid_on date default current_date
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
  select * into gym_record from public.gyms where owner_id = auth.uid() for update;
  if gym_record.id is null then raise exception 'Gym profile not found'; end if;

  select * into plan_record from public.plans
  where id = p_plan_id and gym_id = gym_record.id and is_active;
  if plan_record.id is null then raise exception 'Active plan not found'; end if;

  if p_expires_on < p_starts_on then raise exception 'Invalid membership dates'; end if;
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

  insert into public.charges(gym_id, membership_id, subtotal_paise, discount_paise, gst_rate_basis_points, tax_paise, total_paise)
  values(gym_record.id, membership_id, p_subtotal_paise, p_discount_paise, p_gst_rate_basis_points, p_tax_paise, p_total_paise)
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
