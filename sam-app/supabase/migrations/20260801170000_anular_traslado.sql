-- Devolver un traslado que no debía salir.
--
-- Caso real (1-ago-2026): Diego le cargó a Genaro un traslado de la principal
-- que no era para él. El material ya había SALIDO de la principal y quedó en
-- el aire: ni en la principal ni en el carro. No había forma de devolverlo.
--
-- Dos caminos hacia el mismo estado ANULADO, y hay que poder distinguirlos
-- después: no es lo mismo "me equivoqué al enviarlo" que "esto no me
-- corresponde". El primero es un error de quien despacha; el segundo es un
-- control del que recibe, y es el que dice si el proceso está funcionando.

alter table insumos_traslados
  add column if not exists anulado_por    text,
  add column if not exists anulado_nombre text,
  add column if not exists anulado_en     timestamptz,
  add column if not exists anulado_motivo text,
  -- 'ENVIA'  = lo anuló quien lo despachó (se equivocó)
  -- 'RECIBE' = lo rechazó el supervisor destino (no le correspondía)
  add column if not exists anulado_rol    text;

comment on column insumos_traslados.anulado_rol is
  'ENVIA = anulado por quien despachó · RECIBE = rechazado por el satélite destino';
