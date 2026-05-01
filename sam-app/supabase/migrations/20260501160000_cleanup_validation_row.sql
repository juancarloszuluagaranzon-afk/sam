-- Cleanup: borra fila VALIDATION_TEST creada al validar el fix de
-- codigo_hacienda. RLS bloqueaba el DELETE via anon REST, asi que se
-- limpia desde migracion (security definer).

DELETE FROM asignaciones WHERE nombre_hacienda = 'VALIDATION_TEST';
