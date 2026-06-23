-- MÓDULO INSUMOS — al entregar/despachar se registra el HORÓMETRO de la máquina
-- (obligatorio en la app). Se guarda sobre la solicitud entregada.

ALTER TABLE public.insumos_solicitudes
  ADD COLUMN IF NOT EXISTS horometro numeric;

NOTIFY pgrst, 'reload schema';
