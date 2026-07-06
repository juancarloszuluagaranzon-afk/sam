-- FACTURACIÓN: el funcionario de administración asigna un N° de factura a las
-- labores YA realizadas. `factura_numero` no nulo/no vacío = labor facturada.
-- El KPI "Área facturada" suma el area_realizada de las labores con factura.

ALTER TABLE public.asignaciones ADD COLUMN IF NOT EXISTS factura_numero text;

-- Para el conteo/filtro de facturadas vs sin facturar.
CREATE INDEX IF NOT EXISTS idx_asig_factura
  ON public.asignaciones (factura_numero)
  WHERE factura_numero IS NOT NULL;

NOTIFY pgrst, 'reload schema';
