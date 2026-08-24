-- Viajes de trozas — primer módulo de la línea de transporte de madera.
--
-- ⚠️ RAMA `pruebas`. No va a producción hasta que el cliente valide el flujo.
--
-- Un viaje es UN hecho: sale madera de un predio y llega a una planta. Lo que lo
-- hace distinto de un servicio de flota es que arrastra **papeles con fecha de
-- vencimiento** y un **volumen que hay que conciliar** contra lo que recibió el
-- comprador.
--
-- Las dos columnas que justifican el módulo entero:
--
--   `doc_vence`  el salvoconducto (SUNL) dura **8 días calendario** y sirve para
--                UN viaje. Vencido, el decomiso incluye el vehículo, no solo la
--                madera. Hoy eso se controla mirando un papel en la guantera.
--
--   `volumen_recibido_m3`  nullable a propósito: null = **todavía no lo han
--                pesado en destino**, que es distinto de "llegó cero". Mismo
--                criterio que `insumos_solicitudes.engraso`.
--
-- El volumen va en m³ y el peso en toneladas, los DOS, porque con madera verde
-- (~1 t/m³) el camión se llena por PESO antes que por volumen y el límite legal
-- es de peso: C2 16 t · C3 28 t · C3S3 52 t (Resolución 4100 de 2004).

create table if not exists public.madera_viajes (
  id                  uuid primary key default gen_random_uuid(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  fecha               date not null default current_date,
  predio              text,                      -- de dónde sale la madera
  destino             text,                      -- planta o patio que la recibe
  placa               text,
  -- Configuración del vehículo. Decide el límite de peso, así que no es un dato
  -- decorativo: es contra lo que se compara para avisar del sobrepeso.
  config              text not null default 'C3',
  conductor_id        text,
  conductor_nombre    text,

  especie             text,
  volumen_m3          numeric,
  peso_ton            numeric,
  volumen_recibido_m3 numeric,                   -- null = aún sin conciliar

  -- Bosque natural → SUNL (plataforma VITAL). Plantación registrada → remisión
  -- del ICA. Son documentos distintos de autoridades distintas; guardar cuál es
  -- evita tener que adivinarlo después.
  doc_tipo            text default 'SUNL',
  doc_numero          text,
  doc_vence           date,

  estado              text not null default 'CARGADO',
  foto_url            text,
  nota                text,
  registrado_por      text,
  registrado_nombre   text
);

alter table public.madera_viajes add column if not exists volumen_recibido_m3 numeric;
alter table public.madera_viajes add column if not exists doc_vence date;

do $$ begin
  begin
    alter table public.madera_viajes add constraint madera_viajes_estado_check
      check (estado in ('CARGADO','EN_RUTA','DESCARGADO','ANULADO'));
  exception when duplicate_object then null; end;
  begin
    alter table public.madera_viajes add constraint madera_viajes_config_check
      check (config in ('C2','C3','C3S3'));
  exception when duplicate_object then null; end;
end $$;

comment on table public.madera_viajes is
  'Viajes de trozas: origen, destino, carga, documento de movilización y '
  'conciliación de volumen. Rama pruebas.';
comment on column public.madera_viajes.doc_vence is
  'Vencimiento del salvoconducto. El SUNL dura 8 días calendario y sirve para un '
  'solo viaje; vencido, el decomiso incluye el vehículo.';
comment on column public.madera_viajes.volumen_recibido_m3 is
  'NULL = todavía no lo pesaron en destino. Distinto de cero.';

create index if not exists madera_viajes_fecha_idx on public.madera_viajes (fecha desc);
create index if not exists madera_viajes_vence_idx on public.madera_viajes (doc_vence)
  where estado <> 'ANULADO';

-- ⚠️ Una tabla nueva NO hereda los GRANT: sin esto la app responde
-- "permission denied" aunque la policy exista.
alter table public.madera_viajes enable row level security;
drop policy if exists madera_viajes_rw on public.madera_viajes;
create policy madera_viajes_rw on public.madera_viajes for all to anon, authenticated
  using (true) with check (true);
grant select, insert, update, delete on public.madera_viajes to anon, authenticated;

notify pgrst, 'reload schema';
