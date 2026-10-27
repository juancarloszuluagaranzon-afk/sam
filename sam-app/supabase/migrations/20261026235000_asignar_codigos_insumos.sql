-- Reparto de códigos propios (ROD-0001…) para una CARGA MASIVA de piezas (26-oct-2026).
--
-- `siguiente_codigo_insumo(familia)` calcula «el máximo + 1» sobre lo que YA está guardado. Pedirlo pieza por pieza
-- ANTES de insertar da el mismo código (ROD-0001) a todas las piezas de una familia. Esta función los reparte
-- DESPUÉS de insertar, de un solo golpe y en una sola transacción, con el mismo candado por familia que usa la otra:
-- cada pieza ve el código que acaba de tomar la anterior, y dos personas cargando al mismo tiempo no se pisan.
--
-- Solo toca piezas que NO tienen código y cuya familia EXISTE en `insumos_familias` (un texto suelto como
-- «RODAMIENTO» no inventa un código «RODAMIENTO-0001»). Idempotente: volver a llamarla no cambia lo ya asignado.
create or replace function public.asignar_codigos_insumos(p_ids uuid[])
returns integer
language plpgsql
as $$
declare
  r record;
  n integer;
  c integer := 0;
begin
  for r in
    select i.id, upper(trim(i.familia)) as fam
      from public.insumos i
      join public.insumos_familias f on f.codigo = upper(trim(i.familia))
     where i.id = any(p_ids) and i.codigo is null
     order by i.created_at, i.id
  loop
    perform pg_advisory_xact_lock(hashtext('insumo_codigo_' || r.fam));
    select coalesce(max((regexp_replace(codigo, '^[A-Z]+-', ''))::int), 0) + 1
      into n
      from public.insumos
     where codigo ~ ('^' || r.fam || '-[0-9]+$');
    update public.insumos set codigo = r.fam || '-' || lpad(n::text, 4, '0') where id = r.id and codigo is null;
    c := c + 1;
  end loop;
  return c;
end $$;

grant execute on function public.asignar_codigos_insumos(uuid[]) to anon, authenticated;
