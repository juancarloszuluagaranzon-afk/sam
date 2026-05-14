-- CRUD de usuarios usando md5 (consistente con app_login que valida con md5).
--
-- Contexto: la migración original del socio tenía app_create_user usando
-- `crypt(p_pin, gen_salt('bf'))` (bcrypt) pero app_login valida con
-- `md5(p_pin || ':sam-piloto')`. Eran INCONSISTENTES: los usuarios creados
-- con bcrypt nunca podían loguearse. Además gen_salt fallaba porque pgcrypto
-- no estaba en el search_path de la función → error "gen_salt(unknown) does
-- not exist" desde la UI.
--
-- Esta migración deja la fuente canónica de las 3 funciones (create/update/
-- delete) usando md5. Si alguien las recrea con otra cosa, esta migración
-- las regresa al estado correcto.

-- 1. app_create_user
DROP FUNCTION IF EXISTS public.app_create_user(text, text, text, text, text) CASCADE;
DROP FUNCTION IF EXISTS public.app_create_user(text, text, text, text) CASCADE;

CREATE FUNCTION public.app_create_user(
  p_id text,
  p_nombre text,
  p_rol text,
  p_pin text,
  p_equipo_codigo text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
begin
  INSERT INTO public.app_usuarios
    (id, nombre_completo, rol, pin_hash, equipo_codigo, activo, orden)
  VALUES (
    upper(p_id),
    p_nombre,
    p_rol,
    md5(p_pin || ':sam-piloto'),
    nullif(p_equipo_codigo, ''),
    true,
    (SELECT COALESCE(MAX(orden), 0) + 1 FROM public.app_usuarios)
  );
end;
$function$;

-- 2. app_update_user (deja pin_hash sin tocar si p_pin viene NULL/vacío)
DROP FUNCTION IF EXISTS public.app_update_user(text, text, text, text, text) CASCADE;
DROP FUNCTION IF EXISTS public.app_update_user(text, text, text, text) CASCADE;

CREATE FUNCTION public.app_update_user(
  p_id text,
  p_nombre text,
  p_rol text,
  p_pin text DEFAULT NULL,
  p_equipo_codigo text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
begin
  UPDATE public.app_usuarios u
  SET nombre_completo = p_nombre,
      rol = p_rol,
      equipo_codigo = nullif(p_equipo_codigo, ''),
      pin_hash = CASE
        WHEN p_pin IS NOT NULL AND length(p_pin) > 0
        THEN md5(p_pin || ':sam-piloto')
        ELSE u.pin_hash
      END
  WHERE u.id = upper(p_id);
end;
$function$;

-- 3. app_delete_user (soft delete por activo=false)
DROP FUNCTION IF EXISTS public.app_delete_user(text) CASCADE;

CREATE FUNCTION public.app_delete_user(p_id text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
begin
  UPDATE public.app_usuarios
  SET activo = false
  WHERE id = upper(p_id);
end;
$function$;

-- Grants para el rol anon (cliente usa anon_key) y authenticated
GRANT EXECUTE ON FUNCTION public.app_create_user(text, text, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_update_user(text, text, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_delete_user(text) TO anon, authenticated;

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
