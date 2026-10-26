-- Candado de área, reforzado (26-oct-2026).
--
-- Regla de Iván: «por ninguna razón se puede pagar más del área de la suerte, así sean dos o tres
-- operarios». El candado ya existía (asignaciones_cap_area, 30-jun-2026) pero tenía huecos:
--   1. Saltaba las filas cerradas con area_realizada = 0, que la planilla SÍ paga con el área asignada.
--   2. No miraba el ingenio (haciendas con el mismo nombre y suerte en dos ingenios se mezclaban).
--   3. Dos cierres a la vez de la misma suerte y labor podían pasar los dos.
--   4. Al EDITAR una fila cerrada (otra suerte, labor o fecha) sin subir el área, no se volvía a revisar.
--   5. El margen era de 0,05 ha; ahora es de 0,02 ha (solo para absorber redondeos de dos decimales).
--   6. El mensaje de error imprimía «%.2f» literal.
-- Qué NO cambia: solo se topan labores en hectáreas (los hectómetros y las horas siguen libres), el ciclo
-- sigue siendo ±21 días, el área oficial sigue saliendo del maestro, y si la suerte no tiene área oficial se
-- usa la mayor área asignada del ciclo como respaldo. Las filas viejas que ya pasaban del área NO se tocan;
-- el candado solo actúa al insertar o al cambiar algo que mueve la cuenta.

create or replace function public.asignaciones_cap_area()
returns trigger
language plpgsql security definer set search_path to 'public', 'pg_catalog'
as $fn$
declare
  v_tol constant numeric := 0.02;
  v_nuevo numeric;
  v_viejo numeric := 0;
  v_ingenio text;
  v_n int;
  v_oficial numeric;
  v_sum numeric;
  v_ref timestamptz;
begin
  -- Solo se topa lo que se mide en HECTÁREAS: los hectómetros (ACEQUIAS) son longitud y las horas
  -- (OFICIOS VARIOS) son tiempo; compararlos con el área de la suerte no significa nada.
  if exists (
    select 1 from public.labores_catalogo lc
     where upper(btrim(lc.nombre)) = upper(btrim(NEW.labor_nombre))
       and lower(coalesce(lc.unidad, 'ha')) <> 'ha'
  ) then
    return NEW;
  end if;

  if NEW.estado not in ('COMPLETADA', 'PARCIAL') then
    return NEW;
  end if;

  -- Lo que se PAGA: el área realizada y, si no hay, la asignada (la misma regla de la planilla).
  v_nuevo := case when coalesce(NEW.area_realizada, 0) > 0 then NEW.area_realizada else coalesce(NEW.area_asignada, 0) end;
  if v_nuevo <= 0 then
    return NEW;
  end if;

  -- En UPDATE solo se revisa si algo que mueve la cuenta cambió: sube el área pagada, o cambió la
  -- suerte, la labor, la hacienda, el ingenio o la fecha (que decide el ciclo).
  if TG_OP = 'UPDATE' then
    if OLD.estado in ('COMPLETADA', 'PARCIAL') then
      v_viejo := case when coalesce(OLD.area_realizada, 0) > 0 then OLD.area_realizada else coalesce(OLD.area_asignada, 0) end;
    end if;
    if v_nuevo <= v_viejo
       and NEW.suerte_codigo   is not distinct from OLD.suerte_codigo
       and NEW.labor_nombre    is not distinct from OLD.labor_nombre
       and NEW.nombre_hacienda is not distinct from OLD.nombre_hacienda
       and NEW.codigo_hacienda is not distinct from OLD.codigo_hacienda
       and NEW.numero_suerte   is not distinct from OLD.numero_suerte
       and NEW.ingenio_id      is not distinct from OLD.ingenio_id
       and NEW.fecha_fin       is not distinct from OLD.fecha_fin
    then
      return NEW;
    end if;
  end if;

  -- Dos cierres a la vez de la misma suerte y labor se hacen en fila, no al mismo tiempo.
  perform pg_advisory_xact_lock(hashtextextended(
    upper(btrim(coalesce(NEW.nombre_hacienda, ''))) || '|' || upper(btrim(NEW.suerte_codigo)) || '|' || upper(btrim(NEW.labor_nombre)), 0));

  v_ref := coalesce(NEW.fecha_fin, NEW.created_at, now());

  -- El ingenio: el que trae la fila o, si no trae (este candado corre antes de fijar_ingenio),
  -- el único que calce con la hacienda y la suerte.
  v_ingenio := nullif(btrim(NEW.ingenio_id), '');
  if v_ingenio is null then
    select min(m.ingenio_id), count(*) into v_ingenio, v_n
      from public.maestro_risaralda m
     where m.activo
       and upper(btrim(m.hacienda))        = upper(btrim(NEW.codigo_hacienda))
       and upper(btrim(m.nombre_hacienda)) = upper(btrim(NEW.nombre_hacienda))
       and upper(btrim(m.suerte))          = upper(btrim(NEW.numero_suerte));
    if v_n <> 1 then v_ingenio := null; end if;
  end if;

  -- 1) Área OFICIAL del maestro (hacienda + suerte + nombre, y el ingenio si se sabe).
  select m.area_neta into v_oficial
    from public.maestro_risaralda m
   where m.activo
     and upper(btrim(m.hacienda))        = upper(btrim(NEW.codigo_hacienda))
     and upper(btrim(m.suerte))          = upper(btrim(NEW.numero_suerte))
     and upper(btrim(m.nombre_hacienda)) = upper(btrim(NEW.nombre_hacienda))
     and (v_ingenio is null or m.ingenio_id = v_ingenio)
   order by m.area_neta desc
   limit 1;

  -- 2) RESPALDO: la mayor área planificada de la misma suerte y labor en el ciclo.
  if v_oficial is null then
    select greatest(coalesce(NEW.area_asignada, 0), coalesce(max(a.area_asignada), 0)) into v_oficial
      from public.asignaciones a
     where upper(btrim(a.suerte_codigo))   = upper(btrim(NEW.suerte_codigo))
       and upper(btrim(a.labor_nombre))    = upper(btrim(NEW.labor_nombre))
       and upper(btrim(a.nombre_hacienda)) = upper(btrim(NEW.nombre_hacienda))
       and (v_ingenio is null or a.ingenio_id is null or a.ingenio_id = v_ingenio)
       and a.estado <> 'CANCELADA'
       and abs(extract(epoch from (coalesce(a.fecha_fin, a.created_at) - v_ref))) <= 21 * 86400;
  end if;

  if coalesce(v_oficial, 0) <= 0 then
    return NEW;
  end if;

  select coalesce(sum(case when coalesce(a.area_realizada, 0) > 0 then a.area_realizada else coalesce(a.area_asignada, 0) end), 0)
    into v_sum
    from public.asignaciones a
   where a.id <> NEW.id
     and a.estado in ('COMPLETADA', 'PARCIAL')
     and upper(btrim(a.suerte_codigo))   = upper(btrim(NEW.suerte_codigo))
     and upper(btrim(a.labor_nombre))    = upper(btrim(NEW.labor_nombre))
     and upper(btrim(a.nombre_hacienda)) = upper(btrim(NEW.nombre_hacienda))
     and (v_ingenio is null or a.ingenio_id is null or a.ingenio_id = v_ingenio)
     and abs(extract(epoch from (coalesce(a.fecha_fin, a.created_at) - v_ref))) <= 21 * 86400;

  if v_sum + v_nuevo > v_oficial + v_tol then
    raise exception 'AREA_EXCEDIDA: la suerte % (%) tiene % ha; con estas % ha (ya hay % en el ciclo) se excede el área de la suerte.',
      NEW.suerte_codigo, NEW.labor_nombre, round(v_oficial, 2), round(v_nuevo, 2), round(v_sum, 2)
      using errcode = 'check_violation';
  end if;

  return NEW;
end;
$fn$;
