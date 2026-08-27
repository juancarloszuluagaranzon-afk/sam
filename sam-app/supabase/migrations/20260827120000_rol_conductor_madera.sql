-- Rol nuevo: `conductor_madera` — el que maneja el camión de trozas.
--
-- Es distinto de `conductor`, que es el escolta y llena el CDA-F-68. El de
-- madera abre y cierra partes de viaje: kilómetros con foto del tablero,
-- toneladas y ruta. Meterlos en el mismo rol le daría a cada uno la pantalla del
-- otro.
--
-- 🔴 Esta migración NO es opcional ni cosmética. El CHECK de `rol` hay que
-- ampliarlo A MANO por cada rol nuevo, y si se olvida el rol existe en la
-- pantalla pero la base lo rechaza con un 23514 al crear el usuario. Ya pasó
-- dos veces en este proyecto: `conductor` estuvo SEIS DÍAS creado en el código y
-- rechazado por la base, y a `analista_insumos` le pasó lo mismo.
--
-- ⚠️ El CHECK se reescribe ENTERO, no se le suma un valor: Postgres no permite
-- extender una restricción existente. Cualquier rol que falte en esta lista deja
-- de poder crearse.

alter table public.app_usuarios drop constraint if exists app_usuarios_rol_check;

alter table public.app_usuarios add constraint app_usuarios_rol_check
  check (rol = any (array[
    'owner',
    'administracion',
    'supervisor',
    'operador',
    'soporte',
    'supervisor_insumos',
    'conductor',
    'analista_insumos',
    'taller',
    'conductor_madera'
  ]::text[]));

notify pgrst, 'reload schema';
