-- Registro INMUTABLE de sesiones de labor: cada inicio→cierre (parcial o final)
-- inserta UNA fila que NUNCA se actualiza. Es el detalle "uno a uno" para
-- trazabilidad de horómetros, horas-máquina y eficiencias. Las suertes totales
-- y el desglose por operario son VISTAS/consultas encima de esta tabla.

CREATE TABLE IF NOT EXISTS public.labor_sesiones (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asignacion_id     text,
  suerte_codigo     text,
  numero_suerte     text,
  nombre_hacienda   text,
  labor_nombre      text,
  operador_id       text,
  operador_nombre   text,
  equipo_codigo     text,
  equipo_nombre     text,
  fecha             date,
  horometro_inicial numeric,
  horometro_final   numeric,
  horas             numeric,          -- = horometro_final - horometro_inicial
  area_ejecutada    numeric,          -- área hecha en ESTA sesión
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_labor_sesiones_fecha  ON public.labor_sesiones (fecha);
CREATE INDEX IF NOT EXISTS idx_labor_sesiones_suerte ON public.labor_sesiones (suerte_codigo);
CREATE INDEX IF NOT EXISTS idx_labor_sesiones_equipo ON public.labor_sesiones (equipo_codigo);
CREATE INDEX IF NOT EXISTS idx_labor_sesiones_oper   ON public.labor_sesiones (operador_id);

-- El cliente usa el anon_key (igual que asignaciones).
ALTER TABLE public.labor_sesiones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS labor_sesiones_rw ON public.labor_sesiones;
CREATE POLICY labor_sesiones_rw ON public.labor_sesiones
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
GRANT ALL ON public.labor_sesiones TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
