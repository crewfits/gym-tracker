-- Staff-aware membership operations must resolve the gym through current_gym_id().
create or replace function public.create_member_with_enrollment(
  p_name text, p_phone text, p_email text, p_notes text, p_plan_id uuid,
  p_starts_on date, p_expires_on date, p_date_overridden boolean,
  p_subtotal_paise bigint, p_discount_paise bigint,
  p_gst_rate_basis_points integer, p_tax_paise bigint, p_total_paise bigint,
  p_due_on date, p_payment_paise bigint,
  p_payment_method public.payment_method, p_payment_reference text, p_paid_on date
) returns jsonb
language plpgsql security invoker set search_path = public
as $$
declare
  gym_record public.gyms; plan_record public.plans; member_record public.members;
  membership_id uuid; charge_id uuid; payment_id uuid;
begin
  select * into gym_record from public.gyms
  where id = public.current_gym_id() and is_active for update;
  if gym_record.id is null or auth.uid() is null then raise exception 'Active gym profile not found'; end if;
  select * into plan_record from public.plans where id = p_plan_id and gym_id = gym_record.id and is_active;
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
  values(gym_record.id, 'MEM-' || lpad(gym_record.next_member_number::text, 5, '0'), trim(p_name), trim(p_phone), nullif(trim(p_email), ''), nullif(trim(p_notes), ''))
  returning * into member_record;
  update public.gyms set next_member_number = next_member_number + 1 where id = gym_record.id;
  insert into public.memberships(gym_id, member_id, plan_id, plan_name, duration_value, duration_unit, starts_on, expires_on, date_overridden)
  values(gym_record.id, member_record.id, plan_record.id, plan_record.name, plan_record.duration_value, plan_record.duration_unit, p_starts_on, p_expires_on, p_date_overridden)
  returning id into membership_id;
  insert into public.charges(gym_id, membership_id, subtotal_paise, discount_paise, gst_rate_basis_points, tax_paise, total_paise, due_on)
  values(gym_record.id, membership_id, p_subtotal_paise, p_discount_paise, p_gst_rate_basis_points, p_tax_paise, p_total_paise, p_due_on)
  returning id into charge_id;
  if p_payment_paise > 0 then
    insert into public.payments(gym_id, charge_id, amount_paise, method, reference, paid_on, receipt_number)
    values(gym_record.id, charge_id, p_payment_paise, p_payment_method, nullif(trim(p_payment_reference), ''), p_paid_on, gym_record.receipt_prefix || '-' || lpad(gym_record.next_receipt_number::text, 6, '0'))
    returning id into payment_id;
    update public.gyms set next_receipt_number = next_receipt_number + 1 where id = gym_record.id;
  end if;
  return jsonb_build_object('member_id', member_record.id, 'membership_id', membership_id, 'payment_id', payment_id);
end;
$$;

create or replace function public.record_payment(
  p_charge_id uuid, p_amount_paise bigint, p_method public.payment_method,
  p_reference text, p_paid_on date, p_notes text
) returns public.payments
language plpgsql security invoker set search_path = public
as $$
declare
  g public.gyms; selected_charge public.charges; paid bigint; result public.payments;
begin
  select * into g from public.gyms where id = public.current_gym_id() and is_active for update;
  if g.id is null or auth.uid() is null then raise exception 'Active gym profile not found'; end if;
  select ch.* into selected_charge from public.charges ch
  join public.memberships ms on ms.id = ch.membership_id and ms.gym_id = ch.gym_id
  where ch.id = p_charge_id and ch.gym_id = g.id and ms.reverted_at is null for update of ch;
  if selected_charge.id is null then raise exception 'Charge not found'; end if;
  select coalesce(sum(case when p.voided_at is not null then 0 else p.amount_paise - coalesce(r.reversed_paise, 0) end), 0)
  into paid from public.payments p
  left join (select payment_id, sum(amount_paise) reversed_paise from public.payment_reversals group by payment_id) r on r.payment_id = p.id
  where p.charge_id = selected_charge.id;
  if p_amount_paise <= 0 or paid + p_amount_paise > selected_charge.total_paise then raise exception 'Payment exceeds outstanding balance'; end if;
  insert into public.payments(gym_id, charge_id, amount_paise, method, reference, paid_on, notes, receipt_number)
  values(g.id, selected_charge.id, p_amount_paise, p_method, nullif(trim(p_reference), ''), p_paid_on, nullif(trim(p_notes), ''), g.receipt_prefix || '-' || lpad(g.next_receipt_number::text, 6, '0'))
  returning * into result;
  update public.gyms set next_receipt_number = next_receipt_number + 1 where id = g.id;
  return result;
end;
$$;

revoke all on function public.create_member_with_enrollment(text,text,text,text,uuid,date,date,boolean,bigint,bigint,integer,bigint,bigint,date,bigint,public.payment_method,text,date) from public, anon;
grant execute on function public.create_member_with_enrollment(text,text,text,text,uuid,date,date,boolean,bigint,bigint,integer,bigint,bigint,date,bigint,public.payment_method,text,date) to authenticated, service_role;
revoke all on function public.record_payment(uuid,bigint,public.payment_method,text,date,text) from public, anon;
grant execute on function public.record_payment(uuid,bigint,public.payment_method,text,date,text) to authenticated;
notify pgrst, 'reload schema';
