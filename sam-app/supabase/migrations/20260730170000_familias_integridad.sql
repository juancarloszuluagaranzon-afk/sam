-- ============================================================================
-- Familias que faltaban + integridad del código, tras la auditoría
--
-- Cuatro familias de alto gasto no existían y caían en OTR o, peor, en la
-- familia equivocada:
--   FRE — frenos. Hoy un "disco de freno" caía en IMP por la palabra "disco".
--   REF — refrigeración. La manguera de agua caía en HID, que es falso.
--   EMP — empaques y sellos. Es de los renglones más numerosos de un taller.
--   CON — consumibles de taller (electrodos, silicona, cinta). No son
--         herramienta (que dura) ni repuesto (que se monta).
--
-- Y tres reglas del backfill clasificaban mal: "manzana" es la maza de la rueda
-- (rodaje, no tornillería), y "gancho"/"chapeta" son enganche de implemento.
-- ============================================================================

insert into public.insumos_familias (codigo, nombre, orden) values
  ('FRE', 'Frenos', 55),
  ('REF', 'Refrigeración', 65),
  ('EMP', 'Empaques, sellos y O-rings', 45),
  ('CON', 'Consumibles de taller', 135)
on conflict (codigo) do nothing;

-- ── Reclasificación de lo mal clasificado ───────────────────────────────────
-- El CÓDIGO NO SE TOCA: ya pudo salir en una cotización o en un rótulo. Solo
-- cambia la familia, que es justo para lo que existe como columna aparte.
update public.insumos set familia = 'IMP'
 where familia = 'TOR' and (nombre ilike '%gancho%' or nombre ilike '%chapeta%');

update public.insumos set familia = 'TRA'
 where familia = 'TOR' and nombre ilike '%manzana%';

-- ── Integridad: que la familia no se pueda inventar ─────────────────────────
-- `insumos.familia` era texto libre contra una tabla que ya existía. Nada
-- impedía que aparecieran 'Filtros', 'fil ', 'FILTRO' y 'FIL' como cuatro
-- familias distintas, ni que `siguiente_codigo_insumo` generara 'XXX-0001'.
update public.insumos set familia = 'OTR'
 where familia is not null
   and not exists (select 1 from public.insumos_familias f where f.codigo = insumos.familia);

do $$ begin
  alter table public.insumos
    add constraint insumos_familia_fk foreign key (familia)
    references public.insumos_familias(codigo) on update cascade;
exception when duplicate_object then null; end $$;

-- El formato del código: FAM-####. Un código con otra forma rompe el
-- consecutivo, porque el generador extrae el número con un regex.
do $$ begin
  alter table public.insumos
    add constraint insumos_codigo_formato check (codigo is null or codigo ~ '^[A-Z]{3}-[0-9]{4}$');
exception when duplicate_object then null; end $$;

-- ── El consecutivo, ahora sí a prueba de simultáneos ────────────────────────
-- El comentario original decía que ponerlo en la base resolvía la concurrencia.
-- No es cierto: un `select max(...)` sin bloqueo NO es atómico y dos personas
-- creando un repuesto a la vez obtienen el mismo FIL-0007. El unique evita la
-- corrupción, pero el segundo usuario ve un error sin entender por qué.
-- El advisory lock serializa por familia y solo dura la transacción.
create or replace function public.siguiente_codigo_insumo(p_familia text)
returns text
language plpgsql
as $$
declare
  fam text := upper(coalesce(nullif(trim(p_familia), ''), 'OTR'));
  n integer;
begin
  perform pg_advisory_xact_lock(hashtext('insumo_codigo_' || fam));
  select coalesce(max((regexp_replace(codigo, '^[A-Z]+-', ''))::int), 0) + 1
    into n
    from public.insumos
   where codigo ~ ('^' || fam || '-[0-9]+$');
  return fam || '-' || lpad(n::text, 4, '0');
end $$;

grant execute on function public.siguiente_codigo_insumo(text) to anon, authenticated;
