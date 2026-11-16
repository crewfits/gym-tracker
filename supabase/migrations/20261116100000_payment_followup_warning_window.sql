-- The QR access migration was already applied with the temporary access mode.
-- Keep that migration immutable and update its function in a forward migration.
do $migration$
declare
  definition text;
  updated_definition text;
begin
  select pg_get_functiondef(
    'public.process_qr_access(uuid, integer, uuid, public.attendance_direction, boolean)'::regprocedure
  ) into definition;

  updated_definition := replace(
    definition,
    $needle$      v_access_mode := 'temporary';$needle$,
    $replacement$      if v_due_on <= v_today + 7 then v_access_mode := 'payment_due_soon'; end if;$replacement$
  );

  if updated_definition = definition then
    raise exception 'Could not update process_qr_access: temporary access mode was not found';
  end if;

  execute updated_definition;
end;
$migration$;

notify pgrst, 'reload schema';
