-- El cliente (rol anon) debe poder LEER los usuarios INACTIVOS para la gestión
-- de Usuarios (ver y reactivar). La policy de SELECT existente filtraba a
-- activo=true, así que los inactivos nunca llegaban al cliente aunque el query
-- ya no filtrara (RLS server-side). Esta policy permisiva los expone — las
-- policies permisivas se combinan con OR, así que con USING(true) pasan todos.
-- pin_hash NUNCA se selecciona desde el cliente.

DROP POLICY IF EXISTS app_usuarios_select_all ON public.app_usuarios;
CREATE POLICY app_usuarios_select_all ON public.app_usuarios
  FOR SELECT TO anon, authenticated USING (true);

NOTIFY pgrst, 'reload schema';
