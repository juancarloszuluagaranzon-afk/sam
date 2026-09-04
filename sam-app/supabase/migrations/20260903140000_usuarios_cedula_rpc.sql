-- La CEDULA se puede escribir desde la app.
--
-- La columna se agrego en 20260903130000 pero los usuarios se escriben por RPC
-- (`app_create_user` / `app_update_user`), asi que sin tocarlas el dato solo se
-- podia llenar por SQL — o sea no se podia llenar.
--
-- 🔴 `p_cedula` va AL FINAL y CON DEFAULT. Es lo que hace segura la ventana de
-- despliegue: una PWA que quedo en cache llamando sin ese argumento sigue
-- funcionando (toma el default) en vez de romper el alta de usuarios para todo
-- el que no haya recargado. Por eso tambien es DROP + CREATE y no un overload:
-- dos versiones de la misma funcion conviviendo es justo lo que hace que un dia
-- se llame a la equivocada.
--
-- ⚠️ `app_create_user` GENERA EL ID ELLA MISMA (U001, U002...) e IGNORA p_id.
-- Ese bloque se copia tal cual: reescribirlo "mas simple" habria hecho que el
-- id lo pusiera el navegador, con dos altas simultaneas pisandose.

drop function if exists public.app_update_user(text, text, text, text, text, text);
drop function if exists public.app_create_user(text, text, text, text, text, text);

create function public.app_update_user(
  p_id text, p_nombre text, p_rol text,
  p_pin text default null, p_equipo_codigo text default null,
  p_zona text default null, p_cedula text default null
) returns void language plpgsql security definer
set search_path to 'public', 'pg_catalog' as $fn$
begin
  update public.app_usuarios u set
    nombre_completo = p_nombre,
    rol             = p_rol,
    equipo_codigo   = nullif(p_equipo_codigo, ''),
    zona            = nullif(p_zona, ''),
    -- La cedula NO se borra si llega vacia: quien edite a alguien desde una
    -- pantalla que no la manda no puede hacer que se pierda.
    cedula          = coalesce(nullif(p_cedula, ''), u.cedula),
    pin_hash        = case when p_pin is not null and length(p_pin) > 0
                           then md5(p_pin || ':sam-piloto') else u.pin_hash end
  where u.id = upper(p_id);
end; $fn$;

create function public.app_create_user(
  p_id text, p_nombre text, p_rol text, p_pin text,
  p_equipo_codigo text default null, p_zona text default null,
  p_cedula text default null
) returns void language plpgsql security definer
set search_path to 'public', 'pg_catalog' as $fn$
declare v_id text;
begin
  -- El id lo pone la BASE, no el navegador (copiado de la version anterior).
  select 'U' || lpad((coalesce(max((regexp_replace(id, '\D', '', 'g'))::int), 0) + 1)::text, 3, '0')
  into v_id from public.app_usuarios where id ~ '^U?\d+$';

  insert into public.app_usuarios
    (id, nombre_completo, rol, pin_hash, equipo_codigo, zona, cedula, activo, orden)
  values (v_id, p_nombre, p_rol, md5(p_pin || ':sam-piloto'),
    nullif(p_equipo_codigo, ''), nullif(p_zona, ''), nullif(p_cedula, ''), true,
    (select coalesce(max(orden), 0) + 1 from public.app_usuarios));
end; $fn$;

grant execute on function public.app_update_user(text,text,text,text,text,text,text) to anon, authenticated;
grant execute on function public.app_create_user(text,text,text,text,text,text,text) to anon, authenticated;

notify pgrst, 'reload schema';
