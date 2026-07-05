-- BASELINE reconstruido de `asignaciones`. La tabla real de producción se creó a
-- mano en Studio (fuera de control de versiones); un restore/staging desde cero
-- fallaba. Esta migración documenta el esquema y lo hace reproducible.
--
-- Es 100% IDEMPOTENTE (CREATE TABLE IF NOT EXISTS + ADD COLUMN IF NOT EXISTS):
-- NO toca la tabla de producción existente. Su fecha (2026-04-01) es anterior a
-- todos los ALTER, para que en un replay corra primero. Verifica los tipos
-- contra el esquema vivo (`\d asignaciones` en Studio) si aplicas a un entorno nuevo.

CREATE TABLE IF NOT EXISTS public.asignaciones (
  id                text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  suerte_codigo     text,
  numero_suerte     text,
  codigo_hacienda   text,
  nombre_hacienda   text,
  labor_nombre      text,
  tractor           text,
  equipo_codigo     text,
  equipo_nombre     text,
  area_asignada     numeric,
  area_realizada    numeric,
  tipo_area         text,
  estado            text NOT NULL DEFAULT 'PENDIENTE',
  fecha_inicio      timestamptz,
  fecha_fin         timestamptz,
  horometro_inicial numeric,
  horometro_final   numeric,
  observaciones     text,
  supervisor_id     text,
  supervisor_nombre text,
  operador_id       text,
  operador_nombre   text,
  tipo_registro     text,
  cliente           text,
  aprobacion        text DEFAULT 'APROBADA',
  aprobada_por      text,
  aprobada_en       timestamptz,
  zona              text,
  liberada          boolean NOT NULL DEFAULT false,
  editado_por       text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Columnas por si la tabla existía sin alguna (idempotente).
ALTER TABLE public.asignaciones ADD COLUMN IF NOT EXISTS tipo_area text;
ALTER TABLE public.asignaciones ADD COLUMN IF NOT EXISTS cliente text;
ALTER TABLE public.asignaciones ADD COLUMN IF NOT EXISTS tipo_registro text;
ALTER TABLE public.asignaciones ADD COLUMN IF NOT EXISTS horometro_inicial numeric;
ALTER TABLE public.asignaciones ADD COLUMN IF NOT EXISTS horometro_final numeric;
ALTER TABLE public.asignaciones ADD COLUMN IF NOT EXISTS supervisor_nombre text;
ALTER TABLE public.asignaciones ADD COLUMN IF NOT EXISTS operador_nombre text;

-- RLS abierta al rol anon (coherente con el resto del modelo actual).
ALTER TABLE public.asignaciones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS asignaciones_all ON public.asignaciones;
CREATE POLICY asignaciones_all ON public.asignaciones
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
GRANT ALL ON public.asignaciones TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
