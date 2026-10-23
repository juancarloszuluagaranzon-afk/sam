-- Borra la finca demo RIOGRANDE PRUEBAS y TODO su rastro, incluida la auditoría
-- que genera el propio borrado. Ejecutar con psql -v ON_ERROR_STOP=1 --single-transaction.
select set_config('af.via_funcion','1', true);

-- 1. Guardar los ids de todo lo de la finca ANTES de borrar (para limpiar la auditoría al final).
create temp table ids_demo on commit drop as
  select id::text as rid from public.af_movimientos where finca_id in (select id from public.af_fincas where nombre='RIOGRANDE PRUEBAS')
  union select r.id::text from public.af_reportes r join public.af_labores l on l.id=r.labor_id join public.af_ciclos c on c.id=l.ciclo_id join public.af_suertes s on s.id=c.suerte_id where s.finca_id in (select id from public.af_fincas where nombre='RIOGRANDE PRUEBAS')
  union select l.id::text from public.af_labores l join public.af_ciclos c on c.id=l.ciclo_id join public.af_suertes s on s.id=c.suerte_id where s.finca_id in (select id from public.af_fincas where nombre='RIOGRANDE PRUEBAS')
  union select c.id::text from public.af_ciclos c join public.af_suertes s on s.id=c.suerte_id where s.finca_id in (select id from public.af_fincas where nombre='RIOGRANDE PRUEBAS')
  union select id::text from public.af_poligonos where finca_id in (select id from public.af_fincas where nombre='RIOGRANDE PRUEBAS')
  union select id::text from public.af_suertes where finca_id in (select id from public.af_fincas where nombre='RIOGRANDE PRUEBAS')
  union select id::text from public.af_accesos where finca_id in (select id from public.af_fincas where nombre='RIOGRANDE PRUEBAS')
  union select id::text from public.af_fincas where nombre='RIOGRANDE PRUEBAS';

-- 2. Borrar los datos en orden (hijos antes que padres).
delete from public.af_movimientos where finca_id in (select id from public.af_fincas where nombre='RIOGRANDE PRUEBAS');
delete from public.af_reportes where labor_id in (select l.id from public.af_labores l join public.af_ciclos c on c.id=l.ciclo_id join public.af_suertes s on s.id=c.suerte_id where s.finca_id in (select id from public.af_fincas where nombre='RIOGRANDE PRUEBAS'));
delete from public.af_labores where ciclo_id in (select c.id from public.af_ciclos c join public.af_suertes s on s.id=c.suerte_id where s.finca_id in (select id from public.af_fincas where nombre='RIOGRANDE PRUEBAS'));
delete from public.af_ciclos where suerte_id in (select id from public.af_suertes where finca_id in (select id from public.af_fincas where nombre='RIOGRANDE PRUEBAS'));
delete from public.af_poligonos where finca_id in (select id from public.af_fincas where nombre='RIOGRANDE PRUEBAS');
delete from public.af_accesos where finca_id in (select id from public.af_fincas where nombre='RIOGRANDE PRUEBAS');
delete from public.af_suertes where finca_id in (select id from public.af_fincas where nombre='RIOGRANDE PRUEBAS');
delete from public.af_fincas where nombre='RIOGRANDE PRUEBAS';

-- 3. Borrar la auditoría de esos ids: la original Y la que el propio borrado acaba de generar.
delete from public.af_auditoria where registro_id in (select rid from ids_demo);

-- 4. Verificar que no quede nada (todo debe dar 0).
select 'af_fincas' as tabla, count(*) from public.af_fincas where nombre='RIOGRANDE PRUEBAS'
union all select 'af_poligonos', count(*) from public.af_poligonos where finca_id in (select id from public.af_fincas where nombre='RIOGRANDE PRUEBAS')
union all select 'af_auditoria (del demo)', count(*) from public.af_auditoria where registro_id in (select rid from ids_demo);
