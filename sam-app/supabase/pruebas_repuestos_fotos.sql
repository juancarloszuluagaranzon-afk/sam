-- Pruebas de la migracion 20261026230000_repuestos_fotos. Correr DESPUES de aplicarla; todo en begin..rollback.
begin;

do $$
declare n int;
begin
  select count(*) into n from information_schema.columns
   where table_schema = 'public' and table_name = 'insumos' and column_name in ('foto_url', 'foto_thumb_url', 'foto_hash');
  if n <> 3 then raise exception 'FALLA: faltan columnas de foto en insumos (hay %)', n; end if;

  -- «sin foto» es NULL, no cadena vacia ni default
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'insumos'
                and column_name in ('foto_url', 'foto_thumb_url', 'foto_hash')
                and (column_default is not null or is_nullable = 'NO')) then
    raise exception 'FALLA: las columnas de foto deben ser NULLABLE y sin default';
  end if;

  if not exists (select 1 from storage.buckets where id = 'taller' and public and file_size_limit = 307200
                  and allowed_mime_types @> array['image/webp', 'image/jpeg']) then
    raise exception 'FALLA: el deposito taller no esta bien configurado';
  end if;

  select count(*) into n from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'taller_fotos_%';
  if n <> 3 then raise exception 'FALLA: se esperaban 3 politicas taller_fotos_* y hay %', n; end if;

  -- no hay politica de borrado: nadie borra fotos desde el celular
  if exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
              and policyname like 'taller_fotos_%' and cmd = 'DELETE') then
    raise exception 'FALLA: no debe haber politica DELETE sobre taller';
  end if;

  -- una pieza se puede guardar con y sin foto
  insert into public.insumos (id, nombre, categoria, unidad, es_repuesto) values ('00000000-0000-0000-0000-0000000f0001', 'PRUEBA PIEZA SIN FOTO', 'MATERIAL', 'unidad', true);
  insert into public.insumos (id, nombre, categoria, unidad, es_repuesto, foto_url, foto_thumb_url, foto_hash)
  values ('00000000-0000-0000-0000-0000000f0002', 'PRUEBA PIEZA CON FOTO', 'MATERIAL', 'unidad', true, 'x_full.webp', 'x_thumb.webp', 'abc');
  select count(*) into n from public.insumos where id in ('00000000-0000-0000-0000-0000000f0001', '00000000-0000-0000-0000-0000000f0002');
  if n <> 2 then raise exception 'FALLA: no se pudieron crear las piezas de prueba'; end if;

  raise notice 'OK: pruebas del inventario con fotos';
end $$;

rollback;
