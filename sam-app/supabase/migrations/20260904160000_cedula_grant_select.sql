-- 🔴 Una COLUMNA nueva no hereda los GRANT de la tabla.
--
-- `app_usuarios` no tiene `grant select` sobre la tabla entera: lo tiene sobre
-- una LISTA de columnas, que deja `pin_hash` por fuera a proposito. Al agregar
-- `cedula` en 20260903130000 quedo sin ese permiso, y el select de la app —que
-- la pide por nombre— empezo a responder 401 permission denied.
--
-- Lo peor no fue el 401: `loadAppUsers` atrapa el error y devuelve el espejo de
-- Dexie, asi que la pantalla de Usuarios siguio mostrando la lista VIEJA sin un
-- solo mensaje. Se crearon dos usuarios de verdad y el dueño no los veia.
--
-- ⚠️ Se otorga SOLO sobre `cedula`. Un `grant select on public.app_usuarios`
-- a secas arreglaria el sintoma y de paso le entregaria `pin_hash` a `anon`.

grant select (cedula) on public.app_usuarios to anon, authenticated;

notify pgrst, 'reload schema';
