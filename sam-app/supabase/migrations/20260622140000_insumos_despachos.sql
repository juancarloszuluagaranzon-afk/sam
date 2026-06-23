-- MÓDULO INSUMOS — Fase 3: despachos (entregas) con evidencia + consumo kardex.
--
-- Un despacho = entregar una solicitud. Se documenta sobre la misma solicitud
-- (estado ENTREGADA) con: quién despachó, ruta, fecha y fotos de evidencia. La
-- cantidad realmente entregada se guarda por ítem (puede diferir de la pedida).
-- Al entregar, cada ítem genera una SALIDA en el kardex y descuenta el stock
-- (lo hace la app vía registrarMovimientoInsumo, referencia = id de solicitud).

ALTER TABLE public.insumos_solicitudes
  ADD COLUMN IF NOT EXISTS entregado_en   timestamptz,
  ADD COLUMN IF NOT EXISTS despachado_por text,
  ADD COLUMN IF NOT EXISTS ruta           text,
  ADD COLUMN IF NOT EXISTS evidencia_urls text[];

ALTER TABLE public.insumos_solicitud_items
  ADD COLUMN IF NOT EXISTS cantidad_despachada numeric;

NOTIFY pgrst, 'reload schema';
