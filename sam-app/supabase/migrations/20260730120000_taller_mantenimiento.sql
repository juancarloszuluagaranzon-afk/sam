-- ============================================================================
-- Taller de maquinaria: repuestos, preventivo, órdenes de trabajo y $/hora
--
-- El inventario de uso diario (combustible, ganchos) responde "¿qué le entregué
-- hoy al operario?". Este responde otra cosa: "¿qué le he metido a esta máquina
-- en toda su vida y cuánto me cuesta la hora?". Por eso el ítem de taller lleva
-- referencia, marca, número de parte y a qué modelos aplica — un filtro sirve
-- para el modelo X y para ningún otro, mientras un tornillo es genérico.
--
-- Decisión de fondo: NO se crea un segundo inventario. El taller es una BODEGA
-- más (tipo TALLER) sobre el mismo kardex que ya existe, y el catálogo de
-- insumos gana los campos que el repuesto necesita. Dos inventarios paralelos
-- serían dos verdades.
--
-- La pieza central es la ORDEN DE TRABAJO: sin ella no hay dónde colgar los
-- repuestos, la mano de obra y el paro, y sin paro no se pueden calcular
-- disponibilidad, TMEF ni TMR.
-- ============================================================================

-- ── Equipo: lo que falta para costear el activo ────────────────────────────
alter table public.equipos
  add column if not exists valor_compra numeric(16,2),
  add column if not exists fecha_compra date,
  -- Vida útil en HORAS (no en años): es maquinaria, se deprecia por uso.
  add column if not exists vida_util_horas numeric(12,2),
  add column if not exists valor_residual numeric(16,2),
  -- Lectura capturada a mano cuando no viene de una labor o un tanqueo.
  add column if not exists horometro_manual numeric(12,2),
  add column if not exists horometro_manual_en timestamptz;

-- ── Horómetro consolidado ─────────────────────────────────────────────
-- El horómetro llega por cuatro caminos y nadie lo juntaba: cierre de labor,
-- tanqueo, orden de trabajo y captura manual. Sin un número único, el plan
-- preventivo nunca dispara.
--
-- 🔴 Los datos reales vienen sucios de dos formas distintas:
--   1. Dedazos sueltos: PUMA2101 con un 14.142.545 entre lecturas de ~145.200,
--      o CASE903 con 1.146,53 donde iban 11.465,3 (un dígito de menos).
--   2. ESCALAS MEZCLADAS: en CASE952 unos digitan 5407 y otros 54030 — la misma
--      lectura, con y sin la décima pegada — y va mitad y mitad.
--
-- Por eso NO sirve ni el máximo (un dedazo alto clava la máquina para siempre)
-- ni la mediana (con dos escalas 50/50 cae en el medio y elige la equivocada:
-- en CASE952 daba 29.612 y se quedaba con 54.030 en vez de 5.407).
--
-- Criterio: **magnitud dominante**. Se agrupan las últimas 12 lecturas por orden
-- de magnitud (5.407 → 3, 54.030 → 4) y gana el grupo con más lecturas; a
-- igualdad, el que tenga la más reciente. Dentro del grupo ganador se toma la
-- última. Resuelve los dos casos: el dedazo queda solo en su magnitud, y en la
-- mezcla gana la escala que usa la mayoría.
--
-- Y por encima de todo: si alguien fijó el horómetro A MANO, ESE manda. Es una
-- corrección humana explícita y ningún criterio automático debe pisarla.
create or replace view public.equipo_horometro_v as
with lecturas as (
  select a.equipo_codigo as codigo, a.horometro_final as horas,
         coalesce(a.fecha_fin, a.fecha_inicio) as cuando, 'Labor'::text as fuente
    from public.asignaciones a
   where a.equipo_codigo is not null and a.horometro_final is not null
  union all
  select c.equipo_codigo, c.horometro, c.created_at, 'Tanqueo'
    from public.combustible_externo c
   where c.equipo_codigo is not null and c.horometro is not null
  union all
  select o.equipo_codigo, o.horometro, o.created_at, 'Orden de trabajo'
    from public.ordenes_trabajo o
   where o.horometro is not null and o.estado <> 'ANULADA'
),
ranked as (
  select codigo, horas, cuando, fuente,
         row_number() over (partition by codigo order by cuando desc, horas desc) rn
    from lecturas
   where horas > 0 and cuando is not null
),
-- Orden de magnitud de cada lectura entre las últimas 12.
magnitudes as (
  select codigo, floor(log(10, horas)) as mag, count(*) as cuantas, max(cuando) as ultima
    from ranked where rn <= 12
   group by codigo, floor(log(10, horas))
),
-- La magnitud que manda: la más frecuente; a igualdad, la más reciente.
dominante as (
  select distinct on (codigo) codigo, mag
    from magnitudes
   order by codigo, cuantas desc, ultima desc
),
automatica as (
  select distinct on (r.codigo)
         r.codigo, r.horas, r.cuando, r.fuente
    from ranked r
    join dominante d on d.codigo = r.codigo and floor(log(10, r.horas)) = d.mag
   where r.rn <= 12
   order by r.codigo, r.cuando desc, r.horas desc
),
manual as (
  select e.codigo, e.horometro_manual as horas, e.horometro_manual_en as cuando, 'Manual'::text as fuente
    from public.equipos e
   where e.horometro_manual is not null and e.horometro_manual > 0
)
-- La manual gana siempre que exista.
select coalesce(m.codigo, a.codigo) as codigo,
       coalesce(m.horas, a.horas)   as horometro,
       coalesce(m.cuando, a.cuando) as leido_en,
       coalesce(m.fuente, a.fuente) as fuente
  from automatica a
  full outer join manual m on m.codigo = a.codigo;

-- Lecturas que quedaron fuera de la magnitud dominante: son las que hay que ir
-- a corregir en la labor de origen. Se muestran en la hoja de vida.
drop view if exists public.equipo_horometro_dudoso_v;
create view public.equipo_horometro_dudoso_v as
with lecturas as (
  select a.id::text as origen_id, a.equipo_codigo as codigo, a.horometro_final as horas,
         coalesce(a.fecha_fin, a.fecha_inicio) as cuando, 'Labor'::text as fuente
    from public.asignaciones a
   where a.equipo_codigo is not null and a.horometro_final is not null
  union all
  select c.id::text, c.equipo_codigo, c.horometro, c.created_at, 'Tanqueo'
    from public.combustible_externo c
   where c.equipo_codigo is not null and c.horometro is not null
),
ranked as (
  select origen_id, codigo, horas, cuando, fuente,
         row_number() over (partition by codigo order by cuando desc, horas desc) rn
    from lecturas where horas > 0 and cuando is not null
),
magnitudes as (
  select codigo, floor(log(10, horas)) as mag, count(*) as cuantas, max(cuando) as ultima
    from ranked where rn <= 12 group by codigo, floor(log(10, horas))
),
dominante as (
  select distinct on (codigo) codigo, mag from magnitudes order by codigo, cuantas desc, ultima desc
)
select r.origen_id, r.codigo, r.horas, r.cuando, r.fuente,
       power(10, d.mag)::numeric as magnitud_esperada
  from ranked r
  join dominante d on d.codigo = r.codigo
 where r.rn <= 40 and floor(log(10, r.horas)) <> d.mag;

-- ── Catálogo: lo que distingue un repuesto de un insumo de uso diario ──────
alter table public.insumos
  add column if not exists referencia text,
  add column if not exists marca text,
  add column if not exists numero_parte text,
  -- Dónde está físicamente en el taller (estante, caja, posición).
  add column if not exists ubicacion text,
  add column if not exists stock_maximo numeric(14,2),
  -- Inventario de seguridad: el colchón bajo el mínimo, no el mínimo mismo.
  add column if not exists stock_seguridad numeric(14,2),
  add column if not exists es_repuesto boolean not null default false,
  add column if not exists ficha_url text,
  add column if not exists costo_promedio numeric(16,2);

create index if not exists insumos_repuesto_ix on public.insumos (es_repuesto) where es_repuesto;

-- Aplicabilidad: a qué máquinas sirve el repuesto. Va en tabla aparte porque un
-- filtro puede servir para varios modelos y un modelo usa muchos repuestos.
-- Sin `modelo` (solo marca) = aplica a toda la marca; sin filas = genérico.
create table if not exists public.insumos_aplicabilidad (
  id uuid primary key default gen_random_uuid(),
  insumo_id uuid not null references public.insumos(id) on delete cascade,
  marca text,
  modelo text,
  equipo_codigo text,
  nota text,
  created_at timestamptz not null default now()
);
create index if not exists insumos_aplic_insumo_ix on public.insumos_aplicabilidad (insumo_id);
create index if not exists insumos_aplic_equipo_ix on public.insumos_aplicabilidad (equipo_codigo);

-- ── Proveedores ─────────────────────────────────────────────────────────────
create table if not exists public.proveedores (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  nit text,
  -- REPUESTOS | AGROINSUMOS | SERVICIOS | OTRO: el taller y el campo compran a
  -- gente distinta, y mezclarlos vuelve inusable el selector.
  tipo text not null default 'REPUESTOS',
  contacto text,
  telefono text,
  email text,
  zona text,
  direccion text,
  nota text,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists proveedores_nombre_uk on public.proveedores (upper(nombre));

-- Un mismo repuesto se le compra a varios proveedores, cada uno con SU
-- referencia y SU precio. La llave del ítem es el código propio; la referencia
-- del proveedor es un alias.
create table if not exists public.insumos_proveedores (
  id uuid primary key default gen_random_uuid(),
  insumo_id uuid not null references public.insumos(id) on delete cascade,
  proveedor_id uuid not null references public.proveedores(id) on delete cascade,
  referencia_proveedor text,
  precio numeric(16,2),
  moneda text not null default 'COP',
  dias_entrega integer,
  preferido boolean not null default false,
  ultima_compra date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists insumos_prov_uk on public.insumos_proveedores (insumo_id, proveedor_id);

-- ── Compras ─────────────────────────────────────────────────────────────────
-- Proveedor → Compra → entra a una bodega. Al recibirla se genera la ENTRADA en
-- el kardex, así que el stock nunca aparece de la nada (misma regla que rige el
-- combustible desde el 29-jul).
create table if not exists public.compras (
  id uuid primary key default gen_random_uuid(),
  consecutivo serial,
  proveedor_id uuid references public.proveedores(id),
  bodega_id uuid references public.bodegas(id),
  fecha date not null default current_date,
  factura text,
  -- BORRADOR | RECIBIDA | ANULADA
  estado text not null default 'BORRADOR',
  subtotal numeric(16,2) not null default 0,
  impuestos numeric(16,2) not null default 0,
  total numeric(16,2) not null default 0,
  nota text,
  soporte_url text,
  creado_por uuid,
  creado_nombre text,
  recibida_en timestamptz,
  recibida_por uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists compras_estado_ix on public.compras (estado, fecha desc);

create table if not exists public.compra_items (
  id uuid primary key default gen_random_uuid(),
  compra_id uuid not null references public.compras(id) on delete cascade,
  insumo_id uuid not null references public.insumos(id),
  cantidad numeric(14,2) not null,
  precio_unitario numeric(16,2) not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists compra_items_compra_ix on public.compra_items (compra_id);

-- ── Plan de mantenimiento preventivo ────────────────────────────────────────
-- Se dispara por HORÓMETRO (es maquinaria: el desgaste va por uso, no por
-- calendario). `cada_horas` = periodicidad; `ultima_horas` = horómetro de la
-- última vez que se hizo. Opcionalmente también por días, para lo que vence por
-- tiempo aunque la máquina esté quieta.
create table if not exists public.mtto_planes (
  id uuid primary key default gen_random_uuid(),
  equipo_codigo text,
  -- Un plan puede definirse por MODELO y aplicar a todas las máquinas iguales.
  marca text,
  modelo text,
  tarea text not null,
  cada_horas numeric(12,2),
  cada_dias integer,
  avisar_antes_horas numeric(12,2) not null default 50,
  ultima_horas numeric(12,2),
  ultima_fecha date,
  activo boolean not null default true,
  nota text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists mtto_planes_equipo_ix on public.mtto_planes (equipo_codigo) where activo;

-- ── Órdenes de trabajo ──────────────────────────────────────────────────────
-- La pieza central. `paro_en`/`arranque_en` son los que permiten calcular
-- disponibilidad y TMR; el tipo CORRECTIVO separa las fallas (TMEF) de los
-- preventivos, que no son fallas.
create table if not exists public.ordenes_trabajo (
  id uuid primary key default gen_random_uuid(),
  consecutivo serial,
  equipo_codigo text not null,
  -- PREVENTIVO | CORRECTIVO | MEJORA
  tipo text not null default 'CORRECTIVO',
  -- ABIERTA | EN_PROCESO | CERRADA | ANULADA
  estado text not null default 'ABIERTA',
  plan_id uuid references public.mtto_planes(id),
  descripcion text not null,
  causa text,
  trabajo_realizado text,
  horometro numeric(12,2),
  -- El reloj de la parada: cuándo dejó de producir y cuándo volvió.
  paro_en timestamptz,
  arranque_en timestamptz,
  -- Costos que NO salen del inventario.
  horas_mo numeric(10,2) not null default 0,
  valor_hora_mo numeric(16,2) not null default 0,
  costo_externo numeric(16,2) not null default 0,
  proveedor_externo_id uuid references public.proveedores(id),
  responsable text,
  evidencia_urls text[],
  creado_por uuid,
  creado_nombre text,
  cerrada_en timestamptz,
  cerrada_por uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ot_equipo_ix on public.ordenes_trabajo (equipo_codigo, created_at desc);
create index if not exists ot_estado_ix on public.ordenes_trabajo (estado);

-- Repuestos consumidos por la OT. Al cerrarla se descuentan del inventario con
-- su movimiento de kardex, referenciando la OT.
create table if not exists public.ot_repuestos (
  id uuid primary key default gen_random_uuid(),
  ot_id uuid not null references public.ordenes_trabajo(id) on delete cascade,
  insumo_id uuid not null references public.insumos(id),
  bodega_id uuid references public.bodegas(id),
  cantidad numeric(14,2) not null,
  costo_unitario numeric(16,2) not null default 0,
  descargado boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists ot_repuestos_ot_ix on public.ot_repuestos (ot_id);

-- ── Costos que no salen de la operación ─────────────────────────────────────
-- Seguros, impuestos y depreciación no se pueden deducir de lo que pasa en
-- campo: alguien los carga por equipo y periodo. La depreciación se puede
-- calcular sola si el equipo tiene valor de compra y vida útil en horas.
create table if not exists public.equipo_costos (
  id uuid primary key default gen_random_uuid(),
  equipo_codigo text not null,
  -- SEGURO | IMPUESTO | DEPRECIACION | ADMINISTRATIVO | OTRO
  concepto text not null,
  periodo text not null,            -- 'YYYY-MM'
  valor numeric(16,2) not null default 0,
  nota text,
  creado_por uuid,
  created_at timestamptz not null default now()
);
create unique index if not exists equipo_costos_uk on public.equipo_costos (equipo_codigo, concepto, periodo);

-- ── Permisos ────────────────────────────────────────────────────────────────
-- Una tabla nueva NO hereda los GRANT y la app entra con el anon_key: sin esto
-- responde "permission denied" aunque la policy exista. (Ya nos costó una vez.)
do $$
declare t text;
begin
  foreach t in array array[
    'insumos_aplicabilidad','proveedores','insumos_proveedores','compras',
    'compra_items','mtto_planes','ordenes_trabajo','ot_repuestos','equipo_costos'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    begin
      execute format('create policy %I on public.%I for all using (true) with check (true)', t || '_all', t);
    exception when duplicate_object then null; end;
    execute format('grant select, insert, update, delete on public.%I to anon, authenticated', t);
  end loop;
end $$;

grant select on public.equipo_horometro_v to anon, authenticated;
grant select on public.equipo_horometro_dudoso_v to anon, authenticated;

-- Los serial de compras/OT necesitan su secuencia accesible.
grant usage, select on all sequences in schema public to anon, authenticated;

-- ── Rol nuevo: taller ───────────────────────────────────────────────────────
-- Segregación: quien repara no es quien compra ni quien aprueba.
alter table public.app_usuarios drop constraint if exists app_usuarios_rol_check;
alter table public.app_usuarios add constraint app_usuarios_rol_check check (
  rol in ('owner','administracion','supervisor','operador','soporte',
          'supervisor_insumos','conductor','analista_insumos','taller')
);

-- ── Bodega del taller ───────────────────────────────────────────────────────
-- Es una bodega más, sobre el mismo kardex. El tipo se guarda en `tipo`; si la
-- tabla tiene CHECK, se amplía.
do $$ begin
  alter table public.bodegas drop constraint if exists bodegas_tipo_check;
exception when undefined_object then null; end $$;
alter table public.bodegas
  add constraint bodegas_tipo_check check (tipo in ('PRINCIPAL','SATELITE','TALLER'));

insert into public.bodegas (nombre, tipo, activo)
select 'BODEGA TALLER', 'TALLER', true
 where not exists (select 1 from public.bodegas where tipo = 'TALLER');
