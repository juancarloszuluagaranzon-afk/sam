-- Zona de trabajo (Norte / Sur) para distinguir físicamente dónde se ejecuta la labor.

ALTER TABLE asignaciones
  ADD COLUMN IF NOT EXISTS zona VARCHAR(20);

ALTER TABLE asignaciones
  DROP CONSTRAINT IF EXISTS asignaciones_zona_check;

ALTER TABLE asignaciones
  ADD CONSTRAINT asignaciones_zona_check
  CHECK (zona IS NULL OR zona IN ('NORTE', 'SUR'));
