-- Permite a la app (rol anon, anon_key) CREAR/EDITAR equipos. Antes la tabla
-- `equipos` solo tenía política de lectura, así que "Crear equipo" desde la app
-- fallaba con "No se pudo crear el equipo" (RLS bloqueaba el INSERT del anon),
-- aunque desde Studio (rol postgres, que se salta RLS) sí funcionara.

DROP POLICY IF EXISTS equipos_rw ON public.equipos;
CREATE POLICY equipos_rw ON public.equipos
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
GRANT ALL ON public.equipos TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
