-- Índice ÚNICO parcial: impide DOS labores ACTIVAS (PENDIENTE/EN_PROCESO/PARCIAL,
-- no liberadas) del mismo operario+suerte+labor. Complementa al trigger de área
-- (que cubre COMPLETADA/PARCIAL). Multi-operario legítimo NO choca: el
-- operador_id difiere.
--
-- ⚠️ REQUISITO: no deben existir duplicados ACTIVOS previos, o la creación del
-- índice falla. Si falla, corre primero el script de limpieza (ver el chat /
-- consultas de auditoría) y vuelve a ejecutar esta migración.

CREATE UNIQUE INDEX IF NOT EXISTS asignaciones_activa_uniq
  ON public.asignaciones (suerte_codigo, upper(btrim(labor_nombre)), operador_id)
  WHERE estado IN ('PENDIENTE','EN_PROCESO','PARCIAL')
    AND coalesce(liberada, false) = false;
