-- Habilita el INSERT de suertes ad-hoc desde la app (rol anon).
--
-- Contexto: la app usa el anon_key con auth propio por PIN (no Supabase
-- Auth). La tabla maestro_risaralda tiene RLS activado y ya cuenta con
-- policy de SELECT (por eso el catalogo carga), pero NO tenia policy de
-- INSERT. Por eso createMaestroRow fallaba con:
--   "new row violates row-level security policy for table maestro_risaralda"
--
-- El GRANT INSERT ya existe (si faltara, el error seria "permission
-- denied for table", no "row-level security policy"). Solo falta la
-- policy permisiva de RLS.
--
-- Aplicar en VPS via Supabase Studio (SQL Editor):
--   1. Abrir https://supabase.surcoapp.tech
--   2. SQL Editor -> New query -> pegar todo este archivo -> Run
--   3. Verificar con la query del final del archivo
--
-- Depende de la migracion 20260529120000 (columna creado_manual).

-- Asegura RLS activo (idempotente; ya deberia estarlo).
ALTER TABLE public.maestro_risaralda ENABLE ROW LEVEL SECURITY;

-- Policy de INSERT para clientes anonimos/autenticados.
--
-- Guard de seguridad: WITH CHECK (creado_manual = true) permite que el
-- cliente SOLO inserte suertes marcadas como creadas manualmente. Asi un
-- cliente con el anon_key no puede falsificar entradas del catalogo
-- oficial del ingenio (que se cargan por migracion/import con
-- creado_manual=false). createMaestroRow siempre envia creado_manual=true,
-- por lo que cumple este check.
DROP POLICY IF EXISTS "maestro_anon_insert" ON public.maestro_risaralda;
CREATE POLICY "maestro_anon_insert"
  ON public.maestro_risaralda
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (creado_manual = true);

-- Reload schema cache de PostgREST (las policies aplican de inmediato;
-- el NOTIFY es por consistencia con el resto de migraciones).
NOTIFY pgrst, 'reload schema';

-- Verificacion (ejecutar despues como query separada):
--   SELECT polname, cmd, roles::regrole[]
--   FROM pg_policy
--   WHERE polrelid = 'public.maestro_risaralda'::regclass;
-- Debe listar 'maestro_anon_insert' con cmd = 'a' (INSERT).
