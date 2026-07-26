---
name: project-reglas-asignaciones
description: "Reglas de negocio decididas para Activas/dashboards/usuarios (jun-2026) — 72h, no-duplicar, quincena actual, activar/desactivar"
metadata: 
  node_type: memory
  type: project
  originSessionId: 28aa41c3-1db2-4e9f-bbd1-5f104a70108e
---

Decisiones de negocio del usuario (24-jun-2026), ya implementadas y en producción. Detalle técnico en los skills [[reference-repo-layout]] (`managing-assignments`, `managing-supabase`).

- **Activas se vencen a las 72h:** una labor PENDIENTE/PARCIAL creada hace +72h sale de la vista Activas del operario (excepto EN_PROCESO). NO se cierra ni cancela — sigue PENDIENTE en la base.
- **NUNCA duplicar programadas (regla férrea):** si una suerte+labor quedó PENDIENTE (incl. vencida a 72h) y se vuelve a tomar en campo o a reasignar (mismo u otro operario), se **reutiliza la línea original** (cambia operario/fecha), no se crea otra. Reasignar 10 veces = 1 línea. **Excepción consciente:** una COMPLETADA real (sí se trabajó) sí genera línea nueva = re-laboreo (preserva histórico). El status separa los casos.
- **Activas ordenadas siempre de más reciente a más antigua.**
- **Dashboards/KPIs abren en la QUINCENA ACTUAL** (1–15 = primera, 16–fin = segunda), no "todo el mes". Aplica a Resumen, Reporte, Realizadas, Planilla **y el Historial del operario**. NO a Validación (cola de aprobaciones). Sigue siendo cambiable manualmente.
- **Historial del operario: SIN persistencia.** Se eliminó (24-jun) el localStorage que recordaba mes+período y el auto-salto al mes con datos. Siempre abre en mes actual + quincena en curso. La franja "Hoy" de la pestaña Labores (supervisor) NO se tocó: sigue mostrando el día.
- **Activar/desactivar usuarios** habilitado (chip Inactivo + botón). El id de usuario nuevo lo genera el servidor (no colisiona). **Los inactivos no llegaban al cliente por RLS** (policy de SELECT filtraba activo=true) → se agregó policy permisiva; recordar: fila visible en Studio pero no en el cliente anon = sospechar la policy de SELECT, no el frontend ni la caché. Ver [[project-user-db-autonomy]].

Relacionado con el contrato de sync ([[project-sync-contract]]): `loadAssignments` ahora carga SIEMPRE todas las abiertas (no se pierden por el cap de ~1000 filas de PostgREST).

## Ciclo de vida / retención (8-jul-2026, commit `92f97be`)
Reclamo recurrente del usuario: se acumula **basura** de estados intermedios (pendientes/liberadas/programadas huérfanas y sobre todo **EN_PROCESO "Laborando" que nunca cierran**) que confunde a la operación y NO suma para cobro. **Prioridad absoluta = lo CERRADO (COMPLETADA + PARCIAL)**, que es la verdad permanente del pago. Lo demás es temporal y el sistema lo depura solo.
- **Reporte abre por defecto en filtro "Cerradas" (PARCIAL + COMPLETADA)** — nuevo valor `estado='CERRADAS'` en `reportFilters` (App.tsx) que filtra `status in (PARCIAL,COMPLETADA)`; selector en SupervisorView con Cerradas/Completada/Parcial/Pendiente/En proceso/Cancelada. "Todos" = `''`.
- **Retención automática** (func `sam_run_retention`, mig. `20260708130000`): Nivel 1 cancela PENDIENTE **y EN_PROCESO** con `area_realizada=0` y +3 días → CANCELADA; Nivel 2 borra CANCELADA con `area_realizada=0` y +3 días. **Umbrales elegidos por el usuario: cancelar 3d, purgar 3d.** Guarda clave: `area_realizada=0` protege PARCIAL/COMPLETADA y EN_PROCESO reabierta con avance real (NUNCA se pierde cobro). La dispara owner/admin 1×/día desde el cliente (throttle localStorage `sam-retention-last` en AppDataContext) + opcional pg_cron. La primera corrida purga la basura vieja (canceladas de mayo, etc.).
## "Labores a facturar" = aprobación solo de lo CERRADO (11-jul-2026, commit `f47d85d`)
La pestaña/nav **"Aprobar" se renombró a "A facturar"** (heading "Labores a facturar"). Regla del usuario: **solo PARCIAL o COMPLETADA entran a la bandeja de aprobación** ("una vez se complete un parcial o el 100%"). La cola `pendingApprovals` ya filtraba a `approval='PENDIENTE' && status in (PARCIAL,COMPLETADA)`; el bug de raíz era que **la toma en campo (`useFreeFieldForm`) nacía con `approval='PENDIENTE'`** → labores no cerradas cargaban el sello "por aprobar". Fix: la toma en campo ahora nace **`approval='APROBADA'`** (6 sitios); el estado "pendiente de aprobación" lo dispara **solo** el cierre (`finishAssignment`) o el editar-estado→Terminada/Parcial. Regla única: solo lo cerrado es "labor a facturar". El registro rápido sigue naciendo COMPLETADA+APROBADA (auto, lo crea el supervisor).

## RECHAZAR = sacar de toda parte + auditoría (14-jul-2026, commit `7d23507`)
Deseo del cliente: al **rechazar** una labor en "A facturar", debe **desaparecer de toda parte operativa y NUNCA contar como área realizada**, pero **quedar como auditoría** (que existió y fue rechazada). Antes el rechazo solo ponía `aprobacion=RECHAZADA` y dejaba la labor **COMPLETADA con su área** → seguía sumando en historial/reportes/rendimiento (bug: LA SUIZA MERHEG 020 salía Completada 52.87 aunque rechazada). Fix: `decideApproval` con RECHAZADA ahora **también pone `status='CANCELADA'`** → excluida de todos los conteos que ya filtran CANCELADA (summarize, planilla, reportes, facturación, KPIs historial, rendimiento). Se conserva la fila con `approval=RECHAZADA`; `getStatusMeta` (OperatorView+SupervisorView) la muestra **"Rechazada"** (no "Cancelada") = auditoría. También: `rendimiento` topa a COMPLETADA/PARCIAL, y el **Excel** ('Área Ejec.') solo pone área en COMPLETADA/PARCIAL (else vacío). **Datos viejos:** las rechazadas previas siguen COMPLETADA → normalizar una vez con `update asignaciones set estado='CANCELADA' where aprobacion='RECHAZADA' and estado in ('COMPLETADA','PARCIAL')`. La retención NO las purga (area>0) → quedan como auditoría. Regla viva [[feedback-test-programadas-campo]].

## 🔴 Incidente de reputación 15-jul-2026 — "parece ejecutada estando pendiente"
El dueño llamó molesto y el usuario sentía en riesgo su reputación ("el cliente está desconfiando de nuestro profesionalismo"). **Dos cosas distintas**, ambas resueltas:
1. **Display (commit `a24bbaf`):** la tarjeta mostraba el área PLANIFICADA como ejecutada en labores PENDIENTE (`7.49 / 7.49`) → el cliente creía que estaba hecha. Fix: helper `areaEjecutadaVisible` (una NO cerrada muestra **0.00**). **Verificado con agentes: nunca se pagó de más** — los 6 puntos de KPI/pago ya filtraban COMPLETADA/PARCIAL.
2. **Dato anómalo `PENDIENTE + area_realizada>0` (commit `74ad052`):** lo causaba editar "Hectáreas ejecutadas" desde el **historial de entidad** (`AssignmentDetailModal`) que manda área sin estado. Fix: guarda de coherencia en `editAssignment` (área>0 ⇒ no puede quedar PENDIENTE → PARCIAL/COMPLETADA).

**Lección cara:** al normalizar las 7 filas usé `fecha_fin = coalesce(fecha_fin, now())` → las metí en la quincena actual siendo de **junio**; el cliente lo notó. **NUNCA usar `now()` al normalizar fechas**: usar `coalesce(fecha_inicio, created_at)` (un UPDATE de estado no toca esas columnas → la fecha original siempre se recupera sin backup). **La auditoría solo tiene lo posterior a su instalación** — no promete trazabilidad retroactiva.

## Permisos por rol (15-jul-2026, commit `d73890f`)
- **36 h para decidir:** el supervisor tiene 36 h desde el CIERRE de la labor; pasado el plazo solo **administración y dueño** deciden — **Aprobar Y Rechazar** quedan disabled para el supervisor (chip "⏳ Vencida · solo administración"). Confirmado por el usuario el 17-jul ("tampoco debería" poder rechazar).
- **"+ Nueva suerte" solo administración/dueño** (toca el maestro): quitado a supervisores y operarios en los 3 sitios.
- **Eliminar en el Reporte: también supervisores** (antes solo owner/admin); Editar ya lo tenían.

- ⚠️ Pendiente investigar: **líneas EN_PROCESO duplicadas** (misma suerte+labor+fecha, ej. ARENAL 02A, BALLESTEROS 74F) — la retención barre las abandonadas pero puede haber un bug que las crea al abrir/tomar.
