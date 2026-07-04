-- AUDITORÍA de ediciones de labores (asignaciones).
-- Nivel 1: columna `editado_por` (quién tocó por última vez) + `updated_at` (ya
--          existe por trigger) → el cliente muestra "Última edición: X · fecha".
-- Nivel 2: tabla `asignaciones_auditoria` + trigger que registra CADA cambio
--          (OLD→NEW por campo) venga de donde venga (app, registro rápido, SQL).

-- Nivel 1: quién editó por última vez (lo setea el cliente en cada write).
ALTER TABLE public.asignaciones ADD COLUMN IF NOT EXISTS editado_por text;

-- Nivel 2: bitácora de cambios.
CREATE TABLE IF NOT EXISTS public.asignaciones_auditoria (
  id bigserial PRIMARY KEY,
  asignacion_id text NOT NULL,
  accion text NOT NULL,               -- 'INSERT' | 'UPDATE'
  cambios jsonb,                      -- { campo: [antes, despues] }
  editado_por text,
  editado_en timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_asig_audit_aid
  ON public.asignaciones_auditoria (asignacion_id, editado_en DESC);

ALTER TABLE public.asignaciones_auditoria ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS asignaciones_auditoria_select ON public.asignaciones_auditoria;
CREATE POLICY asignaciones_auditoria_select ON public.asignaciones_auditoria
  FOR SELECT TO anon, authenticated USING (true);
GRANT SELECT ON public.asignaciones_auditoria TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.asignaciones_auditoria_id_seq TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.asignaciones_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v jsonb := '{}'::jsonb;
begin
  if TG_OP = 'UPDATE' then
    if NEW.estado            is distinct from OLD.estado            then v := v || jsonb_build_object('estado',            jsonb_build_array(OLD.estado, NEW.estado)); end if;
    if NEW.area_realizada    is distinct from OLD.area_realizada    then v := v || jsonb_build_object('area_realizada',    jsonb_build_array(OLD.area_realizada, NEW.area_realizada)); end if;
    if NEW.operador_id       is distinct from OLD.operador_id       then v := v || jsonb_build_object('operador',          jsonb_build_array(OLD.operador_nombre, NEW.operador_nombre)); end if;
    if NEW.equipo_codigo     is distinct from OLD.equipo_codigo     then v := v || jsonb_build_object('equipo',            jsonb_build_array(OLD.equipo_nombre, NEW.equipo_nombre)); end if;
    if NEW.horometro_inicial is distinct from OLD.horometro_inicial then v := v || jsonb_build_object('horometro_inicial', jsonb_build_array(OLD.horometro_inicial, NEW.horometro_inicial)); end if;
    if NEW.horometro_final   is distinct from OLD.horometro_final   then v := v || jsonb_build_object('horometro_final',   jsonb_build_array(OLD.horometro_final, NEW.horometro_final)); end if;
    if NEW.fecha_inicio      is distinct from OLD.fecha_inicio      then v := v || jsonb_build_object('fecha_inicio',      jsonb_build_array(OLD.fecha_inicio, NEW.fecha_inicio)); end if;
    if NEW.fecha_fin         is distinct from OLD.fecha_fin         then v := v || jsonb_build_object('fecha_fin',         jsonb_build_array(OLD.fecha_fin, NEW.fecha_fin)); end if;
    if NEW.aprobacion        is distinct from OLD.aprobacion        then v := v || jsonb_build_object('aprobacion',        jsonb_build_array(OLD.aprobacion, NEW.aprobacion)); end if;
    if NEW.observaciones     is distinct from OLD.observaciones     then v := v || jsonb_build_object('observaciones',     jsonb_build_array(OLD.observaciones, NEW.observaciones)); end if;
    if NEW.cliente           is distinct from OLD.cliente           then v := v || jsonb_build_object('cliente',           jsonb_build_array(OLD.cliente, NEW.cliente)); end if;
    if NEW.zona              is distinct from OLD.zona              then v := v || jsonb_build_object('zona',              jsonb_build_array(OLD.zona, NEW.zona)); end if;
    if NEW.liberada          is distinct from OLD.liberada          then v := v || jsonb_build_object('liberada',          jsonb_build_array(OLD.liberada, NEW.liberada)); end if;
    -- Nada relevante cambió (ej. solo updated_at) → no registrar ruido.
    if v = '{}'::jsonb then return NEW; end if;
    insert into public.asignaciones_auditoria (asignacion_id, accion, cambios, editado_por)
      values (NEW.id, 'UPDATE', v, NEW.editado_por);
  elsif TG_OP = 'INSERT' then
    insert into public.asignaciones_auditoria (asignacion_id, accion, cambios, editado_por)
      values (
        NEW.id, 'INSERT',
        jsonb_build_object('estado', NEW.estado, 'area_realizada', NEW.area_realizada, 'operador', NEW.operador_nombre),
        NEW.editado_por
      );
  end if;
  return NEW;
end;
$function$;

DROP TRIGGER IF EXISTS trg_asignaciones_audit ON public.asignaciones;
CREATE TRIGGER trg_asignaciones_audit
  AFTER INSERT OR UPDATE ON public.asignaciones
  FOR EACH ROW EXECUTE FUNCTION public.asignaciones_audit();

-- Refresca la caché de esquema de PostgREST para que reconozca `editado_por`
-- de inmediato (si no, sigue diciendo "column not found in the schema cache").
NOTIFY pgrst, 'reload schema';
