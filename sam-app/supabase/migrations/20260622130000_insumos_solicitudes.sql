-- MÓDULO INSUMOS — Fase 2: solicitudes del operario + bandeja del supervisor.
--
--   insumos_solicitudes        = cabecera (quién pide, estado, nota, zona).
--   insumos_solicitud_items    = qué pide (insumo + cantidad), con snapshot de
--                                nombre/unidad para que el histórico no dependa
--                                de que el insumo siga existiendo.
--
-- Estados: PENDIENTE → (PROGRAMADA | RECHAZADA) ; ENTREGADA llega en fase 3
-- (despachos). El cliente usa anon_key (mismo patrón RLS).

CREATE TABLE IF NOT EXISTS public.insumos_solicitudes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operario_id     text NOT NULL,
  operario_nombre text,
  estado          text NOT NULL DEFAULT 'PENDIENTE',  -- PENDIENTE|PROGRAMADA|ENTREGADA|RECHAZADA|CANCELADA
  nota            text,
  zona            text,
  motivo_rechazo  text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS insumos_solicitudes_estado_idx ON public.insumos_solicitudes (estado, created_at DESC);
CREATE INDEX IF NOT EXISTS insumos_solicitudes_operario_idx ON public.insumos_solicitudes (operario_id, created_at DESC);

ALTER TABLE public.insumos_solicitudes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS insumos_solicitudes_rw ON public.insumos_solicitudes;
CREATE POLICY insumos_solicitudes_rw ON public.insumos_solicitudes
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
GRANT ALL ON public.insumos_solicitudes TO anon, authenticated;

CREATE TABLE IF NOT EXISTS public.insumos_solicitud_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  solicitud_id  uuid NOT NULL REFERENCES public.insumos_solicitudes(id) ON DELETE CASCADE,
  insumo_id     uuid REFERENCES public.insumos(id) ON DELETE SET NULL,
  insumo_nombre text,
  unidad        text,
  cantidad      numeric NOT NULL
);
CREATE INDEX IF NOT EXISTS insumos_solicitud_items_sol_idx ON public.insumos_solicitud_items (solicitud_id);

ALTER TABLE public.insumos_solicitud_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS insumos_solicitud_items_rw ON public.insumos_solicitud_items;
CREATE POLICY insumos_solicitud_items_rw ON public.insumos_solicitud_items
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
GRANT ALL ON public.insumos_solicitud_items TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
