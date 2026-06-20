-- Catálogos nuevos: EMPRESAS y TERCEROS, administrables desde la app (CRUD).
--
--   empresas  = compañías cuya operación se gestiona en el aplicativo
--               (p. ej. Agroservicios Morales). Por ahora solo catálogo.
--   terceros  = clientes a los que se les presta la labor. Los ingenios ya
--               existentes SON terceros; se siembran automáticamente y se
--               pueden crear más a mano. Cada suerte del maestro puede llevar
--               un tercero asignado (campo ADICIONAL — no reemplaza al ingenio).
--
-- Ambas tablas: id uuid, nombre, activo. El cliente usa el anon_key (mismo
-- patrón RLS que labores_catalogo / asignaciones).

-- ─────────────────────────────────────────────────────────────────────────
-- 1) EMPRESAS
CREATE TABLE IF NOT EXISTS public.empresas (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre     text NOT NULL UNIQUE,
  activo     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.empresas (nombre, activo) VALUES
  ('AGROSERVICIOS MORALES', true)
ON CONFLICT (nombre) DO NOTHING;

ALTER TABLE public.empresas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS empresas_rw ON public.empresas;
CREATE POLICY empresas_rw ON public.empresas
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
GRANT ALL ON public.empresas TO anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 2) TERCEROS
CREATE TABLE IF NOT EXISTS public.terceros (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre     text NOT NULL UNIQUE,
  activo     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Semilla: un tercero por cada ingenio distinto que tenga el maestro, con
-- nombre legible. initcap() para cualquier ingenio_id no contemplado.
INSERT INTO public.terceros (nombre)
SELECT DISTINCT CASE ingenio_id
    WHEN 'risaralda'  THEN 'Ingenio Risaralda'
    WHEN 'pichichi'   THEN 'Ingenio Pichichi'
    WHEN 'mayaguez'   THEN 'Ingenio Mayagüez'
    WHEN 'san_carlos' THEN 'Ingenio San Carlos'
    WHEN 'riopaila'   THEN 'Ingenio Riopaila'
    ELSE initcap(ingenio_id)
  END AS nombre
FROM public.maestro_risaralda
WHERE coalesce(ingenio_id, '') <> ''
ON CONFLICT (nombre) DO NOTHING;

ALTER TABLE public.terceros ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS terceros_rw ON public.terceros;
CREATE POLICY terceros_rw ON public.terceros
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
GRANT ALL ON public.terceros TO anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 3) maestro_risaralda.tercero_id  (campo adicional, nullable)
ALTER TABLE public.maestro_risaralda
  ADD COLUMN IF NOT EXISTS tercero_id uuid REFERENCES public.terceros(id) ON DELETE SET NULL;

-- Pre-asignar cada suerte a su ingenio como tercero (solo las que no tengan).
UPDATE public.maestro_risaralda m
SET tercero_id = t.id
FROM public.terceros t
WHERE m.tercero_id IS NULL
  AND lower(t.nombre) = lower(CASE m.ingenio_id
      WHEN 'risaralda'  THEN 'Ingenio Risaralda'
      WHEN 'pichichi'   THEN 'Ingenio Pichichi'
      WHEN 'mayaguez'   THEN 'Ingenio Mayagüez'
      WHEN 'san_carlos' THEN 'Ingenio San Carlos'
      WHEN 'riopaila'   THEN 'Ingenio Riopaila'
      ELSE initcap(m.ingenio_id)
    END);

NOTIFY pgrst, 'reload schema';
