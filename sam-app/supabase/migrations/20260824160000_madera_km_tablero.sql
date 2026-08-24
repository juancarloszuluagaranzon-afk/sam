-- El parte de viaje: kilometraje CON FOTO DEL TABLERO.
--
-- ⚠️ RAMA `pruebas`.
--
-- Cambio de enfoque pedido por el cliente (24-ago-2026). El caso real no es
-- controlar salvoconductos: es que **el dueño del camión vive lejos y quiere
-- saber qué hizo su vehículo**. Eso es un problema de CONFIANZA, no de papeles.
--
-- Por eso el dato central no es el número, es la **prueba**:
--
--   `km_inicio` / `km_fin`   los declara el conductor
--   `foto_tablero_url`       la foto del tablero que los respalda
--   `created_at`             la hora, que NO se digita: la pone el sistema
--
-- Un kilometraje escrito a mano se puede acomodar; uno con foto del tablero y
-- hora automática, no. Esa es toda la diferencia entre informar y demostrar.
--
-- `km_fin` va nullable a propósito: null = el viaje sigue abierto, distinto de
-- "recorrió cero". Mismo criterio que `volumen_recibido_m3`.

alter table public.madera_viajes add column if not exists km_inicio        numeric;
alter table public.madera_viajes add column if not exists km_fin           numeric;
alter table public.madera_viajes add column if not exists foto_tablero_url text;
alter table public.madera_viajes add column if not exists foto_tablero_fin_url text;
alter table public.madera_viajes add column if not exists toneladas        numeric;

comment on column public.madera_viajes.foto_tablero_url is
  'Foto del tablero al iniciar. Es la PRUEBA del kilometraje: sin ella el km es '
  'solo una afirmacion.';
comment on column public.madera_viajes.km_fin is
  'NULL = el viaje sigue abierto. Distinto de "recorrio cero".';
comment on column public.madera_viajes.created_at is
  'La hora del registro. NO se digita — la pone el sistema, para que no se pueda '
  'acomodar despues.';

-- El recorrido, calculado: no se guarda para que no pueda contradecir a los dos
-- kilometrajes que sí tienen foto.
create or replace view madera_viajes_v as
  select v.*,
         case when v.km_fin is not null and v.km_inicio is not null
                   and v.km_fin >= v.km_inicio
              then v.km_fin - v.km_inicio end as km_recorridos
    from public.madera_viajes v;

grant select on madera_viajes_v to anon, authenticated;

notify pgrst, 'reload schema';
