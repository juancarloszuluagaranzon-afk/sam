-- MÓDULO MAPAS OFFLINE (tipo Avenza) — config de mapas disponibles.
--
-- ASM NO genera tiles: consume los que FieldMaps ya produce en su bucket
-- público (https://api.mapview.surcoapp.tech/storage/v1/object/public/tiles/
-- {org}/{map}/{z}/{x}/{y}.png, cache 1 año). Esta tabla solo guarda la CONFIG
-- de cada mapa (URL base + bounds + zooms) para que el visor la cargue
-- on-demand (NUNCA en el arranque) y activar un mapa = insertar una fila,
-- sin deploy. El visor descarga los tiles a Cache Storage para offline total.

CREATE TABLE IF NOT EXISTS public.mapas (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre     text NOT NULL,
  -- URL base hasta el prefijo del mapa (SIN /{z}/{x}/{y}.png). Ej:
  -- https://api.mapview.surcoapp.tech/storage/v1/object/public/tiles/<org_id>/<map_id>
  tiles_base text NOT NULL,
  -- [minLon, minLat, maxLon, maxLat] en WGS84 (de la tabla maps de FieldMaps).
  bounds     jsonb NOT NULL,
  minzoom    int NOT NULL DEFAULT 10,
  maxzoom    int NOT NULL DEFAULT 16,
  activo     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.mapas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mapas_select ON public.mapas;
CREATE POLICY mapas_select ON public.mapas
  FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS mapas_write ON public.mapas;
CREATE POLICY mapas_write ON public.mapas
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mapas TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- Para ACTIVAR el mapa RIOPAILA: obtener los valores reales de FieldMaps
-- (docker exec fieldmaps-db psql ... "select id, org_id, bounds, minzoom,
-- maxzoom from public.maps where status='ready'") y luego:
--
-- INSERT INTO public.mapas (nombre, tiles_base, bounds, minzoom, maxzoom) VALUES (
--   'RIOPAILA — Mapa general',
--   'https://api.mapview.surcoapp.tech/storage/v1/object/public/tiles/<ORG_ID>/<MAP_ID>',
--   '[minLon, minLat, maxLon, maxLat]'::jsonb,
--   <MINZOOM>, <MAXZOOM>
-- );
