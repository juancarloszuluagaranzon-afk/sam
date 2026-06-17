-- Resaltado de celdas de la Planilla en varios colores (antes solo azul). Se
-- agrega `color` a planilla_revisiones: 'azul' | 'rojo' | 'amarillo' | 'verde'
-- (tonos pastel en la UI). Las filas existentes quedan en 'azul' (revisada).
-- Las novedades del operario (operario_novedades.tipo) ya admiten texto libre,
-- así que los nuevos tipos NP/D/P/C no requieren migración.

ALTER TABLE public.planilla_revisiones
  ADD COLUMN IF NOT EXISTS color text NOT NULL DEFAULT 'azul';

NOTIFY pgrst, 'reload schema';
