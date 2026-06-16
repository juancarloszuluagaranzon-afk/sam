-- Tipo de labor: MECANIZADA (con máquina/tractor) o MANUAL (a mano). Sirve para
-- que el operador de tractor SOLO vea labores mecanizadas al tomar en campo, y
-- para advertir al asignar una labor manual. Por defecto todo es MECANIZADA;
-- REPIQUE se marca MANUAL (fue el caso que originó esto).
-- Tabla: labores_catalogo (ver 20260615120000_labores_catalogo.sql).

ALTER TABLE public.labores_catalogo
  ADD COLUMN IF NOT EXISTS tipo text NOT NULL DEFAULT 'MECANIZADA';

UPDATE public.labores_catalogo SET tipo = 'MANUAL' WHERE nombre = 'REPIQUE';

NOTIFY pgrst, 'reload schema';
