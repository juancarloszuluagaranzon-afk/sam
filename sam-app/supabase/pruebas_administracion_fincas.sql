-- Pruebas del módulo de administración de fincas (20260922120000).
-- Correr DESPUÉS de la migración, dentro de begin … rollback: no deja nada.
-- Desde 20260922150000 las funciones con usuario son INTERNAS (af__*): estas pruebas
-- prueban su lógica; las llaves se prueban en pruebas_acceso_dueno.sql.
-- Actores reales: U005 (administración), U002 y U033 (supervisores), U009 (operador).

create temp table r (n serial, caso text, esperado text, obtenido text);
create temp table ids (k text primary key, v uuid);

create or replace function pg_temp.prueba(p_caso text, p_esperado text, p_sql text) returns void
language plpgsql as $$
declare v text;
begin
  -- Cada caso arranca como la app: sin la marca de «viene de una función».
  perform set_config('af.via_funcion', '', true);
  begin
    execute p_sql into v;
    insert into r (caso, esperado, obtenido) values (p_caso, p_esperado, coalesce('ok ' || v, 'ok'));
  exception when others then
    insert into r (caso, esperado, obtenido) values (p_caso, p_esperado, split_part(sqlerrm, ':', 1));
  end;
end $$;

-- Fincas y suertes
select pg_temp.prueba('supervisor crea finca', 'SIN_PERMISO',
  $q$insert into af_fincas (nombre, dueno_nombre, editado_por) values ('X', 'Y', 'U002') returning id::text$q$);
insert into af_fincas (nombre, dueno_nombre, dueno_telefono, editado_por) values ('PRUEBA LA CEIBA', 'DUEÑO PRUEBA', '3000000000', 'U005');
insert into ids select 'finca', id from af_fincas where nombre = 'PRUEBA LA CEIBA';
insert into af_suertes (finca_id, codigo, area_ha, editado_por) select v, '12', 10, 'U005' from ids where k = 'finca';
insert into ids select 'suerte', id from af_suertes where codigo = '12' and finca_id = (select v from ids where k = 'finca');
select pg_temp.prueba('suerte con área 0', 'new row for relation "af_suertes" violates check constraint "af_suertes_area_ha_check"',
  $q$insert into af_suertes (finca_id, codigo, area_ha, editado_por) select v, '13', 0, 'U005' from ids where k = 'finca' returning id::text$q$);

-- Paquete: costos
select pg_temp.prueba('supervisor cambia costo del paquete', 'SIN_PERMISO',
  $q$update af_paquete set costo_unitario = 1, editado_por = 'U002' where labor = 'ROTURACIÓN' returning id::text$q$);
select pg_temp.prueba('admin pone costo a roturación', 'ok',
  $q$update af_paquete set costo_unitario = 100000, editado_por = 'U005' where labor = 'ROTURACIÓN' returning labor$q$);

-- Ciclo
select pg_temp.prueba('supervisor abre ciclo', 'SIN_PERMISO',
  $q$select af__abrir_ciclo((select v from ids where k = 'suerte'), '2026-09-01', 'SOCA', 'U002')::text$q$);
select pg_temp.prueba('ciclo con corte futuro', 'FECHA_FUTURA',
  $q$select af__abrir_ciclo((select v from ids where k = 'suerte'), '2030-01-01', 'SOCA', 'U005')::text$q$);
insert into ids select 'ciclo', af__abrir_ciclo((select v from ids where k = 'suerte'), '2026-09-01', 'SOCA', 'U005');
insert into r (caso, esperado, obtenido)
  select 'ciclo soca carga 4 labores (sin la fert. de plantilla)', '4', count(*)::text from af_labores where ciclo_id = (select v from ids where k = 'ciclo');
insert into ids select 'rot', id from af_labores where ciclo_id = (select v from ids where k = 'ciclo') and labor = 'ROTURACIÓN';
insert into ids select 'fert', id from af_labores where ciclo_id = (select v from ids where k = 'ciclo') and labor = 'FERTILIZACIÓN';
insert into r (caso, esperado, obtenido)
  select 'roturación planeada = área × 1 a $100.000', '10.00 · 100000', cantidad_plan::text || ' · ' || costo_unitario_plan::text from af_labores where id = (select v from ids where k = 'rot');

-- Reportes
insert into ids values ('rep1', gen_random_uuid()), ('rep2', gen_random_uuid()), ('rep3', gen_random_uuid());
select pg_temp.prueba('operador reporta', 'SIN_PERMISO',
  $q$select af__reportar(gen_random_uuid(), (select v from ids where k = 'rot'), 1, '2026-09-10', 'foto', null, null, null, null, 'U009')::text$q$);
select pg_temp.prueba('reporte sin foto', 'SIN_FOTO',
  $q$select af__reportar(gen_random_uuid(), (select v from ids where k = 'rot'), 1, '2026-09-10', '  ', null, null, null, null, 'U002')::text$q$);
select pg_temp.prueba('reporte antes del corte', 'FECHA_ANTES_DEL_CORTE',
  $q$select af__reportar(gen_random_uuid(), (select v from ids where k = 'rot'), 1, '2026-08-20', 'foto', null, null, null, null, 'U002')::text$q$);
select pg_temp.prueba('supervisor A reporta 6 ha', 'ok',
  $q$select 'x' from (select af__reportar((select v from ids where k = 'rep1'), (select v from ids where k = 'rot'), 6, '2026-09-10', 'https://x/foto.jpg', 3.9, -76.3, 8, 'prueba', 'U002')) s$q$);
select pg_temp.prueba('reintento del mismo reporte no duplica', 'ok 1',
  $q$select count(*)::text from (select af__reportar((select v from ids where k = 'rep1'), (select v from ids where k = 'rot'), 6, '2026-09-10', 'https://x/foto.jpg', null, null, null, null, 'U002')) s, af_reportes where labor_id = (select v from ids where k = 'rot')$q$);
insert into r (caso, esperado, obtenido) select 'la labor pasa a EN_CURSO al reportar', 'EN_CURSO', estado from af_labores where id = (select v from ids where k = 'rot');
select pg_temp.prueba('reporte que pasa el área (6+5 > 10)', 'SUPERA_AREA',
  $q$select af__reportar(gen_random_uuid(), (select v from ids where k = 'rot'), 5, '2026-09-11', 'foto', null, null, null, null, 'U002')::text$q$);

-- Aceptar
select pg_temp.prueba('supervisor A acepta lo suyo', 'NO_PROPIO',
  $q$select af__revisar((select v from ids where k = 'rep1'), true, null, 'U002')$q$);
select pg_temp.prueba('supervisor B acepta', 'ok ACEPTADO',
  $q$select af__revisar((select v from ids where k = 'rep1'), true, null, 'U033')$q$);
insert into r (caso, esperado, obtenido)
  select 'aceptar crea el gasto con la foto de soporte', 'GASTO 600000.00 https://x/foto.jpg', tipo || ' ' || valor::text || ' ' || soporte_url
    from af_movimientos where reporte_id = (select v from ids where k = 'rep1');
select pg_temp.prueba('aceptar dos veces', 'YA_REVISADO',
  $q$select af__revisar((select v from ids where k = 'rep1'), true, null, 'U005')$q$);
select pg_temp.prueba('supervisor A reporta 4 ha más', 'ok',
  $q$select 'x' from (select af__reportar((select v from ids where k = 'rep2'), (select v from ids where k = 'rot'), 4, '2026-09-12', 'https://x/foto2.jpg', null, null, null, null, 'U002')) s$q$);
select pg_temp.prueba('rechazar sin motivo', 'MOTIVO',
  $q$select af__revisar((select v from ids where k = 'rep2'), false, ' ', 'U005')$q$);
select pg_temp.prueba('admin acepta las 4 ha', 'ok ACEPTADO',
  $q$select af__revisar((select v from ids where k = 'rep2'), true, null, 'U005')$q$);
insert into r (caso, esperado, obtenido) select 'con 10 de 10 ha la labor queda TERMINADA', 'TERMINADA', estado from af_labores where id = (select v from ids where k = 'rot');
select pg_temp.prueba('reportar en una labor terminada', 'LABOR_CERRADA',
  $q$select af__reportar(gen_random_uuid(), (select v from ids where k = 'rot'), 0.1, '2026-09-12', 'foto', null, null, null, null, 'U002')::text$q$);
select pg_temp.prueba('supervisor A reporta fertilización', 'ok',
  $q$select 'x' from (select af__reportar((select v from ids where k = 'rep3'), (select v from ids where k = 'fert'), 3, '2026-09-15', 'https://x/f.jpg', null, null, null, null, 'U002')) s$q$);
select pg_temp.prueba('rechazar con motivo', 'ok RECHAZADO',
  $q$select af__revisar((select v from ids where k = 'rep3'), false, 'la foto es de otra suerte', 'U033')$q$);
insert into r (caso, esperado, obtenido)
  select 'lo rechazado no genera gasto', '0', count(*)::text from af_movimientos where reporte_id = (select v from ids where k = 'rep3');

-- Plan de labores
select pg_temp.prueba('marcar TERMINADA a mano', 'ESTADO_POR_FUNCION',
  $q$update af_labores set estado = 'TERMINADA', editado_por = 'U005' where id = (select v from ids where k = 'fert') returning id::text$q$);
select pg_temp.prueba('supervisor cambia el presupuesto', 'SIN_PERMISO',
  $q$update af_labores set costo_unitario_plan = 1, editado_por = 'U002' where id = (select v from ids where k = 'fert') returning id::text$q$);
select pg_temp.prueba('anular sin motivo', 'new row for relation "af_labores" violates check constraint "af_labores_check"',
  $q$update af_labores set estado = 'ANULADA', editado_por = 'U005' where id = (select v from ids where k = 'fert') returning id::text$q$);
select pg_temp.prueba('admin anula con motivo', 'ok',
  $q$update af_labores set estado = 'ANULADA', anulada_motivo = 'la hace el dueño', editado_por = 'U005' where id = (select v from ids where k = 'fert') returning 'x'$q$);

-- Cuenta del dueño
select pg_temp.prueba('admin registra anticipo', 'ok',
  $q$insert into af_movimientos (finca_id, tipo, fecha, concepto, valor, registrado_por) select v, 'ANTICIPO', '2026-09-02', 'Giro del dueño', 5000000, 'U005' from ids where k = 'finca' returning 'x'$q$);
select pg_temp.prueba('gasto sin soporte', 'new row for relation "af_movimientos" violates check constraint "af_movimientos_check"',
  $q$insert into af_movimientos (finca_id, tipo, fecha, concepto, valor, registrado_por) select v, 'GASTO', '2026-09-02', 'Algo', 1000, 'U005' from ids where k = 'finca' returning 'x'$q$);
select pg_temp.prueba('supervisor registra anticipo', 'SIN_PERMISO',
  $q$insert into af_movimientos (finca_id, tipo, fecha, concepto, valor, registrado_por) select v, 'ANTICIPO', '2026-09-02', 'x', 1, 'U002' from ids where k = 'finca' returning 'x'$q$);
select pg_temp.prueba('gasto a mano amarrado a un reporte', 'MOVIMIENTO_INVALIDO',
  $q$insert into af_movimientos (finca_id, tipo, fecha, concepto, valor, soporte_url, reporte_id, registrado_por) select (select v from ids where k = 'finca'), 'GASTO', '2026-09-02', 'x', 1, 's', (select v from ids where k = 'rep3'), 'U005' returning 'x'$q$);
select pg_temp.prueba('editar el valor de un movimiento', 'MOVIMIENTO_INMUTABLE',
  $q$update af_movimientos set valor = 1 where reporte_id = (select v from ids where k = 'rep1') returning 'x'$q$);
select pg_temp.prueba('supervisor anula un gasto', 'SIN_PERMISO',
  $q$select af__anular_movimiento((select id from af_movimientos where reporte_id = (select v from ids where k = 'rep1')), 'x', 'U002')::text$q$);
select pg_temp.prueba('admin anula con motivo', 'ok',
  $q$select 'x' from (select af__anular_movimiento((select id from af_movimientos where reporte_id = (select v from ids where k = 'rep1')), 'tarifa mal puesta', 'U005')) s$q$);
select pg_temp.prueba('anular dos veces', 'MOVIMIENTO_ANULADO',
  $q$select af__anular_movimiento((select id from af_movimientos where reporte_id = (select v from ids where k = 'rep1')), 'otra vez', 'U005')::text$q$);

-- La app (llave anónima) no borra ni escribe reportes por fuera de las funciones
select pg_temp.prueba('la app intenta insertar un reporte directo', 'permission denied for table af_reportes',
  $q$select 'x' from (select 1) s where false$q$);  -- se reemplaza abajo con el rol anónimo
insert into r (caso, esperado, obtenido)
  select 'auditoría registró los cambios', 'más de 10', case when count(*) > 10 then 'más de 10' else count(*)::text end
    from af_auditoria where registro_id in (select v::text from ids) or registro_id in (select id::text from af_movimientos where finca_id = (select v from ids where k = 'finca'));

select n, caso, esperado, obtenido, case when obtenido like esperado || '%' or obtenido = esperado then '✓' else '✗' end as ok
  from r where caso <> 'la app intenta insertar un reporte directo' order by n;

-- Permisos del rol anónimo (lo que usa la app)
set local role anon;
do $$
begin
  begin delete from af_movimientos where true; raise notice 'ANON_BORRA: ✗ pudo borrar';
  exception when others then raise notice 'ANON_BORRA: ✓ %', split_part(sqlerrm, ' for ', 1); end;
  begin insert into af_reportes (id, labor_id, cantidad, fecha, foto_url, reportado_por)
        values (gen_random_uuid(), gen_random_uuid(), 1, current_date, 'f', 'U002'); raise notice 'ANON_REPORTE_DIRECTO: ✗ pudo';
  exception when others then raise notice 'ANON_REPORTE_DIRECTO: ✓ %', split_part(sqlerrm, ' for ', 1); end;
  begin update af_reportes set estado = 'ACEPTADO' where true; raise notice 'ANON_ACEPTA_DIRECTO: ✗ pudo';
  exception when others then raise notice 'ANON_ACEPTA_DIRECTO: ✓ %', split_part(sqlerrm, ' for ', 1); end;
  begin perform count(*) from af_fincas; raise notice 'ANON_LEE: ✗ pudo leer la tabla directo';
  exception when others then raise notice 'ANON_LEE: ✓ ya no lee directo (%)', split_part(sqlerrm, ' for ', 1); end;
end $$;
reset role;
