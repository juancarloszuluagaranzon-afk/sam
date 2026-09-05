-- El viaje se registra en DOS FASES: se abre al salir y se cierra al llegar.
--
-- Es la forma del papel: cada renglon tiene km INICIAL y km FINAL, hora de
-- INICIO y hora FINAL. Esos dos pares no se conocen al mismo tiempo — el
-- conductor sale a las 5:35 y llega a las 7:05 — asi que pedirlos juntos obliga
-- a llenar la planilla de memoria al final del dia. De ahi salen los odometros
-- inventados.
--
-- 🔴 `REGISTRADO` SIGUE SIENDO EL ESTADO CERRADO. No se renombra a 'CERRADO'
-- aunque suene mejor: los 37 servicios que ya existen lo tienen, y todos los
-- reportes, el Excel y la pantalla filtran por el. Cambiarlo seria reescribir
-- historia para ganar una palabra.
--
-- El estado nuevo es EN_CURSO: el viaje empezo y le faltan los datos de
-- llegada. Un viaje EN_CURSO no es un error, es trabajo sin terminar.

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'flota_servicios_estado_check') then
    alter table public.flota_servicios
      add constraint flota_servicios_estado_check
      check (estado in ('EN_CURSO', 'REGISTRADO', 'ANULADO'));
  end if;
end $$;

-- Los abiertos se consultan solos y son POCOS: el indice parcial pesa nada y
-- deja la pantalla de "pendientes por cerrar" instantanea.
create index if not exists flota_servicios_en_curso_idx
  on public.flota_servicios (conductor_id, fecha desc) where estado = 'EN_CURSO';

-- Cuando se ABRIO y cuando se CERRO. Son distintas de `created_at` (cuando se
-- tecleo) por la misma razon que en el kardex: el registro y el hecho no pasan
-- al mismo tiempo, y sin estas dos no se puede saber si un viaje quedo abierto
-- tres dias o se cerro a los veinte minutos.
alter table public.flota_servicios
  add column if not exists abierto_en  timestamptz,
  add column if not exists cerrado_en  timestamptz;

comment on column public.flota_servicios.estado is
  'EN_CURSO = salio y falta cerrarlo · REGISTRADO = completo · ANULADO.';
comment on column public.flota_servicios.abierto_en is
  'Cuando se abrio el viaje desde el telefono. NULL en los registrados de una sola vez.';
comment on column public.flota_servicios.cerrado_en is
  'Cuando se cerro. NULL si sigue EN_CURSO o si se registro de una sola vez.';

notify pgrst, 'reload schema';
