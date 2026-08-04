-- Editar un despacho ya entregado: fecha, máquina y cantidad.
--
-- El caso real: el supervisor entrega a las 6 de la mañana y registra a las 4 de
-- la tarde cuando vuelve a tener señal, o se equivoca de máquina, o anota 20
-- galones donde eran 25. Hoy eso no se puede corregir y el reporte queda mal
-- para siempre.
--
-- LA REGLA QUE PIDIÓ EL CLIENTE: la fecha del registro original se conserva como
-- auditoría, pero para informes y cruce de información manda la fecha editada.
-- Son dos fechas distintas y las dos importan:
--
--   created_at      cuándo se tecleó. Inmutable. Es la auditoría.
--   fecha_efectiva  cuándo ocurrió de verdad. Es la que usan los reportes.
--
-- Por qué una columna nueva y no reescribir `created_at`: si se pisa el
-- created_at se pierde para siempre la evidencia de cuándo se registró, que es
-- justo lo que permite detectar a alguien retrofechando movimientos. La columna
-- separada deja las dos preguntas contestables.

-- ---------------------------------------------------------------------------
-- 1. La fecha efectiva del movimiento
-- ---------------------------------------------------------------------------

alter table insumos_kardex
  add column if not exists fecha_efectiva timestamptz;

-- Backfill: para todo lo ya registrado, la fecha efectiva ES la de registro.
update insumos_kardex set fecha_efectiva = created_at where fecha_efectiva is null;

-- NOT NULL con default para que la app pueda filtrar por esta columna sin
-- coalesce. PostgREST no filtra sobre expresiones, y un `null` suelto dejaría
-- movimientos por fuera de todos los rangos de fecha — invisibles en los
-- reportes, que es el peor modo de fallar.
alter table insumos_kardex
  alter column fecha_efectiva set default now();
alter table insumos_kardex
  alter column fecha_efectiva set not null;

comment on column insumos_kardex.fecha_efectiva is
  'Cuándo ocurrió el movimiento de verdad. La usan TODOS los reportes. '
  'Editable desde "Editar despacho". created_at queda como la fecha de registro, '
  'inmutable, para auditoría.';

-- Los reportes filtran y ordenan por esta columna en cada carga.
create index if not exists insumos_kardex_fecha_efectiva_idx
  on insumos_kardex (fecha_efectiva desc);

-- ---------------------------------------------------------------------------
-- 2. Auditoría de las ediciones
-- ---------------------------------------------------------------------------
--
-- Mismo patrón que `asignaciones_auditoria`, que ya lleva 7.019 eventos: una
-- fila por edición con el antes y el después en jsonb. No se normaliza por
-- campo porque lo que se consulta es "qué le pasó a este despacho", nunca
-- "todos los cambios de cantidad de la historia".

create table if not exists insumos_despachos_auditoria (
  id           bigserial primary key,
  solicitud_id text        not null,
  accion       text        not null default 'EDITAR',
  cambios      jsonb       not null,
  editado_por  text,
  editado_en   timestamptz not null default now()
);

create index if not exists insumos_despachos_auditoria_solicitud_idx
  on insumos_despachos_auditoria (solicitud_id, editado_en desc);

comment on table insumos_despachos_auditoria is
  'Cada edición de un despacho entregado. `cambios` lleva {campo: {antes, despues}}. '
  'Es lo que permite responder por qué un movimiento quedó con una fecha distinta '
  'a la de su registro.';

-- ⚠️ Una tabla nueva NO hereda los GRANT: sin esto la app responde
-- "permission denied" aunque la policy exista. Ya mordió antes.
alter table insumos_despachos_auditoria enable row level security;

drop policy if exists insumos_despachos_auditoria_rw on insumos_despachos_auditoria;
create policy insumos_despachos_auditoria_rw
  on insumos_despachos_auditoria for all to anon, authenticated
  using (true) with check (true);

grant select, insert, update, delete on insumos_despachos_auditoria to anon, authenticated;
grant usage, select on sequence insumos_despachos_auditoria_id_seq to anon, authenticated;
