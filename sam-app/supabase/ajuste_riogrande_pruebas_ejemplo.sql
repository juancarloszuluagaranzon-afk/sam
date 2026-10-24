-- Pasa la finca de prueba RIOGRANDE PRUEBAS a datos de EJEMPLO (24-oct-2026).
-- Requiere la migración 20261024090000_fincas_costos_indicadores.sql.
-- Ejecutar con psql -v ON_ERROR_STOP=1 --single-transaction.
--
-- Por qué: el seed copió los datos del ingenio (TCH, rendimiento…) de la finca REAL, y el
-- enlace de esta finca de prueba es para mostrárselo a clientes. Además el tablero de
-- costos necesita los costos COMPLETOS del ciclo (insumos, agua, administración…): con
-- solo las labores del paquete daba ~$400.000/ha, irreal frente a los ~$8 M/ha de Procaña.
-- Todo lo de aquí es inventado y va marcado como ejemplo.
select set_config('af.via_funcion','1', true);

do $$ begin
  if not exists (select 1 from public.af_fincas where nombre = 'RIOGRANDE PRUEBAS') then
    raise exception 'NO_EXISTE: primero corre seed_riogrande_pruebas.sql' using errcode = 'no_data_found';
  end if;
end $$;

-- 1. Parámetros económicos de ejemplo (58 kg = compraventa tradicional; $1.983/kg = el implícito
--    en la plantilla de Procaña 2022). En una finca real los fija administración con la liquidación.
update public.af_fincas set kg_azucar_tc = 58, precio_kg_azucar = 1983, editado_por = 'U005'
 where nombre = 'RIOGRANDE PRUEBAS';

-- 2. Datos del ingenio de EJEMPLO por suerte (reemplazan los copiados de la finca real).
update public.af_suertes s set
  datos_ingenio = jsonb_build_object(
    'tch', v.tch, 'toneladas', round(v.tch * s.area_ha, 1), 'rendimiento', v.rend, 'sacarosa', v.sac,
    'edad_meses', v.edad, 'numero_corte', v.corte, 'f_ult_corte', c.fecha_corte,
    'fuente', 'Ejemplo (finca de prueba: no son datos reales)'),
  editado_por = 'U005'
from (values
  ('0001',  121.4, 10.1, 11.8, 12.6, 4),
  ('0002',  131.2, 10.5, 12.2, 13.0, 6),
  ('0002A', 118.6,  9.9, 11.6, 12.4, 7),
  ('0003',  126.8, 10.2, 11.9, 12.9, 5),
  ('0003A', 124.3, 10.4, 12.1, 12.7, 5),
  ('0004',  134.5, 10.6, 12.3, 13.1, 4),
  ('0004A', 129.7, 10.3, 12.0, 12.8, 5),
  ('0005',  127.9, 10.2, 11.9, 12.6, 6),
  ('0005B', 129.1, 10.3, 12.0, 12.9, 5),
  ('0006',  122.5, 10.0, 11.7, 12.5, 3),
  ('0007',  125.2, 10.4, 12.1, 12.7, 4)
) as v(codigo, tch, rend, sac, edad, corte),
  public.af_fincas f, public.af_ciclos c
where f.nombre = 'RIOGRANDE PRUEBAS' and s.finca_id = f.id and s.codigo = v.codigo
  and c.suerte_id = s.id and c.estado = 'ABIERTO';

-- 3. Movimientos a mano: se reemplazan por un juego COMPLETO y coherente, con su rubro.
--    (Los gastos de las labores aceptadas no se tocan: esos los creó la aceptación.)
delete from public.af_movimientos m using public.af_fincas f
 where f.nombre = 'RIOGRANDE PRUEBAS' and m.finca_id = f.id and m.reporte_id is null;

insert into public.af_movimientos (finca_id, tipo, fecha, concepto, valor, soporte_url, registrado_por, rubro)
select f.id, x.tipo, x.fecha::date, x.concepto, x.valor, x.soporte, 'U005', x.rubro
from public.af_fincas f, (values
  ('ANTICIPO', '2026-02-15', 'Anticipo del dueño · arranque del ciclo',            120000000, null::text, null::text),
  ('ANTICIPO', '2026-06-01', 'Anticipo del dueño · segundo giro',                  110000000, null, null),
  ('ANTICIPO', '2026-09-01', 'Anticipo del dueño · tercer giro',                     90000000, null, null),
  ('GASTO',    '2026-03-05', 'Fertilizante (urea y cloruro de potasio)',            45000000, '/pwa-192x192.png', 'insumos'),
  ('GASTO',    '2026-05-10', 'Herbicidas y madurante',                              28730000, '/pwa-192x192.png', 'insumos'),
  ('GASTO',    '2026-04-20', 'Riego por gravedad · turnos de agua y energía',       34000000, '/pwa-192x192.png', 'agua'),
  ('GASTO',    '2026-08-20', 'Riego por gravedad · turnos de agua y energía',       33780000, '/pwa-192x192.png', 'agua'),
  ('GASTO',    '2026-04-05', 'Jornales de campo: resiembra, acequias y callejones', 21600000, '/pwa-192x192.png', 'mano_obra'),
  ('GASTO',    '2026-09-10', 'Jornales de campo: aplicaciones y mantenimiento',     21500000, '/pwa-192x192.png', 'mano_obra'),
  ('GASTO',    '2026-03-20', 'Cultivo y aporque mecanizado',                         7180000, '/pwa-192x192.png', 'maquinaria'),
  ('GASTO',    '2026-03-31', 'Impuesto predial y fondos del sector',                26640000, '/pwa-192x192.png', 'predial_fondos'),
  ('GASTO',    '2026-03-12', 'Semilla para resiembra',                               7050000, '/pwa-192x192.png', 'semilla'),
  ('GASTO',    '2026-06-30', 'Contabilidad, mayordomo y vehículo',                  43780000, '/pwa-192x192.png', 'administracion')
) as x(tipo, fecha, concepto, valor, soporte, rubro)
where f.nombre = 'RIOGRANDE PRUEBAS';

-- Un gasto ANULADO, para que se vea que nada se borra.
insert into public.af_movimientos (finca_id, tipo, fecha, concepto, valor, soporte_url, registrado_por, rubro,
                                   anulado, anulado_por, anulado_motivo, anulado_en)
select id, 'GASTO', '2026-10-06', 'Flete de insumos', 380000, '/pwa-192x192.png', 'U005', 'otros',
       true, 'U005', 'Se registró dos veces', now()
  from public.af_fincas where nombre = 'RIOGRANDE PRUEBAS';

-- Honorario de administración: 8 % de lo gastado (después de los gastos, para que la suma esté completa).
insert into public.af_movimientos (finca_id, tipo, fecha, concepto, valor, registrado_por, rubro)
select f.id, 'HONORARIO', '2026-09-30', 'Honorario de administración (8 %)',
       round(0.08 * (select sum(m.valor) from public.af_movimientos m
                      where m.finca_id = f.id and m.tipo = 'GASTO' and not m.anulado)),
       'U005', 'administracion'
  from public.af_fincas f where f.nombre = 'RIOGRANDE PRUEBAS';

-- 4. Verificación: lo que el tablero debería mostrar.
with f as (select id, kg_azucar_tc kg, precio_kg_azucar precio from public.af_fincas where nombre = 'RIOGRANDE PRUEBAS'),
s as (select s.* from public.af_suertes s, f where s.finca_id = f.id and s.activa),
cos as (
  select sum(m.valor) total from public.af_movimientos m, f
   where m.finca_id = f.id and not m.anulado and m.tipo in ('GASTO','HONORARIO')
     and m.fecha >= (select min(c.fecha_corte) from public.af_ciclos c join s on s.id = c.suerte_id where c.estado = 'ABIERTO')),
ind as (
  select sum(s.area_ha) area,
         sum((s.datos_ingenio->>'tch')::numeric * s.area_ha) / sum(s.area_ha) tch,
         sum((s.datos_ingenio->>'rendimiento')::numeric * (s.datos_ingenio->>'toneladas')::numeric) / sum((s.datos_ingenio->>'toneladas')::numeric) rend,
         sum((s.datos_ingenio->>'toneladas')::numeric) ton
    from s)
select round(ind.tch, 1) tch, round(ind.rend, 2) rendimiento, round(ind.tch * ind.rend / 100, 1) tah, round(ind.ton) toneladas,
       round(cos.total) costo_total, round(cos.total / ind.area) costo_ha, round(cos.total / ind.area / ind.tch) costo_tc,
       round(cos.total / ind.area / ind.tch / f.precio, 1) ka_tc, round(f.kg - cos.total / ind.area / ind.tch / f.precio, 1) kg_libres,
       round(cos.total / ind.area / (f.kg * f.precio), 1) punto_equilibrio
  from ind, cos, f;
select tipo, count(*), sum(valor) filter (where not anulado) from public.af_movimientos m join public.af_fincas f on f.id = m.finca_id
 where f.nombre = 'RIOGRANDE PRUEBAS' group by tipo order by tipo;
