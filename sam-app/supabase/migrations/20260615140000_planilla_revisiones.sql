-- Marcas de "casilla revisada" de la Planilla quincenal. El propietario/admin
-- resalta en azul celeste las celdas (operario × día) que ya revisó; el cambio
-- es PERMANENTE (vive en BD, se ve en cualquier dispositivo). Una fila = una
-- celda marcada. Desmarcar = borrar la fila.

CREATE TABLE IF NOT EXISTS public.planilla_revisiones (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operador_id  text NOT NULL,
  fecha        date NOT NULL,
  revisado_por text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (operador_id, fecha)
);

ALTER TABLE public.planilla_revisiones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS planilla_revisiones_rw ON public.planilla_revisiones;
CREATE POLICY planilla_revisiones_rw ON public.planilla_revisiones
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
GRANT ALL ON public.planilla_revisiones TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
