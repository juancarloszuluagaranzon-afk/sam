# SAM / AgroMorales — instrucciones para Claude

Este archivo es lo PRIMERO que debes leer al abrir una sesion en este repo.
Contiene las reglas duras del proyecto, URLs canonicas y las decisiones de
infraestructura que NO debes reinventar.

## Stack y topologia

- **Frontend**: React 19 + TypeScript + Vite 8 PWA (Workbox).
- **Backend**: Supabase **self-host** en VPS Hostinger detras de Caddy.
  - URL publica: `https://supabase.surcoapp.tech`
  - Endpoint salud: `https://supabase.surcoapp.tech/healthz` -> "OK" 200
  - Containers: Postgres, PostgREST, Realtime, Storage, Kong, GoTrue.
- **Deploy del front**: Vercel, repo `juancarloszuluagaranzon-afk/sam`,
  branch `main`. Cada push a main = deploy automatico.
- **30 operadores en campo**, PWA instalada en celulares.

## Reglas que han causado bugs si se rompen

1. **PINs se hashean con `md5(pin || ':sam-piloto')`**. Las funciones
   `app_create_user`, `app_update_user` y `app_login` DEBEN usar md5.
   Nunca `crypt`/`gen_salt`/`bcrypt`. La migracion canonica esta en
   `sam-app/supabase/migrations/20260514120000_user_crud_md5.sql`.

2. **Realtime requiere que la tabla este en la publication**. Si agregas
   una tabla nueva y quieres sync push entre dispositivos, ejecuta en el
   VPS:
   ```sql
   ALTER PUBLICATION supabase_realtime ADD TABLE public.<nombre>;
   ALTER TABLE public.<nombre> REPLICA IDENTITY FULL;
   ```
   Verificar con `SELECT * FROM pg_publication_tables WHERE pubname = 'supabase_realtime';`.

3. **Cache local (Dexie) es siempre la fuente UI pero NUNCA la verdad**.
   - Al loguearse un usuario, se limpia `db.assignments` y se borra
     `assignments_last_sync` para forzar full sync (ver `App.tsx`).
   - Cualquier cambio de schema en Dexie debe ir en una version nueva
     dentro de `src/lib/db.ts` con un upgrade que limpie las tablas
     afectadas. Asi todos los dispositivos viejos se autosanean al
     proximo load.

4. **Buffer de delta sync = 10s retroactivo**. El delta sync de
   asignaciones usa `lastSync - 10s` (no `lastSync` puro) para protegerse
   de precision de timestamp y skew de reloj. No lo bajes.

5. **No metas runtimeCaching del SW en endpoints de Supabase**. Las
   respuestas paginadas (Range header) colisionarian. Workbox solo cachea
   estaticos (js, css, html, png, svg, woff). Las llamadas a Supabase las
   maneja Dexie.

6. **PostgREST cache de schema**. Tras un DDL (CREATE/ALTER FUNCTION,
   tabla, etc.) ejecutar `NOTIFY pgrst, 'reload schema';` o el cambio no
   aparece en la API hasta reinicio del container.

7. **RLS esta activo en `asignaciones`** con policies permisivas para
   `anon` Y `authenticated` (SELECT/INSERT/UPDATE con `qual = true`). Si
   creas una tabla nueva accesible desde el front, anade policies
   equivalentes o el front recibe `[]` sin pista de error.

## Que NO hacer

- No mocks de Supabase en tests sin avisar; preferimos integracion contra
  un DB real.
- No `--no-verify` en commits.
- No bypassear el UpdateBanner ni quitar `skipWaiting` / `clientsClaim`
  del SW: son lo que mantiene a los 30 dispositivos al dia.
- No agregar dependencias pesadas sin medir bundle (`npm run build` ya
  emite warning > 500KB).
- No cambiar `VITE_SUPABASE_URL` sin avisar. Si lo cambias en `.env`
  local, recuerda actualizar tambien Vercel (Dashboard -> Settings -> Env).

## Verificacion post-deploy (obligatorio cuando subes cambios)

1. `git push origin main`
2. Esperar ~2 min, abrir la URL de Vercel
3. Side-drawer (menu hamburguesa) -> al final muestra `Version <SHA>`
4. Comparar con `git rev-parse --short HEAD` local. Si coinciden -> deploy OK.
5. Si NO coinciden:
   - Verificar Vercel Dashboard que el build no fallo
   - Forzar reload del navegador (`Ctrl+Shift+R`)
   - En PWA instalada: cerrar app + abrir; el UpdateBanner debe aparecer.

## URLs y referencias rapidas

| Recurso              | URL/comando                                          |
|----------------------|------------------------------------------------------|
| Front prod           | (ver `vercel.json` / Vercel dashboard)               |
| Supabase publico     | https://supabase.surcoapp.tech                       |
| Health check         | https://supabase.surcoapp.tech/healthz               |
| Repo GitHub          | https://github.com/juancarloszuluagaranzon-afk/sam   |
| Runbook operacional  | `sam-app/docs/RUNBOOK.md` (incidentes, backups, etc) |
| SSH VPS              | `ssh root@srv1657782` (key en laptop del owner)      |
| Supabase Cloud (BK)  | https://efwgncsjrqzvistqyfqc.supabase.co (rollback)  |

## Memoria persistente del agente

Memorias de sesiones previas (que problemas se resolvieron, decisiones
tomadas) viven en
`~/.claude/projects/c--Users-Agr338-.../memory/MEMORY.md`. Revisalas si la
pregunta huele a "esto ya lo arreglamos".
