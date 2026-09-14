-- Internal Admins may run a membership operation, but are not gym-floor staff.
-- When no non-Admin handler is selected, keep the handler audit field empty
-- instead of rejecting the operation because the acting account is an Admin.

create or replace function public.submit_payment_operation(p_request_id uuid, p_kind text, p_details jsonb, p_payments jsonb)
returns jsonb language plpgsql security definer set search_path = public
as $$
<<op>>
declare
  g public.gyms;
  prior public.payment_operations;
  operation_id uuid := gen_random_uuid();
  payload jsonb := jsonb_build_object('kind', p_kind, 'details', p_details, 'payments', p_payments);
  plan public.plans;
  member_id uuid;
  membership_id uuid;
  charge_id uuid;
  start_date date;
  end_date date;
  calculated_end date;
  latest_end date;
  due_date date;
  subtotal bigint;
  discount bigint;
  tax_rate integer;
  tax bigint;
  total bigint;
  paid_total bigint := 0;
  row jsonb;
  payment public.payments;
  payment_ids jsonb := '[]'::jsonb;
  result jsonb;
  duplicate public.members;
  duplicate_count integer;
  handler_id uuid;
begin
  select * into g from public.gyms where id = public.current_gym_id() and is_active for update;
  if g.id is null or auth.uid() is null then raise exception 'Active gym profile not found'; end if;
  if p_request_id is null then raise exception 'Request ID is required'; end if;
  if p_kind is null or p_kind not in ('activate', 'enroll', 'renew', 'collect') then raise exception 'Invalid payment operation'; end if;
  select * into prior from public.payment_operations where gym_id=g.id and request_id=p_request_id;
  if found then
    if prior.payload <> payload then raise exception 'This request was already saved with different details. Reload to start a new payment.'; end if;
    return prior.result;
  end if;
  if jsonb_typeof(p_details) is distinct from 'object' or jsonb_typeof(p_payments) is distinct from 'array' then raise exception 'Invalid payment details'; end if;

  handler_id := nullif(p_details->>'handled_by_gym_user_id','')::uuid;
  if handler_id is null then
    select id into handler_id
    from public.gym_users
    where gym_id = g.id and user_id = auth.uid() and status = 'active' and role <> 'admin'
    limit 1;
  end if;
  if handler_id is not null and not exists (
    select 1 from public.gym_users where id = handler_id and gym_id = g.id and status = 'active' and role <> 'admin'
  ) then
    raise exception 'Select an active staff member who handled this operation' using hint='handled_by_gym_user_id';
  end if;

  if jsonb_array_length(p_payments) > 10 or (p_kind='collect' and jsonb_array_length(p_payments)=0) then raise exception 'Enter between 1 and 10 payments for collection'; end if;
  for row in select value from jsonb_array_elements(p_payments) loop
    if jsonb_typeof(row) <> 'object' or coalesce(row->>'amount_paise','') !~ '^[0-9]+$'
      or (row->>'amount_paise')::numeric <= 0 or (row->>'amount_paise')::numeric > 9007199254740991
      or coalesce(row->>'method','') not in ('cash','upi','card','bank_transfer')
      or coalesce(row->>'paid_on','') !~ '^[0-9]{4}-[0-9]{2}$'
      or length(coalesce(row->>'reference','')) > 200 then raise exception 'Invalid payment entry'; end if;
    perform (row->>'paid_on')::date;
    paid_total := paid_total + (row->>'amount_paise')::bigint;
  end loop;
  if p_kind <> 'activate' then
    member_id := (p_details->>'member_id')::uuid;
    perform 1 from public.members where id=member_id and gym_id=g.id and not is_archived for update;
    if not found then raise exception 'Active member not found'; end if;
  end if;
  if p_kind = 'collect' then
    select c.id, c.membership_id into charge_id, membership_id from public.charges c
      join public.memberships ms on ms.id=c.membership_id and ms.gym_id=c.gym_id
      where c.id=(p_details->>'charge_id')::uuid and c.gym_id=g.id and ms.member_id=op.member_id and ms.reverted_at is null for update of c;
    if charge_id is null then raise exception 'Membership charge not found'; end if;
  else
    select * into plan from public.plans where id=(p_details->>'plan_id')::uuid and gym_id=g.id and is_active;
    if plan.id is null then raise exception 'Active plan not found' using hint='plan_id'; end if;
    start_date := (p_details->>'starts_on')::date;
    if p_kind='renew' then
      select max(expires_on) into latest_end from public.memberships where gym_id=g.id and memberships.member_id=op.member_id and reverted_at is null;
      start_date := greatest(start_date, latest_end + 1);
    end if;
    calculated_end := (case when plan.duration_unit='months' then start_date + make_interval(months=>plan.duration_value) else start_date + make_interval(days=>plan.duration_value) end)::date - 1;
    end_date := coalesce(nullif(p_details->>'expires_on','')::date, calculated_end);
    due_date := start_date + 7;
    if start_date is null or end_date < start_date then raise exception 'End date must be on or after the membership start date' using hint='expires_on'; end if;
    subtotal := (p_details->>'subtotal_paise')::bigint;
    discount := (p_details->>'discount_paise')::bigint;
    tax_rate := (p_details->>'gst_rate_basis_points')::integer;
    if subtotal is null or discount is null or tax_rate is null or subtotal < 0 or discount < 0 or discount > subtotal or tax_rate not between 0 and 10000 then raise exception 'Invalid membership price, discount or tax'; end if;
    tax := round((subtotal-discount)::numeric*tax_rate/10000);
    total := subtotal-discount+tax;
    if paid_total > total then raise exception 'Total paid cannot exceed the membership total' using hint='payments'; end if;
    if p_kind='activate' then
      if nullif(trim(p_details->>'name'),'') is null or length(trim(coalesce(p_details->>'phone',''))) < 7 then raise exception 'Name and phone are required'; end if;
      select count(*) into duplicate_count from public.members where gym_id=g.id and phone=trim(p_details->>'phone');
      select * into duplicate from public.members where gym_id=g.id and phone=trim(p_details->>'phone') order by is_archived,created_at desc limit 1;
      if duplicate.is_archived then raise exception 'This phone belongs to an archived member. Open that profile to reactivate.' using hint='phone', detail=duplicate.id::text; end if;
      if duplicate_count >= 3 then raise exception 'This phone is already shared by 3 members' using hint='phone'; end if;
      if duplicate_count > 0 and coalesce((p_details->>'shared_phone')::boolean,false)=false then raise exception 'This phone is already used. Select the shared-phone confirmation to continue.' using hint='shared_phone'; end if;
      result := public.create_member_with_enrollment(p_details->>'name', p_details->>'phone', p_details->>'email', p_details->>'notes', plan.id, start_date, end_date, end_date<>calculated_end, subtotal, discount, tax_rate, tax, total, due_date, 0, 'cash', '', start_date);
      member_id := (result->>'member_id')::uuid;
      membership_id := (result->>'membership_id')::uuid;
    else
      membership_id := public.create_membership_charge(member_id, plan.id, start_date, end_date, end_date<>calculated_end, subtotal, discount, tax_rate, tax, total, due_date);
    end if;
    update public.memberships set handled_by_gym_user_id = handler_id where id = membership_id and gym_id = g.id;
    select id into charge_id from public.charges where charges.membership_id=op.membership_id and gym_id=g.id;
  end if;
  if p_kind='activate' and coalesce((p_details->>'generate_qr')::boolean,false) then
    perform public.issue_member_qr(member_id);
  end if;
  insert into public.payment_operations(id,gym_id,request_id,payload,result,created_by) values(operation_id,g.id,p_request_id,payload,'{}',auth.uid());
  for row in select value from jsonb_array_elements(p_payments) loop
    payment := public.record_payment(charge_id,(row->>'amount_paise')::bigint,(row->>'method')::public.payment_method,row->>'reference',(row->>'paid_on')::date,p_details->>'notes');
    update public.payments set operation_id=op.operation_id, handled_by_gym_user_id=handler_id where id=payment.id and gym_id=g.id;
    payment_ids := payment_ids || jsonb_build_array(payment.id);
  end loop;
  result := jsonb_build_object('operation_id',operation_id,'member_id',member_id,'membership_id',membership_id,'charge_id',charge_id,'payment_ids',payment_ids,'paid_paise',paid_total);
  update public.payment_operations set result=op.result where id=operation_id and gym_id=g.id;
  return result;
end;
$$;

revoke all on function public.submit_payment_operation(uuid,text,jsonb,jsonb) from public,anon;
grant execute on function public.submit_payment_operation(uuid,text,jsonb,jsonb) to authenticated;

notify pgrst, 'reload schema';
