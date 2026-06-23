-- MÓDULO INSUMOS Y COMBUSTIBLE — Fase 1: catálogo + inventario (kardex).
--
--   insumos         = catálogo (combustibles y materiales) con stock actual.
--   insumos_kardex  = movimientos de inventario (ENTRADA/SALIDA/AJUSTE) con el
--                     saldo resultante. Las SALIDA llegarán con los despachos
--                     (fase 3). El cliente usa anon_key (mismo patrón RLS).
--
-- Rol nuevo `supervisor_insumos`: no requiere cambio de BD (app_usuarios.rol es
-- texto libre); solo se maneja en el código.

-- 1) Catálogo de insumos
CREATE TABLE IF NOT EXISTS public.insumos (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre     text NOT NULL UNIQUE,
  categoria  text NOT NULL DEFAULT 'MATERIAL',   -- COMBUSTIBLE | MATERIAL
  unidad     text NOT NULL DEFAULT 'unidad',      -- galón, unidad, kg, litro...
  stock      numeric NOT NULL DEFAULT 0,
  activo     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Semilla de ejemplo (se pueden editar/borrar desde la app).
INSERT INTO public.insumos (nombre, categoria, unidad) VALUES
  ('DIESEL',   'COMBUSTIBLE', 'galón'),
  ('GANCHOS',  'MATERIAL',    'unidad'),
  ('TORNILLOS','MATERIAL',    'unidad')
ON CONFLICT (nombre) DO NOTHING;

ALTER TABLE public.insumos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS insumos_rw ON public.insumos;
CREATE POLICY insumos_rw ON public.insumos
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
GRANT ALL ON public.insumos TO anon, authenticated;

-- 2) Kardex de movimientos
CREATE TABLE IF NOT EXISTS public.insumos_kardex (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  insumo_id   uuid NOT NULL REFERENCES public.insumos(id) ON DELETE CASCADE,
  tipo        text NOT NULL,                 -- ENTRADA | SALIDA | AJUSTE
  cantidad    numeric NOT NULL,
  saldo       numeric NOT NULL,              -- saldo del insumo DESPUÉS del movimiento
  motivo      text,
  referencia  text,                          -- ej. id de despacho (fase 3)
  creado_por  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS insumos_kardex_insumo_idx ON public.insumos_kardex (insumo_id, created_at DESC);

ALTER TABLE public.insumos_kardex ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS insumos_kardex_rw ON public.insumos_kardex;
CREATE POLICY insumos_kardex_rw ON public.insumos_kardex
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
GRANT ALL ON public.insumos_kardex TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
