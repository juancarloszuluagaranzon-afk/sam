-- El tanqueo a una MÁQUINA necesita quién lo recibió, y su aval.
--
-- Hoy el tanqueo guarda a qué máquina se le echó, pero no a quién se le
-- entregó. Cuando Diego o un supervisor le tanquean la máquina a un operario,
-- no queda nadie que confirme que ese combustible llegó — que es justo lo que
-- sostiene el cobro en las entregas de material.
--
-- Los materiales ya lo tienen: pasan por `insumos_solicitudes`, que guarda el
-- operario y su confirmación. El combustible por tanqueo se quedó por fuera.
--
-- ⚠️ `operario_id` y `confirmado_por` son TEXT, no uuid: `app_usuarios.id` es
-- texto (`U051`). Esa confusión ya rompió el aval de combustible una vez
-- (30-jul-2026) y no se veía hasta que alguien intentaba usarlo.

alter table combustible_externo
  add column if not exists operario_id        text,
  add column if not exists operario_nombre    text,
  add column if not exists confirmado_en      timestamptz,
  add column if not exists confirmado_por     text,
  -- true = recibió todo · false = reportó un problema · null = todavía no responde
  add column if not exists conforme           boolean,
  add column if not exists confirmacion_nota  text;

-- Lo que el operario tiene pendiente por confirmar: se consulta en cada
-- arranque de su pantalla, así que conviene que no recorra la tabla entera.
create index if not exists combustible_externo_operario_pend_ix
  on combustible_externo (operario_id)
 where operario_id is not null and confirmado_en is null;

comment on column combustible_externo.operario_id is
  'Operario que RECIBIÓ el combustible en su máquina. Solo aplica a destino=MAQUINA; '
  'los vehículos todavía no piden operario (decisión del cliente, 3-ago-2026).';
