-- Permite el rol `supervisor_insumos` (módulo Insumos y Combustible) en el CHECK
-- de app_usuarios.rol. Sin esto, crear un usuario "Supervisor de insumos" falla
-- con 23514 (el rol existe en el código pero el CHECK de la BD no lo aceptaba).
-- Busca el CHECK actual por su nombre real (sea cual sea) y lo recrea.

DO $$
DECLARE c text;
BEGIN
  SELECT conname INTO c FROM pg_constraint
  WHERE conrelid = 'public.app_usuarios'::regclass AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%rol%';
  IF c IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.app_usuarios DROP CONSTRAINT %I', c);
  END IF;
END $$;

ALTER TABLE public.app_usuarios ADD CONSTRAINT app_usuarios_rol_check
  CHECK (rol IN ('supervisor','operador','owner','administracion','soporte','supervisor_insumos'));

NOTIFY pgrst, 'reload schema';
