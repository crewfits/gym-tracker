-- A partial collection can set the next agreed follow-up date in the same
-- transaction as the payment entries. Full settlement leaves the QR unrestricted.
do $migration$
declare
  definition text;
  updated_definition text;
begin
  select pg_get_functiondef(
    'public.submit_payment_operation(uuid,text,jsonb,jsonb)'::regprocedure
  ) into definition;

  updated_definition := replace(
    definition,
    $needle$  result := jsonb_build_object('operation_id',operation_id,'member_id',member_id,'membership_id',membership_id,'charge_id',charge_id,'payment_ids',payment_ids,'paid_paise',paid_total);$needle$,
    $replacement$  if p_kind = 'collect' and nullif(p_details->>'due_on','') is not null
    and exists (select 1 from public.charge_balances cb where cb.id = charge_id and cb.gym_id = g.id and cb.balance_paise > 0) then
    due_date := (p_details->>'due_on')::date;
    if due_date < (now() at time zone g.timezone)::date then
      raise exception 'Payment follow-up date cannot be before today' using hint='due_on';
    end if;
    update public.charges set due_on = due_date where id = charge_id and gym_id = g.id;
  end if;
  result := jsonb_build_object('operation_id',operation_id,'member_id',member_id,'membership_id',membership_id,'charge_id',charge_id,'payment_ids',payment_ids,'paid_paise',paid_total);$replacement$
  );

  if updated_definition = definition then
    raise exception 'Could not update submit_payment_operation: result construction was not found';
  end if;

  execute updated_definition;
end;
$migration$;

notify pgrst, 'reload schema';
