-- Fase 1: limpieza de asignaciones historicas previas al arranque oficial.
-- Conserva unicamente las asignaciones del dia 2026-05-01 (zona America/Bogota).
-- 2026-05-01 00:00 America/Bogota equivale a 2026-05-01 05:00 UTC.

DELETE FROM asignaciones
WHERE created_at < '2026-05-01 00:00:00-05';
