-- ============================================================================
-- 20261002210000 — Facturas conectadas con SIIGO (2-oct-2026)
--
-- Pedido de Cristhian: que la factura quede asociada y se pueda VER a través de la
-- API de Siigo. La función del servidor `siigo-factura` (supabase/functions) busca
-- la factura en Siigo por su número (p. ej. «FV-1-1234»), trae su PDF oficial y su
-- total / saldo / CUFE, y deja esos datos aquí.
--
-- · Las CREDENCIALES de Siigo (usuario + access_key de cada razón social) van en
--   `siigo_config`, CERRADA a la llave pública: solo la lee la función del
--   servidor. Nunca en el repo ni en el celular.
-- · Solo AGREGA.
-- ============================================================================

create table if not exists public.siigo_config (
  razon_social   text primary key check (razon_social in ('AGROMORALES', 'CEBALLOS Y LOZANO')),
  usuario        text not null,
  access_key     text not null,
  partner_id     text not null default 'AgroMoralesSAM',
  activo         boolean not null default true,
  actualizado_en timestamptz not null default now()
);
comment on table public.siigo_config is
  'Credenciales de la API de Siigo por razón social. CERRADA a anon/authenticated: solo la función siigo-factura.';
alter table public.siigo_config enable row level security;
revoke all on public.siigo_config from anon, authenticated;
grant select on public.siigo_config to postgres;

alter table public.fact_documentos add column if not exists siigo_id text;
alter table public.fact_documentos add column if not exists siigo_nombre text;
alter table public.fact_documentos add column if not exists siigo_cufe text;
alter table public.fact_documentos add column if not exists siigo_total numeric(16, 2);
alter table public.fact_documentos add column if not exists siigo_saldo numeric(16, 2);
alter table public.fact_documentos add column if not exists siigo_consultado_en timestamptz;

-- La función lee y anota con el rol postgres (SUPABASE_DB_URL).
grant select, update on public.fact_documentos to postgres;

-- ¿Hay conexión con Siigo para esta razón social? (sin exponer las credenciales)
create or replace function public.siigo_conectado(p_razon_social text) returns boolean
language sql stable security definer set search_path = public, pg_catalog as $$
  select exists (select 1 from public.siigo_config where razon_social = p_razon_social and activo)
$$;
grant execute on function public.siigo_conectado(text) to anon, authenticated;
