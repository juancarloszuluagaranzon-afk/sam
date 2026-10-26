-- Pruebas del candado de área reforzado (20261026200000).
-- Correr DESPUÉS de la migración, dentro de begin … rollback: no deja nada.

begin;
create temp table r (n serial, caso text, esperado text, obtenido text);

create or replace function pg_temp.prueba(p_caso text, p_esperado text, p_sql text) returns void
language plpgsql as $$
declare v text;
begin
  begin
    execute p_sql into v;
    insert into r (caso, esperado, obtenido) values (p_caso, p_esperado, case when v is null or v = '' then 'ok' else 'ok ' || v end);
  exception when others then
    insert into r (caso, esperado, obtenido) values (p_caso, p_esperado, split_part(sqlerrm, ':', 1));
  end;
end $$;

-- Una cerrada cualquiera: ZZ-<suerte>, labor, ha realizadas, ha asignadas, estado, ingenio y día (0 = hoy).
create or replace function pg_temp.cierra(p_suerte text, p_labor text, p_real numeric, p_asig numeric, p_estado text, p_ingenio text, p_dia int default 0, p_nombre text default 'PRUEBA CANDADO')
returns text language plpgsql as $$
declare v_id uuid;
begin
  insert into asignaciones (suerte_codigo, labor_nombre, tractor, area_asignada, area_realizada, estado, codigo_hacienda, nombre_hacienda, numero_suerte, ingenio_id, fecha_fin)
  values ('ZZ-' || p_suerte, p_labor, 'T', p_asig, p_real, p_estado, 'ZZ', p_nombre, p_suerte, p_ingenio, now() + make_interval(days => p_dia))
  returning id into v_id;
  return v_id::text;
end $$;

-- Maestro de prueba: ZZ-01..ZZ-12 de 10 ha en el ingenio «ia»; ZZ-07 también en «ib» con otra área.
insert into maestro_risaralda (hacienda, nombre_hacienda, suerte, area_neta, ingenio_id)
select 'ZZ', 'PRUEBA CANDADO', lpad(g::text, 2, '0'), 10, 'ia' from generate_series(1, 12) g;
update maestro_risaralda set area_neta = 5 where hacienda = 'ZZ' and suerte = '07' and ingenio_id = 'ia';
insert into maestro_risaralda (hacienda, nombre_hacienda, suerte, area_neta, ingenio_id) values ('ZZ', 'PRUEBA CANDADO', '07', 10, 'ib');

-- 1) Dos y tres operarios sobre la misma suerte
select pg_temp.prueba('1. primer operario 6 ha', 'ok', $q$select left(pg_temp.cierra('01', 'DESPEJE', 6, 6, 'COMPLETADA', 'ia'), 0)$q$);
select pg_temp.prueba('2. segundo operario 4 ha (suman 10, el área)', 'ok', $q$select left(pg_temp.cierra('01', 'DESPEJE', 4, 4, 'COMPLETADA', 'ia'), 0)$q$);
select pg_temp.prueba('3. tercer operario 0,03 ha de más', 'AREA_EXCEDIDA', $q$select pg_temp.cierra('01', 'DESPEJE', 0.03, 0.03, 'COMPLETADA', 'ia')$q$);
select pg_temp.prueba('4. tercer operario con la mitad de la suerte', 'AREA_EXCEDIDA', $q$select pg_temp.cierra('01', 'DESPEJE', 5, 5, 'COMPLETADA', 'ia')$q$);

-- 2) El margen de 0,02
select pg_temp.prueba('5. suerte 02: 10 ha', 'ok', $q$select left(pg_temp.cierra('02', 'DESPEJE', 10, 10, 'COMPLETADA', 'ia'), 0)$q$);
select pg_temp.prueba('6. suerte 02: 0,02 de margen cabe', 'ok', $q$select left(pg_temp.cierra('02', 'DESPEJE', 0.02, 0.02, 'COMPLETADA', 'ia'), 0)$q$);
select pg_temp.prueba('7. suerte 02: 0,01 más ya no cabe', 'AREA_EXCEDIDA', $q$select pg_temp.cierra('02', 'DESPEJE', 0.01, 0.01, 'COMPLETADA', 'ia')$q$);

-- 3) Lo que se paga es la realizada y, si no hay, la asignada
select pg_temp.prueba('8. suerte 03: cerrada con realizada 0 y asignada 6', 'ok', $q$select left(pg_temp.cierra('03', 'DESPEJE', 0, 6, 'COMPLETADA', 'ia'), 0)$q$);
select pg_temp.prueba('9. suerte 03: otra de 5 ha se pasa (6 + 5)', 'AREA_EXCEDIDA', $q$select pg_temp.cierra('03', 'DESPEJE', 5, 5, 'COMPLETADA', 'ia')$q$);
select pg_temp.prueba('10. suerte 03: una sola cerrada de 11 ha asignadas y realizada 0', 'AREA_EXCEDIDA', $q$select pg_temp.cierra('03', 'REENCALLE', 0, 11, 'COMPLETADA', 'ia')$q$);

-- 4) Parciales cuentan, pendientes no
select pg_temp.prueba('11. suerte 04: parcial de 7 ha', 'ok', $q$select left(pg_temp.cierra('04', 'DESPEJE', 7, 10, 'PARCIAL', 'ia'), 0)$q$);
select pg_temp.prueba('12. suerte 04: otra cerrada de 3,1 se pasa', 'AREA_EXCEDIDA', $q$select pg_temp.cierra('04', 'DESPEJE', 3.1, 3.1, 'COMPLETADA', 'ia')$q$);
select pg_temp.prueba('13. suerte 05: tres pendientes de 10 ha no cuentan', 'ok', $q$select left(pg_temp.cierra('05', 'DESPEJE', 0, 10, 'PENDIENTE', 'ia'), 0) || left(pg_temp.cierra('05', 'DESPEJE', 0, 10, 'PENDIENTE', 'ia'), 0) || left(pg_temp.cierra('05', 'DESPEJE', 0, 10, 'PENDIENTE', 'ia'), 0)$q$);
select pg_temp.prueba('14. suerte 05: y la cerrada de 10 ha entra', 'ok', $q$select left(pg_temp.cierra('05', 'DESPEJE', 10, 10, 'COMPLETADA', 'ia'), 0)$q$);

-- 5) Editar una fila ya cerrada
select pg_temp.prueba('15. suerte 06: 9 ha cerradas', 'ok', $q$select left(pg_temp.cierra('06', 'DESPEJE', 9, 9, 'COMPLETADA', 'ia'), 0)$q$);
create temp table mov (id uuid);
insert into mov select pg_temp.cierra('08', 'DESPEJE', 5, 5, 'COMPLETADA', 'ia')::uuid;
select pg_temp.prueba('16. mover una fila de 5 ha a la suerte 06 (que ya tiene 9) se bloquea', 'AREA_EXCEDIDA',
  $q$update asignaciones set suerte_codigo = 'ZZ-06', numero_suerte = '06' where id = (select id from mov) returning 'x'$q$);
select pg_temp.prueba('17. cambiarle la fecha a otro ciclo lejano sí se puede', 'ok',
  $q$update asignaciones set fecha_fin = now() + interval '60 days' where id = (select id from mov) returning left('x', 0)$q$);

-- 6) Filas viejas que ya pasaban del área: no se tocan por cambiar otra cosa
alter table asignaciones disable trigger trg_asignaciones_cap_area;
create temp table viejo (id uuid);
insert into viejo select pg_temp.cierra('09', 'DESPEJE', 12, 12, 'COMPLETADA', 'ia')::uuid;
alter table asignaciones enable trigger trg_asignaciones_cap_area;
select pg_temp.prueba('18. fila vieja en exceso: cambiar las observaciones se permite', 'ok',
  $q$update asignaciones set observaciones = 'nota' where id = (select id from viejo) returning left('x', 0)$q$);
select pg_temp.prueba('19. fila vieja en exceso: bajarle el área se permite', 'ok',
  $q$update asignaciones set area_realizada = 11, area_asignada = 11 where id = (select id from viejo) returning left('x', 0)$q$);
select pg_temp.prueba('20. fila vieja en exceso: subirle el área se bloquea', 'AREA_EXCEDIDA',
  $q$update asignaciones set area_realizada = 11.5 where id = (select id from viejo) returning 'x'$q$);

-- 7) El mismo nombre de hacienda y suerte en dos ingenios NO se mezcla
select pg_temp.prueba('21. ZZ-07 en «ia» (5 ha): cierra 5', 'ok', $q$select left(pg_temp.cierra('07', 'DESPEJE', 5, 5, 'COMPLETADA', 'ia'), 0)$q$);
select pg_temp.prueba('22. ZZ-07 en «ib» (10 ha): cierra 8 sin sumar las de «ia»', 'ok', $q$select left(pg_temp.cierra('07', 'DESPEJE', 8, 8, 'COMPLETADA', 'ib'), 0)$q$);
select pg_temp.prueba('23. ZZ-07 en «ia»: 0,1 más se pasa de sus 5 ha', 'AREA_EXCEDIDA', $q$select pg_temp.cierra('07', 'DESPEJE', 0.1, 0.1, 'COMPLETADA', 'ia')$q$);
select pg_temp.prueba('24. ZZ-07 en «ib»: 2,1 más se pasa de sus 10 ha', 'AREA_EXCEDIDA', $q$select pg_temp.cierra('07', 'DESPEJE', 2.1, 2.1, 'COMPLETADA', 'ib')$q$);

-- 8) Otro ciclo (más de 21 días) y labores que no son hectáreas
select pg_temp.prueba('25. suerte 10: 10 ha hoy', 'ok', $q$select left(pg_temp.cierra('10', 'DESPEJE', 10, 10, 'COMPLETADA', 'ia', 0), 0)$q$);
select pg_temp.prueba('26. suerte 10: 10 ha a los 30 días (otro ciclo)', 'ok', $q$select left(pg_temp.cierra('10', 'DESPEJE', 10, 10, 'COMPLETADA', 'ia', 30), 0)$q$);
select pg_temp.prueba('27. suerte 10: 1 ha a los 10 días (mismo ciclo del primero) se pasa', 'AREA_EXCEDIDA', $q$select pg_temp.cierra('10', 'DESPEJE', 1, 1, 'COMPLETADA', 'ia', 10)$q$);
select pg_temp.prueba('28. ACEQUIAS en hectómetros no se topa', 'ok', $q$select left(pg_temp.cierra('11', 'ACEQUIAS', 50, 50, 'COMPLETADA', 'ia'), 0)$q$);

-- 9) Sin área oficial: respaldo = mayor área planificada del ciclo
select pg_temp.prueba('29. suerte 99 (sin maestro): pendiente de 8 ha', 'ok', $q$select left(pg_temp.cierra('99', 'DESPEJE', 0, 8, 'PENDIENTE', 'ia'), 0)$q$);
select pg_temp.prueba('30. suerte 99: cierra 8 ha', 'ok', $q$select left(pg_temp.cierra('99', 'DESPEJE', 8, 8, 'COMPLETADA', 'ia'), 0)$q$);
select pg_temp.prueba('31. suerte 99: 0,5 más se pasa', 'AREA_EXCEDIDA', $q$select pg_temp.cierra('99', 'DESPEJE', 0.5, 0.5, 'COMPLETADA', 'ia')$q$);

-- 10) Sin ingenio en la fila (lo fija otro disparador después): se resuelve solo
select pg_temp.prueba('32. fila sin ingenio: cierra 10 en ZZ-12', 'ok', $q$select left(pg_temp.cierra('12', 'DESPEJE', 10, 10, 'COMPLETADA', null), 0)$q$);
select pg_temp.prueba('33. fila sin ingenio: 0,5 más se pasa', 'AREA_EXCEDIDA', $q$select pg_temp.cierra('12', 'DESPEJE', 0.5, 0.5, 'COMPLETADA', null)$q$);

-- 11) El mensaje y el candado de concurrencia
insert into r (caso, esperado, obtenido)
select '34. el mensaje ya no trae «.2f» sin formatear', 'true',
       (position('.2f' in pg_get_functiondef('public.asignaciones_cap_area'::regproc)) = 0)::text;
insert into r (caso, esperado, obtenido)
select '35. la función toma el candado de concurrencia', 'true',
       (position('pg_advisory_xact_lock' in pg_get_functiondef('public.asignaciones_cap_area'::regproc)) > 0)::text;

select n, caso, esperado, obtenido, case when obtenido = esperado then '✓' else '✗ REVISAR' end as ok from r order by n;
rollback;
