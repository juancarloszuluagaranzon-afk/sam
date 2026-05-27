-- Agrega 'PARCIAL' como estado valido en asignaciones.
--
-- Motivo: hoy una labor que el operario termina con executedArea < area
-- se marca COMPLETADA y desaparece de "Activas". El supervisor o el
-- operario deben re-crear la asignacion para continuar el faltante.
--
-- Con PARCIAL, la asignacion sigue activa: el operario original puede
-- continuar al dia siguiente, otro operario la puede tomar en campo
-- desde la suerte, y el supervisor la puede reasignar. Cuando alguien
-- la completa al 100% (executedArea >= area), pasa a COMPLETADA.
--
-- Aplicar en VPS:
--   ssh root@2.24.89.123
--   docker exec -i supabase-db psql -U postgres -d postgres \
--     < /opt/supabase/migrations/20260527160000_status_parcial.sql
-- O via Supabase Studio: SQL Editor + ejecutar el contenido.
--
-- Tras aplicar, verificar:
--   docker exec supabase-db psql -U postgres -d postgres -c \
--     "SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--      WHERE conrelid = 'public.asignaciones'::regclass
--        AND conname LIKE '%estado%';"
-- Debe incluir 'PARCIAL' en la lista del CHECK.

ALTER TABLE public.asignaciones
  DROP CONSTRAINT IF EXISTS asignaciones_estado_check;

ALTER TABLE public.asignaciones
  ADD CONSTRAINT asignaciones_estado_check
  CHECK (estado IN ('PENDIENTE', 'EN_PROCESO', 'COMPLETADA', 'CANCELADA', 'PARCIAL'));

-- Reload schema cache de PostgREST (sin esto el cambio no aparece en
-- la API hasta reinicio del container).
NOTIFY pgrst, 'reload schema';
