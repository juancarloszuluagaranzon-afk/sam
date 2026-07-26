---
name: Claves Supabase NO se rotan — decisión consciente del 19-may-2026
description: ANON_KEY/SERVICE_ROLE_KEY del VPS se filtraron en chat; tras evaluar, el usuario decidió mantenerlas (no tiene acceso a Vercel para coordinar rotación; rotar a medias rompe la app)
type: project
originSessionId: 1ce18956-632a-4426-8216-5dffcc058ca5
---
**Decisión (19-may-2026)**

El usuario decidió **no rotar** las claves filtradas. No es "pendiente" — es decisión tomada con el riesgo conocido.

**Qué se filtró**
- `ANON_KEY` (clave pública del cliente; meant to be public-ish, mitigada por RLS).
- `SERVICE_ROLE_KEY` (bypassa RLS — esta es la grave).
- `POSTGRES_PASSWORD` (vista en un pegado anterior).

Todas válidas hasta su `exp` (~2031, 5 años desde su `iat`).

**Por qué se acepta el riesgo**

- Sin acceso a Vercel del usuario, rotar `JWT_SECRET` rompe la app para 50+ usuarios sin forma de fixearlo (la nueva `ANON_KEY` necesita estar en el build de Vercel).
- La rotación parcial no funciona — la única forma de invalidar la `SERVICE_ROLE_KEY` filtrada es cambiar `JWT_SECRET`.
- El repo es `juancarloszuluagaranzon-afk/sam`; el deploy de Vercel está bajo esa cuenta, no la del usuario.

**Mitigaciones que SÍ están vivas**

- Backups diarios automáticos a las 03:00, retención 14 días (en VPS). Si alguien borra datos con la SERVICE_ROLE_KEY, hay restore.
- UptimeRobot monitorea cada 5 min — un atacante que tumbe el servicio se detecta.
- El stack Supabase respeta RLS para `ANON_KEY` aunque sea pública.
- `POSTGRES_PASSWORD` se usa solo internamente entre containers; no expuesto al exterior.

**Cuándo revisitar esto**

- Cuando el usuario consiga acceso a Vercel (colaborador agregado por Juan Carlos Zuluaga, o cuenta CLI, o migración a cuenta propia).
- Si aparece evidencia de uso indebido (logs Caddy/Kong con accesos anómalos, datos modificados sin trail en outbox, etc).

**Qué NO hacer mientras tanto**

- NO rotar `JWT_SECRET` o las keys sin acceso simultáneo a Vercel.
- NO reiniciar el stack Supabase suponiendo que es "no-op" — el restart actual con `.env` intacto es seguro, pero si alguien metió a medias claves nuevas al `.env` y luego restart, rompe todo. Verificar `grep -c '^JWT_SECRET=' /opt/supabase/docker/.env` antes de cualquier restart.
- NO pegar las keys en chats. Si por error vuelve a pasar, esta decisión queda sin efecto y toca rotar de emergencia.

**Why:** Documentar que NO rotar fue decisión informada, no olvido. Si en una próxima sesión un agente o yo veo "claves filtradas" sin contexto, no va a proponer rotación automática.

**How to apply:**

- Si el usuario menciona seguridad de Supabase o Vercel access: revisitar esta decisión.
- Si yo veo las keys en logs/contexto: no las repetir innecesariamente; tratarlas como "comprometidas pero aceptadas".
- Tarea de fondo: cuando se pueda, conseguir el acceso a Vercel y rotar usando el procedimiento de 3 fases ya diseñado (memoria viva en este archivo, no perderlo).
