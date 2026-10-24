-- Crea la finca demo y sus datos; ejecutar con psql -v ON_ERROR_STOP=1 --single-transaction.
select set_config('af.via_funcion','1', true);

-- Candado: si la finca de prueba ya existe, no la dupliques (corre primero el borrador).
do $$ begin
  if exists (select 1 from public.af_fincas where nombre='RIOGRANDE PRUEBAS') then
    raise exception 'YA_EXISTE: la finca RIOGRANDE PRUEBAS ya está creada; corre primero borrar_riogrande_pruebas.sql'
      using errcode = 'check_violation';
  end if;
end $$;

insert into public.af_fincas (nombre, dueno_nombre, dueno_telefono, dueno_correo, ingenio_id, municipio,
                              hacienda_codigo, honorario_modo, honorario_valor, nota, editado_por)
values ('RIOGRANDE PRUEBAS', 'DUEÑO DE PRUEBA', '3000000000', null, 'risaralda', 'Toro',
        '627', 'PORCENTAJE', 8, 'FINCA DE PRUEBA — datos de ejemplo. Se puede borrar con borrar_riogrande_pruebas.sql.', 'U005');

insert into public.af_suertes (finca_id, codigo, area_ha, variedad, editado_por)
values
  ((select id from public.af_fincas where nombre='RIOGRANDE PRUEBAS'), '0001', 0.61, 'CC 05-430', 'U005'),
  ((select id from public.af_fincas where nombre='RIOGRANDE PRUEBAS'), '0002', 2.18, 'CC 01-1940', 'U005'),
  ((select id from public.af_fincas where nombre='RIOGRANDE PRUEBAS'), '0002A', 0.81, null, 'U005'),
  ((select id from public.af_fincas where nombre='RIOGRANDE PRUEBAS'), '0003', 2.38, null, 'U005'),
  ((select id from public.af_fincas where nombre='RIOGRANDE PRUEBAS'), '0003A', 1.96, null, 'U005'),
  ((select id from public.af_fincas where nombre='RIOGRANDE PRUEBAS'), '0004', 5.68, 'CC 11-595', 'U005'),
  ((select id from public.af_fincas where nombre='RIOGRANDE PRUEBAS'), '0004A', 3.47, null, 'U005'),
  ((select id from public.af_fincas where nombre='RIOGRANDE PRUEBAS'), '0005', 5.89, null, 'U005'),
  ((select id from public.af_fincas where nombre='RIOGRANDE PRUEBAS'), '0005B', 9.17, null, 'U005'),
  ((select id from public.af_fincas where nombre='RIOGRANDE PRUEBAS'), '0006', 1.47, null, 'U005'),
  ((select id from public.af_fincas where nombre='RIOGRANDE PRUEBAS'), '0007', 5.56, null, 'U005');

insert into public.af_poligonos (finca_id, suerte_id, etiqueta, anillo, area_ha, fuente, editado_por)
select nf.id, ns.id, p.etiqueta, p.anillo, p.area_ha, p.fuente, 'U005'
from public.af_poligonos p
join public.af_suertes rs on rs.id = p.suerte_id
join public.af_fincas  rf on rf.id = rs.finca_id and rf.nombre = 'RIOGRANDE II'
join public.af_fincas  nf on nf.nombre = 'RIOGRANDE PRUEBAS'
join public.af_suertes ns on ns.finca_id = nf.id and ns.codigo = rs.codigo;

-- 24-oct-2026: ya NO se copian los datos del ingenio de la finca real (TCH, rendimiento…):
-- el enlace de esta finca se le muestra a clientes. Los datos de cosecha, los parámetros
-- económicos y los costos completos de EJEMPLO los pone `ajuste_riogrande_pruebas_ejemplo.sql`,
-- que se corre justo después de este archivo.

update public.af_poligonos set suerte_id = null, etiqueta = 'por asignar', editado_por = 'U005'
where id = (
  select p.id from public.af_poligonos p
   join public.af_suertes s on s.id = p.suerte_id
   join public.af_fincas  f on f.id = s.finca_id
  where f.nombre='RIOGRANDE PRUEBAS' and s.codigo='0005B' limit 1);

select public.af__abrir_ciclo((select s.id from public.af_suertes s join public.af_fincas f on f.id=s.finca_id where f.nombre='RIOGRANDE PRUEBAS' and s.codigo='0001'), '2026-10-13'::date, 'SOCA', 'U005');
select public.af__abrir_ciclo((select s.id from public.af_suertes s join public.af_fincas f on f.id=s.finca_id where f.nombre='RIOGRANDE PRUEBAS' and s.codigo='0002'), '2026-10-01'::date, 'SOCA', 'U005');
select public.af__abrir_ciclo((select s.id from public.af_suertes s join public.af_fincas f on f.id=s.finca_id where f.nombre='RIOGRANDE PRUEBAS' and s.codigo='0002A'), '2026-08-20'::date, 'SOCA', 'U005');
select public.af__abrir_ciclo((select s.id from public.af_suertes s join public.af_fincas f on f.id=s.finca_id where f.nombre='RIOGRANDE PRUEBAS' and s.codigo='0003'), '2026-10-20'::date, 'SOCA', 'U005');
select public.af__abrir_ciclo((select s.id from public.af_suertes s join public.af_fincas f on f.id=s.finca_id where f.nombre='RIOGRANDE PRUEBAS' and s.codigo='0003A'), '2026-10-05'::date, 'SOCA', 'U005');
select public.af__abrir_ciclo((select s.id from public.af_suertes s join public.af_fincas f on f.id=s.finca_id where f.nombre='RIOGRANDE PRUEBAS' and s.codigo='0004'), '2026-08-10'::date, 'SOCA', 'U005');
select public.af__abrir_ciclo((select s.id from public.af_suertes s join public.af_fincas f on f.id=s.finca_id where f.nombre='RIOGRANDE PRUEBAS' and s.codigo='0004A'), '2026-07-15'::date, 'SOCA', 'U005');
select public.af__abrir_ciclo((select s.id from public.af_suertes s join public.af_fincas f on f.id=s.finca_id where f.nombre='RIOGRANDE PRUEBAS' and s.codigo='0005'), '2026-07-09'::date, 'SOCA', 'U005');
select public.af__abrir_ciclo((select s.id from public.af_suertes s join public.af_fincas f on f.id=s.finca_id where f.nombre='RIOGRANDE PRUEBAS' and s.codigo='0005B'), '2026-07-04'::date, 'SOCA', 'U005');
select public.af__abrir_ciclo((select s.id from public.af_suertes s join public.af_fincas f on f.id=s.finca_id where f.nombre='RIOGRANDE PRUEBAS' and s.codigo='0006'), '2026-09-20'::date, 'SOCA', 'U005');
select public.af__abrir_ciclo((select s.id from public.af_suertes s join public.af_fincas f on f.id=s.finca_id where f.nombre='RIOGRANDE PRUEBAS' and s.codigo='0007'), '2026-02-09'::date, 'SOCA', 'U005');

create function pg_temp.lab(p_codigo text, p_labor text) returns uuid language sql as $$
  select l.id from public.af_labores l
   join public.af_ciclos c on c.id=l.ciclo_id and c.estado='ABIERTO'
   join public.af_suertes s on s.id=c.suerte_id
   join public.af_fincas  f on f.id=s.finca_id
  where f.nombre='RIOGRANDE PRUEBAS' and s.codigo=p_codigo and l.labor=p_labor
  limit 1
$$;

select public.af__revisar(public.af__reportar(gen_random_uuid(), pg_temp.lab('0001','ROTURACIÓN'), 0.61, '2026-10-22'::date, '', null,null,null, null, 'U033'), true, null, 'U005');
select public.af__reportar(gen_random_uuid(), pg_temp.lab('0001','FERTILIZACIÓN'), 0.61, '2026-10-22'::date, '', null,null,null, 'Quedó pendiente la cabecera norte', 'U033');
select public.af__revisar(public.af__reportar(gen_random_uuid(), pg_temp.lab('0002','ROTURACIÓN'), 2.18, '2026-10-21'::date, '', null,null,null, null, 'U033'), true, null, 'U005');
select public.af__reportar(gen_random_uuid(), pg_temp.lab('0003','ROTURACIÓN'), 2.38, '2026-10-22'::date, '', 4.6092,-76.0345,8, null, 'U033');
select public.af__revisar(public.af__reportar(gen_random_uuid(), pg_temp.lab('0003A','ROTURACIÓN'), 1.96, '2026-10-10'::date, '', null,null,null, null, 'U033'), true, null, 'U005');
select public.af__revisar(public.af__reportar(gen_random_uuid(), pg_temp.lab('0003A','FERTILIZACIÓN'), 1.96, '2026-10-18'::date, '', null,null,null, null, 'U033'), false, 'La foto no corresponde a la suerte', 'U005');
select public.af__revisar(public.af__reportar(gen_random_uuid(), pg_temp.lab('0004','ROTURACIÓN'), 5.68, '2026-08-20'::date, '', null,null,null, null, 'U033'), true, null, 'U005');
select public.af__revisar(public.af__reportar(gen_random_uuid(), pg_temp.lab('0004','FERTILIZACIÓN'), 5.68, '2026-09-05'::date, '', null,null,null, null, 'U033'), true, null, 'U005');
select public.af__revisar(public.af__reportar(gen_random_uuid(), pg_temp.lab('0004','CONTROL DE MALEZAS'), 2.84, '2026-10-18'::date, '', null,null,null, null, 'U033'), true, null, 'U005');
select public.af__revisar(public.af__reportar(gen_random_uuid(), pg_temp.lab('0004','RIEGO'), 5.68, '2026-10-10'::date, '', null,null,null, null, 'U033'), true, null, 'U005');
select public.af__revisar(public.af__reportar(gen_random_uuid(), pg_temp.lab('0004A','ROTURACIÓN'), 3.47, '2026-07-25'::date, '', null,null,null, null, 'U033'), true, null, 'U005');
select public.af__revisar(public.af__reportar(gen_random_uuid(), pg_temp.lab('0004A','FERTILIZACIÓN'), 3.47, '2026-08-14'::date, '', null,null,null, null, 'U033'), true, null, 'U005');
select public.af__revisar(public.af__reportar(gen_random_uuid(), pg_temp.lab('0004A','CONTROL DE MALEZAS'), 1.74, '2026-09-25'::date, '', null,null,null, null, 'U033'), true, null, 'U005');
select public.af__revisar(public.af__reportar(gen_random_uuid(), pg_temp.lab('0005','ROTURACIÓN'), 5.89, '2026-07-19'::date, '', null,null,null, null, 'U033'), true, null, 'U005');
select public.af__revisar(public.af__reportar(gen_random_uuid(), pg_temp.lab('0005','FERTILIZACIÓN'), 5.89, '2026-08-10'::date, '', null,null,null, null, 'U033'), true, null, 'U005');
select public.af__revisar(public.af__reportar(gen_random_uuid(), pg_temp.lab('0005','RIEGO'), 5.89, '2026-08-20'::date, '', null,null,null, null, 'U033'), true, null, 'U005');
select public.af__revisar(public.af__reportar(gen_random_uuid(), pg_temp.lab('0005','RIEGO'), 5.89, '2026-10-05'::date, '', null,null,null, null, 'U033'), true, null, 'U005');
select public.af__revisar(public.af__reportar(gen_random_uuid(), pg_temp.lab('0005B','ROTURACIÓN'), 9.17, '2026-07-14'::date, '', null,null,null, null, 'U033'), true, null, 'U005');
select public.af__revisar(public.af__reportar(gen_random_uuid(), pg_temp.lab('0005B','FERTILIZACIÓN'), 9.17, '2026-08-05'::date, '', null,null,null, null, 'U033'), true, null, 'U005');
select public.af__revisar(public.af__reportar(gen_random_uuid(), pg_temp.lab('0005B','CONTROL DE MALEZAS'), 4.58, '2026-09-20'::date, '', null,null,null, null, 'U033'), true, null, 'U005');
select public.af__revisar(public.af__reportar(gen_random_uuid(), pg_temp.lab('0006','ROTURACIÓN'), 1.47, '2026-09-30'::date, '', null,null,null, null, 'U033'), true, null, 'U005');
select public.af__reportar(gen_random_uuid(), pg_temp.lab('0006','FERTILIZACIÓN'), 1.47, '2026-10-21'::date, '', null,null,null, null, 'U033');
select public.af__revisar(public.af__reportar(gen_random_uuid(), pg_temp.lab('0007','ROTURACIÓN'), 5.56, '2026-02-19'::date, '', null,null,null, null, 'U033'), true, null, 'U005');
select public.af__revisar(public.af__reportar(gen_random_uuid(), pg_temp.lab('0007','FERTILIZACIÓN'), 5.56, '2026-03-11'::date, '', null,null,null, null, 'U033'), true, null, 'U005');
select public.af__revisar(public.af__reportar(gen_random_uuid(), pg_temp.lab('0007','CONTROL DE MALEZAS'), 2.78, '2026-05-01'::date, '', null,null,null, null, 'U033'), true, null, 'U005');

insert into public.af_movimientos (finca_id, tipo, fecha, concepto, valor, suerte_id, soporte_url, registrado_por)
values ((select id from public.af_fincas where nombre='RIOGRANDE PRUEBAS'), 'ANTICIPO', '2026-07-01', 'Transferencia del dueño (anticipo)', 20000000, null, null, 'U005');
insert into public.af_movimientos (finca_id, tipo, fecha, concepto, valor, soporte_url, registrado_por)
values ((select id from public.af_fincas where nombre='RIOGRANDE PRUEBAS'), 'GASTO', '2026-10-05', 'Compra de herbicida', 1250000, '/pwa-192x192.png', 'U005');
insert into public.af_movimientos (finca_id, tipo, fecha, concepto, valor, soporte_url, registrado_por, anulado, anulado_por, anulado_motivo, anulado_en)
values ((select id from public.af_fincas where nombre='RIOGRANDE PRUEBAS'), 'GASTO', '2026-10-06', 'Flete de insumos', 380000, '/pwa-192x192.png', 'U005', true, 'U005', 'Se registró dos veces', now());
insert into public.af_movimientos (finca_id, tipo, fecha, concepto, valor, registrado_por)
values ((select id from public.af_fincas where nombre='RIOGRANDE PRUEBAS'), 'HONORARIO', '2026-09-30', 'Honorario de administración (8 %)', round(0.08 * (select sum(valor) from public.af_movimientos m join public.af_fincas f on f.id=m.finca_id where f.nombre='RIOGRANDE PRUEBAS' and m.tipo='GASTO' and not m.anulado)), 'U005');

do $$ declare v text := public.af_token_nuevo(); begin
  insert into public.af_accesos (finca_id, token_hash, nombre, creado_por)
  select id, public.af_hash(v), 'Dueño PRUEBA (demo)', 'U005' from public.af_fincas where nombre='RIOGRANDE PRUEBAS';
  raise notice 'ENLACE_DUENO=https://agroserviciosmorales.vercel.app/#finca=%', v;
end $$;

select 'suertes' as tipo, count(*) from public.af_suertes where finca_id=(select id from public.af_fincas where nombre='RIOGRANDE PRUEBAS')
union all select 'ciclos', count(*) from public.af_ciclos c join public.af_suertes s on s.id=c.suerte_id where s.finca_id=(select id from public.af_fincas where nombre='RIOGRANDE PRUEBAS')
union all select 'labores', count(*) from public.af_labores l join public.af_ciclos c on c.id=l.ciclo_id join public.af_suertes s on s.id=c.suerte_id where s.finca_id=(select id from public.af_fincas where nombre='RIOGRANDE PRUEBAS')
union all select 'poligonos', count(*) from public.af_poligonos where finca_id=(select id from public.af_fincas where nombre='RIOGRANDE PRUEBAS');
select r.estado, count(*) from public.af_reportes r join public.af_labores l on l.id=r.labor_id join public.af_ciclos c on c.id=l.ciclo_id join public.af_suertes s on s.id=c.suerte_id where s.finca_id=(select id from public.af_fincas where nombre='RIOGRANDE PRUEBAS') group by r.estado order by r.estado;
select tipo, count(*) from public.af_movimientos where finca_id=(select id from public.af_fincas where nombre='RIOGRANDE PRUEBAS') group by tipo order by tipo;
select
  coalesce(sum(valor) filter (where tipo='ANTICIPO' and not anulado), 0)
  - coalesce(sum(valor) filter (where tipo='GASTO' and not anulado), 0)
  - coalesce(sum(valor) filter (where tipo='HONORARIO' and not anulado), 0) as saldo
from public.af_movimientos where finca_id=(select id from public.af_fincas where nombre='RIOGRANDE PRUEBAS');
