-- Catálogo de ZONAS + zona asignada a cada SUPERVISOR.
--
-- Objetivo: que al aprobar labores de campo la ZONA se llene sola según la zona
-- del supervisor (hoy Alfredo = Norte, otro = Sur), evitando seleccionarla cada
-- vez. Las zonas se manejan desde un catálogo (crear/editar) para que crezcan.
--
-- `codigo` es el valor que se guarda (compatible con el actual NORTE/SUR de
-- asignaciones.zona); `nombre` es la etiqueta visible. Se preserva EXACTO el
-- hash de PIN md5(pin || ':sam-piloto').

-- 1) Catálogo de zonas
CREATE TABLE IF NOT EXISTS public.zonas (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo     text NOT NULL UNIQUE,
  nombre     text NOT NULL,
  activo     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.zonas (codigo, nombre) VALUES
  ('NORTE', 'Zona Norte'),
  ('SUR',   'Zona Sur')
ON CONFLICT (codigo) DO NOTHING;

ALTER TABLE public.zonas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS zonas_rw ON public.zonas;
CREATE POLICY zonas_rw ON public.zonas
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
GRANT ALL ON public.zonas TO anon, authenticated;

-- 2) Columna zona en usuarios (la usan los supervisores)
ALTER TABLE public.app_usuarios
  ADD COLUMN IF NOT EXISTS zona text;

-- 3) RPC create/update con p_zona (firma de 6 args). Preserva md5 del PIN.
DROP FUNCTION IF EXISTS public.app_create_user(text, text, text, text, text) CASCADE;
DROP FUNCTION IF EXISTS public.app_create_user(text, text, text, text, text, text) CASCADE;
CREATE FUNCTION public.app_create_user(
  p_id text, p_nombre text, p_rol text, p_pin text,
  p_equipo_codigo text DEFAULT NULL, p_zona text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
begin
  INSERT INTO public.app_usuarios
    (id, nombre_completo, rol, pin_hash, equipo_codigo, zona, activo, orden)
  VALUES (
    upper(p_id), p_nombre, p_rol, md5(p_pin || ':sam-piloto'),
    nullif(p_equipo_codigo, ''), nullif(p_zona, ''), true,
    (SELECT COALESCE(MAX(orden), 0) + 1 FROM public.app_usuarios)
  );
end;
$function$;

DROP FUNCTION IF EXISTS public.app_update_user(text, text, text, text, text) CASCADE;
DROP FUNCTION IF EXISTS public.app_update_user(text, text, text, text, text, text) CASCADE;
CREATE FUNCTION public.app_update_user(
  p_id text, p_nombre text, p_rol text, p_pin text DEFAULT NULL,
  p_equipo_codigo text DEFAULT NULL, p_zona text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
begin
  UPDATE public.app_usuarios u
  SET nombre_completo = p_nombre,
      rol = p_rol,
      equipo_codigo = nullif(p_equipo_codigo, ''),
      zona = nullif(p_zona, ''),
      pin_hash = CASE
        WHEN p_pin IS NOT NULL AND length(p_pin) > 0
        THEN md5(p_pin || ':sam-piloto')
        ELSE u.pin_hash
      END
  WHERE u.id = upper(p_id);
end;
$function$;

GRANT EXECUTE ON FUNCTION public.app_create_user(text,text,text,text,text,text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_update_user(text,text,text,text,text,text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
