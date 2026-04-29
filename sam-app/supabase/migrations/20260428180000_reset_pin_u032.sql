-- Reset PIN de U032 (HERNANDEZ MARTINEZ BERNARDO) usando bcrypt explícito.
-- Workaround documentado en memory/feedback_gotchas.md #1: el RPC app_create_user
-- puede generar hashes que app_login rechaza. Forzar bcrypt directo es el método
-- canónico para resetear PINs.
--
-- Idempotente: si U032 no existe en otro entorno, no actualiza nada.

UPDATE app_usuarios
SET pin_hash = extensions.crypt('1234', extensions.gen_salt('bf'))
WHERE id = 'U032';
