-- Módulo FLOTA / ESCOLTA — Control de transporte de flota no propia (CDA-F-68).
--
-- Registra cada SERVICIO/viaje de las camionetas de escolta que alquila
-- AgroMorales, con los campos del formato oficial CDA-F-68 + comprobante:
-- firma del pasajero/responsable y foto de evidencia (ambas livianas).
--
-- Rol nuevo `conductor`: los conductores registran sus servicios desde el
-- celular. La gestión/exportación la ven owner/administración.
--
-- Correr en Supabase Studio (extensión traductora APAGADA).

create table if not exists public.flota_servicios (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Campos del formato CDA-F-68
  fecha date not null default current_date,
  vehiculo text,                 -- placa / identificador de la camioneta
  tipo_servicio text,            -- ESCOLTA, TRANSPORTE, etc.
  centro_costo text,
  proceso_solicitante text,
  nombre_pasajero text,
  origen text,
  destino text,
  hora_salida_origen text,
  hora_llegada_destino text,
  hora_salida_destino text,
  hora_llegada_origen text,
  hora_espera text,
  num_peajes integer default 0,
  otros_gastos numeric default 0,
  total_km numeric default 0,
  observacion text,

  -- Quién lo registró (conductor) + comprobante
  conductor_id text,
  conductor_nombre text,
  firma_url text,                -- imagen de la firma (JPEG liviano)
  firma_nombre text,             -- nombre de quien firma
  evidencia_url text,            -- foto de evidencia (JPEG liviano)
  estado text not null default 'REGISTRADO'   -- REGISTRADO | ANULADO
);

create index if not exists flota_servicios_fecha_idx on public.flota_servicios (fecha desc);
create index if not exists flota_servicios_conductor_idx on public.flota_servicios (conductor_id);

alter table public.flota_servicios enable row level security;
drop policy if exists flota_servicios_rw on public.flota_servicios;
create policy flota_servicios_rw on public.flota_servicios for all using (true) with check (true);
grant all on public.flota_servicios to anon, authenticated;
