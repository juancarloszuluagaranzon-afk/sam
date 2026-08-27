-- RISARALDA pasa al plano general 2026.
--
-- Se reemplaza sobre la MISMA fila: el id es lo que amarra la descarga offline
-- de cada equipo. Borrando y creando, a quien ya lo tenía bajado se le queda un
-- mapa huérfano en el celular; así ve el aviso de re-descarga.
update public.mapas set
  tiles_base = 'https://api.mapview.surcoapp.tech/storage/v1/object/public/tiles/d2598200-c647-4ffe-b73e-32dc92d8072d/3a9909e4-bf4f-4c37-a2d9-38cc69a010e8',
  bounds     = '[-76.26301, 4.1110254, -75.695404, 5.2284997]'::jsonb,
  minzoom = 8, maxzoom = 14, updated_at = now()
where id = '2cc28c0c-7e24-4460-b777-d66fe10ee6af';

-- El plano 2025 queda sin dueño en ASM y "Listos para agregar" lo ofrecería de
-- vuelta como si acabara de llegar. En FieldMaps se queda: es el respaldo.
insert into public.mapas_descartados (tiles_base, nombre, motivo) values
  ('https://api.mapview.surcoapp.tech/storage/v1/object/public/tiles/d2598200-c647-4ffe-b73e-32dc92d8072d/f2812c6f-d65e-4a53-9630-a6ee13bcdc48',
   'RISARALDA — Plano general 2025', 'Reemplazado por el plano general 2026')
on conflict (tiles_base) do nothing;
