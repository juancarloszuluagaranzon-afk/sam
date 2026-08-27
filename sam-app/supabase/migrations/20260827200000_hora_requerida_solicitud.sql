-- ¿Para cuándo necesita el material o el combustible? (27-ago-2026)
--
-- La solicitud dice qué se necesita y desde cuándo espera el operario, pero no
-- decía PARA CUÁNDO lo necesita — y eso es lo que ordena el día del supervisor:
-- no es lo mismo un pedido de las 7 a.m. que se necesita a las 8 que uno que se
-- necesita hasta mañana. Sin ese dato, el que despacha atiende por orden de
-- llegada, que no es el mismo orden en que hacen falta las cosas.
--
-- 🔴 NULLABLE y sin default: `null` = "no dijo para cuándo", que es distinto de
-- una hora inventada. Todas las solicitudes anteriores a hoy caen ahí, y está
-- bien: nadie se las preguntó.
alter table public.insumos_solicitudes
  add column if not exists requerido_para timestamptz;

comment on column public.insumos_solicitudes.requerido_para is
  'Para cuando lo necesita el operario. NULL = no lo dijo. Ordena la bandeja del despachador.';
