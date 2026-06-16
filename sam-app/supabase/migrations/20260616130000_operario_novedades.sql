-- Novedades de disponibilidad del operario: VACACIONES o TALLER. El operario las
-- reporta desde su app (Vacaciones pide rango inicio/fin; Taller idem). Cada fila
-- = un día marcado. Se reflejan en la Planilla quincenal como V / T. Una sola
-- novedad por (operario, día): re-reportar el mismo día reemplaza el tipo.

CREATE TABLE IF NOT EXISTS public.operario_novedades (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operador_id text NOT NULL,
  fecha       date NOT NULL,
  tipo        text NOT NULL,   -- 'V' (vacaciones) | 'T' (taller)
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (operador_id, fecha)
);

CREATE INDEX IF NOT EXISTS idx_operario_novedades_fecha ON public.operario_novedades (fecha);

ALTER TABLE public.operario_novedades ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS operario_novedades_rw ON public.operario_novedades;
CREATE POLICY operario_novedades_rw ON public.operario_novedades
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
GRANT ALL ON public.operario_novedades TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
