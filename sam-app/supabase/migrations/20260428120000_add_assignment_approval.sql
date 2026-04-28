-- Aprobación administrativa de labores creadas en campo (kind=LIBRE).
-- El operador puede ejecutar la labor sin esperar; pero para nómina, el supervisor
-- elegido debe aprobarla a posteriori.

ALTER TABLE asignaciones
  ADD COLUMN IF NOT EXISTS aprobacion VARCHAR(20) NOT NULL DEFAULT 'APROBADA',
  ADD COLUMN IF NOT EXISTS aprobada_por VARCHAR(20),
  ADD COLUMN IF NOT EXISTS aprobada_en TIMESTAMPTZ;

ALTER TABLE asignaciones
  DROP CONSTRAINT IF EXISTS asignaciones_aprobacion_check;

ALTER TABLE asignaciones
  ADD CONSTRAINT asignaciones_aprobacion_check
  CHECK (aprobacion IN ('PENDIENTE', 'APROBADA', 'RECHAZADA'));

-- Datos existentes: filas creadas antes de esta migración quedan como APROBADA
-- (el sistema las consideraba válidas implícitamente).

CREATE INDEX IF NOT EXISTS idx_asignaciones_aprobacion_pendiente
  ON asignaciones (aprobacion)
  WHERE aprobacion = 'PENDIENTE';
