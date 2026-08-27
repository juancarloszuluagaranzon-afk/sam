-- PICHICHI pasa de dos planos a tres sectores: SUR, CENTRO y NORTE (27-ago-2026).
--
-- Se REEMPLAZA la cartografía conservando la fila (mismo id) en vez de borrar y
-- crear: el id es lo que amarra la descarga offline de cada equipo. Borrando, a
-- quien ya lo tenía bajado se le queda un mapa huérfano en el celular; así ve el
-- aviso de re-descarga y sigue siendo el mismo mapa.
--
-- El plano "SECTOR NORTE" resultó ser el que era PICHICHI: sus coordenadas
-- (lat 3,646–4,346) son las que tenía esa fila (3,625–4,347). Se había subido con
-- nombre de Mayagüez y se corrigió. Y el de Mayagüez volvió a llamarse MAYAGUEZ:
-- sin un norte con qué hacer pareja, un "SUR" solo hace buscar lo que no existe.
update public.mapas set
  nombre     = 'PICHICHI SUR',
  tiles_base = 'https://api.mapview.surcoapp.tech/storage/v1/object/public/tiles/d2598200-c647-4ffe-b73e-32dc92d8072d/e4ddc35e-daf1-4310-956b-186ee88d5dee',
  bounds     = '[-76.4918955, 3.4134402, -76.1764979, 3.7303364]'::jsonb,
  minzoom = 10, maxzoom = 14, orden = 70, updated_at = now()
where id = 'b5c0bb0a-6f91-4f64-b31c-4d8e11d8fd53';

update public.mapas set
  nombre     = 'PICHICHI CENTRO',
  tiles_base = 'https://api.mapview.surcoapp.tech/storage/v1/object/public/tiles/d2598200-c647-4ffe-b73e-32dc92d8072d/20c99acf-cb13-4bc7-be7c-6ce531bbaa1f',
  bounds     = '[-76.4852306, 3.6773693, -76.1697188, 3.9942845]'::jsonb,
  minzoom = 10, maxzoom = 14, orden = 80, updated_at = now()
where id = '82277915-1f51-493b-8be9-afa49353be25';

update public.mapas set nombre = 'PICHICHI NORTE', orden = 90 where nombre = 'MAYAGUEZ NORTE';
update public.mapas set nombre = 'MAYAGUEZ',       orden = 50 where nombre = 'MAYAGUEZ SUR';
update public.mapas set orden = 100 where nombre = 'CASTILLA';
