-- Marcas de "labor revisada" en la pestaña Labores. El propietario/admin/superv.
-- resalta en azul celeste las tarjetas de labor que ya revisó; el cambio es
-- PERMANENTE (vive en BD, se ve en cualquier dispositivo). Una fila = una labor
-- (asignación) marcada. Desmarcar = borrar la fila.

CREATE TABLE IF NOT EXISTS public.labor_revisiones (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asignacion_id text NOT NULL UNIQUE,
  revisado_por  text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.labor_revisiones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS labor_revisiones_rw ON public.labor_revisiones;
CREATE POLICY labor_revisiones_rw ON public.labor_revisiones
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
GRANT ALL ON public.labor_revisiones TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
