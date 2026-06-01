-- Permite EDITAR filas del maestro desde la app (cliente anon_key): cambiar
-- el area_neta de una suerte (y su nombre de hacienda) desde la nueva pestana
-- "Maestros" que usan dueno, administracion y supervisores.
--
-- Igual que con el INSERT (migracion 20260529130000), para UPDATE desde el
-- cliente con RLS activo NO basta el GRANT: hace falta una policy permisiva
-- por comando. Sintoma si falta: "new row violates row-level security policy
-- for table maestro_risaralda" al guardar el area editada.
--
-- La autorizacion por ROL (solo dueno/admin/supervisor) se hace en la UI; a
-- nivel DB todos usan el anon_key (auth por PIN propia, no Supabase Auth),
-- igual que con el UPDATE de asignaciones.
--
-- Aplicar en VPS via Supabase Studio (SQL Editor) ANTES del push del codigo
-- que llama a updateMaestroRow.

ALTER TABLE public.maestro_risaralda ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "maestro_anon_update" ON public.maestro_risaralda;
CREATE POLICY "maestro_anon_update"
  ON public.maestro_risaralda
  FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

-- Las policies aplican de inmediato (no requieren NOTIFY pgrst), pero lo
-- dejamos por consistencia.
NOTIFY pgrst, 'reload schema';

-- Verificacion (ejecutar despues como query separada):
--   SELECT polname, cmd FROM pg_policy
--   WHERE polrelid = 'public.maestro_risaralda'::regclass;
-- Debe listar la policy de UPDATE 'maestro_anon_update'.
