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

## Autenticación

Login por ID (ej. `U020`) + PIN numérico. El PIN se hashea con
`md5(pin || ':sam-piloto')` y se compara contra `app_usuarios.pin_hash`.

Funciones SQL canónicas: `app_login`, `app_create_user`, `app_update_user`,
`app_delete_user`. Migración en
`supabase/migrations/20260514120000_user_crud_md5.sql`.

**No** uses `crypt`/`gen_salt`/`bcrypt` — el cliente valida con md5 puro y
romperás el login.

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
