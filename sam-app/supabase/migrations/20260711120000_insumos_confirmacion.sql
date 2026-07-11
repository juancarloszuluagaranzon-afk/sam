-- MÓDULO INSUMOS — Fase 4: AVAL DEL OPERARIO (confirmación de recepción).
--
-- Handshake de dos partes (estándar de proof-of-delivery en fuel delivery):
-- el despachador marca ENTREGADA (con evidencia), pero SOLO el operario puede
-- dar el aval de que sí recibió. Dos autores independientes → ninguno cierra
-- el ciclo solo (antifraude estructural).
--
-- Se usan CAMPOS sobre estado='ENTREGADA' (no estados nuevos): mapSolicitud de
-- los clientes ya desplegados convierte estados desconocidos en 'PENDIENTE',
-- así que un estado nuevo rompería sus pantallas. Con campos, los clientes
-- viejos simplemente los ignoran.
--
--   conforme = true   → "Recibí todo" (RECIBIDO CONFORME)
--   conforme = false  → "Hubo un problema" (DIFERENCIA — cae a revisión del
--                        supervisor de insumos, con motivo en confirmacion_nota)
--   confirmado_en null → entregada SIN confirmar aún (visible así en la bandeja)

ALTER TABLE public.insumos_solicitudes
  ADD COLUMN IF NOT EXISTS confirmado_en     timestamptz,
  ADD COLUMN IF NOT EXISTS confirmado_por    text,
  ADD COLUMN IF NOT EXISTS conforme          boolean,
  ADD COLUMN IF NOT EXISTS confirmacion_nota text;

NOTIFY pgrst, 'reload schema';
