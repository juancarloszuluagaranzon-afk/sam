-- ============================================================================
-- 20261023120000 — ÍNDICES PARA LA SINCRONIZACIÓN (23-oct-2026)
--
-- Medido en producción: la app repregunta labores cada 30 s con
--   WHERE updated_at >= X OR created_at >= X ORDER BY created_at DESC
-- `asignaciones` tenía índice en created_at pero NO en updated_at, así que ese
-- `.or` sobre dos columnas no podía usar índice y ESCANEABA toda la tabla en cada
-- consulta (Seq Scan, 536 buffers). Y la verificación de versión del maestro
-- (getMaestroVersion) ordena por updated_at entre los activos, también por Seq Scan.
--
-- Estos índices son ADITIVOS (no borran ni cambian datos). Verificado con EXPLAIN:
--   · asignaciones: pasa a Bitmap Index Scan (536 → 4 buffers, 2,3ms → 0,09ms).
--   · maestro: la consulta de updated_at pasa a Index Scan (2,6ms → 0,02ms).
-- Las tablas son chicas (5.661 y ~20.700 filas), así que crear el índice es casi
-- instantáneo; el beneficio real es MENOS carga de disco con muchos celulares.
-- ============================================================================

create index if not exists idx_asignaciones_updated_at
  on public.asignaciones (updated_at desc);

create index if not exists idx_maestro_activo_updated
  on public.maestro_risaralda (updated_at desc) where activo = true;
