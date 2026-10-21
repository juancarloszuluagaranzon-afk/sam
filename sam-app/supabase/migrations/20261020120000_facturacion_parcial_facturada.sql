-- ============================================================================
-- Una PARCIAL ya FACTURADA no sigue creciendo (20-oct-2026).
--
-- Problema (revisión de Facturación): una labor PARCIAL se puede facturar; si el
-- operario la continúa, la app suma en la MISMA fila (área = lo previo + lo de
-- hoy) y cambia su fecha. La línea seguía «Facturado FE-10» pero con más
-- hectáreas y más valor del que se cobró.
--
-- Arreglo, en la base para que valga desde cualquier celular (y con la cola sin
-- señal): cuando a una PARCIAL facturada le crece lo ejecutado, el disparador la
-- PARTE en dos:
--   · la línea facturada queda EXACTAMENTE como se cobró y pasa a COMPLETADA;
--   · lo nuevo sale en una fila nueva (mismos datos, área = la diferencia), sin
--     factura ni soporte ni precio manual / tarifa forzada (esos eran del cobro
--     anterior; el cliente puesto a mano sí se conserva).
-- El operario no hace nada distinto. Corre después del tope de área y de «solo
-- administración» (orden alfabético de los BEFORE), así que la diferencia ya
-- viene validada; el INSERT vuelve a pasar el tope con la fila vieja aún sin
-- cambiar, que suma lo mismo.
-- ⚠️ Las sesiones (`labor_sesiones`) de esa continuación quedan ligadas a la fila
-- vieja: las horas del día siguen contando igual para máquina y operario.
-- ============================================================================

create or replace function public.asignaciones_partir_facturada() returns trigger
language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_nueva public.asignaciones;
  v_delta numeric;
begin
  if OLD.estado is distinct from 'PARCIAL'
     or (OLD.factura_id is null and coalesce(btrim(OLD.factura_numero), '') = '')
     or coalesce(NEW.area_realizada, 0) <= coalesce(OLD.area_realizada, 0) + 0.0001
     or NEW.estado not in ('PARCIAL', 'COMPLETADA') then
    return NEW;
  end if;

  v_delta := NEW.area_realizada - coalesce(OLD.area_realizada, 0);

  -- Lo nuevo: una fila aparte, sin facturar.
  v_nueva := NEW;
  v_nueva.id := gen_random_uuid();
  v_nueva.area_realizada := v_delta;
  v_nueva.area_asignada := greatest(coalesce(NEW.area_asignada, 0) - coalesce(OLD.area_realizada, 0), v_delta);
  v_nueva.factura_id := null;
  v_nueva.factura_numero := null;
  v_nueva.soporte_id := null;
  v_nueva.observaciones := nullif(btrim(regexp_replace(coalesce(NEW.observaciones, ''),
    '\s*\[(PRECIO_MANUAL:[0-9.]+|TARIFA:[a-fA-F0-9-]{36})\]', '', 'g')), '');
  v_nueva.created_at := now();
  v_nueva.updated_at := now();
  insert into public.asignaciones select (v_nueva).*;

  -- La facturada: tal como se cobró, cerrada.
  NEW := OLD;
  NEW.estado := 'COMPLETADA';
  return NEW;
end $$;

drop trigger if exists trg_asignaciones_partir_facturada on public.asignaciones;
create trigger trg_asignaciones_partir_facturada before update on public.asignaciones
  for each row execute function public.asignaciones_partir_facturada();

comment on function public.asignaciones_partir_facturada() is
  'Una PARCIAL facturada que crece se parte: la facturada queda como se cobró (COMPLETADA) y lo nuevo va en otra fila sin facturar (20-oct-2026).';

-- Comprobación: el disparador existe y corre DESPUÉS del tope de área (orden alfabético).
select string_agg(tgname, ' → ' order by tgname) as orden_before_update
  from pg_trigger
 where tgrelid = 'public.asignaciones'::regclass and not tgisinternal
   and tgtype & 2 = 2 and tgtype & 16 = 16;
