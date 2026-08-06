-- Consumo histórico: el "FORMATO CONTROL DIARIO" que se llevaba en papel.
--
-- Son 2.985 registros de marzo a julio de 2026 — el mundo antes de que la app
-- tomara el proceso. Sin esto, el tablero del dueño arranca en agosto y no hay
-- contra qué comparar: un consumo de 1.300 galones no dice nada si no se sabe
-- que julio fueron 9.252.
--
-- ⚠️ TABLA APARTE, NO `insumos_kardex`. La tentación es meterlo todo al kardex
-- para no tener dos fuentes, y sería un error: el kardex mueve el stock, y
-- cargarle cuatro meses de salidas históricas dejaría el inventario en números
-- negativos absurdos. Esto es un registro de lo que pasó, no un movimiento de
-- inventario. Es de solo lectura y no participa de ningún saldo.
--
-- ⚠️ EL CORTE ES EL 31 DE JULIO. El Excel llega hasta el 4 de agosto y la app
-- también tiene agosto: cargar el traslape contaría dos veces los mismos
-- galones. Decisión del cliente: hasta julio manda el papel, desde agosto manda
-- la app. `cargar_historico.sql` filtra por fecha, no por lo que traiga el
-- archivo.

create table if not exists consumo_historico (
  id            bigserial primary key,
  fecha         date    not null,
  semana        smallint,
  equipo_codigo text    not null,
  operario      text,
  responsable   text,
  horometro     numeric,
  galones       numeric not null default 0,
  ganchos       numeric not null default 0,
  -- El resto de materiales del formato, como {"CHAPETAS": 4, "RESORTES": 2}.
  -- Van en jsonb porque son quince columnas casi siempre vacías: normalizarlas
  -- daría una tabla de 45.000 filas con ceros para responder una sola pregunta
  -- ("cuánto de esto se gastó"), que jsonb contesta igual de bien.
  otros         jsonb   not null default '{}'::jsonb,
  -- true/false/null = no se preguntó. Igual que en las entregas de la app.
  engraso       boolean,
  fuente        text    not null default 'EXCEL CONTROL DIARIO',
  created_at    timestamptz not null default now()
);

create index if not exists consumo_historico_fecha_idx  on consumo_historico (fecha);
create index if not exists consumo_historico_equipo_idx on consumo_historico (equipo_codigo, fecha);

comment on table consumo_historico is
  'Formato de control diario en papel (mar-jul 2026), previo a la app. SOLO '
  'LECTURA: no mueve stock ni participa de ningún saldo. El tablero del dueño lo '
  'une con el consumo real de la app para tener la serie completa.';

alter table consumo_historico enable row level security;
drop policy if exists consumo_historico_rw on consumo_historico;
create policy consumo_historico_rw on consumo_historico
  for all to anon, authenticated using (true) with check (true);
grant select, insert, update, delete on consumo_historico to anon, authenticated;
grant usage, select on sequence consumo_historico_id_seq to anon, authenticated;
