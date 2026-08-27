-- El orden de los mapas lo manda el cliente, no el abecedario.
--
-- Hasta hoy la lista salía ordenada por nombre, que es un orden que no significa
-- nada para quien la usa: el mapa que más se abre podía quedar de último solo
-- porque su nombre empieza por S. El jefe dictó el orden que quiere ver
-- (27-ago-2026) y de aquí en adelante lo acomoda él con ↑ ↓ en Mapas.
--
-- 🔴 `orden` va NULLABLE y SIN default a propósito: `null` = "a este nadie le ha
-- dado posición todavía" y se va al final. Un default (digamos 999) afirmaría que
-- alguien lo puso ahí, que es distinto. Mismo criterio que `insumos_solicitudes.engraso`.
alter table public.mapas add column if not exists orden integer;

comment on column public.mapas.orden is
  'Posición en la lista, la dicta el jefe desde Mapas (↑ ↓). NULL = sin ubicar, va al final.';

-- Los nombres, como los dictó el jefe. El plano que estaba como "MAYAGUEZ" es el
-- del sector sur; el norte se subió aparte el mismo día.
update public.mapas set nombre = 'RIOPAILA CASTILLA' where nombre = 'Mapa general Riopaila-Castilla';
update public.mapas set nombre = 'RISARALDA'         where nombre = 'RISARALDA — Plano general 2025';
update public.mapas set nombre = 'CASTILLA'          where nombre = 'CASTILLA MANEJO DIRECTO';
update public.mapas set nombre = 'MAYAGUEZ SUR'      where nombre = 'MAYAGUEZ';

-- De diez en diez para poder meter uno en la mitad sin renumerar todo.
update public.mapas set orden = 10 where nombre = 'RIOPAILA CASTILLA';
update public.mapas set orden = 20 where nombre = 'RIOPAILA — Plano detallado';
update public.mapas set orden = 30 where nombre = 'RISARALDA';
update public.mapas set orden = 40 where nombre = 'SAN CARLOS';
update public.mapas set orden = 50 where nombre = 'MAYAGUEZ NORTE';
update public.mapas set orden = 60 where nombre = 'MAYAGUEZ SUR';
update public.mapas set orden = 70 where nombre = 'PICHICHI';
update public.mapas set orden = 80 where nombre = 'PICHICHI SUR';
update public.mapas set orden = 90 where nombre = 'CASTILLA';
