-- Pruebas de «abrir corte con plan» (20261025190000).
-- Correr DESPUÉS de la migración, dentro de begin … rollback: no deja nada.
-- Actores reales: U005 (administración) y U002 (supervisor).

begin;
create temp table r (n serial, caso text, esperado text, obtenido text);
create temp table ids (k text primary key, v uuid);

create or replace function pg_temp.prueba(p_caso text, p_esperado text, p_sql text) returns void
language plpgsql as $$
declare v text;
begin
  perform set_config('af.via_funcion', '', true);
  begin
    execute p_sql into v;
    insert into r (caso, esperado, obtenido) values (p_caso, p_esperado, coalesce('ok ' || v, 'ok'));
  exception when others then
    insert into r (caso, esperado, obtenido) values (p_caso, p_esperado, split_part(sqlerrm, ':', 1));
  end;
end $$;

insert into af_fincas (nombre, dueno_nombre, dueno_telefono, editado_por) values ('PRUEBA PLAN CORTE', 'DUEÑO PRUEBA', '3000000000', 'U005');
insert into ids select 'finca', id from af_fincas where nombre = 'PRUEBA PLAN CORTE';
insert into af_suertes (finca_id, codigo, area_ha, editado_por) select v, '77', 10, 'U005' from ids where k = 'finca';
insert into ids select 'suerte', id from af_suertes where codigo = '77' and finca_id = (select v from ids where k = 'finca');

-- Permisos y entradas inválidas
select pg_temp.prueba('supervisor abre corte con plan', 'SIN_PERMISO',
  $q$select af__abrir_ciclo_plan((select v from ids where k = 'suerte'), '2026-09-01', 'SOCA', '[]'::jsonb, 'U002')::text$q$);
select pg_temp.prueba('ajustes que no son una lista', 'AJUSTES_INVALIDOS',
  $q$select af__abrir_ciclo_plan((select v from ids where k = 'suerte'), '2026-09-01', 'SOCA', '{"a":1}'::jsonb, 'U005')::text$q$);
select pg_temp.prueba('ajuste sin nombre de labor', 'AJUSTES_INVALIDOS',
  $q$select af__abrir_ciclo_plan((select v from ids where k = 'suerte'), '2026-09-01', 'SOCA', '[{"costo": 5}]'::jsonb, 'U005')::text$q$);
select pg_temp.prueba('costo que no es número', 'AJUSTES_INVALIDOS',
  $q$select af__abrir_ciclo_plan((select v from ids where k = 'suerte'), '2026-09-01', 'SOCA', '[{"labor":"ROTURACIÓN","costo":"abc"}]'::jsonb, 'U005')::text$q$);
select pg_temp.prueba('costo negativo', 'COSTO_INVALIDO',
  $q$select af__abrir_ciclo_plan((select v from ids where k = 'suerte'), '2026-09-01', 'SOCA', '[{"labor":"ROTURACIÓN","costo":-1}]'::jsonb, 'U005')::text$q$);
select pg_temp.prueba('ppto por ha negativo', 'COSTO_INVALIDO',
  $q$select af__abrir_ciclo_plan((select v from ids where k = 'suerte'), '2026-09-01', 'SOCA', '[{"labor":"ROTURACIÓN","costo_aparte":-5}]'::jsonb, 'U005')::text$q$);
select pg_temp.prueba('pasadas en cero', 'PASADAS_INVALIDAS',
  $q$select af__abrir_ciclo_plan((select v from ids where k = 'suerte'), '2026-09-01', 'SOCA', '[{"labor":"RIEGO","pasadas":0}]'::jsonb, 'U005')::text$q$);
select pg_temp.prueba('varias pasadas en una labor que no se repite', 'PASADAS_NO_APLICA',
  $q$select af__abrir_ciclo_plan((select v from ids where k = 'suerte'), '2026-09-01', 'SOCA', '[{"labor":"ROTURACIÓN","pasadas":3}]'::jsonb, 'U005')::text$q$);
select pg_temp.prueba('labor que no está en el corte', 'LABOR_NO_EXISTE',
  $q$select af__abrir_ciclo_plan((select v from ids where k = 'suerte'), '2026-09-01', 'SOCA', '[{"labor":"COSECHA MECANICA"}]'::jsonb, 'U005')::text$q$);
select pg_temp.prueba('unidad que no coincide', 'LABOR_NO_EXISTE',
  $q$select af__abrir_ciclo_plan((select v from ids where k = 'suerte'), '2026-09-01', 'SOCA', '[{"labor":"ROTURACIÓN","unidad":"jornal"}]'::jsonb, 'U005')::text$q$);
select pg_temp.prueba('corte con fecha futura', 'FECHA_FUTURA',
  $q$select af__abrir_ciclo_plan((select v from ids where k = 'suerte'), '2030-01-01', 'SOCA', '[]'::jsonb, 'U005')::text$q$);

-- Todo o nada: ninguna de las fallas de arriba dejó un corte a medias.
insert into r (caso, esperado, obtenido)
  select 'las fallas no dejaron ningún corte abierto', '0', count(*)::text from af_ciclos where suerte_id = (select v from ids where k = 'suerte');

-- Camino feliz
insert into ids select 'ciclo', af__abrir_ciclo_plan((select v from ids where k = 'suerte'), '2026-09-01', 'SOCA',
  '[{"labor":"ROTURACIÓN","costo":200000,"costo_aparte":50000},
    {"labor":"RIEGO","costo":10000,"costo_aparte":5000,"pasadas":4},
    {"labor":"CONTROL DE MALEZAS","unidad":"ha","costo_aparte":30000}]'::jsonb, 'U005');
insert into r (caso, esperado, obtenido)
  select 'roturación: servicio 200.000 + ppto 50.000, 1 pasada', '200000 · 50000 · 1',
         costo_unitario_plan::text || ' · ' || costo_aparte_unitario_plan::text || ' · ' || pasadas_plan::text
    from af_labores where ciclo_id = (select v from ids where k = 'ciclo') and labor = 'ROTURACIÓN';
insert into r (caso, esperado, obtenido)
  select 'riego (se repite): 10.000 + 5.000 y 4 pasadas', '10000 · 5000 · 4',
         costo_unitario_plan::text || ' · ' || costo_aparte_unitario_plan::text || ' · ' || pasadas_plan::text
    from af_labores where ciclo_id = (select v from ids where k = 'ciclo') and labor = 'RIEGO';
insert into r (caso, esperado, obtenido)
  select 'malezas: solo cambia el ppto por ha, el servicio queda como el catálogo', 'true · 30000',
         (costo_unitario_plan = (select costo_unitario from af_paquete where labor = 'CONTROL DE MALEZAS' and activa and variedad is null limit 1))::text
         || ' · ' || costo_aparte_unitario_plan::text
    from af_labores where ciclo_id = (select v from ids where k = 'ciclo') and labor = 'CONTROL DE MALEZAS';
insert into r (caso, esperado, obtenido)
  select 'la cantidad sigue siendo el área de la suerte', '10.00', cantidad_plan::text
    from af_labores where ciclo_id = (select v from ids where k = 'ciclo') and labor = 'ROTURACIÓN';
insert into r (caso, esperado, obtenido)
  select 'la fertilización no tocada queda como el catálogo', 'true',
         (costo_unitario_plan = (select costo_unitario from af_paquete where labor = 'FERTILIZACIÓN' and activa and variedad is null and aplica = 'SOCA' limit 1))::text
    from af_labores where ciclo_id = (select v from ids where k = 'ciclo') and labor = 'FERTILIZACIÓN' limit 1;

-- Un segundo corte cierra el anterior, igual que af__abrir_ciclo
insert into ids select 'ciclo2', af__abrir_ciclo_plan((select v from ids where k = 'suerte'), '2026-09-15', 'SOCA', '[]'::jsonb, 'U005');
insert into r (caso, esperado, obtenido)
  select 'el corte anterior quedó CERRADO y el nuevo ABIERTO', 'CERRADO · ABIERTO',
         (select estado from af_ciclos where id = (select v from ids where k = 'ciclo')) || ' · ' ||
         (select estado from af_ciclos where id = (select v from ids where k = 'ciclo2'));

-- Permisos de ejecución: la interna no se expone a la app; la pública sí, pero pide sesión.
insert into r (caso, esperado, obtenido)
  select 'la función interna NO es ejecutable por anon', 'false',
         has_function_privilege('anon', 'public.af__abrir_ciclo_plan(uuid, date, text, jsonb, text)', 'execute')::text;
insert into r (caso, esperado, obtenido)
  select 'la función pública SÍ es ejecutable por anon', 'true',
         has_function_privilege('anon', 'public.af_abrir_ciclo_plan(text, uuid, date, text, jsonb)', 'execute')::text;
select pg_temp.prueba('la pública sin sesión válida', 'SIN_SESION',
  $q$select af_abrir_ciclo_plan('token-que-no-existe', (select v from ids where k = 'suerte'), '2026-09-01', 'SOCA', '[]'::jsonb)::text$q$);

select n, caso, esperado, obtenido,
       case when obtenido = esperado or (esperado ~ '^[A-Z_]+$' and obtenido = esperado) then '✓' else '✗ REVISAR' end as ok
  from r order by n;
rollback;
