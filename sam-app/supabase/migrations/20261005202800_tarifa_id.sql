-- Add tarifa_id for manual tariff overrides
ALTER TABLE asignaciones ADD COLUMN tarifa_id UUID REFERENCES tarifas(id) ON DELETE SET NULL;
