-- app_create_user genera el id en el SERVIDOR (sobre TODOS los usuarios, activos
-- o no) → nunca colisiona con un id ocupado por un inactivo. Antes el cliente
-- calculaba el id sobre la lista cargada; si esa lista no traía inactivos, se
-- saltaba ids ocupados (U040/U046…) → "duplicate key app_usuarios_pkey".
-- p_id se ignora (queda por compatibilidad de firma). Preserva md5 del PIN.

DROP FUNCTION IF EXISTS public.app_create_user(text, text, text, text, text, text) CASCADE;
CREATE FUNCTION public.app_create_user(
  p_id text, p_nombre text, p_rol text, p_pin text,
  p_equipo_codigo text DEFAULT NULL, p_zona text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_id text;
begin
  -- Siguiente Uxxx libre = U + (máximo número existente + 1), sobre TODOS.
  SELECT 'U' || lpad(
           (coalesce(max((regexp_replace(id, '\D', '', 'g'))::int), 0) + 1)::text, 3, '0')
  INTO v_id
  FROM public.app_usuarios
  WHERE id ~ '^U?\d+$';

  INSERT INTO public.app_usuarios
    (id, nombre_completo, rol, pin_hash, equipo_codigo, zona, activo, orden)
  VALUES (
    v_id, p_nombre, p_rol, md5(p_pin || ':sam-piloto'),
    nullif(p_equipo_codigo, ''), nullif(p_zona, ''), true,
    (SELECT coalesce(max(orden), 0) + 1 FROM public.app_usuarios)
  );
end;
$function$;

GRANT EXECUTE ON FUNCTION public.app_create_user(text, text, text, text, text, text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
