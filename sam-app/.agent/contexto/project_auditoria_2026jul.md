---
name: project-auditoria-2026jul
description: "Auditoría integral de SAM (5-jul-2026, 6 agentes) — qué se corrigió, qué quedó diferido, y la postura de seguridad real (anon_key)"
metadata: 
  node_type: memory
  type: project
  originSessionId: 28aa41c3-1db2-4e9f-bbd1-5f104a70108e
---

Auditoría integral del aplicativo con **6 agentes** (5-jul-2026): correctitud, seguridad, integridad/migraciones, sync/offline, performance, calidad. Detalle técnico en los skills `managing-assignments` y `managing-supabase` (gotchas 2026-07-05) y en el informe (artifact de Claude).

## Ya CORREGIDO (código + migraciones)
- **Facturación:** doble-conteo del área en Resumen/dashboard (split de cruce-de-día y multi-operario) → dedup por suerte+labor. `finishAssignment` ya no trunca en re-tomas. `getSuerteProgress` no cierra cards ajenas. Aprobar no borra la zona.
- **Sync/offline (crítico):** el outbox ya NO pierde trabajo en silencio (recuenta+reintenta los `error`); DELETE reconciliado en Realtime (no más filas fantasma); anti-cap también en delta.
- **Roles:** `appLogin` ya mapea `supervisor_insumos` (un solo `mapRole`).
- **BD:** trigger de área filtra por `nombre_hacienda` (código de hacienda compartido); índices en `asignaciones`; auditoría registra DELETE; migración baseline de `asignaciones`. Ver [[project-reglas-asignaciones]].

## Agregado el 5-jul (aparte de la auditoría)
- **Facturación / Área facturada:** columna `asignaciones.factura_numero`; administración le asigna N° de factura a las labores realizadas desde el modal **Editar** (Reporte/Labores); KPI **"Área facturada"** destacado (número más grande + morado) junto a "Ha ejecut." en la franja Hoy/Reporte; `summarizeAssignments.billedArea`. Es el MVP del "módulo de facturación". Mig. `20260705150000`.
- **Novedad "Máquina varada" (MV)** en la Planilla (día no trabajado por daño de máquina). Sin migración.

## Diferido A PROPÓSITO (no producen datos malos)
- **Seguridad de raíz** = proyecto aparte. **Refactor `domain/`** (duplicación con deriva), memo del contexto, maestro→Map, virtualización, code-splitting = pase de performance/mantenibilidad. FKs → mejor script de huérfanos. Insumos offline = decisión de producto.

## ⚠️ Postura de SEGURIDAD real (documentada, el usuario la tiene como baja prioridad — ver [[feedback_security_low_priority]])
Con el `anon_key` (público en el bundle) **cualquiera** puede: leer los `pin_hash` (revertibles: md5 + sal fija + PIN de 4 dígitos), borrar cualquier tabla, y crear un usuario `owner`. Los **PIN semilla están en el repo**: `SOP01=1357`, `SOP02=2468`, `U032=1234` → si no se han cambiado, es login admin directo. Mitigación barata pendiente (del usuario): rotar esos 3 PINs + `REVOKE SELECT(pin_hash)`. La raíz es que se usa un `anon_key` compartido como si fuera autenticación, con el control de acceso solo en la UI.
