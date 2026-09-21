-- Pruebas de 20260919120000_oficios_varios_horas.sql. Correr DENTRO de:
--   begin; <la migración, si no está aplicada> <este archivo> rollback;
-- No deja nada. Usa una suerte real pequeña (VALPARAISO 1224-010, 5,22 ha, Pichichí).
create temp table r (n serial, caso text, esperado text, obtenido text);

do $$
declare v_id uuid; v_u text; v_msg text;
begin
  -- 1) 9,5 HORAS de oficios varios en una suerte de 5,22 ha: tiene que pasar.
  begin
    insert into asignaciones (suerte_codigo, numero_suerte, codigo_hacienda, nombre_hacienda, labor_nombre, tractor,
      area_asignada, area_realizada, estado, tipo_registro, operador_id, operador_nombre, supervisor_id,
      fecha_inicio, fecha_fin, horometro_inicial, horometro_final, administrador_encargado, aprobacion)
    values ('1224-010', '010', '1224', 'VALPARAISO  ', 'OFICIOS VARIOS', 'CASE 1302', 0, 9.5, 'COMPLETADA', 'ASIGNADA',
      'U058', 'PRUEBA', 'U005', now() - interval '10 hours', now(), 4000, 4009.5, 'DON PEDRO', 'PENDIENTE')
    returning id, unidad into v_id, v_u;
    insert into r (caso, esperado, obtenido) values ('9,5 h en una suerte de 5,22 ha', 'pasa, unidad h', 'pasa, unidad ' || coalesce(v_u, 'NULL'));
  exception when others then
    insert into r (caso, esperado, obtenido) values ('9,5 h en una suerte de 5,22 ha', 'pasa, unidad h', 'ERROR: ' || left(sqlerrm, 80));
  end;

  -- 2) Subirle las horas (UPDATE que aumenta): también pasa.
  begin
    update asignaciones set area_realizada = 14 where id = v_id;
    insert into r (caso, esperado, obtenido) values ('subir a 14 h', 'pasa', 'pasa');
  exception when others then
    insert into r (caso, esperado, obtenido) values ('subir a 14 h', 'pasa', 'ERROR: ' || left(sqlerrm, 80));
  end;

  -- 3) El ingenio y el administrador quedaron.
  insert into r (caso, esperado, obtenido)
  select 'ingenio y administrador encargado', 'pichichi / DON PEDRO', coalesce(ingenio_id, 'NULL') || ' / ' || coalesce(administrador_encargado, 'NULL')
    from asignaciones where id = v_id;

  -- 4) El tope SIGUE vivo para hectáreas: 9,5 ha de DESPEJE en 5,22 ha no pasa.
  begin
    insert into asignaciones (suerte_codigo, numero_suerte, codigo_hacienda, nombre_hacienda, labor_nombre, tractor,
      area_asignada, area_realizada, estado, tipo_registro, operador_id, operador_nombre, supervisor_id, fecha_fin, aprobacion)
    values ('1224-010', '010', '1224', 'VALPARAISO  ', 'DESPEJE', 'CASE 1302', 5.22, 9.5, 'COMPLETADA', 'ASIGNADA',
      'U058', 'PRUEBA', 'U005', now(), 'PENDIENTE');
    insert into r (caso, esperado, obtenido) values ('9,5 ha de DESPEJE en 5,22 ha', 'AREA_EXCEDIDA', 'LO DEJÓ PASAR');
  exception when others then
    insert into r (caso, esperado, obtenido) values ('9,5 ha de DESPEJE en 5,22 ha', 'AREA_EXCEDIDA', left(sqlerrm, 13));
  end;

  -- 4b) Un SUPERVISOR (U002) no puede programar oficios varios: lo rechaza la base.
  begin
    insert into asignaciones (suerte_codigo, numero_suerte, codigo_hacienda, nombre_hacienda, labor_nombre, tractor,
      area_asignada, estado, tipo_registro, operador_id, operador_nombre, supervisor_id, aprobacion)
    values ('1224-010', '010', '1224', 'VALPARAISO  ', 'OFICIOS VARIOS', 'CASE 1302', 0, 'PENDIENTE', 'ASIGNADA',
      'U058', 'PRUEBA', 'U002', 'APROBADA');
    insert into r (caso, esperado, obtenido) values ('un supervisor programa oficios varios', 'SOLO_ADMINISTRACION', 'LO DEJÓ PASAR');
  exception when others then
    insert into r (caso, esperado, obtenido) values ('un supervisor programa oficios varios', 'SOLO_ADMINISTRACION', left(sqlerrm, 19));
  end;
  -- 4c) ...y el mismo supervisor SÍ programa un DESPEJE normal.
  begin
    insert into asignaciones (suerte_codigo, numero_suerte, codigo_hacienda, nombre_hacienda, labor_nombre, tractor,
      area_asignada, estado, tipo_registro, operador_id, operador_nombre, supervisor_id, aprobacion)
    values ('1224-010', '010', '1224', 'VALPARAISO  ', 'DESPEJE', 'CASE 1302', 5.22, 'PENDIENTE', 'ASIGNADA',
      'U058', 'PRUEBA', 'U002', 'APROBADA');
    insert into r (caso, esperado, obtenido) values ('un supervisor programa un DESPEJE', 'pasa', 'pasa');
  exception when others then
    insert into r (caso, esperado, obtenido) values ('un supervisor programa un DESPEJE', 'pasa', 'ERROR: ' || left(sqlerrm, 60));
  end;

  -- 5) ACEQUIAS (hm) sigue exenta, y queda con su unidad.
  begin
    insert into asignaciones (suerte_codigo, numero_suerte, codigo_hacienda, nombre_hacienda, labor_nombre, tractor,
      area_asignada, area_realizada, estado, tipo_registro, operador_id, operador_nombre, supervisor_id, fecha_fin, aprobacion)
    values ('1224-010', '010', '1224', 'VALPARAISO  ', 'ACEQUIAS', 'CASE 1302', 5.22, 12, 'COMPLETADA', 'ASIGNADA',
      'U058', 'PRUEBA', 'U005', now(), 'PENDIENTE') returning unidad into v_u;
    insert into r (caso, esperado, obtenido) values ('12 hm de ACEQUIAS en 5,22 ha', 'pasa, unidad hm', 'pasa, unidad ' || coalesce(v_u, 'NULL'));
  exception when others then
    insert into r (caso, esperado, obtenido) values ('12 hm de ACEQUIAS en 5,22 ha', 'pasa, unidad hm', 'ERROR: ' || left(sqlerrm, 80));
  end;
end $$;

insert into r (caso, esperado, obtenido)
select 'catálogo: OFICIOS VARIOS', 'h / solo administración / activa',
       unidad || ' / ' || case when solo_administracion then 'solo administración' else 'abierta' end || ' / ' || case when activa then 'activa' else 'inactiva' end
  from labores_catalogo where nombre = 'OFICIOS VARIOS';
insert into r (caso, esperado, obtenido)
select 'las demás labores siguen abiertas al supervisor', '0 con solo_administracion', count(*)::text
  from labores_catalogo where solo_administracion and nombre <> 'OFICIOS VARIOS';
insert into r (caso, esperado, obtenido)
select 'lo viejo NO se rellenó', 'todas las anteriores con unidad NULL', count(*) filter (where unidad is not null)::text || ' con unidad'
  from asignaciones where created_at < now() - interval '1 minute';
insert into r (caso, esperado, obtenido)
select 'el celular puede leer y escribir las columnas nuevas', 'sí / sí',
  case when has_column_privilege('anon', 'public.asignaciones', 'administrador_encargado', 'SELECT') then 'sí' else 'NO' end || ' / ' ||
  case when has_column_privilege('anon', 'public.asignaciones', 'administrador_encargado', 'UPDATE') then 'sí' else 'NO' end;

select n, caso, esperado, obtenido from r order by n;
