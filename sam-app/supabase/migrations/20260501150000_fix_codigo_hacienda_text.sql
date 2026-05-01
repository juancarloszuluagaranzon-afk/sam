-- Fix: codigo_hacienda debe ser TEXT para soportar haciendas alfanumericas
-- de Ingenio San Carlos (BS, CA, MA, etc.). Estaba como INTEGER y rechazaba
-- inserts con error 22P02 invalid_text_representation.

-- Limpieza de filas debug residuales de tests previos.
DELETE FROM asignaciones WHERE nombre_hacienda IN ('DEBUG_TEST', 'DUP_TEST');

-- Migrar tipo de columna a TEXT (cast in-place de los integers existentes).
ALTER TABLE asignaciones
  ALTER COLUMN codigo_hacienda TYPE TEXT USING codigo_hacienda::TEXT;
