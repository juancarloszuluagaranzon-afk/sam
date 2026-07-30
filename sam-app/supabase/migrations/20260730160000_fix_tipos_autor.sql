-- ============================================================================
-- 🔴 CORRECCIÓN CRÍTICA — las columnas de autor eran uuid y deben ser text
--
-- `app_usuarios.id` es TEXT (`U051`, `SOP01`), no uuid. Todo el resto del
-- proyecto lo respeta (`insumos_kardex.creado_por`, `labor_revisiones.
-- revisado_por`, `combustible_externo.registrado_por`… todas text), pero las
-- migraciones del 29 y 30 de julio declararon seis columnas de autor como uuid.
--
-- Efecto real, comprobado:
--     ERROR: invalid input syntax for type uuid: "U051"
--
-- Es decir: **el aval del analista no funcionaba**, ni crear o cerrar una orden
-- de trabajo, ni crear o recibir una compra, ni cargar un costo — siempre que
-- la app mandara quién lo hizo, que es siempre.
--
-- Por qué no lo cazaron las pruebas: la auditoría de integración llamaba a
-- `crearOrden`/`recibirCompra` sin pasar el id del usuario, así que las
-- columnas iban en null y el insert pasaba. La lección es que una prueba que
-- omite un campo opcional no prueba ese campo.
-- ============================================================================

alter table public.combustible_externo alter column revisado_por type text using revisado_por::text;

alter table public.compras alter column creado_por   type text using creado_por::text;
alter table public.compras alter column recibida_por type text using recibida_por::text;

alter table public.ordenes_trabajo alter column creado_por  type text using creado_por::text;
alter table public.ordenes_trabajo alter column cerrada_por type text using cerrada_por::text;

alter table public.equipo_costos alter column creado_por type text using creado_por::text;
