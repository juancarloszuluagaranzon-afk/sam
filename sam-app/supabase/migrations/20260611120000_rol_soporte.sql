-- Rol "soporte": permite usuarios que entran a la app impersonando a otros
-- roles (operario / supervisor / propietario) para ver lo que cada uno ve.
-- La impersonación es 100% del lado del cliente (intercambia la sesión); aquí
-- solo habilitamos el rol en el CHECK y creamos 2 cuentas de soporte.

-- 1. Permitir 'soporte' en el CHECK de rol (el nombre del constraint puede
--    variar, así que lo buscamos y reemplazamos de forma robusta).
DO $$
DECLARE c text;
BEGIN
  SELECT conname INTO c
    FROM pg_constraint
   WHERE conrelid = 'public.app_usuarios'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) ILIKE '%rol%';
  IF c IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.app_usuarios DROP CONSTRAINT %I', c);
  END IF;
END $$;

ALTER TABLE public.app_usuarios
  ADD CONSTRAINT app_usuarios_rol_check
  CHECK (rol IN ('supervisor', 'operador', 'owner', 'administracion', 'soporte'));

-- 2. Dos cuentas de soporte (PIN con md5 igual que app_login).
--    PINs por defecto: SOP01 = 1357, SOP02 = 2468  (cambiarlos luego).
INSERT INTO public.app_usuarios (id, nombre_completo, rol, pin_hash, activo, orden)
VALUES
  ('SOP01', 'Soporte 1', 'soporte', md5('1357' || ':sam-piloto'), true,
   (SELECT COALESCE(MAX(orden), 0) + 1 FROM public.app_usuarios)),
  ('SOP02', 'Soporte 2', 'soporte', md5('2468' || ':sam-piloto'), true,
   (SELECT COALESCE(MAX(orden), 0) + 2 FROM public.app_usuarios))
ON CONFLICT (id) DO NOTHING;

NOTIFY pgrst, 'reload schema';
