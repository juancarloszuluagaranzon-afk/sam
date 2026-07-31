-- ============================================================================
-- Autoabastecimiento del satélite, con aval posterior del analista
--
-- El supervisor de insumos llega a las 5:30 de la mañana; el analista entra a
-- las 7:00. Con el combustible ya podía servirse solo (tanqueo `origen=SEDE`)
-- y Diego avalaba después, pero con los MATERIALES no: los ganchos solo
-- entraban a su carro por un traslado que creaba administración. Si no había
-- nadie, se quedaba sin material o se lo llevaba sin registrar — que es peor.
--
-- Ahora puede tomar de la principal por su cuenta. El movimiento se hace de una
-- (físicamente ya se lo llevó) y queda PENDIENTE del aval; si el analista lo
-- rechaza, se reversa. Mismo trato que el combustible.
--
-- Se reusa `insumos_traslados` en vez de crear una tabla nueva: es exactamente
-- lo que ya modela —material que se mueve entre dos bodegas, con ítems— y dos
-- tablas para el mismo hecho obligarían a unir las dos en cada reporte.
-- ============================================================================

alter table public.insumos_traslados
  -- Lo tomó el propio supervisor, sin que administración se lo enviara. Es lo
  -- que distingue este caso del traslado clásico y lo que lo manda al aval.
  add column if not exists autoservicio boolean not null default false,
  add column if not exists aval_estado text,
  add column if not exists avalado_por text,
  add column if not exists avalado_nombre text,
  add column if not exists avalado_en timestamptz,
  add column if not exists aval_nota text;

alter table public.insumos_traslados
  drop constraint if exists insumos_traslados_aval_check;
alter table public.insumos_traslados
  add constraint insumos_traslados_aval_check
  check (aval_estado is null or aval_estado in ('PENDIENTE', 'APROBADO', 'RECHAZADO'));

-- Solo el autoservicio necesita aval. Los traslados que envía administración ya
-- los avala quien recibe, y volver a pedirlos sería un paso de más.
update public.insumos_traslados set aval_estado = null where autoservicio = false;

create index if not exists traslados_aval_ix
  on public.insumos_traslados (aval_estado, created_at desc)
  where autoservicio;
