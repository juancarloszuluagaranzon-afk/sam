-- ============================================================================
-- Abastecimiento en SEDE + aval del analista de insumos
--
-- Antes: el supervisor de insumos entraba a Inventario y se metía una "+ Entrada"
-- a mano. Eso no deja trazabilidad de nada — nadie sabe de dónde salió ese
-- combustible. Se acabó: el supervisor ya no toca inventario.
--
-- Ahora TODO el combustible que se carga (en estación o en la sede) se registra
-- como un evento en `combustible_externo`, sale de donde tiene que salir y queda
-- PENDIENTE del aval del analista de insumos y materiales (Diego).
--
-- Dos ejes que antes no existían:
--   origen  = de dónde salió   → ESTACION (bomba externa) | SEDE (bodega principal)
--   destino = a qué se le echó → CARRO (tanque de distribución) | VEHICULO (con
--             placa) | MAQUINA (con horómetro) | PIMPINAS (cantidad x capacidad)
--
-- El descuento de la bodega principal se hace de UNA VEZ (el combustible ya se
-- lo llevaron físicamente); Diego valida después. Si rechaza, se reversa.
-- ============================================================================

-- ── Catálogo de placas ──────────────────────────────────────────────────────
-- Para que nadie escriba la placa a mano y salgan tres variantes de la misma.
create table if not exists public.vehiculos (
  id uuid primary key default gen_random_uuid(),
  placa text not null,
  descripcion text,
  tipo text not null default 'VEHICULO',
  -- Las de uso diario salen primero en el selector; el resto queda tras "Otros".
  frecuente boolean not null default false,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists vehiculos_placa_uk on public.vehiculos (upper(placa));
create index if not exists vehiculos_activo_ix on public.vehiculos (activo);

alter table public.vehiculos enable row level security;
do $$ begin
  create policy vehiculos_all on public.vehiculos for all using (true) with check (true);
exception when duplicate_object then null; end $$;

-- Sin estos GRANT la policy no sirve de nada: la app entra con el anon_key y
-- se toparia con "permission denied for table vehiculos". Las demas tablas del
-- proyecto los tienen; una tabla nueva NO los hereda.
grant select, insert, update, delete on public.vehiculos to anon, authenticated;

-- ── Eventos de combustible: origen, conceptos nuevos y aval ────────────────
alter table public.combustible_externo
  add column if not exists origen text not null default 'ESTACION',
  add column if not exists bodega_origen_id uuid references public.bodegas(id),
  add column if not exists placa text,
  add column if not exists pimpinas_cantidad integer,
  add column if not exists pimpinas_capacidad numeric(12,2),
  add column if not exists estado text not null default 'PENDIENTE',
  add column if not exists revisado_por uuid,
  add column if not exists revisado_nombre text,
  add column if not exists revisado_en timestamptz,
  add column if not exists revision_nota text;

-- Lo que ya estaba registrado nace aprobado: no tiene sentido pedirle a Diego
-- que avale movimientos viejos que ya se consumieron.
update public.combustible_externo set estado = 'APROBADO' where estado = 'PENDIENTE' and created_at < now();

-- `destino` ya no es solo CARRO/MAQUINA.
do $$ begin
  alter table public.combustible_externo drop constraint if exists combustible_externo_destino_check;
exception when undefined_object then null; end $$;
alter table public.combustible_externo
  add constraint combustible_externo_destino_check
  check (destino in ('CARRO', 'MAQUINA', 'VEHICULO', 'PIMPINAS'));

alter table public.combustible_externo
  drop constraint if exists combustible_externo_origen_check;
alter table public.combustible_externo
  add constraint combustible_externo_origen_check check (origen in ('ESTACION', 'SEDE'));

alter table public.combustible_externo
  drop constraint if exists combustible_externo_estado_check;
alter table public.combustible_externo
  add constraint combustible_externo_estado_check check (estado in ('PENDIENTE', 'APROBADO', 'RECHAZADO'));

create index if not exists combustible_externo_estado_ix on public.combustible_externo (estado, fecha desc);

-- ── Rol nuevo: analista de insumos y materiales ─────────────────────────────
-- La tabla de usuarios se llama `app_usuarios` (no `usuarios`), y su CHECK de
-- rol se quedó atrás: no admite `analista_insumos` NI `conductor`, aunque el
-- codigo ya tiene los dos. Sin esto, crear a Diego revienta con violacion de
-- restriccion — y un conductor tampoco se podia crear (bug latente).
alter table public.app_usuarios drop constraint if exists app_usuarios_rol_check;
alter table public.app_usuarios add constraint app_usuarios_rol_check check (
  rol in ('owner','administracion','supervisor','operador','soporte',
          'supervisor_insumos','conductor','analista_insumos')
);

-- ── Placas de arranque ──────────────────────────────────────────────────────
insert into public.vehiculos (placa, descripcion, frecuente)
select v.placa, v.descripcion, true
  from (values
    ('CARRO GENARO', 'Camioneta supervisor de insumos - Genaro'),
    ('CARRO EDUVIN', 'Camioneta supervisor de insumos - Eduvin')
  ) as v(placa, descripcion)
 where not exists (select 1 from public.vehiculos x where upper(x.placa) = upper(v.placa));
