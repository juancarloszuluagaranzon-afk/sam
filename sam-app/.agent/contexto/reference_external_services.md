---
name: Servicios externos asociados a SAM
description: Dónde buscar info de monitoreo, backups y el panel del VPS
type: reference
originSessionId: 1ce18956-632a-4426-8216-5dffcc058ca5
---
- **Hostinger hPanel** — `https://hpanel.hostinger.com/vps/1657782/docker-manager` — gestión del VPS, Docker Manager web, terminal del contenedor. Útil para verificar que `supabase-db` y los demás contenedores estén `Running` sin entrar por SSH.
- **UptimeRobot** — monitor cada 5 min con alertas por correo si el VPS deja de responder. (Pedir credenciales al usuario antes de mirar si hace falta.)
- **Backups diarios** — cron job en el VPS, 03:00 hora servidor, retención 14 días. Ubicación en VPS: confirmar con `crontab -l` y revisar destino del script.
- **Supabase Studio (self-hosted)** — `https://supabase.surcoapp.tech` (vía Caddy). SQL Editor para queries ad-hoc.
- **Supabase Cloud (legacy)** — `https://efwgncsjrqzvistqyfqc.supabase.co`. Mantenido como respaldo histórico desde 9-may-2026; NO escribir.
