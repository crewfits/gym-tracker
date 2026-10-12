-- Run as postgres in a disposable migrated database; fixtures are rolled back.
begin;
insert into auth.users(id) values
 ('12000000-0000-4000-8000-000000000001'),
 ('12000000-0000-4000-8000-000000000002');
insert into public.gyms(id,owner_id,name) values
 ('22000000-0000-4000-8000-000000000001','12000000-0000-4000-8000-000000000001','Staff Activation Test');
insert into public.plans(id,gym_id,name,duration_value,duration_unit,default_fee_paise) values
 ('32000000-0000-4000-8000-000000000001','22000000-0000-4000-8000-000000000001','Monthly',1,'months',100000);
insert into public.gym_users(gym_id,user_id,role,status,display_name) values
 ('22000000-0000-4000-8000-000000000001','12000000-0000-4000-8000-000000000002','receptionist','active','Front Desk');
select set_config('request.jwt.claim.sub','12000000-0000-4000-8000-000000000002',true);
set local role authenticated;
do $$
declare
  details jsonb := '{"name":"Staff Member","phone":"9876543299","email":"","notes":"Reception activation","plan_id":"32000000-0000-4000-8000-000000000001","starts_on":"2026-09-11","expires_on":"2026-10-10","subtotal_paise":100000,"discount_paise":0,"gst_rate_basis_points":0,"generate_qr":false}';
  rows jsonb := '[{"amount_paise":25000,"method":"cash","paid_on":"2026-09-11","reference":"STAFF-CASH"}]';
  result jsonb; handler uuid;
begin
  result := public.submit_payment_operation(gen_random_uuid(),'activate',details,rows);
  assert exists(select 1 from public.members where id=(result->>'member_id')::uuid and gym_id='22000000-0000-4000-8000-000000000001'), 'Activation escaped assigned gym';
  select handled_by_gym_user_id into handler from public.memberships where id=(result->>'membership_id')::uuid;
  assert handler=(select id from public.gym_users where user_id='12000000-0000-4000-8000-000000000002'), 'Receptionist handler missing';
  assert exists(select 1 from public.payments where id=(result->'payment_ids'->>0)::uuid and handled_by_gym_user_id=handler), 'Payment handler missing';
end $$;
reset role;
rollback;
