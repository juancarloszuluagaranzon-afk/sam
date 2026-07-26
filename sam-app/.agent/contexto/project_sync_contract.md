---
name: Contrato de sincronización entre dispositivos (datos y código)
description: 7 capas vivas que garantizan que todos los dispositivos vean la misma información y corran la misma build. Ya implementado en main; aquí está el mapa y cómo verificarlo.
type: project
originSessionId: 1ce18956-632a-4426-8216-5dffcc058ca5
---
**Garantía operativa pedida por el usuario:** "todos los dispositivos siempre ven la misma información y corren la misma versión".

Esto ya está implementado en `main` (verificado al 19-may-2026, commit `aea3532`) en 7 capas concurrentes. Ninguna por sí sola es suficiente; juntas son redundantes y se cubren entre sí.

**Datos (filas de `asignaciones`)**

1. **Realtime WebSocket** — `supabase.channel('asignaciones-changes')` con `postgres_changes` `event: '*'`, debounce 500ms. Empuja a todos al instante. Archivo: `sam-app/src/hooks/useSync.ts` líneas ~106-133.
2. **Poll silencioso 30s** — mientras `document.visibilityState === 'visible' && navigator.onLine`. Delta sync (solo filas que cambiaron desde `lastSync - 10s buffer`). Líneas ~141-148.
3. **`visibilitychange`** — al volver al foco, recarga assignments. Líneas ~96-104.
4. **`online` recovery** — al volver de offline: `syncOutbox` + `loadMaestro` + (vía visibilitychange) loadAssignments. Líneas ~86-92.
5. **Login full sync** — Dexie v6 limpia `assignments`/`outbox`/`meta` al subir desde v5; el hook `db.delete()`+`reload` en DiagnosticModal hace lo mismo manualmente.

**Código (build)**

6. **SW `skipWaiting + clientsClaim`** — `sam-app/vite.config.ts` líneas 106-107. SW nuevo toma control inmediatamente.
7. **`UpdateBanner` polling 2min + auto-fallback 15s** — `sam-app/src/components/UpdateBanner.tsx`. Polling vía `registration.update()` + `visibilitychange`.

**Detección de fallos**

- Banner `syncError` cuando un fetch falla: la UI cae a cache pero **avisa**.
- Pantalla de Diagnóstico (icono pill de versión): muestra ping al backend con latencia, conexión, último sync, cache tuyas/totales, outbox pendiente.

**Gotcha conocido — delta sync no propaga DELETES (descubierto 19-may-2026)**

`loadAssignments` con cache existente hace delta sync ([samApi.ts:298-324](sam/sam-app/src/services/samApi.ts#L298-L324)): solo trae filas con `updated_at` o `created_at` recientes. Si en el servidor se borran filas (DELETE), **el cache local no las pierde nunca** vía sync normal — la consulta delta no devuelve "fila X eliminada", simplemente no la incluye, pero la fila ya está en Dexie y se conserva.

Capa Realtime tampoco resuelve solo: el callback de `postgres_changes` event=DELETE dispara `loadAssignments()`, que es delta → tampoco ve la diferencia.

Soluciones que SÍ propagan deletes:
1. **Diagnóstico → "Forzar sync ahora"**: hace `db.meta.delete('assignments_last_sync')` antes de `loadAssignments` → fuerza path full ([samApi.ts:326-368](sam/sam-app/src/services/samApi.ts#L326-L368)) → `db.assignments.clear()` + `bulkPut(servidor)`.
2. **Diagnóstico → "Limpiar cache y reiniciar"**: `db.delete()` + `window.location.reload()`. Más agresivo.
3. **Logout + login**: la sesión nueva limpia Dexie en `handleLogin` (App.tsx — `db.assignments.clear()` + `db.outbox.clear()`).
4. **Reload manual** después de que Dexie suba a v7+ con upgrade que clear assignments.

Mejora pendiente de codear (no hecha en sesión 19-may, baja prioridad): en `useSync.ts` realtime callback, distinguir `payload.eventType === 'DELETE'` y hacer `db.assignments.delete(payload.old.id)` para que los DELETES se propaguen sin necesidad de full sync.

**REQUISITO postgres (sin esto la capa 1 está muerta)**

- `asignaciones` debe estar en la publication `supabase_realtime`.
- `asignaciones` debe tener `REPLICA IDENTITY FULL`.

Verificar:

```sql
SELECT * FROM pg_publication_tables WHERE pubname = 'supabase_realtime';
SELECT relname, relreplident FROM pg_class WHERE relname = 'asignaciones';
```

Setear (idempotente):

```sql
ALTER PUBLICATION supabase_realtime ADD TABLE public.asignaciones;
ALTER TABLE public.asignaciones REPLICA IDENTITY FULL;
```

Documentado como regla dura en `sam-app/README.md` "Reglas duras (han causado bugs si se rompen)" punto 2.

**Why:** El usuario quiso garantía de consistencia entre +50 dispositivos. La arquitectura ya la da, pero es invisible si no se mapea. Sin este memo, en una próxima sesión podría proponer "implementar realtime" cuando ya está, o tocar las 7 capas pensando que falta una.

**How to apply**

- Cuando el usuario reporte "no veo los mismos datos en mi celular que en el de otro": preguntar (1) qué SHA muestra cada uno en Diagnóstico, (2) qué dice el ping backend, (3) última sync. Con esos 3 datos se identifica en qué capa falló.
- Cuando el usuario pida "garantízame que todos vean lo mismo": no implementar; señalar este mapa y verificar la publication/replica identity.
- Si alguna capa desaparece del código en una próxima sesión, restaurarla con `git log` (commits `ae3c361 Realtime`, `089fb8f poll 30s`, `117ee23 poll silencioso`, `7a12df0 buffer delta sync`).
- Nunca quitar `skipWaiting`/`clientsClaim` ni el polling de 2 min — son contratos.
