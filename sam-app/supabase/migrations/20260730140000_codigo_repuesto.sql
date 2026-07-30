-- ============================================================================
-- Codificación de repuestos — la estructura del cuaderno (15-jul)
--
--   LLAVE              DESCRIPCIÓN                        SOPORTE
--   # Código propio  · Nombre, Ref, Marca, Partida  ·  Texto soporte
--                    └──────────────┬──────────────┘
--                     Históricos · $ · Proveedores vinculados
--
-- Dos capas, y la distinción importa:
--
--  · El **código propio** es INTERNO. Sirve para que en la empresa todos hablen
--    del mismo ítem. Al proveedor no le dice nada — y no tiene por qué.
--  · Lo que el proveedor entiende es **nombre + referencia del fabricante +
--    marca + para qué máquina**. Eso es lo que se le manda.
--  · Y cada proveedor tiene ADEMÁS su propia referencia (`insumos_proveedores.
--    referencia_proveedor`): el código con el que él lo busca en su sistema.
--
-- El catálogo de hoy muestra por qué hace falta: "PUNTERA" y "PUNTERAS" son el
-- mismo ítem duplicado, y "RODAMIENTO 30206" lleva la referencia del fabricante
-- metida dentro del nombre, donde nadie la puede buscar.
-- ============================================================================

alter table public.insumos
  -- Código propio legible: FAM-0001. Es la llave con la que se habla del ítem
  -- puertas adentro; el uuid no sirve para dictar por teléfono.
  add column if not exists codigo text,
  -- Familia de 3 letras: agrupa, ordena el estante y da el prefijo del código.
  add column if not exists familia text,
  -- "Texto soporte" del apunte: la descripción larga que se le manda al
  -- proveedor cuando el nombre corto no alcanza (medidas, especificación…).
  add column if not exists descripcion text;

create unique index if not exists insumos_codigo_uk on public.insumos (upper(codigo)) where codigo is not null;

-- ── Familias ────────────────────────────────────────────────────────────────
create table if not exists public.insumos_familias (
  codigo text primary key,
  nombre text not null,
  orden integer not null default 100
);

insert into public.insumos_familias (codigo, nombre, orden) values
  ('FIL', 'Filtros', 10),
  ('LUB', 'Lubricantes y aceites', 20),
  ('COM', 'Combustible', 30),
  ('ROD', 'Rodamientos y retenedores', 40),
  ('COR', 'Correas y cadenas', 50),
  ('HID', 'Hidráulico y mangueras', 60),
  ('ELE', 'Eléctrico', 70),
  ('MOT', 'Motor', 80),
  ('TRA', 'Transmisión', 90),
  ('LLA', 'Llantas y neumáticos', 100),
  ('TOR', 'Tornillería y sujeción', 110),
  ('IMP', 'Implementos y puntas', 120),
  ('HER', 'Herramienta', 130),
  ('OTR', 'Otros', 999)
on conflict (codigo) do nothing;

alter table public.insumos_familias enable row level security;
do $$ begin
  create policy insumos_familias_all on public.insumos_familias for all using (true) with check (true);
exception when duplicate_object then null; end $$;
grant select, insert, update, delete on public.insumos_familias to anon, authenticated;

-- ── Generador del consecutivo ───────────────────────────────────────────────
-- Va en la base y no en el cliente: si dos personas crean un repuesto a la vez,
-- en el cliente les tocaría el mismo número.
create or replace function public.siguiente_codigo_insumo(p_familia text)
returns text
language plpgsql
as $$
declare
  fam text := upper(coalesce(nullif(trim(p_familia), ''), 'OTR'));
  n integer;
begin
  select coalesce(max((regexp_replace(codigo, '^[A-Z]+-', ''))::int), 0) + 1
    into n
    from public.insumos
   where codigo ~ ('^' || fam || '-[0-9]+$');
  return fam || '-' || lpad(n::text, 4, '0');
end $$;

grant execute on function public.siguiente_codigo_insumo(text) to anon, authenticated;

-- ── Backfill: darle código a lo que ya existe ───────────────────────────────
-- La familia se infiere del nombre. Lo que no encaje queda en OTR y se
-- reclasifica a mano; es preferible a inventar una familia equivocada.
update public.insumos set familia = case
    when nombre ilike '%filtro%'                                   then 'FIL'
    when nombre ilike '%aceite%' or nombre ilike '%grasa%'
      or nombre ilike '%lubricante%'                               then 'LUB'
    when nombre ilike '%combustible%' or nombre ilike '%diesel%'
      or nombre ilike '%acpm%'                                     then 'COM'
    when nombre ilike '%rodamiento%' or nombre ilike '%retenedor%'
      or nombre ilike '%balinera%'                                 then 'ROD'
    when nombre ilike '%correa%' or nombre ilike '%cadena%'        then 'COR'
    when nombre ilike '%manguera%' or nombre ilike '%hidraul%'     then 'HID'
    when nombre ilike '%fusible%' or nombre ilike '%bombillo%'
      or nombre ilike '%bater%'                                    then 'ELE'
    when nombre ilike '%llanta%' or nombre ilike '%neumatic%'      then 'LLA'
    when nombre ilike '%tornillo%' or nombre ilike '%tuerca%'
      or nombre ilike '%arandela%' or nombre ilike '%gancho%'
      or nombre ilike '%chapeta%'  or nombre ilike '%resorte%'
      or nombre ilike '%manzana%'                                  then 'TOR'
    when nombre ilike '%puntera%' or nombre ilike '%punta%'
      or nombre ilike '%cincel%'  or nombre ilike '%disco%'        then 'IMP'
    else 'OTR'
  end
 where familia is null;

-- Consecutivo por familia, en orden alfabético para que quede estable.
with numerados as (
  select id, familia,
         row_number() over (partition by familia order by nombre) as n
    from public.insumos
   where codigo is null
)
update public.insumos i
   set codigo = nu.familia || '-' || lpad(nu.n::text, 4, '0')
  from numerados nu
 where i.id = nu.id;

-- ── Separar la referencia que hoy vive dentro del nombre ────────────────────
-- "RODAMIENTO 30206" → nombre "RODAMIENTO", referencia "30206". Solo cuando el
-- nombre termina en algo que claramente es una referencia y el campo está
-- vacío: no se toca nada que ya tenga referencia puesta a mano.
update public.insumos
   set referencia = trim((regexp_match(nombre, '\s([0-9][0-9A-Z/\-\.]{3,})$'))[1])
 where referencia is null
   and nombre ~ '\s[0-9][0-9A-Z/\-\.]{3,}$';
