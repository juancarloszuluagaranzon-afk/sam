-- ============================================================================
-- ROL «Propietario 1» (código `propietario`) — SOLO CONSULTA (24-oct-2026)
--
-- Pedido de Iván: un rol para don Alcides Morales (padre de Cristian) que pueda VER
-- los tableros, la planilla, el resumen y el reporte, sin crear, editar ni borrar nada.
--
-- Postgres no AMPLÍA un CHECK: se reescribe completo. La lista de abajo son los 11
-- roles vigentes, leídos de la base el 24-oct-2026 con
--   select pg_get_constraintdef(oid) from pg_constraint
--    where conrelid = 'public.app_usuarios'::regclass and conname = 'app_usuarios_rol_check';
-- más `propietario`. Si falta uno, los usuarios con ese rol quedan inválidos.
--
-- ⚠️ El «solo consulta» lo hace cumplir la APP (pantallas). La base todavía confía en el
-- cliente (Fase 3 de seguridad pendiente): ver `project_permisos_base`.
-- ============================================================================

alter table public.app_usuarios drop constraint if exists app_usuarios_rol_check;
alter table public.app_usuarios add constraint app_usuarios_rol_check check (rol = any (array[
  'owner', 'administracion', 'supervisor', 'operador', 'soporte', 'supervisor_insumos',
  'conductor', 'analista_insumos', 'taller', 'conductor_madera', 'dueno_finca',
  'propietario'
]::text[]));
