-- Agregar materiales a un despacho YA entregado, marcados como agregados después.
--
-- El caso real: Genaro o Eduvin entregan, y más tarde el operario les pide algo
-- más para la misma máquina, o cayeron en cuenta de que faltó anotar un material.
-- Hasta ahora la única salida era hacer una entrega directa aparte, y entonces en
-- el reporte aparecían dos despachos donde hubo uno.
--
-- ⚠️ NO se confunde con lo que se entregó de una: `agregado_en` en null significa
-- "salió con el despacho original". Con fecha significa "se sumó después, tal día
-- a tal hora". Son dos hechos distintos y mezclarlos borraría justo lo que el
-- cliente quiere poder ver.

alter table insumos_solicitud_items
  add column if not exists agregado_en  timestamptz,
  add column if not exists agregado_por text;

comment on column insumos_solicitud_items.agregado_en is
  'Cuándo se sumó este material al despacho, si NO salió con la entrega original. '
  'null = venía en el despacho. La hora se guarda sola, no se digita.';
comment on column insumos_solicitud_items.agregado_por is
  'Quién lo agregó. Puede ser distinto de quien hizo la entrega.';

-- Los reportes filtran por "lo agregado después" para poder separarlo.
create index if not exists insumos_solicitud_items_agregado_idx
  on insumos_solicitud_items (agregado_en) where agregado_en is not null;

notify pgrst, 'reload schema';
