-- "¿Engrasó el tractor?" en la entrega.
--
-- Es una columna de la hoja de Excel que llevan a mano y que la app no
-- capturaba. El engrase se hace justo cuando el supervisor llega a la máquina a
-- entregar, así que ese es el momento de preguntarlo: si se deja para después,
-- nadie se acuerda.
--
-- Tres estados, no dos: `true` engrasó, `false` no engrasó, `null` no se
-- preguntó (todas las entregas viejas). Un booleano NOT NULL con default false
-- diría que ninguna máquina se ha engrasado nunca, que es distinto de "no
-- sabemos".

alter table insumos_solicitudes
  add column if not exists engraso boolean;

comment on column insumos_solicitudes.engraso is
  '¿Se engrasó la máquina en esta entrega? true/false/null (no se preguntó). '
  'Sale en el informe semanal, columna "¿Engrasó el tractor?".';
