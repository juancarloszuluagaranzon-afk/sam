-- RENDIMIENTO / PRODUCTIVIDAD del operario (motivación por metas).
--
-- 1) Meta de ha/día por LABOR: cada labor rinde distinto (DESPEJE 12, REENCALLE
--    8…). El operario ve su cumplimiento de la quincena promediado día a día.
--    El KPI se calcula 100% en el cliente con datos ya cargados (cero carga BD).
-- 2) Config del refuerzo motivacional (imagen/GIF + mensaje) que el dueño edita
--    y que se le muestra al operario cuando va ≥ umbral (default 100%).

ALTER TABLE public.labores_catalogo
  ADD COLUMN IF NOT EXISTS meta_ha_dia numeric;

CREATE TABLE IF NOT EXISTS public.motivacion (
  id         text PRIMARY KEY DEFAULT 'default',
  mensaje    text,
  imagen_url text,
  umbral     numeric NOT NULL DEFAULT 100,   -- % de cumplimiento para felicitar
  activo     boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.motivacion (id, mensaje)
  VALUES ('default', '¡Vas muy bien! Sigue así 💪')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.motivacion ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS motivacion_rw ON public.motivacion;
CREATE POLICY motivacion_rw ON public.motivacion
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
GRANT ALL ON public.motivacion TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
