-- ============================================================================
-- 20261002190000 — TARIFAS REALES por razón social, cliente, labor y modalidad (2-oct-2026)
--
-- Tabla que mandó Iván («TARIFAS IVAN APP.xlsx»): dos razones sociales
-- (AGROMORALES / CEBALLOS Y LOZANO) × clientes (San Carlos, Riopaila, Riopaila
-- Agrícola, Mayagüez, Risaralda, Pichichí, Proveedor) × labor (+ modalidad).
--
-- · `tarifas` gana: razon_social, cliente_clave, modalidad (null = vale para todas),
--   unidad (ha / hm / h / jornal) y etiqueta (como la escribe el cliente).
-- · Las 27 tarifas de EJEMPLO se respaldan (respaldo_tarifas_20261002) y se borran.
-- · Vigencia: desde el 1-may-2026 (cubre todo lo registrado en la app).
-- · Riopaila Agrícola ≠ Ingenio Riopaila: se separa por HACIENDA, lista
--   `HACIENDA_RIOPAILA_AGRICOLA` en catalogos_valores (editable en Más → Listas),
--   sembrada con las haciendas de «Agricola.xlsx».
-- · Fertilización y cultivo tienen precio por modalidad → listas MODALIDAD:… y
--   a lo realizado sin modalidad se le pone la sugerida 2X1 (regla aprobada el
--   2-oct), con respaldo en respaldo_modalidad_20261002.
-- ============================================================================

create table if not exists public.respaldo_tarifas_20261002 as select * from public.tarifas;
revoke all on public.respaldo_tarifas_20261002 from anon, authenticated;
delete from public.tarifas;

alter table public.tarifas add column if not exists razon_social text;
alter table public.tarifas add column if not exists cliente_clave text;
alter table public.tarifas add column if not exists modalidad text;
alter table public.tarifas add column if not exists unidad text not null default 'ha';
alter table public.tarifas add column if not exists etiqueta text;
alter table public.tarifas drop constraint if exists tarifas_unidad_ck;
alter table public.tarifas add constraint tarifas_unidad_ck check (unidad in ('ha', 'hm', 'h', 'jornal'));

-- La llave ahora incluye razón social, cliente y modalidad.
drop index if exists public.tarifas_vigencia_uq;
create unique index tarifas_vigencia_uq on public.tarifas (
  coalesce(razon_social, ''), coalesce(cliente_clave, ''),
  coalesce(tercero_id, '00000000-0000-0000-0000-000000000000'::uuid),
  upper(labor_nombre), coalesce(upper(modalidad), ''), vigente_desde
);

insert into public.tarifas (razon_social, cliente_clave, labor_nombre, modalidad, unidad, precio_ha, etiqueta, vigente_desde, nota, creado_por)
values
  ('AGROMORALES', 'SAN_CARLOS', 'DESPEJE', null, 'ha', 85786, 'Despeje', '2026-05-01', 'Tabla de Iván 2-oct-2026', 'IMPORTE'),
  ('AGROMORALES', 'SAN_CARLOS', 'REENCALLE', null, 'ha', 85786, 'Reencalle', '2026-05-01', 'Tabla de Iván 2-oct-2026', 'IMPORTE'),
  ('AGROMORALES', 'RIOPAILA', 'DESPEJE', null, 'ha', 107203, 'Despeje', '2026-05-01', 'Tabla de Iván 2-oct-2026', 'IMPORTE'),
  ('AGROMORALES', 'RIOPAILA', 'REENCALLE', null, 'ha', 97364, 'Reencalle', '2026-05-01', 'Tabla de Iván 2-oct-2026', 'IMPORTE'),
  ('AGROMORALES', 'RIOPAILA', 'REENCALLE', 'VERDE', 'ha', 181728, 'Reencalle caña cruda', '2026-05-01', 'Tabla de Iván 2-oct-2026', 'IMPORTE'),
  ('AGROMORALES', 'RIOPAILA', 'TRIPLE', null, 'ha', 187554, 'Triple', '2026-05-01', 'Tabla de Iván 2-oct-2026', 'IMPORTE'),
  ('AGROMORALES', 'RIOPAILA', 'CULTIVO', null, 'ha', 139678, 'Cultivo aporque', '2026-05-01', 'Tabla de Iván 2-oct-2026', 'IMPORTE'),
  ('AGROMORALES', 'RIOPAILA', 'OFICIOS VARIOS', 'POR JORNAL', 'jornal', 640000, 'Of, varios', '2026-05-01', 'Tabla de Iván 2-oct-2026 (jornal)', 'IMPORTE'),
  ('AGROMORALES', 'RIOPAILA_AGRICOLA', 'REENCALLE', null, 'ha', 111000, 'Reencalle', '2026-05-01', 'Tabla de Iván 2-oct-2026', 'IMPORTE'),
  ('AGROMORALES', 'RIOPAILA_AGRICOLA', 'FERTILIZACION', 'PLANTILLA', 'ha', 167214, 'Abono Plantilla', '2026-05-01', 'Tabla de Iván 2-oct-2026', 'IMPORTE'),
  ('AGROMORALES', 'RIOPAILA_AGRICOLA', 'FERTILIZACION', '2X1', 'ha', 159000, 'Abono 2x1', '2026-05-01', 'Tabla de Iván 2-oct-2026', 'IMPORTE'),
  ('AGROMORALES', 'RIOPAILA_AGRICOLA', 'FERTILIZACION', '4X1', 'ha', 165563, 'Abono 4x1', '2026-05-01', 'Tabla de Iván 2-oct-2026', 'IMPORTE'),
  ('AGROMORALES', 'RIOPAILA_AGRICOLA', 'ACEQUIAS', null, 'hm', 70000, 'Acequias', '2026-05-01', 'Tabla de Iván 2-oct-2026 (hm, incluye 2 pases)', 'IMPORTE'),
  ('AGROMORALES', 'RIOPAILA_AGRICOLA', 'OFICIOS VARIOS', 'POR HORA', 'h', 50000, 'Of, varios ha', '2026-05-01', 'Tabla de Iván 2-oct-2026 (por hora)', 'IMPORTE'),
  ('AGROMORALES', 'RIOPAILA_AGRICOLA', 'SUBSUELO', null, 'ha', 260000, 'Subsuelo', '2026-05-01', 'Tabla de Iván 2-oct-2026', 'IMPORTE'),
  ('AGROMORALES', 'RIOPAILA_AGRICOLA', 'TRIPLE', null, 'ha', 219764, 'Triple', '2026-05-01', 'Tabla de Iván 2-oct-2026', 'IMPORTE'),
  ('AGROMORALES', 'RIOPAILA_AGRICOLA', 'CULTIVO', null, 'ha', 106900, 'Cultivo aporque', '2026-05-01', 'Tabla de Iván 2-oct-2026', 'IMPORTE'),
  ('AGROMORALES', 'MAYAGUEZ', 'DESPEJE', null, 'ha', 85786, 'Despeje', '2026-05-01', 'Tabla de Iván 2-oct-2026', 'IMPORTE'),
  ('AGROMORALES', 'MAYAGUEZ', 'REENCALLE', null, 'ha', 85786, 'Reencalle', '2026-05-01', 'Tabla de Iván 2-oct-2026', 'IMPORTE'),
  ('AGROMORALES', 'RISARALDA', 'DESPEJE', null, 'ha', 105574.36, 'Despeje', '2026-05-01', 'Tabla de Iván 2-oct-2026', 'IMPORTE'),
  ('AGROMORALES', 'RISARALDA', 'REENCALLE', null, 'ha', 97858.76, 'Reencalle', '2026-05-01', 'Tabla de Iván 2-oct-2026', 'IMPORTE'),
  ('CEBALLOS Y LOZANO', 'PICHICHI', 'DESPEJE', null, 'ha', 82504, 'Despeje', '2026-05-01', 'Tabla de Iván 2-oct-2026', 'IMPORTE'),
  ('CEBALLOS Y LOZANO', 'PICHICHI', 'REENCALLE', null, 'ha', 82504, 'Reencalle', '2026-05-01', 'Tabla de Iván 2-oct-2026', 'IMPORTE'),
  ('CEBALLOS Y LOZANO', 'PICHICHI', 'SUBSUELO', null, 'ha', 208489, 'Subsuelo', '2026-05-01', 'Tabla de Iván 2-oct-2026', 'IMPORTE'),
  ('CEBALLOS Y LOZANO', 'PICHICHI', 'TRIPLE', null, 'ha', 169003, 'Triple', '2026-05-01', 'Tabla de Iván 2-oct-2026', 'IMPORTE'),
  ('CEBALLOS Y LOZANO', 'RIOPAILA', 'DESPEJE', null, 'ha', 108028, 'Despeje', '2026-05-01', 'Tabla de Iván 2-oct-2026 (alternativa al de AGROMORALES)', 'IMPORTE'),
  ('CEBALLOS Y LOZANO', 'PROVEEDOR', 'REENCALLE', null, 'ha', 105000, 'Reencalle', '2026-05-01', 'Tabla de Iván 2-oct-2026', 'IMPORTE'),
  ('CEBALLOS Y LOZANO', 'PROVEEDOR', 'REENCALLE', 'VERDE', 'ha', 190000, 'Reencalle caña verde', '2026-05-01', 'Tabla de Iván 2-oct-2026', 'IMPORTE'),
  ('CEBALLOS Y LOZANO', 'PROVEEDOR', 'SUBSUELO', null, 'ha', 225000, 'Subsuelo', '2026-05-01', 'Tabla de Iván 2-oct-2026', 'IMPORTE'),
  ('CEBALLOS Y LOZANO', 'PROVEEDOR', 'TRIPLE', null, 'ha', 225000, 'Triple', '2026-05-01', 'Tabla de Iván 2-oct-2026', 'IMPORTE'),
  ('CEBALLOS Y LOZANO', 'PROVEEDOR', 'SUBSUELO', '4X1', 'ha', 240000, 'Subsuelo 4x1', '2026-05-01', 'Tabla de Iván 2-oct-2026', 'IMPORTE'),
  ('CEBALLOS Y LOZANO', 'PROVEEDOR', 'TRIPLE', '4X1', 'ha', 240000, 'Triple 4x1', '2026-05-01', 'Tabla de Iván 2-oct-2026', 'IMPORTE'),
  ('CEBALLOS Y LOZANO', 'PROVEEDOR', 'FERTILIZACION', 'PLANTILLA', 'ha', 170000, 'Abono Plantilla', '2026-05-01', 'Tabla de Iván 2-oct-2026', 'IMPORTE'),
  ('CEBALLOS Y LOZANO', 'PROVEEDOR', 'FERTILIZACION', '2X1', 'ha', 160000, 'Abono 2x1', '2026-05-01', 'Tabla de Iván 2-oct-2026', 'IMPORTE'),
  ('CEBALLOS Y LOZANO', 'PROVEEDOR', 'CULTIVO', 'PLANTILLA', 'ha', 130000, 'Cultivo aporque plantilla', '2026-05-01', 'Tabla de Iván 2-oct-2026', 'IMPORTE'),
  ('CEBALLOS Y LOZANO', 'PROVEEDOR', 'CULTIVO', '2X1', 'ha', 120000, 'Cultivo aporque 2x1', '2026-05-01', 'Tabla de Iván 2-oct-2026', 'IMPORTE'),
  ('CEBALLOS Y LOZANO', 'PROVEEDOR', 'ACEQUIAS', null, 'hm', 85000, 'Acequias', '2026-05-01', 'Tabla de Iván 2-oct-2026 (hm, incluye 2 pases)', 'IMPORTE');

-- Haciendas que se facturan como RIOPAILA AGRÍCOLA (de «Agricola.xlsx»; editable en Listas).
insert into public.catalogos_valores (tipo, valor, orden, frecuente) values
  ('HACIENDA_RIOPAILA_AGRICOLA', 'VENECIA', 1, true), ('HACIENDA_RIOPAILA_AGRICOLA', 'MORILLO', 2, true),
  ('HACIENDA_RIOPAILA_AGRICOLA', 'VALPARAISO', 3, true), ('HACIENDA_RIOPAILA_AGRICOLA', 'ZAMBRANO', 4, true),
  ('HACIENDA_RIOPAILA_AGRICOLA', 'LAGUNAS', 5, true), ('HACIENDA_RIOPAILA_AGRICOLA', 'LA LUISA BENGALA', 6, true),
  ('HACIENDA_RIOPAILA_AGRICOLA', 'NORMANDIA', 7, true), ('HACIENDA_RIOPAILA_AGRICOLA', 'PERALONSO', 8, true),
  ('HACIENDA_RIOPAILA_AGRICOLA', 'GERTRUDIS', 9, true)
on conflict (tipo, upper(valor)) do nothing;

-- Fertilización y cultivo: precio por modalidad.
insert into public.catalogos_valores (tipo, valor, orden, frecuente) values
  ('MODALIDAD:FERTILIZACION', 'PLANTILLA', 1, true), ('MODALIDAD:FERTILIZACION', '2X1', 2, true),
  ('MODALIDAD:FERTILIZACION', '4X1', 3, true),
  ('MODALIDAD:CULTIVO', 'PLANTILLA', 1, true), ('MODALIDAD:CULTIVO', '2X1', 2, true)
on conflict (tipo, upper(valor)) do nothing;

insert into public.respaldo_modalidad_20261002 (id, labor_nombre, estado, modalidad_antes, respaldado_en)
select a.id, a.labor_nombre, a.estado, a.modalidad, now()
  from public.asignaciones a
 where a.estado in ('COMPLETADA', 'PARCIAL') and coalesce(a.modalidad, '') = ''
   and upper(trim(a.labor_nombre)) in ('FERTILIZACION', 'CULTIVO', 'OFICIOS VARIOS')
   and not exists (select 1 from public.respaldo_modalidad_20261002 r where r.id = a.id);
update public.asignaciones a
   set modalidad = case upper(trim(a.labor_nombre)) when 'OFICIOS VARIOS' then 'POR HORA' else '2X1' end
 where a.estado in ('COMPLETADA', 'PARCIAL') and coalesce(a.modalidad, '') = ''
   and upper(trim(a.labor_nombre)) in ('FERTILIZACION', 'CULTIVO', 'OFICIOS VARIOS');
