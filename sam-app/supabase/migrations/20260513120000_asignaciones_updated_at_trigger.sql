-- Trigger BEFORE UPDATE para que `updated_at` se mueva en cada UPDATE.
-- Sin esto, el delta-sync de loadAssignments (filtro updated_at.gt.lastSync)
-- nunca trae las filas modificadas y la UI del operador queda con estado stale.

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS asignaciones_set_updated_at ON public.asignaciones;

CREATE TRIGGER asignaciones_set_updated_at
BEFORE UPDATE ON public.asignaciones
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
