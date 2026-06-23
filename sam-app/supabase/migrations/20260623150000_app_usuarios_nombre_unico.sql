-- Evita usuarios ACTIVOS duplicados por nombre. Origen: existían DOS
-- "JULIO CESAR NIÑO" (U033 y U040) con ids distintos; una labor quedó bajo U040
-- y descuadraba el Resumen (que filtra por id de sesión, no por nombre).
--
-- Índice único PARCIAL sobre el nombre normalizado (sin espacios extra, en
-- minúsculas), solo para usuarios activos → los soft-deleted (activo=false) no
-- estorban. Crear un usuario activo con nombre repetido fallará en el INSERT.
--
-- ⚠️ Requiere que NO existan ya dos usuarios activos con el mismo nombre.
-- Verificar antes:
--   select lower(btrim(nombre_completo)), count(*) from app_usuarios
--   where activo=true group by 1 having count(*)>1;

CREATE UNIQUE INDEX IF NOT EXISTS app_usuarios_nombre_activo_uniq
  ON public.app_usuarios (lower(btrim(nombre_completo)))
  WHERE activo = true;
