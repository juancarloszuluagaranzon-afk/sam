-- El plano que se REEMPLAZA vuelve a aparecer como si fuera nuevo.
--
-- "Listos para agregar" compara lo que FieldMaps tiene procesado contra lo que
-- ASM ya registró. Al reemplazar la cartografía de un mapa, la vieja deja de
-- estar referenciada — y la pantalla la ofrece otra vez, con su nombre viejo,
-- como un plano recién llegado. Ya pasó: los dos planos anteriores de PICHICHI
-- se volvieron a agregar minutos después de reemplazarlos.
--
-- No se borran de FieldMaps a propósito: son la version anterior del plano y
-- sirven de respaldo si el reemplazo salió mal. Lo que se guarda aquí es la
-- decisión de NO mostrarlos más, que es un dato de ASM, no de FieldMaps.
create table if not exists public.mapas_descartados (
  tiles_base  text primary key,
  nombre      text,
  motivo      text,
  created_at  timestamptz not null default now()
);

comment on table public.mapas_descartados is
  'Cartografias procesadas en FieldMaps que NO deben ofrecerse en "Listos para agregar" (reemplazadas o desechadas).';

alter table public.mapas_descartados enable row level security;
drop policy if exists mapas_descartados_all on public.mapas_descartados;
create policy mapas_descartados_all on public.mapas_descartados for all using (true) with check (true);

-- ⚠️ Una tabla nueva NO hereda los GRANT: sin esto PostgREST responde
-- "permission denied" aunque la policy exista.
grant select, insert, delete on public.mapas_descartados to anon, authenticated;

-- Los dos planos de PICHICHI que se reemplazaron el 27-ago-2026.
insert into public.mapas_descartados (tiles_base, nombre, motivo) values
  ('https://api.mapview.surcoapp.tech/storage/v1/object/public/tiles/d2598200-c647-4ffe-b73e-32dc92d8072d/c09a31b2-5b49-4f7b-87c4-46467cf7d75f',
   'PICHICHI (version anterior)', 'Reemplazado por los tres sectores'),
  ('https://api.mapview.surcoapp.tech/storage/v1/object/public/tiles/d2598200-c647-4ffe-b73e-32dc92d8072d/45c6f853-4e42-444f-90c7-7fb42b0f4eeb',
   'PICHICHI SUR (version anterior)', 'Reemplazado por los tres sectores')
on conflict (tiles_base) do nothing;
