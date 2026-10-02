-- ============================================================================
-- 20261003090000 — UNA FIRMA POR DÍA en la planilla de IMECOL (2-oct-2026)
--
-- Pedido de Iván (por Julián Morales Bustos, conductor de IMECOL): «solo se debe
-- pedir una firma por día, no una por registro, porque es una planilla para todos
-- los recorridos del día». Medido: Julián hace 3–12 servicios al día y la mayoría
-- quedaban sin firma (de 134 registrados, 57 con firma).
--
-- · Terminar un servicio de IMECOL ya NO pide firma.
-- · Al final del día, quien recibe firma UNA vez la planilla del día:
--   `flota_firmas_dia` (conductor, fecha, formato, firma, nombre) y cada servicio
--   firmado queda con `firma_dia_id`.
-- · Con la firma, el día se CIERRA: el conductor ya no edita esos servicios.
--   Administración puede quitar la firma (anularla con motivo) para corregir.
-- · Las firmas viejas (una por servicio, `firma_url`) se respetan como están.
-- · Solo AGREGA.
-- ============================================================================

create table if not exists public.flota_firmas_dia (
  id             uuid primary key default gen_random_uuid(),
  conductor_id   text not null,
  conductor_nombre text,
  fecha          date not null,
  formato        text not null default 'IMECOL' check (formato in ('IMECOL', 'AGROMORALES')),
  firma_url      text not null,
  firma_nombre   text,
  n_servicios    integer not null default 0,
  anulado        boolean not null default false,
  anulado_por    text,
  anulado_motivo text,
  creado_por     text,
  created_at     timestamptz not null default now()
);
comment on table public.flota_firmas_dia is
  'Firma ÚNICA del día por conductor y formato (planilla de todos los recorridos del día). Ver flota_servicios.firma_dia_id.';

-- Una firma vigente por conductor, día y formato.
create unique index if not exists flota_firmas_dia_uq on public.flota_firmas_dia (conductor_id, fecha, formato) where not anulado;

alter table public.flota_firmas_dia enable row level security;
drop policy if exists flota_firmas_dia_rw on public.flota_firmas_dia;
create policy flota_firmas_dia_rw on public.flota_firmas_dia for all to anon, authenticated using (true) with check (true);
grant select, insert, update on public.flota_firmas_dia to anon, authenticated;

alter table public.flota_servicios add column if not exists firma_dia_id uuid references public.flota_firmas_dia(id);
create index if not exists flota_servicios_firma_dia_idx on public.flota_servicios (firma_dia_id) where firma_dia_id is not null;
