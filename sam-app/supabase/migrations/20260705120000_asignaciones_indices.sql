-- Índices de rendimiento en `asignaciones`. Sin ellos, cada sync (delta cada
-- 30s, cada evento realtime, ×N dispositivos) hacía seq-scan de toda la tabla,
-- que crece sin poda → degradación lineal. Baratos, alto impacto.

-- Sync: delta filtra por updated_at/created_at; full ordena por created_at.
CREATE INDEX IF NOT EXISTS idx_asig_created_at ON public.asignaciones (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_asig_updated_at ON public.asignaciones (updated_at DESC);

-- Filtros y scoping frecuentes.
CREATE INDEX IF NOT EXISTS idx_asig_estado ON public.asignaciones (estado);
CREATE INDEX IF NOT EXISTS idx_asig_operador_id ON public.asignaciones (operador_id);
CREATE INDEX IF NOT EXISTS idx_asig_supervisor_id ON public.asignaciones (supervisor_id);

-- Índice funcional que MATCHEA el predicado real del trigger de cap-área
-- (usa upper(btrim(labor_nombre)) + estado), para que la suma del ciclo no
-- escanee fila por fila a escala.
CREATE INDEX IF NOT EXISTS idx_asig_cap_area
  ON public.asignaciones (suerte_codigo, upper(btrim(labor_nombre)), estado);
