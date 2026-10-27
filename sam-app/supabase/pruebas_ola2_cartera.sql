-- Pruebas de la migración 20261027140000_ola2_cartera_contable. Correr DESPUÉS de aplicarla; todo en begin..rollback.
begin;

do $$
declare
  v_admin text; v_op text; v_c1 uuid; v_c2 uuid; v_f uuid; v_f2 uuid; v_sop uuid; v_d uuid; n int; r numeric; falla boolean;
  v_row record; v_e text;
begin
  select id into v_admin from public.app_usuarios where rol::text = 'administracion' and activo limit 1;
  select id into v_op from public.app_usuarios where rol::text = 'operador' and activo limit 1;
  if v_admin is null or v_op is null then raise exception 'FALLA: la prueba necesita un usuario administracion y un operador activos'; end if;

  -- La vista conserva sus 25 columnas de antes y suma 7 al final (la PWA vieja sigue leyéndola)
  select count(*) into n from information_schema.columns where table_schema = 'public' and table_name = 'cartera_facturas_v';
  if n <> 32 then raise exception 'FALLA: la vista debía quedar con 32 columnas y tiene %', n; end if;
  select column_name into v_e from information_schema.columns where table_schema = 'public' and table_name = 'cartera_facturas_v' and ordinal_position = 25;
  if v_e <> 'anticipo' then raise exception 'FALLA: la columna 25 de la vista debe seguir siendo anticipo (es %)', v_e; end if;
  select column_name into v_e from information_schema.columns where table_schema = 'public' and table_name = 'cartera_facturas_v' and ordinal_position = 26;
  if v_e <> 'deducido' then raise exception 'FALLA: la columna 26 debe ser deducido (es %)', v_e; end if;

  -- Conceptos sembrados, SIN porcentajes
  select count(*) into n from public.fact_deduccion_conceptos where codigo in ('RETEFUENTE','RETEICA','ICA','FONDO_GARANTIA','TIMBRE','DESCUENTO','OTRO');
  if n <> 7 then raise exception 'FALLA: faltan conceptos de deducción (hay %)', n; end if;
  if exists (select 1 from public.fact_cliente_reglas where cliente_id in (select id from public.fact_clientes where nombre like 'ZZ%')) then
    raise exception 'FALLA: no debe haber reglas sembradas';
  end if;

  -- ── Catálogo de clientes ──
  v_c1 := public.fact_cliente_guardar(null, ' zz ingenio prueba ', 'INGENIO', ' 900123 ', true, v_admin);
  if (select nombre from public.fact_clientes where id = v_c1) <> 'ZZ INGENIO PRUEBA' then raise exception 'FALLA: el nombre debe guardarse en MAYÚSCULA y sin espacios sobrantes'; end if;
  falla := false; begin perform public.fact_cliente_guardar(null, 'zz Ingenio PRUEBA', 'INGENIO', null, true, v_admin); exception when unique_violation then falla := true; end;
  if not falla then raise exception 'FALLA: no debe repetirse un cliente aunque cambien mayúsculas'; end if;
  falla := false; begin perform public.fact_cliente_guardar(null, 'ZZ OTRO', 'INGENIO', null, true, v_op); exception when insufficient_privilege then falla := true; end;
  if not falla then raise exception 'FALLA: un operador no debe editar el catálogo de clientes'; end if;
  falla := false; begin perform public.fact_cliente_guardar(null, 'ZZ MALO', 'RARO', null, true, v_admin); exception when check_violation then falla := true; end;
  if not falla then raise exception 'FALLA: no debe aceptar un tipo de cliente inventado'; end if;
  v_c2 := public.fact_cliente_guardar(null, 'ZZ PROVEEDOR PRUEBA', 'PROVEEDOR', null, true, v_admin);
  perform public.fact_cliente_guardar(v_c2, 'ZZ PROVEEDOR PRUEBA 2', null, null, null, v_admin);
  if (select nombre || tipo from public.fact_clientes where id = v_c2) <> 'ZZ PROVEEDOR PRUEBA 2PROVEEDOR' then raise exception 'FALLA: editar debe conservar el tipo si no llega uno nuevo'; end if;

  -- ── Reglas por cliente ──
  n := public.fact_cliente_reglas_guardar(v_c1, '[{"concepto":"retefuente","porcentaje":4},{"concepto":"RETEICA","porcentaje":0.5}]'::jsonb, v_admin);
  if n <> 2 or (select count(*) from public.fact_cliente_reglas where cliente_id = v_c1) <> 2 then raise exception 'FALLA: debían quedar 2 reglas'; end if;
  falla := false; begin perform public.fact_cliente_reglas_guardar(v_c1, '[{"concepto":"DESCUENTO","porcentaje":4}]'::jsonb, v_admin); exception when check_violation then falla := true; end;
  if not falla then raise exception 'FALLA: una regla solo puede ser de un concepto por porcentaje'; end if;
  falla := false; begin perform public.fact_cliente_reglas_guardar(v_c1, '[{"concepto":"RETEFUENTE","porcentaje":0}]'::jsonb, v_admin); exception when check_violation then falla := true; end;
  if not falla then raise exception 'FALLA: el porcentaje cero no es válido'; end if;
  if (select count(*) from public.fact_cliente_reglas where cliente_id = v_c1) <> 2 then raise exception 'FALLA: un intento inválido no debe borrar las reglas que ya había'; end if;
  falla := false; begin perform public.fact_cliente_reglas_guardar(v_c1, '[]'::jsonb, v_op); exception when insufficient_privilege then falla := true; end;
  if not falla then raise exception 'FALLA: un operador no debe fijar reglas'; end if;
  perform public.fact_cliente_reglas_guardar(v_c1, '[{"concepto":"RETEFUENTE","porcentaje":3.5}]'::jsonb, v_admin);
  if (select count(*) from public.fact_cliente_reglas where cliente_id = v_c1) <> 1 or (select porcentaje from public.fact_cliente_reglas where cliente_id = v_c1) <> 3.5 then
    raise exception 'FALLA: guardar reglas debe REEMPLAZAR el conjunto';
  end if;

  -- ── Factura de prueba, a quién se facturó y quién paga ──
  insert into public.fact_documentos (tipo, numero, fecha, razon_social, cliente, valor, creado_por)
    values ('FACTURA', 'ZZ-OLA2-1', current_date, 'AGROMORALES', 'Proveedor', 10000000, v_admin) returning id into v_f;
  insert into public.fact_documentos (tipo, numero, fecha, razon_social, cliente, valor, creado_por)
    values ('FACTURA', 'ZZ-OLA2-2', current_date, 'AGROMORALES', 'Proveedor', null, v_admin) returning id into v_f2;
  insert into public.fact_documentos (tipo, numero, fecha, clase, cliente, creado_por)
    values ('SOPORTE', 'ZZ-OLA2-S', current_date, 'Soporte', 'Proveedor', v_admin) returning id into v_sop;
  perform public.fact_factura_clientes(v_f, v_c2, v_c1, v_admin);
  select * into v_row from public.cartera_facturas_v where id = v_f;
  if v_row.facturado_a <> 'ZZ PROVEEDOR PRUEBA 2' or v_row.pagador <> 'ZZ INGENIO PRUEBA' then raise exception 'FALLA: la cartera debe mostrar a quién se facturó y quién paga'; end if;
  falla := false; begin perform public.fact_factura_clientes(v_f, v_c2, v_c1, v_op); exception when insufficient_privilege then falla := true; end;
  if not falla then raise exception 'FALLA: un operador no debe cambiar cliente ni pagador'; end if;
  falla := false; begin perform public.fact_factura_clientes(v_f, gen_random_uuid(), null, v_admin); exception when check_violation then falla := true; end;
  if not falla then raise exception 'FALLA: no debe aceptar un cliente que no está en el catálogo'; end if;
  falla := false; begin perform public.fact_factura_clientes(v_sop, v_c2, null, v_admin); exception when check_violation then falla := true; end;
  if not falla then raise exception 'FALLA: un soporte no lleva cliente ni pagador'; end if;
  perform public.fact_factura_clientes(v_f, v_c2, null, v_admin);   -- sin pagador: queda NULL
  if (select pagador_id from public.cartera_facturas_v where id = v_f) is not null then raise exception 'FALLA: el pagador debía quedar vacío'; end if;
  perform public.fact_factura_clientes(v_f, v_c2, v_c1, v_admin);

  -- ── Deducciones ──
  r := public.fact_deducciones_guardar(v_f, '[{"concepto":"RETEFUENTE","porcentaje":4}]'::jsonb, null, v_admin);
  if r <> 400000 then raise exception 'FALLA: el 4 %% de 10.000.000 son 400.000 y dio %', r; end if;
  select * into v_row from public.cartera_facturas_v where id = v_f;
  if v_row.deducido <> 400000 or v_row.saldo <> 9600000 or v_row.pagado <> 0 or v_row.estado = 'PAGADA' then
    raise exception 'FALLA: tras la retención el saldo debe ser 9.600.000 y NO está pagada (deducido %, saldo %, estado %)', v_row.deducido, v_row.saldo, v_row.estado;
  end if;
  falla := false; begin perform public.fact_deducciones_guardar(v_f, '[{"concepto":"RETEFUENTE","porcentaje":4}]'::jsonb, null, v_admin); exception when unique_violation then falla := true; end;
  if not falla then raise exception 'FALLA: la misma retención no debe aplicarse dos veces a la factura'; end if;
  falla := false; begin perform public.fact_deducciones_guardar(v_f, '[{"concepto":"RETEICA","porcentaje":0.5}]'::jsonb, null, v_op); exception when insufficient_privilege then falla := true; end;
  if not falla then raise exception 'FALLA: un operador no debe aplicar deducciones'; end if;
  falla := false; begin perform public.fact_deducciones_guardar(v_f, '[{"concepto":"RETEICA","porcentaje":101}]'::jsonb, null, v_admin); exception when check_violation then falla := true; end;
  if not falla then raise exception 'FALLA: un porcentaje de 101 no es válido'; end if;
  falla := false; begin perform public.fact_deducciones_guardar(v_f, '[{"concepto":"DESCUENTO"}]'::jsonb, null, v_admin); exception when check_violation then falla := true; end;
  if not falla then raise exception 'FALLA: un descuento sin valor no es válido'; end if;
  falla := false; begin perform public.fact_deducciones_guardar(v_f, '[{"concepto":"INVENTADO","valor":5}]'::jsonb, null, v_admin); exception when check_violation then falla := true; end;
  if not falla then raise exception 'FALLA: no debe aceptar un concepto que no existe'; end if;
  falla := false; begin perform public.fact_deducciones_guardar(v_f2, '[{"concepto":"RETEFUENTE","porcentaje":4}]'::jsonb, null, v_admin); exception when check_violation then falla := true; end;
  if not falla then raise exception 'FALLA: una factura sin valor no admite deducciones'; end if;
  falla := false; begin perform public.fact_deducciones_guardar(v_sop, '[{"concepto":"DESCUENTO","valor":5}]'::jsonb, null, v_admin); exception when check_violation then falla := true; end;
  if not falla then raise exception 'FALLA: las deducciones van contra una factura, no un soporte'; end if;

  -- «Otro» y «Descuento» se pueden repetir; el valor manual manda sobre el calculado
  perform public.fact_deducciones_guardar(v_f, '[{"concepto":"DESCUENTO","valor":100000,"nota":"ajuste"},{"concepto":"OTRO","valor":50000}]'::jsonb, null, v_admin);
  perform public.fact_deducciones_guardar(v_f, '[{"concepto":"DESCUENTO","valor":25000}]'::jsonb, null, v_admin);
  select * into v_row from public.cartera_facturas_v where id = v_f;
  if v_row.deducido <> 575000 or v_row.n_deducciones <> 4 then raise exception 'FALLA: debían sumar 575.000 en 4 deducciones (% en %)', v_row.deducido, v_row.n_deducciones; end if;

  -- No deja pasar del valor, y un intento fallido no deja nada a medias
  falla := false; begin perform public.fact_deducciones_guardar(v_f, '[{"concepto":"OTRO","valor":99999999}]'::jsonb, null, v_admin); exception when check_violation then falla := true; end;
  if not falla then raise exception 'FALLA: lo deducido no puede pasar del valor de la factura'; end if;
  if (select deducido from public.cartera_facturas_v where id = v_f) <> 575000 then raise exception 'FALLA: el intento que excedía el valor dejó una deducción guardada'; end if;

  -- Anular una deducción: exige motivo, devuelve el saldo, no se anula dos veces
  select id into v_d from public.fact_deducciones where factura_id = v_f and concepto = 'OTRO' and not anulado;
  falla := false; begin perform public.fact_deduccion_anular(v_d, '   ', v_admin); exception when check_violation then falla := true; end;
  if not falla then raise exception 'FALLA: anular una deducción exige motivo'; end if;
  falla := false; begin perform public.fact_deduccion_anular(v_d, 'x', v_op); exception when insufficient_privilege then falla := true; end;
  if not falla then raise exception 'FALLA: un operador no debe anular deducciones'; end if;
  perform public.fact_deduccion_anular(v_d, 'Se aplicó por error', v_admin);
  perform public.fact_deduccion_anular(v_d, 'otra vez', v_admin);
  if (select anulado_motivo from public.fact_deducciones where id = v_d) <> 'Se aplicó por error' then raise exception 'FALLA: anular dos veces no debe pisar el motivo'; end if;
  if (select deducido from public.cartera_facturas_v where id = v_f) <> 525000 then raise exception 'FALLA: la deducción anulada debe dejar de contar'; end if;

  -- Una eliminación de documento se frena mientras haya deducciones vivas
  falla := false; begin perform public.fact_documento_anular(v_f, 'x', v_admin); exception when check_violation then falla := true; end;
  if not falla then raise exception 'FALLA: no debe eliminar una factura con deducciones'; end if;

  -- Pagos + deducciones cruzan el saldo: queda PAGADA y los días se congelan
  insert into public.fact_pagos (factura_id, fecha, valor, creado_por) values (v_f, current_date, 9475000, v_admin);
  select * into v_row from public.cartera_facturas_v where id = v_f;
  if v_row.saldo <> 0 or v_row.estado <> 'PAGADA' or v_row.pagado <> 9475000 then
    raise exception 'FALLA: pagado 9.475.000 + deducido 525.000 cubren los 10.000.000 (saldo %, estado %, pagado %)', v_row.saldo, v_row.estado, v_row.pagado;
  end if;
  falla := false; begin perform public.fact_deducciones_guardar(v_f, '[{"concepto":"OTRO","valor":1000}]'::jsonb, null, v_admin); exception when check_violation then falla := true; end;
  if not falla then raise exception 'FALLA: una factura ya cubierta no admite más deducciones'; end if;

  -- ── Observaciones ──
  falla := false; begin perform public.fact_observacion_agregar(v_f, 'x', v_op); exception when insufficient_privilege then falla := true; end;
  if not falla then raise exception 'FALLA: un operador no debe anotar observaciones de cartera'; end if;
  falla := false; begin perform public.fact_observacion_agregar(v_f, '   ', v_admin); exception when check_violation then falla := true; end;
  if not falla then raise exception 'FALLA: una observación vacía no es válida'; end if;
  perform public.fact_observacion_agregar(v_f, ' Viviana confirmó con el ingenio ', v_admin);
  if (select n_observaciones from public.cartera_facturas_v where id = v_f) <> 1 or (select texto from public.fact_observaciones where factura_id = v_f) <> 'Viviana confirmó con el ingenio' then
    raise exception 'FALLA: la observación debe guardarse sin espacios sobrantes y contarse en la cartera';
  end if;
  falla := false; begin perform public.fact_observacion_agregar(v_sop, 'a un soporte', v_admin); exception when no_data_found then falla := true; end;
  if not falla then raise exception 'FALLA: las observaciones de cartera van contra una factura'; end if;

  -- ── La app NO puede escribir directo en las tablas nuevas ──
  set local role anon;
  falla := false; begin insert into public.fact_deducciones (factura_id, concepto, valor, fecha, creado_por) values (v_f, 'OTRO', 1, current_date, 'x'); exception when insufficient_privilege then falla := true; end;
  if not falla then reset role; raise exception 'FALLA: anon no debe poder insertar deducciones directo'; end if;
  falla := false; begin insert into public.fact_clientes (nombre) values ('ZZ DIRECTO'); exception when insufficient_privilege then falla := true; end;
  if not falla then reset role; raise exception 'FALLA: anon no debe poder insertar clientes directo'; end if;
  falla := false; begin insert into public.fact_observaciones (factura_id, texto, creado_por) values (v_f, 'directo', 'x'); exception when insufficient_privilege then falla := true; end;
  if not falla then reset role; raise exception 'FALLA: anon no debe poder insertar observaciones directo'; end if;
  falla := false; begin delete from public.fact_cliente_reglas; exception when insufficient_privilege then falla := true; end;
  if not falla then reset role; raise exception 'FALLA: anon no debe poder borrar reglas directo'; end if;
  perform count(*) from public.cartera_facturas_v;   -- pero sí leer la cartera
  reset role;

  raise notice 'OK: pruebas de la Ola 2 (cartera contable)';
end $$;

rollback;
