-- Activation, enrollment, and renewal may set an agreed payment follow-up date.
-- Keep the seven-day default for older callers that do not send due_on.
do $migration$
declare
  definition text;
  updated_definition text;
begin
  select pg_get_functiondef('public.submit_payment_operation(uuid,text,jsonb,jsonb)'::regprocedure)
  into definition;

  updated_definition := replace(
    definition,
    'due_date := start_date + 7;',
    $replacement$due_date := coalesce(nullif(p_details->>'due_on','')::date, start_date + 7);$replacement$
  );
  if updated_definition = definition then
    raise exception 'Could not update submit_payment_operation: seven-day due-date default was not found';
  end if;

  definition := updated_definition;
  updated_definition := replace(
    definition,
    $needle$    if start_date is null or end_date < start_date then raise exception 'End date must be on or after the membership start date' using hint='expires_on'; end if;$needle$,
    $replacement$    if due_date < start_date then raise exception 'Payment follow-up date cannot be before the membership start date' using hint='due_on'; end if;
    if start_date is null or end_date < start_date then raise exception 'End date must be on or after the membership start date' using hint='expires_on'; end if;$replacement$
  );
  if updated_definition = definition then
    raise exception 'Could not update submit_payment_operation: membership date validation was not found';
  end if;

  execute updated_definition;
end;
$migration$;

notify pgrst, 'reload schema';
