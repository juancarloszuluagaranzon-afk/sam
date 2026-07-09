-- Catálogo de INGENIOS/compradores editable desde la app (Catálogos → Ingenios).
-- Antes la lista estaba fija en código (6 copias) y agregar uno nuevo requería
-- tocar el repo. Ahora vive en esta tabla; el `id` es un slug estable porque es
-- la llave que amarra `maestro_risaralda.ingenio_id` y `asignaciones` — el nombre
-- se puede renombrar, pero el id NO debe cambiar una vez tenga suertes asociadas.

CREATE TABLE IF NOT EXISTS public.ingenios (
  id text PRIMARY KEY,                 -- slug estable (ej. 'trapiche_lucerna')
  nombre text NOT NULL,                -- nombre legible (ej. 'Trapiche Lucerna')
  activo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Semilla con los ingenios que ya existían en código (idempotente: no pisa
-- nombres si ya están, solo inserta los que falten).
INSERT INTO public.ingenios (id, nombre) VALUES
  ('risaralda',        'Ingenio Risaralda'),
  ('pichichi',         'Ingenio Pichichi'),
  ('mayaguez',         'Ingenio Mayagüez'),
  ('san_carlos',       'Ingenio San Carlos'),
  ('riopaila',         'Ingenio Riopaila'),
  ('trapiche_lucerna', 'Trapiche Lucerna')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.ingenios ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ingenios_select ON public.ingenios;
CREATE POLICY ingenios_select ON public.ingenios
  FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS ingenios_write ON public.ingenios;
CREATE POLICY ingenios_write ON public.ingenios
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ingenios TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
