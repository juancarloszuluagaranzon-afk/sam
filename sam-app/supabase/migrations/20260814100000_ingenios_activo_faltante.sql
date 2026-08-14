-- Repara `ingenios`: le falta la columna `activo` y por eso administración no
-- podía crear un ingenio ("column ingenios.activo does not exist").
--
-- ⚠️ LA TRAMPA, que vale más que el arreglo: la migración
-- `20260708120000_ingenios_catalogo.sql` SÍ declara `activo`, pero lo hace dentro
-- de un `CREATE TABLE IF NOT EXISTS`. La tabla ya existía de antes con otra forma,
-- así que Postgres saltó el bloque ENTERO —columna incluida— sin error y sin
-- aviso. La migración quedó marcada como aplicada y el esquema quedó a medias.
--
-- Regla para lo que venga: `CREATE TABLE IF NOT EXISTS` sirve para crear, NO para
-- evolucionar. Una columna que se agrega a una tabla que puede existir va SIEMPRE
-- en su propio `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`.

alter table public.ingenios
  add column if not exists activo     boolean     not null default true,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

comment on column public.ingenios.activo is
  'Los inactivos dejan de ofrecerse en los selectores; el histórico que ya los '
  'usa se conserva. Se agregó aparte porque el CREATE TABLE IF NOT EXISTS de la '
  'migración original nunca corrió: la tabla ya existía.';

-- Los permisos y la policy sí quedaron de la migración original, pero se
-- reafirman: si la tabla se creó por otra vía, pudo quedarse sin ellos.
alter table public.ingenios enable row level security;
drop policy if exists ingenios_select on public.ingenios;
create policy ingenios_select on public.ingenios
  for select to anon, authenticated using (true);
drop policy if exists ingenios_write on public.ingenios;
create policy ingenios_write on public.ingenios
  for all to anon, authenticated using (true) with check (true);
grant select, insert, update, delete on public.ingenios to anon, authenticated;

-- Sin esto PostgREST sigue sirviendo el esquema viejo y el error persiste aunque
-- la columna ya exista.
notify pgrst, 'reload schema';

\echo == COMO QUEDA ==
select id, nombre, activo from public.ingenios order by nombre;
