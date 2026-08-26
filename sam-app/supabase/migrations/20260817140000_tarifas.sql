-- Tarifas: cuánto se le cobra a cada cliente por hectárea de cada labor.
--
-- Es la pieza que falta para poder facturar. Hoy hay 3.192 labores cerradas y
-- 17.475 hectáreas ejecutadas, y ni una sola factura — porque no existe en
-- ninguna parte el precio.
--
-- ⚠️ CON VIGENCIA POR FECHAS, no una sola columna `precio`. Los precios se
-- renegocian, y una tabla con un precio único reescribe el pasado: al subir la
-- tarifa en octubre, las facturas de julio empezarían a mostrar otro valor. Con
-- vigencia, cada labor se cobra al precio que regía **el día que se ejecutó**.

create table if not exists tarifas (
  id uuid primary key default gen_random_uuid(),
  -- NULL = tarifa GENERAL, la que aplica a cualquier cliente que no tenga una
  -- propia. Así un cliente nuevo no bloquea el cobro mientras se le negocia.
  tercero_id uuid references terceros(id) on delete cascade,
  labor_nombre text not null,
  precio_ha numeric(14,2) not null check (precio_ha > 0),
  vigente_desde date not null,
  -- NULL = sigue vigente hoy. Al cambiar el precio se cierra la anterior y se
  -- abre una nueva; NUNCA se edita el precio de una vigencia pasada.
  vigente_hasta date,
  nota text,
  creado_por text,
  created_at timestamptz not null default now(),
  constraint tarifas_rango_valido check (vigente_hasta is null or vigente_hasta >= vigente_desde)
);

comment on table tarifas is
  'Precio por hectárea, por cliente y labor, CON VIGENCIA. La tarifa se resuelve '
  'a la fecha de EJECUCIÓN de la labor, no a la de la factura: una labor de julio '
  'facturada en agosto se cobra al precio de julio.';
comment on column tarifas.tercero_id is
  'NULL = tarifa general (aplica a quien no tenga una propia). La del cliente le gana.';

-- Una sola tarifa por cliente+labor+fecha de inicio. El coalesce es porque en
-- Postgres dos NULL no son iguales, así que sin él se podrían crear varias
-- tarifas generales idénticas para la misma labor y fecha.
create unique index if not exists tarifas_vigencia_uq on tarifas (
  coalesce(tercero_id, '00000000-0000-0000-0000-000000000000'::uuid),
  upper(labor_nombre),
  vigente_desde
);
create index if not exists tarifas_labor_idx on tarifas (upper(labor_nombre), vigente_desde desc);

-- ---------------------------------------------------------------------------
-- Resolver la tarifa de una labor
-- ---------------------------------------------------------------------------
-- El orden del `order by` es la regla de negocio: primero la del cliente, y si
-- no tiene, la general. Dentro de las que aplican, la más reciente.

create or replace function tarifa_de(p_tercero uuid, p_labor text, p_fecha date)
returns numeric
language sql stable
as $$
  select t.precio_ha
    from tarifas t
   where upper(t.labor_nombre) = upper(p_labor)
     and (t.tercero_id = p_tercero or t.tercero_id is null)
     and t.vigente_desde <= p_fecha
     and (t.vigente_hasta is null or t.vigente_hasta >= p_fecha)
   order by (t.tercero_id is null), t.vigente_desde desc
   limit 1
$$;

comment on function tarifa_de is
  'Precio por hectárea que aplica a esa labor, para ese cliente, EN ESA FECHA. '
  'null = no hay tarifa: la labor no se puede facturar todavía.';

-- ---------------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------------
alter table tarifas enable row level security;
drop policy if exists tarifas_rw on tarifas;
create policy tarifas_rw on tarifas for all to anon, authenticated
  using (true) with check (true);
grant select, insert, update, delete on tarifas to anon, authenticated;
grant execute on function tarifa_de(uuid, text, date) to anon, authenticated;

notify pgrst, 'reload schema';
