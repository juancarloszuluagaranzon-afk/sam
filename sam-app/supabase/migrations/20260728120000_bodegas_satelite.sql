-- Módulo Insumos — BODEGAS (principal + satélites) y COMBUSTIBLE EXTERNO.
--
-- Modelo nuevo:
--   · Bodega PRINCIPAL: la fija. Compra y almacena. La manejan admin/dueño.
--   · Bodegas SATÉLITE: el vehículo de cada supervisor de insumos. De ahí
--     consumen los operarios. Se surten por TRASLADO desde la principal
--     (con aval del supervisor que recibe) o tanqueando en bombas externas.
--
-- El stock deja de ser una sola cifra por insumo y pasa a ser POR BODEGA
-- (tabla `insumos_stock`). `insumos.stock` se conserva como TOTAL consolidado
-- para no romper pantallas existentes mientras se migra la UI.
--
-- Correr en Supabase Studio (extensión traductora APAGADA).

-- ── 1. Catálogo de bodegas ────────────────────────────────────────────────
create table if not exists public.bodegas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  tipo text not null default 'SATELITE',      -- PRINCIPAL | SATELITE
  -- Supervisor de insumos dueño del satélite (su vehículo).
  responsable_id text,
  vehiculo text,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Una sola bodega principal.
create unique index if not exists bodegas_una_principal
  on public.bodegas (tipo) where tipo = 'PRINCIPAL';

-- Semilla: la bodega principal (los satélites se crean desde la app).
insert into public.bodegas (nombre, tipo)
select 'BODEGA PRINCIPAL', 'PRINCIPAL'
where not exists (select 1 from public.bodegas where tipo = 'PRINCIPAL');

-- ── 2. Stock por bodega ───────────────────────────────────────────────────
create table if not exists public.insumos_stock (
  insumo_id uuid not null references public.insumos(id) on delete cascade,
  bodega_id uuid not null references public.bodegas(id) on delete cascade,
  stock numeric not null default 0,
  updated_at timestamptz not null default now(),
  primary key (insumo_id, bodega_id)
);

-- El stock que existe hoy queda en la PRINCIPAL (es donde estaba todo).
insert into public.insumos_stock (insumo_id, bodega_id, stock)
select i.id, b.id, coalesce(i.stock, 0)
from public.insumos i
cross join (select id from public.bodegas where tipo = 'PRINCIPAL' limit 1) b
on conflict (insumo_id, bodega_id) do nothing;

-- ── 3. Kardex: cada movimiento pertenece a una bodega ─────────────────────
alter table public.insumos_kardex
  add column if not exists bodega_id uuid references public.bodegas(id);

-- Los movimientos históricos son de la principal.
update public.insumos_kardex k
   set bodega_id = (select id from public.bodegas where tipo = 'PRINCIPAL' limit 1)
 where k.bodega_id is null;

create index if not exists insumos_kardex_bodega_idx on public.insumos_kardex (bodega_id);

-- ── 3b. La solicitud recuerda de qué bodega salió ─────────────────────────
-- Necesario para que una devolución (el operario recibió menos) regrese al
-- MISMO satélite del que salió, y no a la principal.
alter table public.insumos_solicitudes
  add column if not exists bodega_id uuid references public.bodegas(id);

-- ── 4. Traslados principal → satélite (con aval de quien recibe) ──────────
create table if not exists public.insumos_traslados (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  origen_id uuid not null references public.bodegas(id),
  destino_id uuid not null references public.bodegas(id),
  -- EN_TRANSITO: salió de principal, falta que el satélite confirme.
  -- RECIBIDO: confirmado (con o sin diferencias). ANULADO: se deshizo.
  estado text not null default 'EN_TRANSITO',
  enviado_por text,
  nota text,
  evidencia_url text,
  recibido_en timestamptz,
  recibido_por text,
  conforme boolean,
  nota_recepcion text
);

create table if not exists public.insumos_traslado_items (
  id uuid primary key default gen_random_uuid(),
  traslado_id uuid not null references public.insumos_traslados(id) on delete cascade,
  insumo_id uuid not null references public.insumos(id),
  insumo_nombre text,
  unidad text,
  cantidad numeric not null default 0,       -- lo que salió de principal
  cantidad_recibida numeric                  -- lo que confirmó el satélite
);

create index if not exists insumos_traslados_destino_idx on public.insumos_traslados (destino_id, estado);

-- ── 5. Combustible tanqueado en bombas externas ───────────────────────────
-- Dos casos, ambos con tirilla:
--   CARRO   → el supervisor tanquea su vehículo-tanque: ENTRA al satélite.
--   MAQUINA → el operario tanquea la máquina directo en la bomba: NO toca
--             inventario, pero el costo/consumo SÍ se carga a la máquina
--             (por eso exige horómetro).
create table if not exists public.combustible_externo (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  fecha date not null default current_date,
  destino text not null,                     -- CARRO | MAQUINA
  bodega_id uuid references public.bodegas(id),   -- solo si destino = CARRO
  equipo_codigo text,                        -- solo si destino = MAQUINA
  horometro numeric,                         -- solo si destino = MAQUINA
  insumo_id uuid references public.insumos(id),
  galones numeric not null default 0,
  valor numeric default 0,
  estacion text,
  factura text,
  tirilla_url text,
  registrado_por text,
  registrado_nombre text,
  nota text
);

create index if not exists combustible_externo_fecha_idx on public.combustible_externo (fecha desc);
create index if not exists combustible_externo_equipo_idx on public.combustible_externo (equipo_codigo);

-- ── 6. RLS permisiva (igual que el resto del módulo) ──────────────────────
alter table public.bodegas enable row level security;
drop policy if exists bodegas_rw on public.bodegas;
create policy bodegas_rw on public.bodegas for all using (true) with check (true);

alter table public.insumos_stock enable row level security;
drop policy if exists insumos_stock_rw on public.insumos_stock;
create policy insumos_stock_rw on public.insumos_stock for all using (true) with check (true);

alter table public.insumos_traslados enable row level security;
drop policy if exists insumos_traslados_rw on public.insumos_traslados;
create policy insumos_traslados_rw on public.insumos_traslados for all using (true) with check (true);

alter table public.insumos_traslado_items enable row level security;
drop policy if exists insumos_traslado_items_rw on public.insumos_traslado_items;
create policy insumos_traslado_items_rw on public.insumos_traslado_items for all using (true) with check (true);

alter table public.combustible_externo enable row level security;
drop policy if exists combustible_externo_rw on public.combustible_externo;
create policy combustible_externo_rw on public.combustible_externo for all using (true) with check (true);

grant all on public.bodegas, public.insumos_stock, public.insumos_traslados,
             public.insumos_traslado_items, public.combustible_externo
  to anon, authenticated;

notify pgrst, 'reload schema';
