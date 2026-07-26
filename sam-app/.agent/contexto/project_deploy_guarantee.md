---
name: Garantía de deploy continuo + versión visible en todo dispositivo
description: Requisito operativo no negociable — cada push a main llega a Vercel y a todos los dispositivos. Ya está implementado en main desde mayo 2026 (no es código mío, fue trabajo previo).
type: project
originSessionId: 1ce18956-632a-4426-8216-5dffcc058ca5
---
**Requisito (no negociable)**

Cuando se hace push a `main`:

1. Vercel hace build automático.
2. Cada dispositivo con la app abierta recibe la build nueva en <3 minutos (PWA + UpdateBanner con polling cada 2 min, auto-fallback 15s).
3. Cada dispositivo muestra `<SHA7>` del commit instalado para que soporte pueda verificar versión.

**IMPORTANTE (lección 19-may-2026)**

Todo esto **YA está implementado en `main`** desde antes de mayo 2026. NO es mi código — son commits previos. Archivos productivos:

- `sam-app/vite.config.ts` — define `__APP_VERSION__` y `__APP_BUILD_TIME__` (no `__BUILD_VERSION__`). En Vercel toma `VERCEL_GIT_COMMIT_SHA`; local toma `git rev-parse --short HEAD`. SW con `skipWaiting: true` + `clientsClaim: true`.
- `sam-app/src/components/UpdateBanner.tsx` — usa `useRegisterSW` de `virtual:pwa-register/react`. Polling cada 2 min + chequeo en `visibilitychange`. Auto-fallback que llama `updateServiceWorker(true)` a los 15s si el usuario no toca "Actualizar". Botones "Más tarde" / "Actualizar".
- `sam-app/src/components/DiagnosticModal.tsx` — modal con: `__APP_VERSION__` + `__APP_BUILD_TIME__`, conexión, ping al backend vía `supabase.from('asignaciones').select('id', { count: 'exact', head: true })` con latencia, session.id + nombre, última sincronización (`db.meta.assignments_last_sync` con tiempo relativo), `cacheTotal` y `cacheMine` (filas Dexie del operador), `assignmentsInState.length`, `outboxCount`. Botones "Limpiar cache y reiniciar" / "Forzar sync ahora".
- `sam-app/src/lib/db.ts` v6 — al subir de v5 limpia `assignments`, `outbox` y `meta` (incluye `assignments_last_sync`) para forzar full sync.
- `sam-app/src/services/samApi.ts` — `appLogin` distingue red de credenciales.
- `sam-app/.githooks/pre-push` (vía `git config core.hooksPath .githooks`) — bloquea pushes con `tsc` o `vite build` roto. Por eso `sam-app/README.md` documenta `git config core.hooksPath .githooks` como setup obligatorio tras clonar.
- `sam-app/README.md` — documenta flow completo: push → Vercel → SW polling → UpdateBanner → reload, con tiempos esperados.

**Cómo verificar que sigue intacto en futuras sesiones**

Antes de tocar cualquier cosa relacionada con auto-update, versión visible o login, hacer:

```bash
ls sam-app/src/components/{UpdateBanner,DiagnosticModal}.tsx
grep -E '__APP_VERSION__|__APP_BUILD_TIME__|skipWaiting|clientsClaim' sam-app/vite.config.ts
grep -E 'useRegisterSW|virtual:pwa-register' sam-app/src/components/UpdateBanner.tsx
```

Si esto NO devuelve resultados, el contrato se rompió y hay que restaurarlo desde `git log` (commits `0dae1f0`, `def017c`, `90019ce`, `0d21a96`, `9b7764c`).

**Convención de versión en este proyecto**

- Variable inyectada por Vite: `__APP_VERSION__` (string, ej. `"aea3532"`) + `__APP_BUILD_TIME__` (ISO).
- En Vercel: `VERCEL_GIT_COMMIT_SHA.slice(0,7)`.
- En local: `git rev-parse --short HEAD`.
- NO usar `__BUILD_VERSION__` ni otro nombre — es el contrato existente con el README y los componentes.

**Auto-deploy Vercel — confirmado al 19-may**

- Repo: `juancarloszuluagaranzon-afk/sam` rama `main`.
- Vercel Root Directory: `sam-app`.
- Env vars en Vercel: `VITE_SUPABASE_URL=https://supabase.surcoapp.tech` y `VITE_SUPABASE_ANON_KEY=<la del VPS>`.
- **Confirmado funcionando** el 19-may-2026: push de `8dc2535` (cambio de agrupación por fecha de ejecución) → Vercel lo construyó automáticamente sin intervención manual. El pre-push hook (`tsc -b && npm run build`) corrió primero localmente y pasó. Los clientes con app abierta recibieron `UpdateBanner` dentro de los siguientes ~2 min.
- **Acceso al panel Vercel:** el usuario NO tiene acceso al panel (no es el dueño del proyecto). NO puede editar env vars ni provocar redeploys manuales. SÍ puede pushear código a `main` (que dispara el auto-deploy). Esto limita la rotación de claves Supabase — ver `project_pending_key_rotation.md`.

**Cómo aplicar**

- Antes de proponer "vamos a implementar X de la garantía de deploy": chequear con `ls`/`grep` si X ya está. Probablemente sí.
- Cuando el usuario reporta "no veo el cambio": pedir el SHA que muestra Diagnóstico, compararlo con `git log -1 origin/main`. Si difieren, esperar a que Vercel termine o pedir Ctrl+Shift+R.
- Si toca código del SW (`vite.config.ts` workbox, `UpdateBanner.tsx`): probar end-to-end. Romper esto afecta a 30-50 dispositivos.
