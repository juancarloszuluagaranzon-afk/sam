---
name: Cronología migración y incidentes (mayo 2026)
description: Línea de tiempo de la migración Cloud→VPS y los incidentes del mes que explican por qué existen los blindajes actuales
type: project
originSessionId: 1ce18956-632a-4426-8216-5dffcc058ca5
---

## 9-may-2026 — Migración Cloud → VPS Hostinger

Todo movido en una sola pasada. Quedaron pendientes algunas funciones que se completaron días siguientes (entre ellas, activación de Realtime).

## 13-14-may-2026 — Hardening operacional

- Backups automáticos diarios a las 03:00 con 14 días de retención.
- UptimeRobot monitoreando cada 5 min con alertas por correo.
- Documentación operacional.
- **Bug crítico encontrado y resuelto:** Supabase Realtime no estaba activado en el VPS → operador no veía las labores recién asignadas por el supervisor.

## 14-may-2026 — Demo con caché viejo (caso Acevedo)

Durante demostración en vivo, el operador Acevedo no veía sus labores. Causa: cache local desactualizado por bundles viejos. Resultado: se implementaron 3 capas de protección (limpieza automática al login, sello de versión visible, banner si servidor no responde).

## 15-may-2026 — VPS bloqueado por su propio firewall

Una regla nueva del firewall del VPS cerró todos los puertos excepto el de n8n. Nadie podía loguearse durante un rato. El servidor estaba vivo todo el tiempo; solo no aceptaba conexiones. Diagnóstico exacto: regla específica que bloqueaba todo menos n8n. Corregida.

## 19-may-2026 — Limpieza de asignaciones previas al 16-may + cambio de regla de agrupación

1. **DELETE en VPS:** 247 → 76 filas en `public.asignaciones` (171 borradas con fechas < 16-may, conservando 2 frontera: Edier Cortes/REENCALLE 300 ha y Ortiz Manuel/TRIPLE 5.94 ha, ambas creadas el 14-15 may y terminadas el 16-may). Backup externo `/root/asignaciones_backup_20260519_1955.sql` (226 KB) + pg_dump previo. Transacción `BEGIN/COMMIT` con `ON_ERROR_STOP`. Distribución final: 23 ASIGNADA (2 CANCELADA + 13 COMPLETADA + 8 PENDIENTE) + 53 LIBRE (37 COMPLETADA + 4 EN_PROCESO + 12 PENDIENTE).

2. **Propagación a clientes:** descubrimos que el **delta sync de `loadAssignments` NO detecta DELETES** ([samApi.ts:298-324](sam/sam-app/src/services/samApi.ts#L298-L324)) — solo trae filas con `updated_at` o `created_at` recientes. Las filas borradas siguen en Dexie hasta un sync completo. Workaround: Diagnóstico → "Forzar sync ahora" (borra `assignments_last_sync` y fuerza el path full en [samApi.ts:326-368](sam/sam-app/src/services/samApi.ts#L326-L368)) o "Limpiar cache y reiniciar" (`db.delete()`). El usuario confirmó tras "Forzar sync": dashboard "1ra quincena" bajó de 1784.64 ha → 305.94 ha (solo las 2 frontera quedaron porque su `dateKey` = `created_at` aún caía en 1-15).

3. **Cambio de regla de agrupación (commit `8dc2535`):** El cliente pidió que la agrupación por quincena use **fecha de ejecución**, no de asignación. Implementado helper `executionDateKey(a)` en [samApi.ts](sam/sam-app/src/services/samApi.ts) que retorna `dayKey(fecha_fin)` para COMPLETADA, `dayKey(fecha_inicio)` para EN_PROCESO, `dateKey` (creación) para PENDIENTE/CANCELADA. Aplicado en 3 filtros: SupervisorView Resumen PRIMERA/SEGUNDA, OperatorView Historial Q1/Q2, EntityHistoryModal. NO aplicado (intencional, decisión conservadora): Tablero mes, Reporte desde/hasta, Labores tab default. Display "Programada en X" y reportes Excel siguen mostrando `dateKey` (creación). Resultado: las 2 frontera ahora caen en 2da quincena (cuándo se ejecutaron), 1ra quincena queda en 0.

## 21-may-2026 — Reporte de Labores expandido + KPIs + pull-to-refresh

1. **Reporte expandido (commit `aacbda1`):** El cliente pidió alinear el Reporte con el Resumen: filtro por fecha de ejecución (no asignación), selector de período (Hoy / 1ra quincena / 2da quincena / Mes actual / Personalizado), columnas nuevas Cliente (`a.cliente` → 'Ingenio'/'Proveedor'/'—') e Ingenio (lookup en maestro vía `getAssignmentIngenioId` + `getIngenioName`), filtro adicional por Ingenio. Excel trae columnas "Fecha (ejecución)" + "Fecha asignación" separadas y nueva columna Ingenio. Reutiliza `executionDateKey` y `matchesSummaryFilter` que ya existían. Archivos: [sam-app/src/services/samApi.ts](sam/sam-app/src/services/samApi.ts) (nuevo `getAssignmentIngenioId`), [sam-app/src/App.tsx](sam/sam-app/src/App.tsx) (estado + filtro + Excel), [sam-app/src/views/SupervisorView.tsx](sam/sam-app/src/views/SupervisorView.tsx) (UI + interface).

2. **Pull-to-refresh global (commit `fb98c52`):** Cuando el usuario arrastra hacia abajo desde el tope de la pantalla, se ejecuta la misma acción que el botón "Forzar sync ahora" del DiagnosticModal. Diseño: nuevo método `forceSync(): Promise<number>` en `AppDataContext` (`db.meta.delete('assignments_last_sync')` + `loadAssignments()` + `setAssignments` + `setSyncError`). Nuevo componente [PullToRefresh.tsx](sam/sam-app/src/components/PullToRefresh.tsx) que escucha touch events del `window`, muestra banner verde con 3 estados ("Desliza hacia abajo" / "Suelta para sincronizar" / "Sincronizando…"), trigger 75px, cap visual 140px, damping 0.5. Ignora gestos que empiecen dentro de modales/sheets para no chocar con scroll interno. Solo escucha touch (desktop usa F5/Ctrl+R). Montado en `App.tsx` junto al `<UpdateBanner />` dentro de `<AppDataProvider>`.

3. **KPIs segmentados en Reporte (commit `12a76d9`):** Reemplazó la barra delgada (`.report-summary-bar`) por una franja con 4 KPIs estilo "Hoy" (`.day-status-bar--large`): Ha planif. / Ha ejecut. / Cumplimiento (con semáforo: verde ≥70%, amber ≥30%, rojo <30%) / En proceso. Cálculo inline en `SupervisorView.tsx` Reporte sección, replica la fórmula de `summarizeAssignments` (excluye CANCELADA del planificado, usa `executedArea` con fallback a `area` para COMPLETADA). Header dinámico: "Hoy · N registros" / "1ra quincena · …" / etc. Los KPIs cambian instantáneamente al cambiar Período / Estado / Ingenio / Hacienda / Operador.

4. **Vista "Por máquina" en Reporte (commit `2bf10ee`):** Selector "Vista" junto a "Período" con dos opciones: "Por labor" (vista plana existente) y "Por máquina" (nuevo). El modo máquina agrupa `filteredReport` por `equipmentCode` y renderiza un bloque por equipo con header verde (`#1a6b3a`) que muestra nombre + totales (horas trabajadas, ha planif., ha ejec., # labores), y sub-tabla con columnas adicionales **Hor. Ini / Hor. Fin / Horas** además de las del modo labor. Horas = `horometroFinal - horometroInicial` si ambos están presentes y final > inicial, else "—". Reutiliza todos los filtros existentes (Período / Estado / Ingenio / Hacienda / Operador) y los mismos KPIs segmentados de arriba. `reportFilters` ganó `view: 'labor' | 'maquina'`.

6. **Reload del navegador = full sync (commit `78bb04a`, 22-may-2026):** Si la página se carga vía reload (F5 / Ctrl+R / botón circular del navegador), `hydrate()` borra `db.meta.'assignments_last_sync'` ANTES de la fase 2, lo que fuerza el path full-sync en `loadAssignments` (clear + bulkPut con todas las filas del servidor). Sin esto, el delta sync no detectaba DELETES y el usuario veía cache stale tras reload. Detección vía Performance API (`navigation entry type === 'reload'`). Para navegación normal (click en link, primera carga) sigue el path delta — solo el reload explícito dispara full sync. Pull-to-refresh y el botón Diagnóstico → "Forzar sync ahora" siguen siendo los otros 2 caminos para lo mismo.

5. **Filtros del Reporte con búsqueda (commit `12ccda1`):** Los 4 filtros tipo lista (Estado, Ingenio, Hacienda, Operador) cambiaron de `<select>` nativo a `SearchableSelect` (componente ya existía en el proyecto, lo usaba LoginView). Usuario puede escribir para filtrar las opciones. Sentinels uniformizados: `''` significa "todos" (antes era mezcla de 'TODAS', 'TODOS' y ''). Checks en `filteredReport` pasaron de `!== 'TODAS'` a truthy check. Período y Vista siguen como `<select>` (toggles de 2-5 opciones sin semántica "todos"). Para Operador se usa `rightLabel: op.id` para mostrar el código U001/U005/etc. al lado del nombre.

## Aprendizajes acumulados (no listar como evento)

- 19-may: mi local estaba 32 commits atrás de origin/main al iniciar la sesión; no hice `git fetch` y "re-implementé" features (Diagnóstico, UpdateBanner, version stamp, SW skipWaiting) que ya existían en commits previos (`0dae1f0`, `def017c`, `90019ce`, `9b7764c`, etc.). Stash + rebase a `aea3532`, descartado.
- 19-may: configurado `.claude/check-sam-sync.sh` + `.claude/settings.json` con hook SessionStart que hace `git fetch` automático y reporta `behind/ahead/dirty` al inicio de cada sesión. Auto-pullea si está limpio.
- 19-may: keys filtradas (`ANON_KEY`, `SERVICE_ROLE_KEY`, `POSTGRES_PASSWORD`) no se rotaron — el usuario no tiene acceso al panel Vercel para coordinar la rotación del lado cliente. Decisión consciente, ver `project_pending_key_rotation.md`.

**Why:** El usuario quiso que esta cronología quedara grabada para socios y para no olvidar las causas raíz de los blindajes.

**How to apply:**

- Cuando aparezca un síntoma similar a alguno de estos incidentes, recordar la causa raíz antes de hipotetizar de cero.
- Si se hace una limpieza/migración nueva: añadir un bloque acá con fecha, qué se hizo, archivo de backup generado, y conteos antes/después.
- Cuando se agreguen nuevos eventos: usar `## YYYY-MM-DD — título` como heading, y dentro listas numeradas si hay varios items del mismo día. Mantener orden cronológico ascendente (más antiguo arriba).
