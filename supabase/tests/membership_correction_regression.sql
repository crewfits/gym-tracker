-- Run as postgres in a disposable fully migrated database; all fixtures roll back.
begin;

insert into auth.users(id) values ('51000000-0000-4000-8000-000000000001');
insert into public.gyms(id, owner_id, name) values (
  '52000000-0000-4000-8000-000000000001',
  '51000000-0000-4000-8000-000000000001',
  'Correction Regression Gym'
);
insert into public.gym_users(gym_id, user_id, role, status, display_name) values (
  '52000000-0000-4000-8000-000000000001',
  '51000000-0000-4000-8000-000000000001',
  'owner',
  'active',
  'Regression Owner'
);
insert into public.plans(id, gym_id, name, duration_value, duration_unit, default_fee_paise) values
  ('53000000-0000-4000-8000-000000000001', '52000000-0000-4000-8000-000000000001', 'Monthly Plan', 1, 'months', 200000),
  ('53000000-0000-4000-8000-000000000002', '52000000-0000-4000-8000-000000000001', 'Quarterly Plan', 3, 'months', 500000);

select set_config('request.jwt.claim.sub', '51000000-0000-4000-8000-000000000001', true);
set local role authenticated;

do $$
<<correction_regression>>
declare
  activated jsonb;
  corrected jsonb;
  retried jsonb;
  no_payment jsonb;
  reduced jsonb;
  member_id uuid;
  membership_id uuid;
  charge_id uuid;
  correction_request constant uuid := '54000000-0000-4000-8000-000000000001';
  payment_count integer;
  reason_count integer;
begin
  activated := public.submit_payment_operation(
    '54000000-0000-4000-8000-000000000000',
    'activate',
    '{"name":"Correction Member","phone":"9876500001","email":"","notes":"","plan_id":"53000000-0000-4000-8000-000000000001","starts_on":"2026-10-01","expires_on":"2026-10-31","subtotal_paise":200000,"discount_paise":0,"gst_rate_basis_points":0,"generate_qr":false}',
    '[{"amount_paise":200000,"method":"cash","paid_on":"2026-10-01","reference":"ORIGINAL"}]'
  );
  member_id := (activated->>'member_id')::uuid;
  membership_id := (activated->>'membership_id')::uuid;
  charge_id := (activated->>'charge_id')::uuid;

  corrected := public.correct_membership_with_payment(
    correction_request, member_id, membership_id,
    '53000000-0000-4000-8000-000000000002',
    '2026-10-01', '2026-12-31',
    500000, 0, 0, 0, 500000,
    'Wrong monthly plan selected',
    '[{"amount_paise":100000,"method":"upi","paid_on":"2026-10-11","reference":"CORRECTION-PARTIAL"}]'
  );

  assert (corrected->>'balance_paise')::bigint = 200000,
    'Partial correction payment did not preserve the remaining balance';
  assert jsonb_array_length(corrected->'payment_ids') = 1,
    'Partial correction should create exactly one payment';
  assert exists(
    select 1 from public.payment_operations
    where gym_id = '52000000-0000-4000-8000-000000000001'
      and request_id = correction_request
      and payload->>'kind' = 'membership_correction'
      and payload->>'reason' = 'Wrong monthly plan selected'
  ), 'Correction reason was not retained in the operation audit';
  assert exists(
    select 1 from public.payments
    where id = (corrected->'payment_ids'->>0)::uuid
      and charge_id = correction_regression.charge_id
      and notes = 'Collected with owner membership correction: Wrong monthly plan selected'
  ), 'Correction payment notes do not contain the audit reason';
  assert exists(
    select 1 from public.list_transactions(p_query => 'Wrong monthly plan selected', p_page_size => 100)
    where correction_reason = 'Wrong monthly plan selected'
  ), 'Transactions do not expose the internal correction reason';

  select count(*) into payment_count from public.payments where payments.charge_id = correction_regression.charge_id;
  retried := public.correct_membership_with_payment(
    correction_request, member_id, membership_id,
    '53000000-0000-4000-8000-000000000002',
    '2026-10-01', '2026-12-31',
    500000, 0, 0, 0, 500000,
    'Wrong monthly plan selected',
    '[{"amount_paise":100000,"method":"upi","paid_on":"2026-10-11","reference":"CORRECTION-PARTIAL"}]'
  );
  assert retried = corrected, 'Identical correction retry did not return the stored result';
  assert payment_count = (select count(*) from public.payments where payments.charge_id = correction_regression.charge_id),
    'Identical correction retry created a duplicate payment';

  no_payment := public.correct_membership_with_payment(
    '54000000-0000-4000-8000-000000000002', member_id, membership_id,
    '53000000-0000-4000-8000-000000000002',
    '2026-10-01', '2026-12-31',
    600000, 0, 0, 0, 600000,
    'Correct fee but collect later', '[]'
  );
  assert (no_payment->>'balance_paise')::bigint = 300000,
    'No-payment correction did not leave the full difference outstanding';
  assert jsonb_array_length(no_payment->'payment_ids') = 0,
    'No-payment correction unexpectedly created a payment';

  begin
    perform public.correct_membership_with_payment(
      '54000000-0000-4000-8000-000000000003', member_id, membership_id,
      '53000000-0000-4000-8000-000000000002',
      '2026-10-01', '2026-12-31',
      600000, 0, 0, 0, 600000,
      'Reject excessive correction payment',
      '[{"amount_paise":300001,"method":"cash","paid_on":"2026-10-11","reference":"TOO-MUCH"}]'
    );
    raise exception 'Overpayment was incorrectly accepted';
  exception
    when others then
      if sqlerrm = 'Overpayment was incorrectly accepted' then raise; end if;
      assert sqlerrm like 'Payment cannot exceed the corrected outstanding balance%',
        'Unexpected overpayment validation error: ' || sqlerrm;
  end;

  reduced := public.correct_membership_with_payment(
    '54000000-0000-4000-8000-000000000004', member_id, membership_id,
    '53000000-0000-4000-8000-000000000001',
    '2026-10-01', '2026-10-31',
    100000, 0, 0, 0, 100000,
    'Quarterly plan selected by mistake', '[]'
  );
  assert (reduced->>'reversed_paise')::bigint = 200000,
    'Lower correction did not reverse the excess collected amount';
  select count(*) into reason_count
  from public.list_transactions(p_query => 'Quarterly plan selected by mistake', p_page_size => 100)
  where correction_reason = 'Quarterly plan selected by mistake';
  assert reason_count > 0,
    'Transactions do not expose a downward correction reason from reversal audit rows';

  corrected := public.correct_membership_with_final_payment(
    '54000000-0000-4000-8000-000000000005', member_id, membership_id,
    '53000000-0000-4000-8000-000000000002',
    '2026-10-01', '2026-12-31',
    500000, 0, 0, 0, 500000,
    350000, 'cash', '2026-10-11', '',
    'Set one final collected amount'
  );
  assert (corrected->>'final_paid_paise')::bigint = 350000,
    'Final amount-paid correction did not store the requested collected total';
  assert (corrected->>'balance_paise')::bigint = 150000,
    'Final amount-paid correction did not leave the expected outstanding balance';

  retried := public.correct_membership_with_final_payment(
    '54000000-0000-4000-8000-000000000005', member_id, membership_id,
    '53000000-0000-4000-8000-000000000002',
    '2026-10-01', '2026-12-31',
    500000, 0, 0, 0, 500000,
    350000, 'cash', '2026-10-11', '',
    'Set one final collected amount'
  );
  assert retried = corrected,
    'Final amount-paid correction retry did not return the stored result';

  reduced := public.correct_membership_with_final_payment(
    '54000000-0000-4000-8000-000000000006', member_id, membership_id,
    '53000000-0000-4000-8000-000000000002',
    '2026-10-01', '2026-12-31',
    500000, 0, 0, 0, 500000,
    150000, 'cash', '2026-10-11', '',
    'Reduce final collected amount'
  );
  assert (reduced->>'final_paid_paise')::bigint = 150000,
    'Reduced final amount was not returned';
  assert (reduced->>'balance_paise')::bigint = 350000,
    'Reduced final amount did not become the expected outstanding balance';
  assert (select sum(net_paise) from public.list_transactions(p_page_size => 100) where member_id = correction_regression.member_id) = 150000,
    'Transaction ledger net amounts do not match the reduced final collected amount';
  assert exists(
    select 1 from public.list_transactions(p_query => 'Reduce final collected amount', p_page_size => 100)
    where correction_reason = 'Reduce final collected amount'
      and reversed_paise > 0
  ), 'Reduced final amount did not update transaction reversal status and correction reason';
  assert (select total_paise from public.charges where id = correction_regression.charge_id) = 500000,
    'Corrected charge total was not retained';
end $$;

reset role;
rollback;
