-- Kilometraje INICIAL y FINAL del servicio de escolta (CDA-F-68).
--
-- Hasta hoy el conductor tecleaba el total a mano. Pedirle las dos lecturas del
-- odometro y restar quita la cuenta mental —que se hace de memoria al final del
-- dia— y ademas deja el rastro: con solo el total no hay forma de saber si los
-- 47 km salieron de una lectura o de un calculo aproximado.
--
-- NULLABLE y sin default, a proposito. `null` no significa "cero kilometros":
-- significa "se registro cuando esto no se pedia" (todo lo anterior a hoy) o
-- "no se pudo leer el odometro". Un `numeric NOT NULL DEFAULT 0` afirmaria que
-- todos los servicios historicos arrancaron en el kilometro cero.
--
-- `total_km` NO se toca: sigue siendo la columna que imprime la planilla y la
-- que suma el total del formato. Cuando hay las dos lecturas es la resta; si no
-- las hay, es lo que se escribio a mano. El documento que se entrega no cambia.

alter table public.flota_servicios
  add column if not exists km_inicial numeric,
  add column if not exists km_final   numeric;

comment on column public.flota_servicios.km_inicial is
  'Lectura del odometro al salir. NULL = no se registro (servicio anterior a sep-2026 o odometro ilegible).';
comment on column public.flota_servicios.km_final is
  'Lectura del odometro al regresar. NULL = no se registro.';
comment on column public.flota_servicios.total_km is
  'Km del servicio, lo que imprime la planilla CDA-F-68. = km_final - km_inicial cuando hay las dos lecturas.';

notify pgrst, 'reload schema';
