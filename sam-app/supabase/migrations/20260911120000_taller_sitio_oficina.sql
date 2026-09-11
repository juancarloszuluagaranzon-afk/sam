-- El sitio contra el que se mide si alguien marcó desde el taller o desde afuera.
--
-- Coordenadas entregadas por el cliente el 11-sep-2026:
--   4°23'17.3"N 76°02'56.6"W  =  4.388136, -76.049045
-- Radio 500 m, que es el que pidió. No es un número caprichoso: cubre el patio
-- y absorbe el error del GPS de un celular bajo techo metálico, que se va
-- fácil 50 m. Un radio apretado convierte una marcación buena en una alerta.
--
-- ⚠️ Va en migración y no solo insertado a mano en producción: si mañana hay
-- que levantar la base de cero, el geocerco no puede depender de que alguien se
-- acuerde de estas coordenadas.
insert into public.taller_sitios (nombre, lat, lng, radio_m, activo)
select 'Oficina / Taller AgroMorales', 4.388136, -76.049045, 500, true
 where not exists (
   select 1 from public.taller_sitios where nombre = 'Oficina / Taller AgroMorales');
