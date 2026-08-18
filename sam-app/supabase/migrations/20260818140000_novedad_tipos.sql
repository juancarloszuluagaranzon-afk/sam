-- Catálogo de novedades de la Planilla, editable desde la app.
--
-- Hasta ahora los 15 tipos (V, T, NP, D, P, E, IN, F, OV, MV, MT, SP, LL, CD,
-- CN) vivían escritos en `samApi.ts`: agregar uno nuevo obligaba a tocar el
-- repo y desplegar. Administración necesita poder crear los que le hagan falta.
--
-- ✅ La tabla `operario_novedades.tipo` es TEXT SIN CHECK (verificado), así que
-- un código nuevo entra sin migración adicional. Si algún día se le pone un
-- CHECK, hay que ampliarlo a mano por cada tipo — la misma trampa que ya cobró
-- `app_usuarios.rol`.

create table if not exists novedad_tipos (
  -- El código ES la llave y es lo que se ve en la celda de la planilla. Corto a
  -- propósito: en una cuadrícula de 15 días no cabe una palabra.
  codigo    text primary key,
  nombre    text not null,
  -- Color del texto en la celda. Se guarda el hex para que administración pueda
  -- distinguir de un vistazo sin pedir un despliegue.
  color     text not null default '#4a5040',
  -- Orden en que salen los botones. Los de uso diario arriba.
  orden     smallint not null default 100,
  activo    boolean not null default true,
  -- Los 15 originales no se pueden borrar: hay 385 registros históricos
  -- apuntando a ellos y la planilla de meses pasados quedaría con celdas mudas.
  del_sistema boolean not null default false,
  created_at timestamptz not null default now()
);

comment on table novedad_tipos is
  'Los códigos que se pueden marcar en la Planilla. Administración crea los que '
  'necesite. Los `del_sistema` no se borran: el histórico apunta a ellos.';

-- Semilla con los 15 que ya existen, con sus colores actuales y en el orden en
-- que se venían mostrando. `on conflict do nothing`: si la migración se corre
-- dos veces, no pisa lo que administración haya editado después.
insert into novedad_tipos (codigo, nombre, color, orden, del_sistema) values
  ('V',  'Vacaciones',            '#2a4a8c',  10, true),
  ('T',  'Taller',                '#8a5a00',  20, true),
  ('NP', 'No programado',         '#4a5040',  30, true),
  ('D',  'Descanso',              '#2a4a8c',  40, true),
  ('P',  'Permiso',               '#7d2e2e',  50, true),
  ('E',  'Enfermedad',            '#7d2e2e',  60, true),
  ('IN', 'Incapacidad',           '#7d2e2e',  70, true),
  ('F',  'Falta sin justa causa', '#b3261e',  80, true),
  ('OV', 'Oficios varios',        '#6b4500',  90, true),
  ('MV', 'Máquina varada',        '#b3261e', 100, true),
  ('MT', 'Máquina en traslado',   '#2a4a8c', 110, true),
  ('SP', 'Supervisor',            '#155b30', 120, true),
  ('LL', 'Lluvia',                '#2a4a8c', 130, true),
  ('CD', 'Camioneta día',         '#8a5a00', 140, true),
  ('CN', 'Camioneta noche',       '#4a5040', 150, true),
  -- Legado: existe en datos viejos, no se ofrece como botón.
  ('C',  'Camioneta (antiguo)',   '#8a8e85', 900, true)
on conflict (codigo) do nothing;

-- Los legados no se ofrecen para marcar, pero siguen mostrándose en el histórico.
update novedad_tipos set activo = false where codigo = 'C';

alter table novedad_tipos enable row level security;
drop policy if exists novedad_tipos_rw on novedad_tipos;
create policy novedad_tipos_rw on novedad_tipos for all to anon, authenticated
  using (true) with check (true);
grant select, insert, update, delete on novedad_tipos to anon, authenticated;

notify pgrst, 'reload schema';

\echo == COMO QUEDA ==
select codigo, nombre, color, orden, activo, del_sistema from novedad_tipos order by orden;
