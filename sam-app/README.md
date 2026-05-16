# SAM Control - React App

Aplicación principal de SAM/AgroMorales. PWA para 30 operadores de campo,
funciona en condiciones de baja conectividad gracias a Dexie (IndexedDB)
y outbox de cambios pendientes.

## Stack

+ **Framework**: React 19 + Vite 8 + TypeScript 5
+ **PWA**: `vite-plugin-pwa` con Workbox (`skipWaiting + clientsClaim`)
+ **Backend**: Supabase **self-host** en VPS Hostinger (Caddy reverse proxy)
+ **URL backend**: <https://supabase.surcoapp.tech>
+ **Deploy front**: Vercel (auto en push a `main`)
+ **Cache offline**: Dexie (IndexedDB), `src/lib/db.ts`

## Comandos

```bash
npm install     # Instalar dependencias
npm run dev     # Servidor de desarrollo (localhost:5173)
npm run build   # Build de producción (genera dist/)
npx tsc -b      # Solo type-check (lo que valida Vercel antes del bundle)
```

## Setup tras clonar el repo (una vez)

Activar el pre-push hook que bloquea pushes con TypeScript o build roto:

```bash
# Desde la raíz del repo (carpeta sam/, no sam-app/)
git config core.hooksPath .githooks
```

Si rompes algo y `git push` falla con `pre-push`, arregla el error y vuelve
a pushear. Solo úsate `git push --no-verify` en emergencias reales — el hook
existe porque hoy un build roto llegaba a Vercel silenciosamente.

## Autenticación

Login por ID (ej. `U020`) + PIN numérico. El PIN se hashea con
`md5(pin || ':sam-piloto')` y se compara contra `app_usuarios.pin_hash`.

Funciones SQL canónicas: `app_login`, `app_create_user`, `app_update_user`,
`app_delete_user`. Migración en
`supabase/migrations/20260514120000_user_crud_md5.sql`.

**No** uses `crypt`/`gen_salt`/`bcrypt` — el cliente valida con md5 puro y
romperás el login.

---

## Instalación en celulares de operadores

Hay dos formas equivalentes; ambas reciben actualizaciones automáticas desde Vercel.

### Opción A — PWA (sin instalar nada)

1. El operador abre en Chrome la URL pública de la app.
2. Toca **⋮ (3 puntos arriba)** → **"Agregar a pantalla de inicio"** o **"Instalar app"**.
3. Confirma. Queda como app en el escritorio.

Funciona en cualquier celular con Chrome moderno. La limitación es que algunos
operadores no encuentran la opción en navegadores no-Chrome (Brave, Samsung
Internet) o si Chrome ya rechazó el prompt.

### Opción B — APK distribuido por WhatsApp (recomendado para flota)

Para instalar en los 30 celulares sin que cada operador tenga que buscar el
menú, se genera un **APK con PWABuilder** que envuelve la PWA en un paquete
Android nativo (TWA — Trusted Web Activity).

**Características importantes del APK:**

+ **No empaqueta el código**: el APK es solo un envoltorio. El JS/CSS/HTML
  se sigue cargando desde Vercel en tiempo real.
+ **Las actualizaciones llegan igual que a la PWA**: cada 2 minutos el SW
  chequea si hay versión nueva en Vercel y aparece el `UpdateBanner`. Si
  el operador no toca "Actualizar", a los 15 segundos se aplica solo.
+ **Cero instalaciones manuales tras updates**: nunca hay que reenviar el
  APK por nuevas versiones del código. Solo se regenera el APK si cambia
  el icono, el nombre, o el dominio.

**Generación del APK (proceso humano, ~10 min):**

1. Ir a <https://www.pwabuilder.com>
2. Pegar la URL pública de Vercel y "Start"
3. PWABuilder analiza el manifest y ofrece "Package for Stores"
4. Elegir **Android** → genera APK firmado
5. Descargar el ZIP, que incluye el APK y un archivo `assetlinks.json`
6. Subir `assetlinks.json` a `sam-app/public/.well-known/assetlinks.json`
   en este repo y pushear. Vercel lo sirve y el TWA queda sin barra de URL.
7. Distribuir el APK por WhatsApp. Operador toca el archivo → "Permitir
   instalar de fuentes desconocidas" → instala.

**Cuándo hay que regenerar el APK:**

+ Si cambia el dominio público (compra de dominio propio).
+ Si cambia el icono, nombre o color en el manifest.
+ Si Google Chrome cambia el formato TWA (raro).

En cualquier otro caso, los cambios de código llegan automáticamente.

---

## Flujo de actualizaciones (cómo llegan los cambios a los usuarios)

```text
1. push a main (GitHub)
        │
2. Vercel build automatico (~2 min)
        │
3. SW de cada cliente chequea cada 2 min si hay version nueva
        │
4. UpdateBanner verde aparece abajo
        │
5. Operador toca "Actualizar" → reload con bundle nuevo
   (si ignora 15s → auto-fallback)
        │
6. Toda la flota converge a la misma version en < 3 min
```

Mecanismos que aseguran que **todos vean la misma versión**:

+ `skipWaiting + clientsClaim` en el SW (activación inmediata del bundle nuevo).
+ Polling cada 2 minutos + chequeo al recuperar foco (visibilitychange).
+ Auto-fallback de 15s si el operador no toca el banner.
+ Dexie v6 limpia cache automáticamente al actualizar a un schema nuevo.
+ Reset del cache de asignaciones en cada login.
+ Sello de versión `<SHA>` visible en el menú lateral (sirve para soporte:
  "qué versión tienes?" se resuelve en 2 segundos).

---

## Deploy y verificación post-deploy

Push a `main` → Vercel construye → ~2 min → live. **Verificar siempre**:

1. **Antes de pushear**: que el build local pase limpio:

   ```bash
   npx tsc -b && npm run build
   ```

   Si TS o el bundle fallan, NO pushees.

2. Después del push, anota el SHA:

   ```bash
   git rev-parse --short HEAD
   ```

3. Abre la URL pública (ventana **incógnito** para evitar cache).

4. Loguéate → menú lateral (☰) → al final muestra `Version <SHA>`.

5. **El SHA del menú debe coincidir con el SHA del paso 2.** Si no:

   + Mira <https://vercel.com/dashboard> — ¿el deploy terminó en `Ready`?
   + ¿Cache del navegador? `Ctrl+Shift+R`.
   + ¿PWA con SW viejo? Cerrar app completamente + reabrir (el
     `UpdateBanner` aparece o `skipWaiting` activa el nuevo SW).

### Verificar env vars de Vercel

Si la app en Vercel se comporta distinto al `npm run dev` local, casi
siempre es que `VITE_SUPABASE_URL` o `VITE_SUPABASE_ANON_KEY` apuntan
distinto.

```bash
npx vercel env ls
```

Deben coincidir con `.env` local:

```text
VITE_SUPABASE_URL=https://supabase.surcoapp.tech
VITE_SUPABASE_ANON_KEY=<misma key que /opt/supabase/docker/.env ANON_KEY>
```

Si difieren: Vercel dashboard → Settings → Environment Variables → editar →
**Redeploy** desde la pestaña Deployments (no se aplican solas).

---

## Que NO hacer

+ **No mockear Supabase** en tests sin avisar (usamos integración contra BD real).
+ **No `--no-verify`** en commits (los hooks existen por algo).
+ **No quitar `skipWaiting` / `clientsClaim`** del SW — sincronizan la flota tras un deploy.
+ **No agregar runtimeCaching** del SW para endpoints Supabase — colisiona con Range headers.
+ **No cambiar `VITE_SUPABASE_URL`** sin actualizar Vercel también.
+ **No usar `crypt`/`gen_salt`/`bcrypt`** para PINs — el cliente valida con md5.

---

## Reglas duras (han causado bugs si se rompen)

1. **PINs con `md5(pin || ':sam-piloto')`**. `app_create_user`, `app_update_user`,
   `app_login` DEBEN usar md5. Migración canónica:
   `supabase/migrations/20260514120000_user_crud_md5.sql`.

2. **Realtime requiere publication**. Para sync push entre dispositivos, en el VPS:

   ```sql
   ALTER PUBLICATION supabase_realtime ADD TABLE public.<nombre>;
   ALTER TABLE public.<nombre> REPLICA IDENTITY FULL;
   ```

   Verificar: `SELECT * FROM pg_publication_tables WHERE pubname = 'supabase_realtime';`.

3. **Cache Dexie nunca es la verdad**. Al loguearse un usuario, se limpia
   `db.assignments` y se borra `assignments_last_sync` para forzar full sync
   (ver `src/App.tsx`). Cambios de schema en Dexie van en una versión nueva
   dentro de `src/lib/db.ts` con upgrade que limpia las tablas afectadas.

4. **Delta sync = `lastSync - 10s` retroactivo** para protegerse de precisión
   de timestamp y skew de reloj cliente/servidor. No lo bajes.

5. **RLS activo en `asignaciones`** con policies permisivas para `anon` y
   `authenticated` (SELECT/INSERT/UPDATE, `qual = true`). Tablas nuevas
   accesibles desde el front necesitan policies equivalentes o reciben `[]`
   silenciosamente.

6. **Tras DDL → `NOTIFY pgrst, 'reload schema';`** o el cambio no aparece
   en la API hasta reinicio del container PostgREST.

---

## URLs y referencias

| Recurso              | URL / comando                                        |
|----------------------|------------------------------------------------------|
| Supabase público     | <https://supabase.surcoapp.tech>                     |
| Health check         | <https://supabase.surcoapp.tech/healthz>             |
| Repo GitHub          | <https://github.com/juancarloszuluagaranzon-afk/sam> |
| Runbook operacional  | [`docs/RUNBOOK.md`](docs/RUNBOOK.md)                 |
| SSH VPS              | `ssh root@srv1657782`                                |
| Supabase Cloud (BK)  | <https://efwgncsjrqzvistqyfqc.supabase.co> (rollback)|

---

*Parte del ecosistema SAM (AgroMorales).*
