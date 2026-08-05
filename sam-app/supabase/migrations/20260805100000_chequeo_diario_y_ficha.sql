-- Chequeo diario del operario + ficha técnica + plan de mantenimiento.
--
-- Todo esto sale de "02 Maquinaria 2026.xlsx", que el cliente ya llevaba a mano:
-- 23 máquinas con su ficha y su consumo 2025, y tres hojas que mezclan dos cosas
-- distintas — las filas "Diario/OPERADOR" son la lista de chequeo y las de
-- frecuencia numérica/TÉCNICO son el plan preventivo.
--
-- ⚠️ Lo que este archivo NO hace, a propósito: cargar los servicios de 6.000 h en
-- adelante. Sin saber cuándo fue la última intervención mayor, `vencimientosDe()`
-- calcula `floor(h/cada)*cada + cada` y da el servicio por hecho — la CASE951, con
-- 12.765 h, mostraría su próximo overhaul de 12.000 h en las 24.000, afirmando en
-- silencio que ya se hizo. Un plan que miente es peor que no tener plan.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. FICHA TÉCNICA
-- ═══════════════════════════════════════════════════════════════════════════
-- `marca`, `modelo` y `año` ya existen (y están NULL en las 23 máquinas, que es
-- justo por lo que ningún plan por modelo aplicaba a nada).

alter table equipos
  add column if not exists hp          numeric,
  add column if not exists linea       text,
  add column if not exists procedencia text;

comment on column equipos.linea is
  'Línea comercial exacta ("CASE 130A FARMALL"). Es la llave que une la máquina '
  'con su lista de chequeo y su plan de mantenimiento.';
comment on column equipos.procedencia is
  'De dónde vino la máquina (BRASILEÑO, TURCO). Explica diferencias de repuesto '
  'entre dos unidades del mismo modelo.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. REFERENCIA ANUAL DE CONSUMO
-- ═══════════════════════════════════════════════════════════════════════════
-- Tabla y no columnas planas: cada año trae su propia referencia y el cierre de
-- 2026 no puede pisar el de 2025 — perderlo sería perder la base de comparación.
--
-- ⚠️ `gal_hora` y `ganchos_hora` son CONSUMO REAL 2025, no una meta negociada.
-- Sirven para dos cosas: comparar el consumo de esta semana, y —lo que no era
-- obvio— detectar horómetros mal capturados. La PUMA2101 marca 8,51 gal/h contra
-- 4,48 de referencia; dividiendo su horómetro por 10 da 3,73 y encaja. La
-- referencia delató un error de escala que el filtro de magnitud no vio.

create table if not exists equipo_metas (
  equipo_codigo     text    not null references equipos(codigo) on delete cascade,
  anio              int     not null,
  horometro_inicial numeric,
  horometro_final   numeric,
  horas             numeric,
  gal_hora          numeric,
  ganchos_hora      numeric,
  -- De dónde salió: 'EXCEL 2025', 'CALCULADO', 'AJUSTE MANUAL'.
  fuente            text,
  nota              text,
  created_at        timestamptz not null default now(),
  primary key (equipo_codigo, anio)
);

comment on table equipo_metas is
  'Referencia de consumo por máquina y año. gal_hora/ganchos_hora del 2025 salen '
  'del Excel de maquinaria y son consumo REAL, no meta. Los PUMA tienen '
  'ganchos_hora en null porque no usan ganchos — no es dato faltante.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. LISTAS DE CHEQUEO
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists chequeo_listas (
  id     smallserial primary key,
  codigo text not null unique,          -- '108', '135', '180'
  nombre text not null,
  -- La línea del Excel a la que corresponde ("FARMALL 130").
  modelo text,
  activa boolean not null default true,
  nota   text
);

comment on table chequeo_listas is
  'Las hojas 108 y 135 del Excel traen la MISMA lista diaria (30 ítems idénticos, '
  'mismo orden); solo la 180 difiere. Se guardan como tres registros separados '
  'igual, para poder diferenciarlas después desde la app sin tocar código.';

create table if not exists chequeo_items (
  id       serial primary key,
  lista_id smallint not null references chequeo_listas(id) on delete cascade,
  -- El recorrido físico alrededor del tractor, no el orden del Excel: agrupar por
  -- dónde está parado el operario corta el tiempo a la mitad y hace imposible
  -- contestar sin moverse. 1=capó arriba · 2=alrededor · 3=encendido y mandos.
  vuelta   smallint not null default 1,
  orden    smallint not null,
  texto    text     not null,
  -- ESTADO se responde BIEN/MAL · ACCION se responde HECHO (engrasar, drenar,
  -- desairear NO son preguntas, son tareas) · DATO pide un número o foto.
  tipo     text     not null default 'ESTADO'
             check (tipo in ('ESTADO','ACCION','DATO')),
  -- Si falla, la máquina no debería salir. Solo alerta: decide una persona.
  critico  boolean  not null default false,
  unidad   text,
  activo   boolean  not null default true,
  unique (lista_id, vuelta, orden)
);

comment on column chequeo_items.texto is
  'Redactado SIEMPRE como estado deseado ("Motor sin ruidos extraños"), nunca como '
  'pregunta ("¿Ruidos extraños?"). El Excel mezclaba las dos polaridades y en una '
  'lista de 30 ítems diarios eso garantiza respuestas invertidas.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. EL CHEQUEO DILIGENCIADO
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists chequeos (
  -- El id lo genera el CLIENTE para que reintentar desde la cola offline sea
  -- idempotente: sin señal el operario puede guardar dos veces el mismo chequeo.
  id             uuid primary key,
  equipo_codigo  text not null references equipos(codigo),
  lista_id       smallint not null references chequeo_listas(id),
  operario_id    text not null,
  operario_nombre text,
  -- La jornada (zona Bogotá), no el instante. Un chequeo por máquina y día.
  fecha          date not null,
  horometro      numeric,
  iniciado_en    timestamptz,
  finalizado_en  timestamptz,
  duracion_seg   integer,
  -- Se cerró demasiado rápido para haberlo mirado. NO bloquea: sale en el tablero
  -- del jefe de taller. Bloquear produce que lo llenen en el parqueadero.
  sospechoso     boolean not null default false,
  resultado      text check (resultado in ('OK','CON_NOVEDAD','NO_APTO')),
  nota           text,
  -- Misma separación que el kardex: cuándo ocurrió vs cuándo se sincronizó.
  fecha_efectiva timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  unique (equipo_codigo, fecha)
);

create index if not exists chequeos_fecha_idx  on chequeos (fecha desc);
create index if not exists chequeos_equipo_idx on chequeos (equipo_codigo, fecha desc);

create table if not exists chequeo_respuestas (
  id          bigserial primary key,
  chequeo_id  uuid    not null references chequeos(id) on delete cascade,
  item_id     integer not null references chequeo_items(id),
  -- Congelado: reordenar o reescribir el catálogo NO debe reescribir el histórico.
  item_texto  text    not null,
  -- NULL = no la contestó, que es distinto de BIEN. Misma regla que el engrase.
  valor       text check (valor in ('BIEN','MAL','HECHO','NA')),
  -- En palabras del operario, no en jerga de mantenimiento.
  severidad   text check (severidad in ('TRABAJA','HOY','NO_ARRANCA')),
  medida      numeric,
  nota        text,
  foto_url    text,
  -- Por ítem: es lo que permite ver si contestó 30 cosas en once segundos.
  respondido_en timestamptz,
  unique (chequeo_id, item_id)
);

create index if not exists chequeo_respuestas_mal_idx
  on chequeo_respuestas (item_id) where valor = 'MAL';

-- Qué lista le toca a cada máquina. NULL = no se le pide chequeo (la FIAT es de
-- oficios varios del taller y TRC-1 es de pruebas: pedirles chequeo diario sería
-- inventar 30 tareas al día que nadie va a hacer).
alter table equipos
  add column if not exists chequeo_lista_id smallint references chequeo_listas(id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. PLAN DE MANTENIMIENTO: lo que le faltaba
-- ═══════════════════════════════════════════════════════════════════════════
-- `mtto_planes` ya existe pero solo guarda la tarea y cada cuántas horas. El Excel
-- trae además cuánto se demora, cuántos técnicos y qué materiales lleva — que es
-- justo lo que permite planear la parada y pedir los repuestos antes.

alter table mtto_planes
  add column if not exists tiempo_min    numeric,
  add column if not exists mano_obra     smallint,
  add column if not exists perfil        text,
  -- La lista del Excel de la que salió, para poder recargar sin duplicar.
  add column if not exists lista_codigo  text;

comment on column mtto_planes.tiempo_min is
  'Minutos por técnico. El total de la parada es tiempo_min × mano_obra.';

create table if not exists mtto_plan_materiales (
  id        bigserial primary key,
  plan_id   uuid not null references mtto_planes(id) on delete cascade,
  -- Puede no existir en el catálogo todavía: el Excel dice "kit básico de
  -- reparación de motor", que es una descripción de taller y no un ítem.
  insumo_id uuid references insumos(id),
  -- Siempre se guarda el texto del Excel, aunque el insumo sí exista: la cantidad
  -- viene embebida ahí ("15W40 (6,5 Gal)") y depende del modelo.
  texto     text not null,
  cantidad  numeric,
  unidad    text
);

comment on table mtto_plan_materiales is
  'Materiales de cada actividad del plan. ⚠️ En el Excel la coma es DECIMAL: '
  '"Aceite 80W140 (3, 2 Gal)" son 3,2 galones — separar por coma parte el ítem.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. PERMISOS
-- ═══════════════════════════════════════════════════════════════════════════
-- ⚠️ Una tabla nueva NO hereda los GRANT: sin esto la app responde
-- "permission denied" aunque la policy RLS exista. Ya mordió antes.

do $$
declare t text;
begin
  foreach t in array array['equipo_metas','chequeo_listas','chequeo_items',
                           'chequeos','chequeo_respuestas','mtto_plan_materiales']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_rw', t);
    execute format('create policy %I on %I for all to anon, authenticated '
                   'using (true) with check (true)', t || '_rw', t);
    execute format('grant select, insert, update, delete on %I to anon, authenticated', t);
  end loop;
end $$;

grant usage, select on sequence chequeo_listas_id_seq        to anon, authenticated;
grant usage, select on sequence chequeo_items_id_seq         to anon, authenticated;
grant usage, select on sequence chequeo_respuestas_id_seq    to anon, authenticated;
grant usage, select on sequence mtto_plan_materiales_id_seq  to anon, authenticated;
