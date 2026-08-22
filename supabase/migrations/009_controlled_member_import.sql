-- Service-role-only API used by the controlled first-client CSV import.

create or replace function public.admin_import_member(
  p_gym_id uuid,
  p_name text,
  p_phone text,
  p_email text,
  p_notes text,
  p_is_archived boolean,
  p_plan_id uuid,
  p_starts_on date,
  p_expires_on date,
  p_due_on date,
  p_total_paise bigint,
  p_paid_paise bigint,
  p_payment_method public.payment_method,
  p_payment_date date,
  p_payment_reference text
)
returns jsonb
language plpgsql
security definer
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
  select * into gym_record from public.gyms where id = p_gym_id for update;
  if gym_record.id is null then raise exception 'Gym not found'; end if;
  if nullif(trim(p_name), '') is null or length(regexp_replace(p_phone, '\D', '', 'g')) < 7 then raise exception 'Invalid member identity'; end if;

  insert into public.members(gym_id, member_code, name, phone, email, notes, is_archived)
  values(
    gym_record.id,
    'MEM-' || lpad(gym_record.next_member_number::text, 5, '0'),
    trim(p_name), trim(p_phone), nullif(trim(p_email), ''), nullif(trim(p_notes), ''), p_is_archived
  ) returning * into member_record;
  update public.gyms set next_member_number = next_member_number + 1 where id = gym_record.id;

  if p_plan_id is null then
    if not p_is_archived then raise exception 'Current member requires a plan'; end if;
    return jsonb_build_object('member_id', member_record.id, 'membership_id', null, 'payment_id', null);
  end if;

  select * into plan_record from public.plans where id = p_plan_id and gym_id = gym_record.id;
  if plan_record.id is null then raise exception 'Plan not found'; end if;
  if p_starts_on is null or p_expires_on is null or p_expires_on < p_starts_on then raise exception 'Invalid membership dates'; end if;
  if p_due_on is null then raise exception 'Due date is required'; end if;
  if p_total_paise is null or p_total_paise < 0 or p_paid_paise is null or p_paid_paise < 0 or p_paid_paise > p_total_paise then raise exception 'Invalid imported balance'; end if;
  if p_paid_paise > 0 and (p_payment_method is null or p_payment_date is null) then raise exception 'Imported payment requires its method and date'; end if;

  insert into public.memberships(gym_id, member_id, plan_id, plan_name, duration_value, duration_unit, starts_on, expires_on, date_overridden)
  values(gym_record.id, member_record.id, plan_record.id, plan_record.name, plan_record.duration_value, plan_record.duration_unit, p_starts_on, p_expires_on, true)
  returning id into membership_id;

  insert into public.charges(gym_id, membership_id, subtotal_paise, discount_paise, gst_rate_basis_points, tax_paise, total_paise, due_on)
  values(gym_record.id, membership_id, p_total_paise, 0, 0, 0, p_total_paise, p_due_on)
  returning id into charge_id;

  if p_paid_paise > 0 then
    insert into public.payments(gym_id, charge_id, amount_paise, method, reference, paid_on, notes, receipt_number)
    values(
      gym_record.id, charge_id, p_paid_paise, p_payment_method,
      nullif(trim(p_payment_reference), ''), p_payment_date, 'Controlled initial import',
      gym_record.receipt_prefix || '-' || lpad(gym_record.next_receipt_number::text, 6, '0')
    ) returning id into payment_id;
    update public.gyms set next_receipt_number = next_receipt_number + 1 where id = gym_record.id;
  end if;

  return jsonb_build_object('member_id', member_record.id, 'membership_id', membership_id, 'payment_id', payment_id);
end;
$$;

revoke execute on function public.admin_import_member(uuid, text, text, text, text, boolean, uuid, date, date, date, bigint, bigint, public.payment_method, date, text) from public, anon, authenticated;
grant execute on function public.admin_import_member(uuid, text, text, text, text, boolean, uuid, date, date, date, bigint, bigint, public.payment_method, date, text) to service_role;

create or replace function public.admin_import_members(p_gym_id uuid, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  item jsonb;
  imported integer := 0;
begin
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'Import payload must be an array'; end if;
  if jsonb_array_length(p_rows) > 5000 then raise exception 'Import payload exceeds 5,000 rows'; end if;

  for item in select value from jsonb_array_elements(p_rows)
  loop
    perform public.admin_import_member(
      p_gym_id,
      item->>'name',
      item->>'phone',
      item->>'email',
      item->>'notes',
      coalesce((item->>'is_archived')::boolean, false),
      nullif(item->>'plan_id', '')::uuid,
      nullif(item->>'starts_on', '')::date,
      nullif(item->>'expires_on', '')::date,
      nullif(item->>'due_on', '')::date,
      nullif(item->>'total_paise', '')::bigint,
      coalesce(nullif(item->>'paid_paise', '')::bigint, 0),
      nullif(item->>'payment_method', '')::public.payment_method,
      nullif(item->>'payment_date', '')::date,
      item->>'payment_reference'
    );
    imported := imported + 1;
  end loop;

  return jsonb_build_object('imported', imported);
end;
$$;

revoke execute on function public.admin_import_members(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.admin_import_members(uuid, jsonb) to service_role;

notify pgrst, 'reload schema';
