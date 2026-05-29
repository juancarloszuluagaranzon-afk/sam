-- Permite crear suertes ad-hoc desde la app cuando aparecen suertes
-- nuevas en el campo que aun no estan en el catalogo del ingenio.
--
-- Caso de uso: el supervisor (o el operario) llega a una suerte que el
-- ingenio le agrego en su catalogo pero el maestro de SAM todavia no
-- la tiene. Antes el trabajo se trababa. Ahora puede crearla en 30 seg.
--
-- Aplicar en VPS via Supabase Studio (SQL Editor):
--   1. Abrir https://supabase.surcoapp.tech
--   2. SQL Editor -> New query -> pegar todo este archivo -> Run
--   3. Verificar con la query del final del archivo
--
-- IMPORTANTE: aplicar ANTES del push del codigo que usa estas columnas
-- (createMaestroRow falla con error 42703 si las columnas no existen).

-- Columnas de auditoria para distinguir suertes oficiales del ingenio
-- vs. las creadas manualmente desde la app.
ALTER TABLE public.maestro_risaralda
  ADD COLUMN IF NOT EXISTS creado_manual boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS creado_por text,
  ADD COLUMN IF NOT EXISTS creado_en timestamptz;

-- Indice parcial: solo indexa las creadas manualmente (que son pocas
-- comparadas con el universo oficial del ingenio). Util para que el
-- owner audite "que suertes se crearon a mano" sin escanear toda la
-- tabla maestra.
CREATE INDEX IF NOT EXISTS idx_maestro_creado_manual
  ON public.maestro_risaralda(creado_manual)
  WHERE creado_manual = true;

-- Evita que dos supervisores creen la misma suerte casi al mismo tiempo
-- (caso normal: cada uno ingresa "0042" en hacienda 105 del ingenio
-- risaralda). El segundo INSERT falla con error 23505 y la app le
-- avisa al supervisor: "esa suerte ya existe, seleccionala".
--
-- Si la combinacion ya existia duplicada antes de este constraint,
-- el ADD CONSTRAINT falla — en ese caso primero deduplicar manual.
ALTER TABLE public.maestro_risaralda
  DROP CONSTRAINT IF EXISTS uniq_maestro_suerte;

ALTER TABLE public.maestro_risaralda
  ADD CONSTRAINT uniq_maestro_suerte
  UNIQUE (hacienda, suerte, ingenio_id);

-- Reload schema cache de PostgREST.
NOTIFY pgrst, 'reload schema';

-- Verificacion (ejecutar despues como query separada):
--   SELECT column_name, data_type
--   FROM information_schema.columns
--   WHERE table_schema = 'public'
--     AND table_name = 'maestro_risaralda'
--     AND column_name IN ('creado_manual', 'creado_por', 'creado_en');
-- Debe retornar 3 filas.
