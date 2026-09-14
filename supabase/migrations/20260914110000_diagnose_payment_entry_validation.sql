-- Include the rejected payment payload in the generic validation message.
-- The deployed function may have formatting that differs from the repository,
-- so update only the stable error literal rather than rewriting its full body.

do $migration$
declare
  definition text;
begin
  select pg_get_functiondef('public.submit_payment_operation(uuid,text,jsonb,jsonb)'::regprocedure) into definition;
  if position('Invalid payment entry' in definition) = 0 then
    raise exception 'Could not update submit_payment_operation: payment validation was not found';
  end if;
  execute replace(
    definition,
    '''Invalid payment entry''',
    '''Invalid payment entry (payload=%)'', row'
  );
end;
$migration$;

notify pgrst, 'reload schema';
