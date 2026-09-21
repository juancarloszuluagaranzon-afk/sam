-- ============================================================================
-- Los HECTÓMETROS y las HORAS solo los corrige administración (19-sep-2026).
--
-- Pedido del cliente: «revisar la lógica de acequias porque los supervisores
-- están pudiendo editar los hm y esto es tarea de Carlos David».
--
-- La pantalla ya lo impide (`editAssignment` + el campo bloqueado), pero una PWA
-- vieja en caché no lo sabe. Aquí se rechaza en la base: si quien edita
-- (`editado_por`) tiene rol `supervisor` y cambia `area_realizada` de una labor
-- que NO se mide en hectáreas, no pasa.
--
-- ⚠️ Solo se frena al SUPERVISOR. El operario sigue cerrando sus acequias y sus
--    servicios (él es quien registra lo que hizo), y dueño/administración
--    corrigen. Y el supervisor sigue pudiendo cambiar lo demás de esa labor
--    —día, operario, equipo, notas—: solo no la cantidad.
-- ============================================================================

create or replace function public.asignaciones_cantidad_solo_admin()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if NEW.area_realizada is not distinct from OLD.area_realizada then
    return NEW;
  end if;
  if not exists (
    select 1 from public.labores_catalogo lc
     where upper(btrim(lc.nombre)) = upper(btrim(NEW.labor_nombre))
       and lower(coalesce(lc.unidad, 'ha')) <> 'ha'
  ) then
    return NEW;
  end if;
  if exists (select 1 from public.app_usuarios u where u.id = NEW.editado_por and u.rol = 'supervisor') then
    raise exception 'SOLO_ADMINISTRACION: la cantidad de % (hectómetros u horas) solo la corrige administración', NEW.labor_nombre
      using errcode = 'check_violation';
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_asignaciones_cantidad_solo_admin on public.asignaciones;
create trigger trg_asignaciones_cantidad_solo_admin
  before update on public.asignaciones
  for each row execute function public.asignaciones_cantidad_solo_admin();
