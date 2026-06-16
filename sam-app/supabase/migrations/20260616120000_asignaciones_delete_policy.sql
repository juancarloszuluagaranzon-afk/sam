-- Permitir DELETE de asignaciones al cliente (anon/authenticated). Se usa SOLO
-- desde el Reporte (dueño/administración) para eliminar líneas y ajustar la
-- liquidación final. Sin esta política, un DELETE vía RLS borraría 0 filas en el
-- servidor (sin error) y la fila reaparecería en el siguiente sync.
-- Es idempotente; si ya existe una policy FOR ALL, esto solo agrega/garantiza DELETE.

DROP POLICY IF EXISTS asignaciones_delete ON public.asignaciones;
CREATE POLICY asignaciones_delete ON public.asignaciones
  FOR DELETE TO anon, authenticated USING (true);

GRANT DELETE ON public.asignaciones TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
