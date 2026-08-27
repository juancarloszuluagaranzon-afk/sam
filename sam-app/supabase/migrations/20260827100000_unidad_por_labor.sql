-- Una labor puede medirse en algo que NO sean hectáreas.
--
-- El caso que lo trae: las **acequias** se miden en **hectómetros** (100 m
-- lineales), no en área. Cavar una acequia es un trabajo de longitud: decir que
-- se hicieron "3 hectáreas de acequia" no significa nada.
--
-- 🔴 La unidad se guarda en DOS sitios, y es a propósito.
--
--   `labores_catalogo.unidad`  lo que se propone al crear una asignación nueva
--   `asignaciones.unidad`      lo que esa asignación realmente usó
--
-- Con solo la del catálogo, cambiarle la unidad a una labor reescribiría el
-- pasado: las 29 asignaciones de ZANJAS ya registradas —325,48 hectáreas de
-- verdad— pasarían a leerse como hectómetros de la nada. El dato histórico se
-- queda como se registró; el cambio aplica de aquí en adelante.
--
-- ⚠️ `asignaciones.unidad` va NULLABLE y sin default: `null` significa "se
-- registró cuando todo era hectáreas". Ponerle 'ha' por defecto a las 3.636
-- filas viejas seria afirmar que alguien eligió esa unidad, y nadie la eligió —
-- no existia la pregunta.

alter table public.labores_catalogo
  add column if not exists unidad text not null default 'ha';

alter table public.asignaciones
  add column if not exists unidad text;

comment on column public.labores_catalogo.unidad is
  'Unidad en la que se mide esta labor: ha (hectareas) o hm (hectometros). '
  'Se propone al crear la asignacion; la asignacion guarda la suya.';
comment on column public.asignaciones.unidad is
  'NULL = se registro cuando todo era hectareas. NO es lo mismo que ''ha'' '
  'elegido: esa pregunta no existia.';

do $$ begin
  begin
    alter table public.labores_catalogo add constraint labores_catalogo_unidad_check
      check (unidad in ('ha', 'hm'));
  exception when duplicate_object then null; end;
end $$;

-- ── UNA sola labor, no dos ──────────────────────────────────────────────────
-- El cliente pidio dejar una sola. ZANJAS y acequias son el mismo trabajo, asi
-- que se renombra en vez de crear una segunda que compita con ella.
--
-- Se renombra TAMBIEN el nombre denormalizado de las asignaciones: `asignaciones`
-- guarda `labor_nombre` como texto, no como referencia. Sin esto quedarian dos
-- nombres para la misma labor —ZANJAS en el historial, ACEQUIAS en lo nuevo— que
-- es justo lo que se pidio evitar.
update public.labores_catalogo
   set nombre = 'ACEQUIAS', unidad = 'hm', updated_at = now()
 where upper(nombre) = 'ZANJAS';

update public.asignaciones
   set labor_nombre = 'ACEQUIAS'
 where upper(labor_nombre) = 'ZANJAS';

notify pgrst, 'reload schema';
