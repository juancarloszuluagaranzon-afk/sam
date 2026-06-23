-- MÓDULO INSUMOS — el TRACTOR/MÁQUINA como acumulador de costos.
--
-- Al entregar, el material se carga a una máquina (equipo). Por defecto es el
-- equipo asignado al operario en su perfil, pero el supervisor puede cambiarlo.
-- Se guarda en la solicitud (entrega) y en cada movimiento del kardex, para
-- poder sumar el consumo por máquina.

ALTER TABLE public.insumos_solicitudes
  ADD COLUMN IF NOT EXISTS equipo_codigo text;

ALTER TABLE public.insumos_kardex
  ADD COLUMN IF NOT EXISTS equipo_codigo text;
CREATE INDEX IF NOT EXISTS insumos_kardex_equipo_idx ON public.insumos_kardex (equipo_codigo, created_at DESC);

NOTIFY pgrst, 'reload schema';
