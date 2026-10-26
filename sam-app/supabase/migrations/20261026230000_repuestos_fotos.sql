-- Inventario de piezas del taller con FOTOS DE BAJA RESOLUCION (26-oct-2026).
--
-- Cada pieza lleva dos variantes de la misma foto, generadas en el celular:
--   foto_thumb_url  miniatura (~200 px) para la lista
--   foto_url        detalle (~900 px) para la ficha
--   foto_hash       SHA-256 del detalle: da el nombre del archivo, asi la misma foto no se guarda
--                   dos veces y reintentar una subida no duplica.
-- Las tres son NULLABLE a proposito: «sin foto» es un estado valido, no un cero.
-- `insumos` ya tiene GRANT ALL a anon/authenticated a nivel de tabla (20260622120000), asi que las
-- columnas nuevas heredan el permiso.
alter table public.insumos
  add column if not exists foto_url text,
  add column if not exists foto_thumb_url text,
  add column if not exists foto_hash text;

-- Deposito PUBLICO `taller`: fotos de repuestos (tornillos, filtros, rodamientos), no datos personales.
-- Los nombres salen del hash del contenido, asi que no se pueden adivinar. Tope de 300 KB por archivo
-- (una foto buena pesa 30-60 KB): si algo pasa de ahi, el celular dejo de comprimir.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('taller', 'taller', true, 307200, array['image/webp', 'image/jpeg'])
on conflict (id) do update
  set public = true, file_size_limit = 307200, allowed_mime_types = array['image/webp', 'image/jpeg'];

-- La app usa PIN propio (no supabase auth): entra como anon. Se puede subir y reemplazar (upsert
-- necesita insert + update) pero NO borrar. Solo bajo `repuestos/`.
drop policy if exists "taller_fotos_insert" on storage.objects;
create policy "taller_fotos_insert" on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'taller' and name like 'repuestos/%');

drop policy if exists "taller_fotos_update" on storage.objects;
create policy "taller_fotos_update" on storage.objects for update to anon, authenticated
  using (bucket_id = 'taller' and name like 'repuestos/%')
  with check (bucket_id = 'taller' and name like 'repuestos/%');

drop policy if exists "taller_fotos_select" on storage.objects;
create policy "taller_fotos_select" on storage.objects for select to anon, authenticated
  using (bucket_id = 'taller');
