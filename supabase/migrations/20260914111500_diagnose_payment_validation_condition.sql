-- The payload logged by the prior diagnostic is valid. Report each predicate
-- from the deployed RPC so the remaining database mismatch can be corrected
-- without guessing from a generic P0001 exception.

do $migration$
declare
  definition text;
begin
  select pg_get_functiondef('public.submit_payment_operation(uuid,text,jsonb,jsonb)'::regprocedure) into definition;
  if position('Invalid payment entry (payload=%)' in definition) = 0 then
    raise exception 'Could not update submit_payment_operation: diagnostic payment validation was not found';
  end if;
  execute replace(
    definition,
    '''Invalid payment entry (payload=%)'', row',
    '''Invalid payment entry (payload=%, object_type=%, invalid_amount=%, invalid_method=%, invalid_date=%, invalid_reference=%)'', row, jsonb_typeof(row), coalesce(row->>''amount_paise'','''') !~ ''^[0-9]+$'' or (row->>''amount_paise'')::numeric <= 0 or (row->>''amount_paise'')::numeric > 9007199254740991, coalesce(row->>''method'','''') not in (''cash'',''upi'',''card'',''bank_transfer''), coalesce(row->>''paid_on'','''') !~ ''^[0-9]{4}-[0-9]{2}-[0-9]{2}$'', length(coalesce(row->>''reference'','''')) > 200'
  );
end;
$migration$;

notify pgrst, 'reload schema';
