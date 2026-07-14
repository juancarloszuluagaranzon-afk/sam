-- Referencia de ha/DÍA para el indicador diario del operario (promedio por día
-- y "cómo terminó el último día"). Es un umbral plano por día (ej. 15 ha/día se
-- considera un buen día), independiente de las metas por labor del %. Editable
-- en Catálogos → Motivación.

ALTER TABLE public.motivacion
  ADD COLUMN IF NOT EXISTS meta_dia_ref numeric NOT NULL DEFAULT 15;

NOTIFY pgrst, 'reload schema';
