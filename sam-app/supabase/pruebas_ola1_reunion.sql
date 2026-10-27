-- Pruebas de la migración 20261027100000_ola1_reunion_asm. Correr DESPUÉS de aplicarla; todo en begin..rollback.
begin;

do $$
declare
  v_admin text; v_op text; v_doc uuid; v_doc2 uuid; v_asig uuid; n int; r numeric; v_e1 text; v_e2 text;
  falla boolean;
begin
  select id into v_admin from public.app_usuarios where rol::text = 'administracion' and activo limit 1;
  select id into v_op from public.app_usuarios where rol::text = 'operador' and activo limit 1;
  if v_admin is null or v_op is null then raise exception 'FALLA: la prueba necesita un usuario administracion y un operador activos'; end if;

  -- columnas nuevas, nulas y sin default
  select count(*) into n from information_schema.columns where table_schema = 'public' and is_nullable = 'YES' and column_default is null
     and ((table_name = 'combustible_externo' and column_name = 'tanque_lleno')
       or (table_name = 'insumos_solicitudes' and column_name = 'tanque_lleno')
       or (table_name = 'equipos' and column_name = 'orden'));
  if n <> 3 then raise exception 'FALLA: faltan columnas tanque_lleno / orden (hay %)', n; end if;

  -- documentos de prueba
  insert into public.fact_documentos (tipo, numero, fecha, razon_social, cliente, valor, creado_por)
    values ('FACTURA', 'ZZ-OLA1-1', current_date, 'AGROMORALES', 'ZZ CLIENTE', 3000000, v_admin) returning id into v_doc;
  insert into public.fact_documentos (tipo, numero, fecha, razon_social, cliente, valor, creado_por)
    values ('FACTURA', 'ZZ-OLA1-2', current_date, 'AGROMORALES', 'ZZ CLIENTE', 1000000, v_admin) returning id into v_doc2;

  -- valor: administración sí, operador no, negativo no
  r := public.fact_documento_valor(v_doc, 35000000, v_admin);
  if r <> 35000000 or (select valor from public.fact_documentos where id = v_doc) <> 35000000 then raise exception 'FALLA: no actualizó el valor'; end if;
  falla := false; begin perform public.fact_documento_valor(v_doc, 1, v_op); exception when insufficient_privilege then falla := true; end;
  if not falla then raise exception 'FALLA: un operador no debe cambiar el valor'; end if;
  falla := false; begin perform public.fact_documento_valor(v_doc, -5, v_admin); exception when check_violation then falla := true; end;
  if not falla then raise exception 'FALLA: no debe aceptar un valor negativo'; end if;

  -- anular: un operador no puede
  falla := false; begin perform public.fact_documento_anular(v_doc2, 'x', v_op); exception when insufficient_privilege then falla := true; end;
  if not falla then raise exception 'FALLA: un operador no debe eliminar documentos'; end if;

  -- anular con una línea pegada: se rechaza
  select id into v_asig from public.asignaciones where estado in ('COMPLETADA', 'PARCIAL') and factura_id is null limit 1;
  if v_asig is not null then
    update public.asignaciones set factura_id = v_doc2 where id = v_asig;
    falla := false; begin perform public.fact_documento_anular(v_doc2, 'x', v_admin); exception when check_violation then falla := true; end;
    if not falla then raise exception 'FALLA: no debe anular un documento con líneas pegadas'; end if;
    update public.asignaciones set factura_id = null where id = v_asig;
  else
    raise notice 'AVISO: no hay una labor realizada para probar el bloqueo por líneas';
  end if;

  -- anular sin líneas: funciona, deja rastro, libera el número y es idempotente
  perform public.fact_documento_anular(v_doc2, 'Duplicada', v_admin);
  if not (select anulado and anulado_por = v_admin and anulado_motivo = 'Duplicada' from public.fact_documentos where id = v_doc2) then raise exception 'FALLA: no dejó el rastro de la anulación'; end if;
  perform public.fact_documento_anular(v_doc2, 'otra vez', v_admin);
  if (select anulado_motivo from public.fact_documentos where id = v_doc2) <> 'Duplicada' then raise exception 'FALLA: anular dos veces no debe pisar el motivo'; end if;
  insert into public.fact_documentos (tipo, numero, fecha, razon_social, cliente, valor, creado_por)
    values ('FACTURA', 'ZZ-OLA1-2', current_date, 'AGROMORALES', 'ZZ CLIENTE', 5, v_admin);   -- el número ya se puede reusar
  falla := false; begin perform public.fact_documento_valor(v_doc2, 10, v_admin); exception when check_violation then falla := true; end;
  if not falla then raise exception 'FALLA: no debe cambiar el valor de un documento anulado'; end if;

  -- orden de máquinas
  select codigo into v_e1 from public.equipos order by codigo limit 1;
  select codigo into v_e2 from public.equipos order by codigo desc limit 1;
  if v_e1 is not null and v_e2 is not null and v_e1 <> v_e2 then
    n := public.equipos_guardar_orden(array[v_e2, v_e1], v_admin);
    if n <> 2 then raise exception 'FALLA: debía ordenar 2 máquinas y ordenó %', n; end if;
    if (select orden from public.equipos where codigo = v_e2) <> 1 or (select orden from public.equipos where codigo = v_e1) <> 2 then raise exception 'FALLA: la posición no es el lugar en el arreglo'; end if;
    falla := false; begin perform public.equipos_guardar_orden(array[v_e1], v_op); exception when insufficient_privilege then falla := true; end;
    if not falla then raise exception 'FALLA: un operador no debe ordenar las máquinas'; end if;
  end if;

  raise notice 'OK: pruebas de la Ola 1 de la reunión';
end $$;

rollback;
