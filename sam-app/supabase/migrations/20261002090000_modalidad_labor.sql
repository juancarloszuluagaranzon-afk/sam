-- ============================================================================
-- 20261002090000 — MODALIDAD de la labor (2-oct-2026)
--
-- Para facturar, la labor sola no alcanza: el precio cambia según la modalidad
-- (lógica que mandó Iván en una hoja escrita a mano):
--   DESPEJE   → 0X0 · 2X1 MECANIZADA (caña verde, limpio) · 4X1 QUEMADA
--   REENCALLE → SENCILLO · 2X1 · VERDE
--   SUBSUELO  → PLANTILLA · 2X1 · 4X1
--   TRIPLE    → PLANTILLA · 2X1 · 4X1   (la hoja trae la llave vacía: se asume igual al subsuelo)
--   ACEQUIAS  → 1 PASE · 2 PASES · 3 PASES
--   FERTILIZACION → sin modalidades en la hoja (si llegan, se agregan a la lista)
--
-- · La modalidad la escoge el supervisor AL ASIGNAR, o AL APROBAR una labor
--   tomada en campo; lo ya registrado se completa en lote desde Facturación.
-- · Las listas viven en `catalogos_valores` con tipo `MODALIDAD:<LABOR>`: se
--   editan en Más → Listas, SIN publicar la app. Una labor sin lista no pide nada.
-- · NO se toca nada de lo que ya existe: la columna nace vacía (null = sin modalidad).
-- ============================================================================

alter table public.asignaciones add column if not exists modalidad text;
comment on column public.asignaciones.modalidad is
  'Modalidad de la labor para facturar (2X1, 4X1 QUEMADA, 2 PASES…). Lista por labor en catalogos_valores tipo MODALIDAD:<LABOR>. null = sin modalidad.';

insert into public.catalogos_valores (tipo, valor, descripcion, orden, frecuente)
values
  ('MODALIDAD:DESPEJE',   '0X0',            'Despeje 0 x 0',                     1, true),
  ('MODALIDAD:DESPEJE',   '2X1 MECANIZADA', 'Cosecha mecanizada, caña verde, limpio', 2, true),
  ('MODALIDAD:DESPEJE',   '4X1 QUEMADA',    'Caña quemada',                      3, true),
  ('MODALIDAD:REENCALLE', 'SENCILLO',       null,                                1, true),
  ('MODALIDAD:REENCALLE', '2X1',            null,                                2, true),
  ('MODALIDAD:REENCALLE', 'VERDE',          'Reencalle de caña verde / cruda',   3, true),
  ('MODALIDAD:SUBSUELO',  'PLANTILLA',      null,                                1, true),
  ('MODALIDAD:SUBSUELO',  '2X1',            null,                                2, true),
  ('MODALIDAD:SUBSUELO',  '4X1',            null,                                3, true),
  ('MODALIDAD:TRIPLE',    'PLANTILLA',      null,                                1, true),
  ('MODALIDAD:TRIPLE',    '2X1',            null,                                2, true),
  ('MODALIDAD:TRIPLE',    '4X1',            null,                                3, true),
  ('MODALIDAD:ACEQUIAS',  '1 PASE',         null,                                1, true),
  ('MODALIDAD:ACEQUIAS',  '2 PASES',        null,                                2, true),
  ('MODALIDAD:ACEQUIAS',  '3 PASES',        null,                                3, true)
on conflict (tipo, upper(valor)) do nothing;
