-- BLINDAJE DEFINITIVO: el área ejecutada NUNCA puede superar el área de la suerte.
--
-- El trigger previo (20260630120000) topaba contra el area_neta del MAESTRO, pero
-- si la suerte NO estaba en el maestro (v_area_neta null) → `return NEW` dejaba
-- pasar CUALQUIER área. Por ese hueco entró una labor con ejec 4.00 sobre una
-- suerte de plan 2.00 (cumplimiento 200%) — y como se paga por área ejecutada,
-- eso es sobrepago/sobrefacturación. "No debe pasar de ninguna manera".
--
-- Este reemplazo agrega un TOPE DE RESPALDO: si el maestro no tiene la suerte,
-- usa como límite el área PLANIFICADA (area_asignada) máxima de la misma
-- suerte+labor en el ciclo (±21 días). Así ninguna fila puede registrar más
-- área ejecutada que la que tiene la suerte, venga de la app, offline, otro
-- dispositivo o SQL directo. Atómico y evadible por ningún cliente.

CREATE OR REPLACE FUNCTION public.asignaciones_cap_area()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_area_neta numeric;
  v_sum numeric;
  v_tol numeric := 0.05;
  v_ref timestamptz;
begin
  -- Solo aplica a filas con ejecución real.
  if NEW.estado not in ('COMPLETADA','PARCIAL') or coalesce(NEW.area_realizada,0) <= 0 then
    return NEW;
  end if;

  -- En UPDATE, permitir SIEMPRE si NO se aumenta el área ejecutada: reducir,
  -- reasignar, corregir o cancelar nunca empeora el excedente, y el dueño debe
  -- poder ARREGLAR las suertes ya duplicadas. Solo se topa al INSERTAR o AUMENTAR.
  if TG_OP = 'UPDATE' and coalesce(NEW.area_realizada,0) <= coalesce(OLD.area_realizada,0) then
    return NEW;
  end if;

  v_ref := coalesce(NEW.fecha_fin, NEW.created_at, now());

  -- 1) Tope preferido: área del maestro (match hacienda+suerte+NOMBRE para evitar
  --    el código de hacienda compartido entre ingenios).
  select m.area_neta into v_area_neta
  from public.maestro_risaralda m
  where m.hacienda = NEW.codigo_hacienda
    and m.suerte = NEW.numero_suerte
    and upper(btrim(m.nombre_hacienda)) = upper(btrim(NEW.nombre_hacienda))
    and m.activo = true
  order by m.area_neta desc
  limit 1;

  -- 2) RESPALDO (cierra el hueco): si el maestro no tiene la suerte, tope = área
  --    PLANIFICADA máxima de la misma suerte+labor en el ciclo (incluida esta
  --    fila). Antes aquí se hacía `return NEW` y se colaba cualquier área.
  if v_area_neta is null then
    select greatest(coalesce(NEW.area_asignada,0), coalesce(max(a.area_asignada),0))
      into v_area_neta
    from public.asignaciones a
    where a.suerte_codigo = NEW.suerte_codigo
      and upper(btrim(a.labor_nombre)) = upper(btrim(NEW.labor_nombre))
      and upper(btrim(a.nombre_hacienda)) = upper(btrim(NEW.nombre_hacienda))
      and a.estado <> 'CANCELADA'
      and abs(extract(epoch from (coalesce(a.fecha_fin, a.created_at) - v_ref))) <= 21*86400;
  end if;

  -- Sin ninguna referencia de área (>0) no se puede topar (no hay contra qué).
  if coalesce(v_area_neta,0) <= 0 then
    return NEW;
  end if;

  -- Suma de OTRAS filas de la misma suerte+labor, mismo ciclo (±21 días).
  -- Filtra TAMBIÉN por nombre_hacienda (código de hacienda compartido).
  select coalesce(sum(a.area_realizada),0) into v_sum
  from public.asignaciones a
  where a.suerte_codigo = NEW.suerte_codigo
    and upper(btrim(a.labor_nombre)) = upper(btrim(NEW.labor_nombre))
    and upper(btrim(a.nombre_hacienda)) = upper(btrim(NEW.nombre_hacienda))
    and a.estado in ('COMPLETADA','PARCIAL')
    and coalesce(a.area_realizada,0) > 0
    and a.id <> NEW.id
    and abs(extract(epoch from (coalesce(a.fecha_fin, a.created_at) - v_ref))) <= 21*86400;

  if v_sum + NEW.area_realizada > v_area_neta + v_tol then
    raise exception
      'AREA_EXCEDIDA: la suerte % (%) tiene %.2f ha; con estas %.2f ha (ya hay %.2f en el ciclo) se excede el área de la suerte.',
      NEW.suerte_codigo, NEW.labor_nombre, v_area_neta, NEW.area_realizada, v_sum
      using errcode = 'check_violation';
  end if;

  return NEW;
end;
$function$;

DROP TRIGGER IF EXISTS trg_asignaciones_cap_area ON public.asignaciones;
CREATE TRIGGER trg_asignaciones_cap_area
  BEFORE INSERT OR UPDATE ON public.asignaciones
  FOR EACH ROW EXECUTE FUNCTION public.asignaciones_cap_area();
