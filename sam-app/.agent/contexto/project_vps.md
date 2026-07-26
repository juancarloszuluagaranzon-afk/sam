---
name: VPS infrastructure & operación
description: Estado operativo del VPS Hostinger donde corre SAM/AgroMorales (Supabase self-hosted), backups, monitoreo y reglas de operación tras la migración del 9-may-2026
type: project
originSessionId: 1ce18956-632a-4426-8216-5dffcc058ca5
---
**Servidor — la fuente de verdad**
- VPS Hostinger, Ubuntu 24.04 LTS, IP `2.24.89.123`, hostname `srv1657782`.
- Acceso `ssh root@2.24.89.123`. Disco ~387 GB (≈20% usado al 19-may-2026).

**Stack Supabase self-hosted (Docker Compose)**
- Compose en `/opt/supabase/docker/docker-compose.yml`. 13 contenedores corriendo bajo el proyecto `supabase`.
- Postgres: contenedor `supabase-db`, imagen `supabase/postgres:15.8.1.085`.
- API pública (Kong+rest): `https://supabase.surcoapp.tech` (Caddy en 80/443 → Kong en 8000/8443).
- Pooler/supavisor expuesto 5432 y 6543.
- `ANON_KEY` y `SERVICE_ROLE_KEY` en `/opt/supabase/docker/.env`. NUNCA pegar `SERVICE_ROLE_KEY` en chats o issues; bypassa RLS.

**Backups automáticos**
- Job diario a las 03:00 hora del servidor.
- Comprime toda la DB y guarda 14 copias rotando.
- Antes de cualquier DELETE manual: NO confiar solo en el backup del día — hacer `pg_dump` de la tabla afectada como segunda red.

**Monitoreo**
- UptimeRobot chequea cada 5 minutos, notifica por correo si el VPS deja de responder.

**Sincronización en tiempo real entre dispositivos**
- Realtime Supabase ACTIVADO post-migración (estaba inactivo entre 9-may y 13-may, causó que operadores no vieran asignaciones recientes).
- Si en el futuro algún supervisor reporta "el operador no ve la labor que acabo de asignar": primero revisar que `supabase-realtime` esté `Up (healthy)`.

**Firewall (riesgo recurrente)**
- 15-may-2026: una regla mal puesta bloqueó todos los puertos excepto el de n8n. Servidor vivo pero inaccesible.
- Al tocar `ufw` o reglas iptables: verificar que 22 (SSH), 80, 443, 5432, 6543, 8000, 8443 sigan abiertos antes de salir.

**Otros stacks en el mismo host** (NO mezclar con SAM):
- Caddy reverse proxy (80/443), config en `/etc/caddy/Caddyfile`.
- n8n (`/opt/karpos`, `/root/.n8n`), open-webui, ollama, librechat, groqbot.

**Why:** Migración 9-may-2026 desde Supabase Cloud al VPS por costo fijo y control. La cuenta Cloud (`efwgncsjrqzvistqyfqc.supabase.co`) ya NO se actualiza pero se mantiene como respaldo histórico — no escribir a Cloud bajo ninguna circunstancia. SAM hoy es responsable de mantener el VPS encendido; los incidentes 9-15 de mayo fueron parte de esa curva.

**How to apply:**
- Operaciones SQL contra SAM van a `docker exec supabase-db psql -U postgres -d postgres` o vía Supabase Studio en `https://supabase.surcoapp.tech` (verificar puerta de entrada).
- Cualquier acción destructiva: backup manual con `pg_dump` ANTES + tabla espejo dentro de la misma DB + `BEGIN/COMMIT` con `ON_ERROR_STOP`.
- Si hay que tocar firewall: documentar la regla, probar SSH desde otra ventana ANTES de cerrar sesión actual.
- Si producción "se ve rara" tras cambios: revisar (a) que la app apunte a `supabase.surcoapp.tech`, (b) que `supabase-realtime` esté healthy, (c) que el firewall no esté bloqueando.
