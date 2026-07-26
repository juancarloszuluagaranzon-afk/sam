---
name: feedback-area-ejecutada-asignada
description: "Siempre mostrar el área como \"ejecutada / asignada\" separada por \"/\" en las tarjetas/listados de labores."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 77039424-1dea-4cbc-a68d-d8a552b6ccd0
---

En CUALQUIER tarjeta o listado de labores donde se muestre el área, mostrarla SIEMPRE como **`ejecutada / asignada`** separada por `/` (ej. `2.68 / 3.50 ha`), nunca solo el área ejecutada.

El área "asignada" = área neta de la suerte (del `maestro` por `haciendaCode + suerte`), con fallback a `assignment.area`.

## ⚠️ CORRECCIÓN CRÍTICA (14-jul-2026, commit `a24bbaf`) — usar SIEMPRE el helper
El "ejec" **NO** es `executedArea > 0 ? executedArea : area` a secas. Ese fallback aplicado sin filtrar por estado hacía que una **PENDIENTE/EN_PROCESO mostrara el planificado como ejecutado** (ej. `7.49 / 7.49` en una labor tomada en campo sin iniciar) → el cliente creía que estaba HECHA estando pendiente = **golpe de reputación grave**, reclamo recurrente. Ahora hay helper centralizado en `src/utils/suerteCycle.ts`:
```ts
areaEjecutadaVisible(a) = (status==='COMPLETADA'||status==='PARCIAL') ? (executedArea>0?executedArea:area) : (executedArea>0?executedArea:0)
```
Una labor NO cerrada muestra **0.00** ejecutado, nunca el planificado. Formato de tarjeta: `${formatArea(areaEjecutadaVisible(a))} / ${formatArea(m?.area ?? a.area)}`.

Aplicado en: tarjeta Labores (SupervisorView ~2857), "A facturar" (~2962), `EntityHistoryModal` (~215), export de `ValidationTab` (~344). **Toda vista nueva que muestre área ejecutada DEBE usar `areaEjecutadaVisible`.** Los KPI/pagos ya filtraban bien por estado (verificado con agentes); esto era solo el DISPLAY por tarjeta. Dato en BD siempre limpio: una PENDIENTE tiene `area_realizada=null` — verificar con `select … where estado in ('PENDIENTE','EN_PROCESO') and coalesce(area_realizada,0)>0` (debe dar 0 filas).

## Anomalía de DATO: PENDIENTE con area_realizada>0 (14-jul-2026, commit `74ad052`)
Además del display, se halló en BD **PENDIENTE con `area_realizada>0`** (contradictorio). Causa (trazada con agente): editar "Hectáreas ejecutadas" desde el **historial de entidad** (`AssignmentDetailModal.handleSave` → `editAssignment` → `updateAssignment`) manda `executedArea` **sin** `status`, y `updateAssignment` escribe columnas por separado → el estado se queda en PENDIENTE. (El editor de estado del Reporte SÍ es seguro: limpia executedArea al pasar a PENDIENTE.) EN_PROCESO+área>0 es LEGÍTIMO (reabrir una PARCIAL conserva el avance). **Fix central en `editAssignment`:** si el resultado tendría `executedArea>0 && status==='PENDIENTE'`, se promueve a COMPLETADA (si cubre el área) o PARCIAL + `finishedAt`. Data legacy se corrigió con `UPDATE ... set estado=CASE... WHERE estado='PENDIENTE' AND area_realizada>0`. Verificación: `select count(*) where estado='PENDIENTE' and coalesce(area_realizada,0)>0` debe dar 0. NO se pagó de más nunca (PENDIENTE no cuenta). Rastreable en "Ver historial" (editado_por = nombre del supervisor).

**Why:** facturación/gestión ve cuánto se hizo vs cuánto se asignó; PERO una pendiente NUNCA debe parecer ejecutada NI tener área. Reclamo de reputación grave del cliente.
**How to apply:** al renderizar área ejecutada usar `areaEjecutadaVisible`; cualquier escritura que ponga executedArea>0 debe dejar estado coherente (no PENDIENTE). Ver [[project_owner_admin_tools]] y [[project_facturacion_240_266]].
