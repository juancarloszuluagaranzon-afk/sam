-- POLÍTICA DE CICLO DE VIDA de asignaciones. La prioridad son las labores
-- CERRADAS (COMPLETADA/PARCIAL) — la verdad permanente (pago/facturación). Todo
-- lo demás (PENDIENTE, liberada, programada sin avanzar) es temporal y el sistema
-- lo va depurando solo con el tiempo, para que no se acumule basura que confunde
-- a la operación.
--
--   Nivel 1 (auto-cancelar): PENDIENTE sin área ejecutada y con +3 días → CANCELADA
--                            (reversible; incluye las liberadas/programadas huérfanas).
--   Nivel 2 (auto-purgar):   CANCELADA sin área y con +30 días → DELETE definitivo.
--
-- NUNCA toca COMPLETADA ni PARCIAL. El borrado se limita a filas con
-- area_realizada = 0 (jamás elimina una que tuvo trabajo real).

CREATE OR REPLACE FUNCTION public.sam_run_retention()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_dias_cancelar int := 3;
  v_dias_purgar   int := 30;
  v_canceladas int := 0;
  v_borradas   int := 0;
begin
  -- NIVEL 1: cancelar pendientes sin avanzar (incluye liberadas/programadas).
  with upd as (
    update public.asignaciones
       set estado = 'CANCELADA',
           updated_at = now()
     where estado = 'PENDIENTE'
       and coalesce(area_realizada, 0) = 0
       and coalesce(fecha_inicio, created_at) is not null
       and coalesce(fecha_inicio, created_at) < now() - (v_dias_cancelar || ' days')::interval
    returning 1
  )
  select count(*) into v_canceladas from upd;

  -- NIVEL 2: purgar canceladas viejas SIN trabajo real (irreversible).
  with del as (
    delete from public.asignaciones
     where estado = 'CANCELADA'
       and coalesce(area_realizada, 0) = 0
       and coalesce(updated_at, created_at) < now() - (v_dias_purgar || ' days')::interval
    returning 1
  )
  select count(*) into v_borradas from del;

  return jsonb_build_object('canceladas', v_canceladas, 'borradas', v_borradas, 'corrido_en', now());
end;
$function$;

-- El cliente (owner/admin) lo dispara una vez al día; y opcionalmente pg_cron lo
-- corre de noche sin que nadie abra la app (ver bloque opcional al final).
GRANT EXECUTE ON FUNCTION public.sam_run_retention() TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ─────────────────────────────────────────────────────────────────────────────
-- OPCIONAL (solo si tu Supabase tiene pg_cron habilitado): correrlo cada noche a
-- las 02:00 (hora del servidor) sin depender de que un admin abra la app. Si
-- pg_cron no está disponible, IGNORA este bloque: el disparo desde el cliente ya
-- cubre la limpieza diaria.
--
--   create extension if not exists pg_cron;
--   select cron.schedule('sam-retention', '0 7 * * *', $$ select public.sam_run_retention(); $$);
