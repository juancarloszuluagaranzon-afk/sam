---
name: AgroMorales = SAM (mismo código, +50 usuarios, blindajes post-migración)
description: La app que los usuarios llaman "AgroMorales" es el codebase SAM; resumen de qué quedó blindado y qué riesgos quedan vivos
type: project
originSessionId: 1ce18956-632a-4426-8216-5dffcc058ca5
---
**Branding vs codebase**
- "AgroMorales" es la marca comercial visible en logos, splash y manifest.
- El código es `sam-app/` (React 19 + Vite 6 + Vite-PWA, `registerType: 'autoUpdate'`).
- Producción la usan **+50 usuarios** entre móvil (PWA instalada) y PC. Cada cambio impacta a todos al mismo tiempo.

**Capa de datos en cada celular (cache local Dexie)**
- IndexedDB `db.assignments` guarda copia de trabajo para operar offline.
- En cada `loadAssignments` exitoso: `db.assignments.clear()` + `bulkPut(...)` — la app sobreescribe el cache con lo que venga de Supabase.
- Si Supabase falla, la UI cae a este cache (fallback) y muestra el último snapshot. **Esto es lo que confunde a operadores cuando un cambio de servidor o un firewall mal puesto los deja sin conexión: ven datos viejos pero creen que es lo actual.**

**Blindajes post-incidentes (ya en producción)**
1. Limpieza automática de cache al iniciar sesión (mata bundles viejos).
2. Sello de versión visible en cada celular — el supervisor puede pedirle al operador que lo lea para saber qué build tiene instalada.
3. Pantalla de Diagnóstico dentro de la app: muestra estado de conexión, datos cacheados, y permite forzar resincronización o limpiar cache.
4. Banner de alerta si el servidor no responde.
5. Mensajes de error honestos: "no pudimos contactar al servidor" en vez de "credenciales inválidas" cuando el problema es de red.
6. Validación pre-deploy: si el código no compila, el sistema lo bloquea antes de llegar a producción.

**Sincronización entre dispositivos**
- Activa desde 13-may-2026 (Supabase Realtime habilitado en el VPS).
- Asignación creada en PC del supervisor llega al celular del operador en segundos sin recargar.

**Riesgos vivos**
- VPS único punto de falla (no hay servidor espejo). Si Hostinger cae, supervisores no asignan; operadores pueden seguir offline con cache.
- Recovery time ~horas si toca levantar otro VPS desde backup.
- Firewall sigue siendo administrable por una sola persona — error humano puede tumbar el sistema (caso 15-may-2026).
- Uptime depende de Hostinger + nuestra operación (sin SLA de proveedor cloud).

**Why:** Contexto operativo que el usuario explicó como "resumen para socios". No es derivable del código; refleja decisiones organizacionales y la realidad de campo.

**How to apply:**
- Antes de proponer cambios masivos (UI, schema, deploys), recordar que afectan a +50 usuarios en simultáneo.
- Cuando un usuario reporta "no veo los datos": revisar en orden — (1) ¿Supabase responde?, (2) ¿app apunta al VPS y no a Cloud?, (3) ¿cache local del dispositivo está actualizado? La Pantalla de Diagnóstico de la app suele dar la respuesta sin necesidad de logs.
- No proponer "back to Cloud" como solución rápida: la decisión organizacional es self-host. Solo mencionarlo si el usuario explícitamente pregunta por opciones de reducción de riesgo.
