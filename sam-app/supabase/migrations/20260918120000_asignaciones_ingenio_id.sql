-- ============================================================================
-- Cada labor guarda el INGENIO de su suerte (18-sep-2026, pedido de Iván:
-- «necesito que las suertes tengan un id que las diferencie entre ingenios»).
--
-- La identidad de una suerte ya existía en el maestro:
--   ux_maestro_ingenio_hacienda_suerte = (ingenio_id, hacienda, suerte), única.
-- Lo que faltaba es que la LABOR la llevara. `asignaciones` guardaba código,
-- nombre de hacienda y número de suerte, y la app tenía que adivinar cuál fila
-- del maestro era. Medido sobre 17.584 suertes activas:
--   · código + suerte ........ 19 choques (el «1» de Mayagüez, 1214 ABEJONES/PRAGA…)
--   · nombre + suerte ........ 473 choques (tres «VALPARAISO» con suerte 010)
--   · ingenio + código + suerte  0 choques  ← la llave
-- El caso que lo destapó: el tope de área tomó la VALPARAISO 010 de Pichichí
-- (5,22 ha) en vez de la 3104-010 de Riopaila (16,32 ha) y no dejó registrar
-- 14,50 ha de DESPEJE.
--
-- 1. Columna `ingenio_id` NULLABLE y sin default: null = labor que no se pudo
--    atar a una sola suerte del maestro (hoy 73, suertes que no están activas).
-- 2. Se llena sola al crear o al cambiarle la suerte a una labor, buscando por
--    código + nombre + suerte (también sin choques hoy). Así la llenan TODOS los
--    caminos — formularios, cola sin señal, registro rápido, cargues — incluidas
--    las PWA viejas en caché que no saben de la columna. Si la app ya la manda,
--    se respeta.
-- 3. Relleno de las labores existentes con `session_replication_role = replica`:
--    no es una edición de negocio, no debe dejar 4.000 filas de auditoría ni
--    mover `updated_at` (eso las mandaría a todos los celulares otra vez).
-- ============================================================================

alter table public.asignaciones add column if not exists ingenio_id text;

comment on column public.asignaciones.ingenio_id is
  'Ingenio de la suerte (maestro_risaralda.ingenio_id). Con codigo_hacienda + numero_suerte identifica la suerte sin ambigüedad entre ingenios. NULL = no se pudo atar a una sola suerte del maestro.';

create or replace function public.asignaciones_fijar_ingenio()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_ingenio text;
  v_n int;
begin
  if TG_OP = 'UPDATE'
     and NEW.codigo_hacienda is not distinct from OLD.codigo_hacienda
     and NEW.nombre_hacienda is not distinct from OLD.nombre_hacienda
     and NEW.numero_suerte   is not distinct from OLD.numero_suerte
     and NEW.ingenio_id      is not distinct from OLD.ingenio_id then
    return NEW;  -- no cambió la suerte: nada que recalcular
  end if;
  if TG_OP = 'UPDATE' and NEW.ingenio_id is not distinct from OLD.ingenio_id then
    NEW.ingenio_id := null;  -- cambió la suerte: el ingenio viejo ya no vale
  end if;
  if coalesce(btrim(NEW.ingenio_id), '') <> '' then
    return NEW;  -- la app ya lo mandó
  end if;

  select min(m.ingenio_id), count(*) into v_ingenio, v_n
    from public.maestro_risaralda m
   where m.activo
     and upper(btrim(m.hacienda))        = upper(btrim(NEW.codigo_hacienda))
     and upper(btrim(m.nombre_hacienda)) = upper(btrim(NEW.nombre_hacienda))
     and upper(btrim(m.suerte))          = upper(btrim(NEW.numero_suerte));

  -- Solo si hay UNA suerte que calce; con dos, mejor null que el ingenio equivocado.
  NEW.ingenio_id := case when v_n = 1 then v_ingenio else null end;
  return NEW;
end;
$$;

drop trigger if exists trg_asignaciones_fijar_ingenio on public.asignaciones;
create trigger trg_asignaciones_fijar_ingenio
  before insert or update on public.asignaciones
  for each row execute function public.asignaciones_fijar_ingenio();

-- Relleno de lo existente (sin disparar auditoría ni updated_at).
set local session_replication_role = replica;
update public.asignaciones a
   set ingenio_id = x.ingenio_id
  from (
    select upper(btrim(m.hacienda)) cod, upper(btrim(m.nombre_hacienda)) nom, upper(btrim(m.suerte)) su,
           min(m.ingenio_id) ingenio_id
      from public.maestro_risaralda m
     where m.activo
     group by 1, 2, 3
    having count(*) = 1
  ) x
 where a.ingenio_id is null
   and x.cod = upper(btrim(a.codigo_hacienda))
   and x.nom = upper(btrim(a.nombre_hacienda))
   and x.su  = upper(btrim(a.numero_suerte));
set local session_replication_role = origin;

create index if not exists idx_asignaciones_ingenio on public.asignaciones (ingenio_id);

notify pgrst, 'reload schema';
