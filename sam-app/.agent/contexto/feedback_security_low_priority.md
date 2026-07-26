---
name: Seguridad de claves Supabase NO es prioridad del usuario
description: Al 19-may-2026, el usuario explícitamente dijo que la seguridad de las keys filtradas no le importa ahora; no sacarlo de oficio en futuras sesiones
type: feedback
originSessionId: 1ce18956-632a-4426-8216-5dffcc058ca5
---
No traer de oficio el tema de rotación de `ANON_KEY` / `SERVICE_ROLE_KEY` / `POSTGRES_PASSWORD` filtrados. El usuario lo escuchó, lo evaluó, y dijo "no me importa la seguridad por ahora" y "dejémoslo con las viejas".

**Why:** El 19-may-2026 insistí varias veces en rotar las claves filtradas. El usuario primero intentó hacerlo, no tiene acceso a Vercel para completarlo, y luego cerró el tema. Si yo lo sigo trayendo sin que me lo pida, le hago perder tiempo.

**How to apply:**
- Si veo las claves comprometidas en contexto: no warnear repetidamente. Mencionar UNA VEZ por sesión al inicio si es la primera, y solo si surge naturalmente.
- Si el usuario pregunta por seguridad, Vercel access, o rotación: ahí sí, dar el procedimiento (memoria `project_pending_key_rotation.md` lo tiene).
- Si veo evidencia de uso indebido (logs, datos modificados extraños, alertas UptimeRobot anómalas): ahí sí elevar, es señal real.
- En cualquier otro caso: no abrir el tema.
