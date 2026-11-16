-- Run against a migrated disposable database as postgres. Everything is rolled back.
begin;
insert into auth.users(id) values ('10000000-0000-4000-8000-000000000001'), ('10000000-0000-4000-8000-000000000002');
insert into public.gyms(id, owner_id, name, timezone) values
 ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Test A','Asia/Kolkata'),
 ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','Test B','Asia/Kolkata');
insert into public.members(id,gym_id,member_code,name,phone) values
 ('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','TEST-1','Expired member','0000000001'),
 ('30000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','TEST-2','Other gym','0000000002'),
 ('30000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000001','TEST-3','Upcoming only','0000000003'),
 ('30000000-0000-4000-8000-000000000004','20000000-0000-4000-8000-000000000001','TEST-4','Partial payer','0000000004');
insert into public.member_qr_credentials(member_id,gym_id,version)
 select id,gym_id,1 from public.members where member_code like 'TEST-%' and gym_id in ('20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002');
insert into public.memberships(id,gym_id,member_id,plan_name,duration_value,duration_unit,starts_on,expires_on) values
 ('40000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','Expired monthly',1,'months',(now() at time zone 'Asia/Kolkata')::date-31,(now() at time zone 'Asia/Kolkata')::date-1),
 ('40000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000003','Upcoming',1,'months',(now() at time zone 'Asia/Kolkata')::date+1,(now() at time zone 'Asia/Kolkata')::date+31);
insert into public.memberships(id,gym_id,member_id,plan_name,duration_value,duration_unit,starts_on,expires_on) values
 ('40000000-0000-4000-8000-000000000004','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000004','Partial monthly',1,'months',(now() at time zone 'Asia/Kolkata')::date,(now() at time zone 'Asia/Kolkata')::date+30);
insert into public.charges(id,gym_id,membership_id,subtotal_paise,tax_paise,total_paise,due_on) values
 ('60000000-0000-4000-8000-000000000004','20000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000004',400000,0,400000,(now() at time zone 'Asia/Kolkata')::date);
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
set local role authenticated;
do $$
declare a jsonb; b jsonb; n integer;
begin
  a := public.process_qr_access('30000000-0000-4000-8000-000000000001',1,'50000000-0000-4000-8000-000000000001');
  assert a->>'status' = 'denied', 'Expired scan must deny access';
  assert a->'attempt'->>'reason' = 'membership_expired';
  b := public.process_qr_access('30000000-0000-4000-8000-000000000001',1,'50000000-0000-4000-8000-000000000001');
  assert a->'attempt'->>'id' = b->'attempt'->>'id', 'Retries must be idempotent';
  b := public.process_qr_access('30000000-0000-4000-8000-000000000001',1,'50000000-0000-4000-8000-000000000002');
  assert a->'attempt'->>'id' = b->'attempt'->>'id', 'Rapid scans must be suppressed';
  select count(*) into n from public.attendance_events where member_id='30000000-0000-4000-8000-000000000001';
  assert n=0, 'Denied scans must not create attendance';
  select count(*) into n from public.list_denied_access_attempts('Expired member');
  assert n=1, 'Search should return the attempt';
  select count(*) into n from public.list_denied_access_attempts(null,(now() at time zone 'Asia/Kolkata')::date+1,null);
  assert n=0, 'Business-date filtering must exclude older attempts';
  begin
    perform public.process_qr_access('30000000-0000-4000-8000-000000000002',1,gen_random_uuid());
    raise exception 'Cross-tenant scan was allowed';
  exception when raise_exception then assert sqlerrm='Active member not found'; end;
  begin
    perform public.process_qr_access('30000000-0000-4000-8000-000000000001',2,gen_random_uuid());
    raise exception 'Replaced QR was allowed';
  exception when raise_exception then assert sqlerrm='QR has been disabled or replaced'; end;
  begin
    perform public.process_qr_access('30000000-0000-4000-8000-000000000003',1,gen_random_uuid());
    raise exception 'Upcoming-only membership was logged as expired';
  exception when raise_exception then assert sqlerrm='Member does not have an active membership'; end;
  begin
    delete from public.denied_access_attempts;
    raise exception 'Audit deletion was allowed';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
-- Temporary access is inclusive of the follow-up date, overdue access is denied,
-- and collecting the balance restores the same QR without rotating it.
set local role authenticated;
do $$ declare r jsonb; n integer; today date := (now() at time zone 'Asia/Kolkata')::date; begin
  r := public.process_qr_access('30000000-0000-4000-8000-000000000004',1,gen_random_uuid(),null,true);
  assert r->>'status'='allowed' and r->>'access_mode'='temporary', 'Follow-up date remains temporary access';
  r := public.process_qr_access('30000000-0000-4000-8000-000000000004',1,'50000000-0000-4000-8000-000000000014');
  assert r->>'status'='recorded' and r->>'access_mode'='temporary', 'Temporary scan records normal attendance';
  update public.charges set due_on=today+2 where id='60000000-0000-4000-8000-000000000004';
  r := public.process_qr_access('30000000-0000-4000-8000-000000000004',1,gen_random_uuid(),null,true);
  assert r->>'status'='allowed' and r->>'access_mode'='temporary' and r->>'due_on'=(today+2)::text, 'Rescheduling extends temporary access through the new date';
  update public.charges set due_on=today-1 where id='60000000-0000-4000-8000-000000000004';
  r := public.process_qr_access('30000000-0000-4000-8000-000000000004',1,'50000000-0000-4000-8000-000000000015');
  assert r->>'status'='denied' and r->'attempt'->>'reason'='payment_overdue', 'Overdue balance denies access';
  select count(*) into n from public.attendance_events where member_id='30000000-0000-4000-8000-000000000004';
  assert n=1, 'Payment hold attempts never become attendance';
  select count(*) into n from public.charge_due_date_changes where charge_id='60000000-0000-4000-8000-000000000004';
  assert n=2, 'Each follow-up date change is audited';
end $$;
reset role;
insert into public.payments(gym_id,charge_id,amount_paise,method,paid_on,receipt_number)
 values('20000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000004',400000,'cash',(now() at time zone 'Asia/Kolkata')::date,'TEST-PAID-1');
set local role authenticated;
do $$ declare r jsonb; begin
  r := public.process_qr_access('30000000-0000-4000-8000-000000000004',1,gen_random_uuid());
  assert r->>'status'='recorded' and r->>'access_mode'='paid', 'Full payment restores normal QR access';
end $$;
reset role;
-- Advance the stored event past the cooldown; test a distinct later attempt.
update public.denied_access_attempts set occurred_at=now()-interval '31 seconds' where gym_id='20000000-0000-4000-8000-000000000001';
set local role authenticated;
do $$ declare r jsonb; n integer; begin
  r := public.process_qr_access('30000000-0000-4000-8000-000000000001',1,gen_random_uuid(),null,true);
  assert r->>'status'='denied' and r->>'duplicate'='false';
  select count(*) into n from public.denied_access_attempts where member_id='30000000-0000-4000-8000-000000000001'; assert n=2;
end $$;
reset role;
-- Overlapping active coverage must permit entry, even when older periods expired.
insert into public.memberships(gym_id,member_id,plan_name,duration_value,duration_unit,starts_on,expires_on)
 values('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','Renewed',1,'months',(now() at time zone 'Asia/Kolkata')::date,(now() at time zone 'Asia/Kolkata')::date);
set local role authenticated;
do $$ declare r jsonb; n integer; begin
  r := public.process_qr_access('30000000-0000-4000-8000-000000000001',1,gen_random_uuid(),null,true);
  assert r->>'status'='allowed', 'Direct denial confirmation must not check in a renewed member';
  r := public.process_qr_access('30000000-0000-4000-8000-000000000001',1,'50000000-0000-4000-8000-000000000009');
  assert r->>'status'='recorded' and r->'event'->>'direction'='entry', 'Expiry-day membership remains active';
  select count(*) into n from public.attendance_events where member_id='30000000-0000-4000-8000-000000000001'; assert n=1;
end $$;
reset role;
update public.memberships set reverted_at=now() where plan_name='Renewed';
update public.denied_access_attempts set occurred_at=now()-interval '31 seconds' where gym_id='20000000-0000-4000-8000-000000000001';
set local role authenticated;
do $$ declare r jsonb; begin
  r := public.process_qr_access('30000000-0000-4000-8000-000000000001',1,gen_random_uuid());
  assert r->>'status'='denied', 'Reverted renewals must not allow access';
end $$;
reset role;
update public.member_qr_credentials set enabled=false where member_id='30000000-0000-4000-8000-000000000001';
set local role authenticated;
do $$ begin
  begin perform public.process_qr_access('30000000-0000-4000-8000-000000000001',1,gen_random_uuid()); raise exception 'Disabled QR accepted';
  exception when raise_exception then assert sqlerrm='QR has been disabled or replaced'; end;
end $$;
reset role;
update public.members set is_archived=true where id='30000000-0000-4000-8000-000000000001';
set local role authenticated;
do $$ begin
  begin perform public.process_qr_access('30000000-0000-4000-8000-000000000001',1,gen_random_uuid()); raise exception 'Archived member accepted';
  exception when raise_exception then assert sqlerrm='Active member not found'; end;
end $$;
reset role;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
set local role authenticated;
do $$ declare n integer; begin
  select count(*) into n from public.denied_access_attempts; assert n=0, 'RLS must hide other gyms';
  select count(*) into n from public.list_denied_access_attempts(); assert n=0, 'Directory must hide other gyms';
end $$;
reset role;
select set_config('request.jwt.claim.sub','',true);
set local role anon;
do $$ begin
  begin perform public.process_qr_access('30000000-0000-4000-8000-000000000001',1,gen_random_uuid()); raise exception 'Anonymous execution allowed';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
