-- BLINDAJE server-side contra registros que EXCEDEN el área de la suerte.
-- Toda la prevención estaba en el cliente (caché local) → offline / multi-
-- dispositivo / registro rápido / edición la saltaban. Este trigger es atómico,
-- ve TODAS las filas y ningún cliente lo puede evadir.
--
-- Regla: al insertar/actualizar una fila COMPLETADA/PARCIAL con área ejecutada,
-- la SUMA de area_realizada de la misma suerte+labor dentro del CICLO (±21 días)
-- no puede superar el area_neta del maestro (+0.05 ha de tolerancia). Si la
-- supera, se RECHAZA con mensaje 'AREA_EXCEDIDA' (el cliente lo traduce).

-- Índice de apoyo para la agregación del trigger.
CREATE INDEX IF NOT EXISTS idx_asig_suerte_labor
  ON public.asignaciones (suerte_codigo, labor_nombre);

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

  -- En UPDATE, permitir SIEMPRE si NO se aumenta el área: reducir, reasignar,
  -- corregir o cancelar un registro existente nunca empeora el excedente, y el
  -- dueño necesita poder ARREGLAR las suertes ya duplicadas. Solo se topa cuando
  -- se INSERTA o se AUMENTA el área.
  if TG_OP = 'UPDATE' and coalesce(NEW.area_realizada,0) <= coalesce(OLD.area_realizada,0) then
    return NEW;
  end if;

  -- Área del maestro (match por hacienda+suerte+NOMBRE para evitar el código
  -- de hacienda compartido entre ingenios). Si no se encuentra, no se bloquea.
  select m.area_neta into v_area_neta
  from public.maestro_risaralda m
  where m.hacienda = NEW.codigo_hacienda
    and m.suerte = NEW.numero_suerte
    and upper(btrim(m.nombre_hacienda)) = upper(btrim(NEW.nombre_hacienda))
    and m.activo = true
  order by m.area_neta desc
  limit 1;

  if v_area_neta is null then
    return NEW;
  end if;

  v_ref := coalesce(NEW.fecha_fin, NEW.created_at, now());

  -- Suma de OTRAS filas de la misma suerte+labor, mismo ciclo (±21 días).
  -- Filtra TAMBIÉN por nombre_hacienda: el código de hacienda `1`+mayagüez lo
  -- comparten LA FLORESTA TASCON y Santa Fe → sin este filtro mezclaría el área
  -- de dos haciendas distintas contra el area_neta de una sola.
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
      'AREA_EXCEDIDA: la suerte % (%) ya tiene %.2f ha de % registradas en el ciclo; estas %.2f ha la exceden.',
      NEW.suerte_codigo, NEW.labor_nombre, v_sum, v_area_neta, NEW.area_realizada
      using errcode = 'check_violation';
  end if;

  return NEW;
end;
$function$;

DROP TRIGGER IF EXISTS trg_asignaciones_cap_area ON public.asignaciones;
CREATE TRIGGER trg_asignaciones_cap_area
  BEFORE INSERT OR UPDATE ON public.asignaciones
  FOR EACH ROW EXECUTE FUNCTION public.asignaciones_cap_area();
