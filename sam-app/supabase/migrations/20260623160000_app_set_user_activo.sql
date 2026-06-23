-- Activar / desactivar usuarios desde la app. Antes solo existía
-- app_delete_user (soft-delete a activo=false) y la carga ocultaba los
-- inactivos, así que no se podían reactivar. Esta RPC pone activo a un valor
-- dado. (Reactivar un nombre que ya tiene otro usuario ACTIVO fallará por el
-- índice único app_usuarios_nombre_activo_uniq — comportamiento deseado.)

CREATE OR REPLACE FUNCTION public.app_set_user_activo(p_id text, p_activo boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
begin
  UPDATE public.app_usuarios SET activo = p_activo WHERE id = upper(p_id);
end;
$function$;

GRANT EXECUTE ON FUNCTION public.app_set_user_activo(text, boolean) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
