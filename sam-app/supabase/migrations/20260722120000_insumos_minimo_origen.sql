-- Módulo Insumos — fase 5.
--
--  stock_minimo : umbral por insumo para la ALERTA de "stock bajo". 0 = sin alerta.
--  origen       : distingue la SOLICITUD del operario ('OPERARIO', valor por
--                 defecto) de la ENTREGA DIRECTA que crea el supervisor
--                 ('DIRECTA') sin que el operario la haya pedido. La entrega
--                 directa igual requiere el aval del operario (mismo flujo de
--                 confirmación de la fase 4).
--
-- Ambas columnas son aditivas y con default → no rompen filas ni pantallas
-- existentes. Correr en Supabase Studio (extensión traductora APAGADA).

alter table public.insumos
  add column if not exists stock_minimo numeric not null default 0;

alter table public.insumos_solicitudes
  add column if not exists origen text not null default 'OPERARIO';
