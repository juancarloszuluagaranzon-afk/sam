-- Permite que un operario "libere" (rechace) una labor parcial que sabe
-- que no va a poder terminar, sin perder el avance ya hecho.
--
-- Caso de uso: un operario tomo en campo una suerte (ej: HDA LA LUISA
-- CABAL-090, DESPEJE, 19.52 ha), avanzo 12.20 ha y por una situacion
-- particular no la va a terminar. Le incomoda que la labor parcial le
-- quede activa para siempre. Con esta columna puede LIBERARLA: sale de
-- sus "Activas" pero la labor sigue ABIERTA (status PARCIAL) con su
-- avance guardado, para que el supervisor la reasigne a otro operario,
-- la cancele si ya no se hara, o el mismo operario la retome en campo.
--
-- `liberada = true`  -> oculta de las Activas del operario; visible para
--                       el supervisor con badge "Liberada".
-- `liberada = false` -> labor normal (al reasignar se vuelve a poner en
--                       false para que el nuevo operario la vea).
--
-- Aplicar en VPS via Supabase Studio (SQL Editor):
--   1. Abrir https://supabase.surcoapp.tech
--   2. SQL Editor -> New query -> pegar todo este archivo -> Run
--   3. Verificar con la query del final del archivo
--
-- IMPORTANTE: aplicar ANTES del push del codigo que usa esta columna
-- (mapAssignment / updateAssignment fallan con error 42703 si no existe).

ALTER TABLE public.asignaciones
  ADD COLUMN IF NOT EXISTS liberada boolean NOT NULL DEFAULT false;

-- Indice parcial: solo indexa las liberadas (son pocas frente al total).
-- Util para que el supervisor liste rapido "que parciales estan liberadas
-- esperando reasignacion" sin escanear toda la tabla.
CREATE INDEX IF NOT EXISTS idx_asignaciones_liberada
  ON public.asignaciones(liberada)
  WHERE liberada = true;

-- Reload schema cache de PostgREST.
NOTIFY pgrst, 'reload schema';

-- Verificacion (ejecutar despues como query separada):
--   SELECT column_name, data_type, column_default
--   FROM information_schema.columns
--   WHERE table_schema = 'public'
--     AND table_name = 'asignaciones'
--     AND column_name = 'liberada';
-- Debe retornar 1 fila (boolean, default false).
