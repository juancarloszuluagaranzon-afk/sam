-- Reset PIN de U032 con md5 (formato real que acepta app_login).
-- La migración previa con bcrypt era incorrecta — app_login solo verifica md5.
-- Idempotente: si U032 no existe en otro entorno, no actualiza nada.

UPDATE app_usuarios
SET pin_hash = md5('1234' || ':sam-piloto')
WHERE id = 'U032';
