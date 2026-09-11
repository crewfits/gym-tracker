-- Run as postgres in a disposable migrated database; fixtures are rolled back.
begin;
insert into auth.users(id) values ('11000000-0000-4000-8000-000000000001'),('11000000-0000-4000-8000-000000000002');
insert into public.gyms(id,owner_id,name) values
 ('21000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001','Split Test A'),
 ('21000000-0000-4000-8000-000000000002','11000000-0000-4000-8000-000000000002','Split Test B');
insert into public.plans(id,gym_id,name,duration_value,duration_unit,default_fee_paise) values
 ('31000000-0000-4000-8000-000000000001','21000000-0000-4000-8000-000000000001','Monthly',1,'months',100000);
insert into public.members(id,gym_id,member_code,name,phone) values
 ('41000000-0000-4000-8000-000000000002','21000000-0000-4000-8000-000000000002','OTHER','Other member','9999999999');
-- Force a failure after an earlier row has been inserted to verify transaction rollback.
create function public.split_test_fail_payment() returns trigger language plpgsql as $$ begin
 if new.reference='FAIL-SECOND-ROW' then raise exception 'Injected payment failure'; end if;
 return new;
end $$;
create trigger split_test_failure before insert on public.payments for each row execute function public.split_test_fail_payment();
select set_config('request.jwt.claim.sub','11000000-0000-4000-8000-000000000001',true);
set local role authenticated;
do $$
declare
 details jsonb := '{"name":"Split Member","phone":"9876543210","email":"","notes":"","plan_id":"31000000-0000-4000-8000-000000000001","starts_on":"2026-09-11","expires_on":"2026-10-10","subtotal_paise":100000,"discount_paise":0,"gst_rate_basis_points":0,"generate_qr":true}';
 rows jsonb := '[{"amount_paise":30000,"method":"upi","paid_on":"2026-09-10","reference":"UPI-123"},{"amount_paise":20000,"method":"cash","paid_on":"2026-09-11","reference":""}]';
 request_id uuid := gen_random_uuid();
 a jsonb; b jsonb; c jsonb; balance bigint; n integer; before_counter bigint; before_members integer;
begin
 a := public.submit_payment_operation(request_id,'activate',details,rows);
 assert jsonb_array_length(a->'payment_ids')=2;
 select count(*) into n from public.payments where operation_id=(a->>'operation_id')::uuid; assert n=2;
 select balance_paise into balance from public.charge_balances where id=(a->>'charge_id')::uuid; assert balance=50000, 'Partial balance incorrect';
 assert exists(select 1 from public.payments where id=(a->'payment_ids'->>0)::uuid and method='upi' and paid_on='2026-09-10' and reference='UPI-123');
 assert exists(select 1 from public.member_qr_credentials where member_id=(a->>'member_id')::uuid and version=1 and enabled);
 b := public.submit_payment_operation(request_id,'activate',details,rows);
 assert a=b, 'Retry must return the same operation and receipt IDs';
 select count(*) into n from public.payments where operation_id=(a->>'operation_id')::uuid; assert n=2;
 assert exists(select 1 from public.member_qr_credentials where member_id=(a->>'member_id')::uuid and version=1), 'Retry must not rotate QR';
 begin
  perform public.submit_payment_operation(request_id,'activate',details,rows || rows);
  raise exception 'Changed retry accepted';
 exception when raise_exception then assert sqlerrm like 'This request was already saved%'; end;
 -- Collection fails on its second row: the first row and receipt counter must roll back.
 select next_receipt_number into before_counter from public.gyms where id='21000000-0000-4000-8000-000000000001';
 begin
  perform public.submit_payment_operation(gen_random_uuid(),'collect',jsonb_build_object('member_id',a->>'member_id','charge_id',a->>'charge_id'),jsonb_build_array(rows->0,rows->0));
  raise exception 'Overpayment accepted';
 exception when raise_exception then assert sqlerrm='Payment exceeds outstanding balance'; end;
 select next_receipt_number into balance from public.gyms where id='21000000-0000-4000-8000-000000000001'; assert balance=before_counter;
 select count(*) into n from public.payments; assert n=2, 'Failed collection left partial payment';
 -- Invalid row must leave no new member or operation.
 select count(*) into before_members from public.members;
 begin
  perform public.submit_payment_operation(gen_random_uuid(),'activate',details || '{"phone":"9876543211"}', '[{"amount_paise":100,"method":"cash","paid_on":"2026-09-11"},{"amount_paise":1,"method":"invalid","paid_on":"2026-09-11"}]');
  raise exception 'Invalid row accepted';
 exception when raise_exception then assert sqlerrm='Invalid payment entry'; end;
 select count(*) into n from public.members; assert n=before_members;
 -- A late payment failure must roll back the new member, membership, QR and receipts.
 begin
  perform public.submit_payment_operation(gen_random_uuid(),'activate',details || '{"phone":"9876543211"}',jsonb_build_array(rows->0,(rows->1) || '{"reference":"FAIL-SECOND-ROW"}'));
  raise exception 'Injected failure was ignored';
 exception when raise_exception then assert sqlerrm='Injected payment failure'; end;
 select count(*) into n from public.members; assert n=before_members;
 select count(*) into n from public.memberships; assert n=1;
 select count(*) into n from public.payment_operations; assert n=1;
 select count(*) into n from public.member_qr_credentials; assert n=1;
 select count(*) into n from public.payments; assert n=2;
 begin
  perform public.submit_payment_operation(gen_random_uuid(),'renew', details || jsonb_build_object('member_id',a->>'member_id','expires_on','2026-11-10'),jsonb_build_array(rows->0,(rows->1) || '{"reference":"FAIL-SECOND-ROW"}'));
  raise exception 'Renewal failure was ignored';
 exception when raise_exception then assert sqlerrm='Injected payment failure'; end;
 select count(*) into n from public.memberships; assert n=1;
 select next_receipt_number into balance from public.gyms where id='21000000-0000-4000-8000-000000000001'; assert balance=before_counter;
 -- Zero-payment renewal is valid, extends after current expiry and can be retried safely.
 details := details || jsonb_build_object('member_id',a->>'member_id','expires_on','2026-11-10');
 request_id := gen_random_uuid();
 b := public.submit_payment_operation(request_id,'renew',details,'[]');
 assert jsonb_array_length(b->'payment_ids')=0;
 assert exists(select 1 from public.memberships where id=(b->>'membership_id')::uuid and starts_on='2026-10-11');
 c := public.submit_payment_operation(request_id,'renew',details,'[]'); assert b=c;
 begin
  perform public.submit_payment_operation(gen_random_uuid(),'collect',jsonb_build_object('member_id','41000000-0000-4000-8000-000000000002','charge_id',a->>'charge_id'),rows);
  raise exception 'Cross-gym member accepted';
 exception when raise_exception then assert sqlerrm='Active member not found'; end;
 begin
  perform public.submit_payment_operation(gen_random_uuid(),'collect',jsonb_build_object('member_id',a->>'member_id','charge_id',a->>'charge_id'),'[]');
  raise exception 'Empty collection accepted';
 exception when raise_exception then assert sqlerrm like 'Enter between 1 and 10%'; end;
 begin
  delete from public.payment_operations;
  raise exception 'Operation deletion accepted';
 exception when insufficient_privilege then null; end;
 b := public.submit_payment_operation(gen_random_uuid(),'collect',jsonb_build_object('member_id',a->>'member_id','charge_id',a->>'charge_id'),rows);
 select balance_paise into balance from public.charge_balances where id=(a->>'charge_id')::uuid; assert balance=0;
 select count(distinct receipt_number) into n from public.payments; assert n=4, 'Receipts must be distinct';
 perform public.reverse_payment((a->'payment_ids'->>0)::uuid,10000,'Partial correction');
 select balance_paise into balance from public.charge_balances where id=(a->>'charge_id')::uuid; assert balance=10000;
 b := public.submit_payment_operation(gen_random_uuid(),'collect',jsonb_build_object('member_id',a->>'member_id','charge_id',a->>'charge_id'),'[{"amount_paise":10000,"method":"cash","paid_on":"2026-09-11"}]');
 select balance_paise into balance from public.charge_balances where id=(a->>'charge_id')::uuid; assert balance=0;
end $$;
reset role;
-- Other owner cannot see operation payloads or receipts.
select set_config('request.jwt.claim.sub','11000000-0000-4000-8000-000000000002',true);
set local role authenticated;
do $$ declare n integer; begin
 select count(*) into n from public.payment_operations; assert n=0;
 select count(*) into n from public.payments; assert n=0;
end $$;
reset role;
rollback;
