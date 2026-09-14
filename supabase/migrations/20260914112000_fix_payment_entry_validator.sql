-- The live RPC evaluated its combined payment predicate as true even when
-- every individual predicate was false. Validate each field sequentially in a
-- helper and replace the fragile combined branch in the existing RPC.

create or replace function public.validate_payment_entry(p_payment jsonb)
returns void language plpgsql security definer set search_path = public
as $$
declare
  amount_value text;
  method_value text;
  paid_on_value text;
  reference_value text;
begin
  if jsonb_typeof(p_payment) <> 'object' then
    raise exception 'Invalid payment entry: each payment must be an object';
  end if;

  amount_value := p_payment->>'amount_paise';
  if amount_value is null or amount_value !~ '^[0-9]+$' then
    raise exception 'Invalid payment amount';
  end if;
  if amount_value::numeric <= 0 or amount_value::numeric > 9007199254740991 then
    raise exception 'Invalid payment amount';
  end if;

  method_value := p_payment->>'method';
  if method_value is null or method_value not in ('cash', 'upi', 'card', 'bank_transfer') then
    raise exception 'Invalid payment method';
  end if;

  paid_on_value := p_payment->>'paid_on';
  if paid_on_value is null or paid_on_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception 'Invalid payment date';
  end if;
  perform paid_on_value::date;

  reference_value := p_payment->>'reference';
  if length(coalesce(reference_value, '')) > 200 then
    raise exception 'Payment reference is longer than 200 characters';
  end if;
end;
$$;

revoke all on function public.validate_payment_entry(jsonb) from public, anon;

do $migration$
declare
  definition text;
  updated_definition text;
begin
  select pg_get_functiondef('public.submit_payment_operation(uuid,text,jsonb,jsonb)'::regprocedure) into definition;
  updated_definition := regexp_replace(
    definition,
    $pattern$if jsonb_typeof\(row\) <> 'object' or.*?end if;$pattern$,
    'perform public.validate_payment_entry(row);',
    's'
  );
  if updated_definition = definition then
    raise exception 'Could not update submit_payment_operation: combined payment validation was not found';
  end if;
  execute updated_definition;
end;
$migration$;

notify pgrst, 'reload schema';
