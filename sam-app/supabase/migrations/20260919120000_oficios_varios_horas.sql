-- ============================================================================
-- OFICIOS VARIOS: servicio de máquina POR HORAS (19-sep-2026).
--
-- Pedido del cliente: cuando una máquina presta servicio de oficios varios se
-- cobra por horas, y eso tiene que quedar conectado con todo lo demás —la
-- planilla, lo tomado en campo, lo programado, los Excel—. No lo programa el
-- supervisor (Alfredo, Julio César): lo administra Carlos David desde
-- administración. El formulario que dictó: hora de inicio, horómetro inicial,
-- administrador encargado, hora final, horómetro final.
--
-- La TERCERA unidad. Ya había hectáreas y hectómetros (ACEQUIAS); ahora HORAS.
-- En una labor por horas, `area_asignada`/`area_realizada` guardan HORAS y no
-- tienen nada que ver con el área de la suerte.
--
-- 1. `labores_catalogo.unidad` acepta 'h'. La unidad es un DATO del catálogo:
--    mañana otra labor por horas se crea desde la app, sin desplegar nada.
-- 2. `labores_catalogo.solo_administracion`: la labor solo la pueden programar
--    dueño y administración. Va en el catálogo por la misma razón.
-- 3. `asignaciones.administrador_encargado`: quién recibe el servicio en la
--    hacienda. NULLABLE y sin default: null = no se preguntó (toda labor que no
--    es por horas).
-- 4. `asignaciones.unidad` se llena sola AL CREAR, desde el catálogo. ⚠️ NO se
--    rellena lo viejo: `null` significa «se registró cuando todo eran
--    hectáreas», y hay ACEQUIAS antiguas que de verdad están en hectáreas.
--    Y el mismo trigger RECHAZA programar una labor `solo_administracion` si
--    quien la programa (`supervisor_id`) no es dueño ni administración.
-- 5. El tope contra el área de la suerte (`asignaciones_cap_area`) deja por
--    fuera TODA labor que no se mida en hectáreas, no solo las de hectómetros:
--    8 horas en una suerte de 5 ha no es un exceso de nada.
-- ============================================================================

alter table public.labores_catalogo drop constraint if exists labores_catalogo_unidad_check;
alter table public.labores_catalogo add constraint labores_catalogo_unidad_check
  check (unidad in ('ha', 'hm', 'h'));

alter table public.labores_catalogo
  add column if not exists solo_administracion boolean not null default false;

comment on column public.labores_catalogo.unidad is
  'En qué se mide: ha (hectáreas), hm (hectómetros, lineal) o h (horas de servicio de máquina).';
comment on column public.labores_catalogo.solo_administracion is
  'true = solo dueño y administración la programan; no sale en el formulario del supervisor ni en «tomar en campo».';

insert into public.labores_catalogo (nombre, tipo, unidad, solo_administracion, activa)
values ('OFICIOS VARIOS', 'MECANIZADA', 'h', true, true)
on conflict (nombre) do update set unidad = 'h', solo_administracion = true, activa = true, updated_at = now();

alter table public.asignaciones add column if not exists administrador_encargado text;
comment on column public.asignaciones.administrador_encargado is
  'Servicio por horas (oficios varios): quién recibe el servicio en la hacienda. NULL = no aplica / no se preguntó.';

-- ── La unidad viaja con la labor, desde el catálogo, al crearla ─────────────
create or replace function public.asignaciones_fijar_unidad()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_unidad text;
  v_solo_admin boolean;
begin
  select lower(lc.unidad), lc.solo_administracion into v_unidad, v_solo_admin
    from public.labores_catalogo lc
   where upper(btrim(lc.nombre)) = upper(btrim(NEW.labor_nombre))
   limit 1;

  -- 🔴 Doble candado: la pantalla esconde la labor al supervisor y al operario,
  -- pero una PWA vieja en caché no sabe de `solo_administracion`. Aquí se
  -- rechaza: mejor un error claro que un servicio por horas programado como
  -- hectáreas por quien no lo administra.
  if coalesce(v_solo_admin, false) and not exists (
    select 1 from public.app_usuarios u
     where u.id = NEW.supervisor_id and u.activo and u.rol in ('owner', 'administracion')
  ) then
    raise exception 'SOLO_ADMINISTRACION: la labor % solo la programa administración', NEW.labor_nombre
      using errcode = 'check_violation';
  end if;

  if coalesce(btrim(NEW.unidad), '') = '' then
    NEW.unidad := v_unidad;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_asignaciones_fijar_unidad on public.asignaciones;
create trigger trg_asignaciones_fijar_unidad
  before insert on public.asignaciones
  for each row execute function public.asignaciones_fijar_unidad();

-- ── El tope de área: solo para lo que se mide en hectáreas ─────────────────
-- Mismo cuerpo que 20260828100000; cambia la primera condición ('hm' → <> 'ha').
create or replace function public.asignaciones_cap_area()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_area_neta numeric;
  v_sum numeric;
  v_tol numeric := 0.05;
  v_ref timestamptz;
begin
  -- 🔴 Solo se topa lo que se mide en HECTÁREAS. Los hectómetros (ACEQUIAS) son
  -- longitud y las horas (OFICIOS VARIOS) son tiempo: compararlos con el área de
  -- la suerte no significa nada, y el blindaje le impediría al operario
  -- registrar —y cobrar— lo que de verdad hizo.
  if exists (
    select 1 from public.labores_catalogo lc
     where upper(btrim(lc.nombre)) = upper(btrim(NEW.labor_nombre))
       and lower(coalesce(lc.unidad, 'ha')) <> 'ha'
  ) then
    return NEW;
  end if;

  -- Solo aplica a filas con ejecución real.
  if NEW.estado not in ('COMPLETADA','PARCIAL') or coalesce(NEW.area_realizada,0) <= 0 then
    return NEW;
  end if;

  -- En UPDATE, permitir SIEMPRE si NO se aumenta el área ejecutada.
  if TG_OP = 'UPDATE' and coalesce(NEW.area_realizada,0) <= coalesce(OLD.area_realizada,0) then
    return NEW;
  end if;

  v_ref := coalesce(NEW.fecha_fin, NEW.created_at, now());

  -- 1) Tope preferido: área del maestro (hacienda+suerte+NOMBRE).
  select m.area_neta into v_area_neta
  from public.maestro_risaralda m
  where m.hacienda = NEW.codigo_hacienda
    and m.suerte = NEW.numero_suerte
    and upper(btrim(m.nombre_hacienda)) = upper(btrim(NEW.nombre_hacienda))
    and m.activo = true
  order by m.area_neta desc
  limit 1;

  -- 2) RESPALDO: área PLANIFICADA máxima de la misma suerte+labor en el ciclo.
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

  if coalesce(v_area_neta,0) <= 0 then
    return NEW;
  end if;

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

notify pgrst, 'reload schema';
