# SAM — Runbook operacional

Cheat-sheet para mantener y operar SAM en producción. Cuando algo se rompe, busca el síntoma en el índice y sigue los pasos. Cuando hagas un cambio recurrente, añádelo aquí.

> **Última revisión**: 2026-05-14
> **Mantenedores**: Iván García (ivan.garcia0969@gmail.com), socio (juancarloszuluagaranzon-afk).

---

## Índice rápido

- [Topología y referencias](#topología-y-referencias)
- [Conectar al VPS](#conectar-al-vps)
- [Cheat-sheet de comandos](#cheat-sheet-de-comandos)
- [Diagnóstico por síntoma](#diagnóstico-por-síntoma)
- [Operaciones rutinarias](#operaciones-rutinarias)
- [Procedimientos de cambio](#procedimientos-de-cambio)
- [Datos sensibles — dónde están](#datos-sensibles--dónde-están)

---

## Topología y referencias

```
📱 PWA (Chrome móvil / desktop)
    │ HTTPS
    ▼
🌐 https://agroserviciosmorales.vercel.app  ← Vercel
    │ JS hace requests a:
    ▼
🌐 https://supabase.surcoapp.tech  ← VPS Hostinger
    │ Caddy (reverse proxy + TLS)
    ▼
🐳 Docker compose en /opt/supabase/docker
    ├─ Kong (gateway, puerto 8000 interno)
    ├─ PostgREST (API REST → /rest/v1/*)
    ├─ GoTrue (auth → /auth/v1/*)
    ├─ Realtime (websockets → /realtime/v1/*)
    ├─ Storage (archivos → /storage/v1/*)
    ├─ Studio (UI admin)
    └─ PostgreSQL (motor BD)
```

**Datos clave**:

| Item | Valor |
|---|---|
| VPS IP | `2.24.89.123` |
| Hostname VPS | `srv1657782` |
| OS VPS | Ubuntu 24.04 |
| Recursos VPS | 32 GB RAM, 400 GB disco |
| Dominio Supabase self-host | `supabase.surcoapp.tech` |
| Dominio app producción | `agroserviciosmorales.vercel.app` |
| Repo GitHub | `juancarloszuluagaranzon-afk/sam` |
| Stack Supabase | `/opt/supabase/docker` |
| Caddy config | `/etc/caddy/Caddyfile` |
| Backups Postgres | `/var/backups/supabase` |
| Cron diario backups | `0 8 * * *` (8 UTC = 3 AM Colombia) |
| Monitoreo uptime | UptimeRobot (cuenta de Iván) — 2 monitores |

**Esquema de PIN**: `md5(pin || ':sam-piloto')`. NO usa bcrypt/pgcrypto. La función `app_login` compara directamente con ese hash.

**Roles válidos** (CHECK constraint en `app_usuarios.rol`): `supervisor`, `operador`, `owner`, `administracion`.

---

## Conectar al VPS

```
ssh root@2.24.89.123
```

Te pide password (clave root del VPS, guardada en el password manager personal). La password actual fue rotada el 2026-05-11 después de una fuga por WhatsApp.

Si `ssh` se bloquea con "Connection reset":

- `fail2ban` bloqueó tu IP por intentos fallidos. Espera 15 min, o entra desde el **Browser Terminal** del panel de Hostinger.

Cuando estés dentro, el prompt es:
```
root@srv1657782:~#
```

---

## Cheat-sheet de comandos

### Containers

```bash
# Estado de TODOS los containers
cd /opt/supabase/docker
docker compose ps

# Estado de UNO específico
docker compose ps rest
docker compose ps db

# Logs en vivo (Ctrl+C para salir)
docker compose logs -f rest
docker compose logs -f db --tail=100

# Reiniciar un container (mantiene .env actual)
docker compose restart rest

# Re-crear un container (relee .env)
docker compose up -d rest

# Ver uso de recursos (RAM, CPU)
docker stats --no-stream
```

### PostgreSQL

```bash
# Entrar a psql interactivo
docker exec -it supabase-db psql -U postgres -d postgres

# Ejecutar un query inline
docker exec supabase-db psql -U postgres -d postgres -c "SELECT count(*) FROM public.asignaciones;"

# Listar todas las tablas del schema public
docker exec supabase-db psql -U postgres -d postgres -c "\dt public.*"

# Listar funciones que empiezan con app_
docker exec supabase-db psql -U postgres -d postgres -c "\df public.app_*"

# Ver definición de una función específica
docker exec supabase-db psql -U postgres -d postgres -c "SELECT pg_get_functiondef('public.app_login'::regproc);"
```

### Caddy (reverse proxy)

```bash
# Ver configuración actual
cat /etc/caddy/Caddyfile

# Validar antes de aplicar cambios
caddy validate --config /etc/caddy/Caddyfile

# Recargar (sin downtime)
systemctl reload caddy

# Reiniciar (con downtime ~1s)
systemctl restart caddy

# Ver logs en vivo
journalctl -u caddy -f
```

### Backups

```bash
# Listar backups existentes
ls -lh /var/backups/supabase/

# Ver log de cuándo corrió cada backup
cat /var/backups/supabase/backup.log

# Forzar un backup manual ahora
/usr/local/bin/sam-backup.sh

# Ver crontab actual
crontab -l
```

### Sistema

```bash
# Espacio en disco
df -h

# Uso de RAM
free -h

# Procesos pesados
top -bn1 | head -20

# Logs del sistema (kernel, servicios)
journalctl -p err -n 50
```

---

## Diagnóstico por síntoma

### "Los operadores reportan que la app no carga / da error"

Diagnóstico en orden:

```bash
# 1. ¿El VPS responde?
curl -i https://supabase.surcoapp.tech/healthz
# Esperado: HTTP/2 200 + "OK"
# Si NO responde: salta a "VPS no responde"

# 2. ¿Vercel está OK?
curl -sI https://agroserviciosmorales.vercel.app | head -3
# Si NO responde: salta a "Vercel está caído"

# 3. ¿La API Supabase responde?
curl -sI https://supabase.surcoapp.tech/rest/v1/asignaciones?limit=1 \
  -H "apikey: $(grep ^ANON_KEY /opt/supabase/docker/.env | cut -d= -f2)"
# Esperado: HTTP/2 200
# Si 401: apikey mal. Si 500: ver logs de PostgREST.
```

### "VPS no responde / `/healthz` da timeout"

```bash
# Conecta al VPS
ssh root@2.24.89.123

# ¿Caddy está corriendo?
systemctl status caddy
# Si no: systemctl start caddy

# ¿Docker está vivo?
systemctl status docker

# ¿Los containers están todos arriba?
cd /opt/supabase/docker
docker compose ps

# Si alguno está "Exited" o "Restarting", levanta:
docker compose up -d

# Si el host está sobrecargado:
top -bn1 | head -10
free -h
df -h
```

### "Vercel está caído"

- Vercel maneja la infra. Revisa <https://www.vercel-status.com/>.
- Si es incidente de plataforma, esperar.
- Mientras tanto los operadores pueden usar la app offline (Dexie cache) si ya la abrieron antes.

### "Algunos dispositivos ven datos viejos / no se sincronizan"

```bash
# Verifica que Realtime está vivo
docker compose logs realtime --tail=20
# Buscar líneas tipo "started_replication" o errores

# Verifica que la suscripción websocket llega
curl -sI "https://supabase.surcoapp.tech/realtime/v1/websocket" -H "apikey: test"
# Esperado: HTTP/1.1 401 (significa que enruta bien al container)
# Si 502: Kong no enruta. Si 404: Caddy no enruta.
```

Del lado cliente (en F12 del navegador):
- Application → Service Workers → ver versión activa.
- Network → WS → debe haber una conexión 101 a `realtime/v1/websocket`.
- Si no aparece WS, la PWA tiene bundle viejo. El UpdateBanner debe avisar dentro de 5 min.

### "Build de Vercel está fallando"

GitHub commits con ❌ rojo en el icono junto al hash. Causa típica: error de TS strict que `tsc --noEmit` local no agarró pero `tsc -b && vite build` sí.

```bash
# En tu equipo local (NO en VPS)
cd sam-app
npm run build
```

Si falla local con el mismo error, arregla, commit, push. Vercel reintenta.

Otros errores comunes:

- **`Cannot find type 'foo'`** → falta import o type definition.
- **`Property 'bar' is missing in type ...`** → cambió la interface, falta actualizar callers.
- **`Module not found`** → falta `npm install` de una dep nueva.

### "PIN de un usuario no funciona — dice credenciales inválidas"

```bash
# Verifica que el usuario existe y está activo
docker exec supabase-db psql -U postgres -d postgres -c \
  "SELECT id, nombre_completo, rol, activo FROM public.app_usuarios WHERE id = 'U035';"

# Si activo = false, reactivar
docker exec supabase-db psql -U postgres -d postgres -c \
  "UPDATE public.app_usuarios SET activo = true WHERE id = 'U035';"

# Si quieres resetear el PIN de ese usuario
docker exec supabase-db psql -U postgres -d postgres -c \
  "UPDATE public.app_usuarios SET pin_hash = md5('1234:sam-piloto') WHERE id = 'U035';"
# El usuario ahora puede entrar con PIN 1234.
```

### "pgcrypto desapareció / funciones rotas tras reinicio"

```bash
docker exec supabase-db psql -U postgres -d postgres -c \
  "CREATE EXTENSION IF NOT EXISTS pgcrypto;"
```

Idempotente — no hace nada si ya está. SAM no lo necesita en este momento (PIN usa md5 puro) pero futuros features podrían.

### "El cron de backup no corre"

```bash
# ¿Cron daemon activo?
systemctl is-active cron

# ¿Crontab tiene la línea?
crontab -l | grep sam-backup

# ¿Cuándo corrió por última vez?
tail -5 /var/backups/supabase/backup.log

# Si no hay log reciente, prueba manual:
/usr/local/bin/sam-backup.sh
echo "Exit code: $?"
```

---

### Síntoma: NADIE puede loguearse, todos ven "Credenciales inválidas"

**Diagnóstico**: probablemente el VPS no responde desde fuera, no es problema de PINs.

```bash
# 1. Desde tu PC (NO desde el VPS):
curl -m 8 https://supabase.surcoapp.tech/healthz
# Si da timeout o connection refused → backend inalcanzable desde Internet
# Si responde HTTP 200 OK → backend OK, problema en el cliente o credenciales

# 2. Desde el terminal web del panel de Hostinger (cuando SSH tampoco entra):
curl -s -o /dev/null -w "HTTP %{http_code}\n" http://localhost:8000/rest/v1/
# Si responde 401 → Supabase está sano internamente → el bloqueo es de red

# 3. Verificar firewall del VPS interno:
ufw status verbose
iptables -L INPUT -n --line-numbers | head -25
# Si UFW inactive e INPUT policy ACCEPT sin reglas → NO es el firewall del VPS
# El bloqueo está afuera (panel Hostinger)
```

**Causa típica**: en el panel Hostinger → VPS → Firewall hay un conjunto de
reglas que dice "Drop Any Any" como última regla y solo abre puertos
específicos. Si se activa un nuevo conjunto que solo permite un puerto,
todos los demás (22, 80, 443) quedan bloqueados.

**Fix**: en el panel Hostinger → Firewall → editar las reglas. Asegurar que
existan estas Accept antes de cualquier Drop:

| Action | Protocolo | Puerto | Origen                    |
|--------|-----------|--------|---------------------------|
| Accept | TCP       | 22     | Any (SSH)                 |
| Accept | TCP       | 80     | Any (HTTP, Let's Encrypt) |
| Accept | TCP       | 443    | Any (HTTPS, Supabase)     |
| Accept | TCP       | 18789  | Any (n8n, si aplica)      |
| Drop   | Any       | Any    | Any (catch-all final)     |

**IMPORTANTE**: tras editar, click en **"Synchronize"** (botón amarillo) o
los cambios NO se aplican al servidor.

**Detección del incidente**: si los operadores reportan "no puedo entrar"
y desde el celular se ve mensaje "**No pudimos contactar al servidor**" en
vez de "Credenciales inválidas", confirmado que es de red. La app ya
distingue ambos errores.

---

## Operaciones rutinarias

### Crear un usuario nuevo (sin pasar por la UI)

Útil si no tienes acceso de owner o si quieres crear masivamente.

```bash
docker exec supabase-db psql -U postgres -d postgres -c "
INSERT INTO public.app_usuarios (id, nombre_completo, rol, pin_hash, activo)
VALUES (
  'U' || lpad(
    (COALESCE(
      (SELECT MAX(CAST(SUBSTRING(id FROM 2) AS INTEGER))
       FROM public.app_usuarios WHERE id ~ '^U[0-9]+\$'),
      0
    ) + 1)::text,
    3, '0'
  ),
  'Nombre Completo Aqui',
  'operador',
  md5('1234:sam-piloto'),
  true
)
RETURNING id, nombre_completo, rol, activo;
"
```

Cambia `'Nombre Completo Aqui'`, `'operador'` (o `supervisor`/`owner`/`administracion`), y `'1234'` (PIN inicial) por los valores reales.

### Reactivar / desactivar usuario

```bash
# Desactivar (no puede loguearse)
docker exec supabase-db psql -U postgres -d postgres -c \
  "UPDATE public.app_usuarios SET activo = false WHERE id = 'U035';"

# Reactivar
docker exec supabase-db psql -U postgres -d postgres -c \
  "UPDATE public.app_usuarios SET activo = true WHERE id = 'U035';"
```

### Resetear PIN de un usuario

```bash
docker exec supabase-db psql -U postgres -d postgres -c \
  "UPDATE public.app_usuarios SET pin_hash = md5('NUEVO_PIN:sam-piloto') WHERE id = 'U035';"
```

Reemplaza `NUEVO_PIN` y `U035` por los valores reales. Avísale al usuario el nuevo PIN.

### Restaurar desde un backup específico

⚠ **OPERACIÓN DESTRUCTIVA**. Borra todos los datos actuales y los reemplaza por el backup. Solo úsalo si la BD está corrupta o necesitas rollback.

```bash
# 1. Lista los backups disponibles
ls -lh /var/backups/supabase/

# 2. Pon la app en modo lectura (idealmente avisar a usuarios primero)
# Para esta versión simple: detén Caddy ~ los operadores ven "down"
systemctl stop caddy

# 3. Restaura
gunzip -c /var/backups/supabase/sam_pg_YYYYMMDD_HHMMSS.sql.gz \
  | docker exec -i supabase-db psql -U postgres -d postgres

# 4. Re-habilita pgcrypto por si acaso
docker exec supabase-db psql -U postgres -d postgres -c \
  "CREATE EXTENSION IF NOT EXISTS pgcrypto;"

# 5. Reload PostgREST schema cache
docker exec supabase-db psql -U postgres -d postgres -c "NOTIFY pgrst, 'reload schema';"

# 6. Levanta Caddy de vuelta
systemctl start caddy

# 7. Verifica
curl -i https://supabase.surcoapp.tech/healthz
```

### Forzar a Vercel a re-deplegar

Vercel auto-despliega en cada push a `main`. Si por alguna razón un deploy falló y quieres reintentarlo sin hacer un commit:

- Pide al socio que entre al dashboard Vercel → Deployments → 3 puntos del último → **Redeploy**.

Alternativa: hacer un commit "trivial" (cambiar un comentario) y pushear — eso fuerza un build nuevo.

---

## Procedimientos de cambio

### Cambiar la `anon_key` (rotación de seguridad)

⚠ Operación con downtime de ~1 min. Hacerlo en hora muerta (madrugada).

```bash
# 1. Generar JWT nuevo con el JWT_SECRET actual
# (Se hace con jwt.io o un script — pedir a quien sabe)

# 2. Actualizar en /opt/supabase/docker/.env
nano /opt/supabase/docker/.env
# Buscar ANON_KEY=... y reemplazar

# 3. Re-crear containers para que tomen la nueva key
cd /opt/supabase/docker
docker compose up -d

# 4. Actualizar Vercel env var VITE_SUPABASE_ANON_KEY (socio en dashboard)

# 5. Trigger redeploy Vercel
```

Todos los clientes con la key vieja van a fallar después del paso 3 hasta que tomen el nuevo bundle del paso 4-5.

### Cambiar el dominio de Supabase

Si necesitas mover de `supabase.surcoapp.tech` a otro dominio:

1. Apuntar el dominio nuevo al VPS (DNS A record → 2.24.89.123).
2. Editar `/etc/caddy/Caddyfile` para que el bloque diga el dominio nuevo.
3. `caddy validate && systemctl reload caddy` — Caddy obtiene certificado Let's Encrypt automático.
4. Actualizar `VITE_SUPABASE_URL` en Vercel.
5. Trigger redeploy.

### Escalar el VPS (más RAM / CPU)

Hostinger permite upgrade sin perder datos. Desde su panel: "Upgrade plan". El VPS se reinicia, todos los containers se levantan solos por `restart: always`.

Verificar al volver:

```bash
docker compose ps
free -h
curl -i https://supabase.surcoapp.tech/healthz
```

### Cuando el disco se llene (< 10 GB libres)

```bash
df -h

# Limpiar imágenes Docker viejas
docker system prune -a

# Limpiar backups antiguos (el script lo hace automático pero puedes manual)
find /var/backups/supabase -name "sam_pg_*.sql.gz" -mtime +30 -delete

# Limpiar logs de Docker (cuidado: pierdes histórico)
truncate -s 0 /var/lib/docker/containers/*/*-json.log
```

### Habilitar SSH key auth (PENDIENTE)

Item pospuesto el 2026-05-14. Cuando se retome, en tu equipo local (Windows PowerShell):

```powershell
# 1. Generar par de claves (si no tienes)
ssh-keygen -t ed25519 -C "agromorales-vps"

# 2. Ver la clave pública
Get-Content $env:USERPROFILE\.ssh\id_ed25519.pub
# Copiarla al portapapeles

# 3. En el VPS, agregar a authorized_keys
ssh root@2.24.89.123
mkdir -p ~/.ssh
chmod 700 ~/.ssh
echo "PEGAR_AQUI_LA_CLAVE_PUBLICA" >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys

# 4. Probar (abrir NUEVA PowerShell)
ssh root@2.24.89.123
# No debe pedir password

# 5. (opcional, riesgoso) Deshabilitar password login
# Solo después de confirmar que la key funciona EN DOS sesiones distintas.
nano /etc/ssh/sshd_config
# Cambiar: PasswordAuthentication no
systemctl reload sshd
```

---

## Datos sensibles — dónde están

| Secreto | Ubicación | Quién lo conoce |
|---|---|---|
| Password root del VPS | Password manager personal | Iván + socio |
| `POSTGRES_PASSWORD` | `/opt/supabase/docker/.env` línea ~10 | Solo accesible vía SSH al VPS |
| `JWT_SECRET` | `/opt/supabase/docker/.env` | Idem |
| `ANON_KEY` (JWT) | `/opt/supabase/docker/.env` + `.env` de Vercel | Pública (va al cliente) |
| `SERVICE_ROLE_KEY` (JWT) | `/opt/supabase/docker/.env` | **NUNCA al cliente**. Solo backend. |
| `DASHBOARD_PASSWORD` | `/opt/supabase/docker/.env` | Iván + socio |
| Backups (sql.gz) | `/var/backups/supabase/` | Acceso vía SSH al VPS |

⚠ **Reglas estrictas**:

1. **NUNCA** pegar valores reales de secrets en WhatsApp / chat / email / Telegram. Hubo un incidente el 2026-05-11 con la password de Postgres por WhatsApp — tuvo que rotarse.
2. **NUNCA** commitear el `.env` del cliente ni del servidor a git. Está en `.gitignore`. Si por error se commitea, hay que rotar todos los secrets.
3. Cuando alguien deja el equipo, rotar `SERVICE_ROLE_KEY` y password root del VPS.

---

## Cambios recientes

| Fecha | Cambio | Por |
|---|---|---|
| 2026-05-14 | Item 1 backups automáticos diarios | Iván + Claude |
| 2026-05-14 | Item 2 UptimeRobot monitoreando VPS + Vercel | Iván + Claude |
| 2026-05-14 | Item 3 este runbook | Iván + Claude |
| 2026-05-13 | Realtime + UpdateBanner para 30 operadores | Iván + Claude |
| 2026-05-13 | Edición de asignaciones para supervisor/owner | Iván + Claude |
| 2026-05-12 | `pgcrypto` habilitado + `app_create_user`/`app_update_user` creadas | Iván + Claude |
| 2026-05-12 | Optimizaciones: PGRST_DB_MAX_ROWS, Caddy gzip, version-check maestro, delta sync | Iván + Claude |
| 2026-05-11 | Migración Supabase Cloud → self-host VPS | Iván + Claude |

Cuando hagas un cambio operacional importante (especialmente algo que pueda romper / requiera deshacer), agrégalo a esta tabla con fecha + descripción + autor.
