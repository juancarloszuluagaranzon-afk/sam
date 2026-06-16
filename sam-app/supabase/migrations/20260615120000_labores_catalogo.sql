-- Catálogo CRUD de TIPOS de labor. Antes era una lista fija en el código
-- (WORKFLOW). Ahora vive en BD y se administra desde la app: crear, renombrar,
-- activar/desactivar y eliminar. Las labores DESACTIVADAS dejan de ofrecerse en
-- los selectores (al asignar y al tomar en campo) y en el Tablero; el histórico
-- que ya las usa se conserva (labor_nombre es texto libre en asignaciones).
--
-- OJO: la tabla `labores` (singular, sin sufijo) YA EXISTE y pertenece a OTRO
-- módulo (recibos/nómina): es transaccional, id entero, FK desde `recibos`. NO
-- es este catálogo. Por eso usamos un nombre distinto: `labores_catalogo`.

CREATE TABLE IF NOT EXISTS public.labores_catalogo (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre     text NOT NULL UNIQUE,
  activa     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Semilla = las labores que estaban fijas en el código. REPIQUE arranca
-- DESACTIVADA (es manual; se registró por error en un operador de tractor).
INSERT INTO public.labores_catalogo (nombre, activa) VALUES
  ('DESPEJE', true),
  ('REPIQUE', false),
  ('REENCALLE', true),
  ('REENCALLE V', true),
  ('SUBSUELO', true),
  ('TRIPLE', true),
  ('FERTILIZACION', true),
  ('ZANJAS', true)
ON CONFLICT (nombre) DO NOTHING;

-- El cliente usa el anon_key (igual que asignaciones/equipos).
ALTER TABLE public.labores_catalogo ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS labores_catalogo_rw ON public.labores_catalogo;
CREATE POLICY labores_catalogo_rw ON public.labores_catalogo
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
GRANT ALL ON public.labores_catalogo TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
