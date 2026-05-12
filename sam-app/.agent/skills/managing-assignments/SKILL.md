---
name: managing-assignments
description: >
  Reglas de negocio del dominio de asignaciones agrícolas en SAM. Úsala cuando
  trabajes con estados de asignación, el flujo de labores WORKFLOW, lógica de
  operadores vs supervisores, cálculo de métricas, o cualquier cosa relacionada
  con "asignacion", "labor", "suerte", "hacienda", "operador", "equipo",
  "PENDIENTE", "EN_PROCESO", "COMPLETADA", "campo libre".
---

# Managing Assignments — SAM

## Ciclo de vida de una asignación

```
PENDIENTE → EN_PROCESO → COMPLETADA
                       ↘ CANCELADA
PENDIENTE → CANCELADA
```

- Solo el **supervisor u owner** puede crear y cancelar asignaciones
- Solo el **operador** puede iniciar (`EN_PROCESO`) y finalizar (`COMPLETADA`)
- Una asignación `COMPLETADA` o `CANCELADA` es inmutable desde la UI

## WORKFLOW — Secuencia de labores

El orden importa. Es la secuencia canónica para una suerte:

```ts
export const WORKFLOW = [
  'DESPEJE',
  'REPIQUE',
  'RENCALLE',
  'SUBSUELO',
  'TRIPLE',
  'FERTILIZACION',
  'ZANJAS',
]
```

`getSuggestedLabor` encuentra la primera labor del WORKFLOW que aún no está `COMPLETADA` en esa suerte. Úsala para pre-seleccionar la labor en el formulario.

## Tipos de registro (kind)

| kind | Creado por | Descripción |
|------|-----------|-------------|
| `'ASIGNADA'` | Supervisor u Owner | Asignación formal a un operador |
| `'LIBRE'` | Operador | El operador toma una suerte por iniciativa propia |

## Roles y acceso

```ts
type Role = 'owner' | 'supervisor' | 'operador'
```

- **owner / supervisor**: tabs `resumen`, `asignar`, `labores`, `equipos`, `tablero`
- **operador**: tabs `activas`, `campo`, `historial`

Los operadores solo ven sus propias asignaciones. El matching es triple para cubrir filas históricas:

```ts
assignmentOperatorId === sessionId ||
(assignmentOperatorId === '' && assignmentOperatorName === sessionName) ||
assignmentOperatorName === sessionName
```

## Haciendas y suertes (maestro)

- `haciendaCode` es numérico (ej: `103`, `105`, `108`, `126`)
- `suerte` es string con ceros a la izquierda (ej: `'0001'`, `'0002'`)
- `suerteCode` = `"${haciendaCode}-${suerte}"` (ej: `"103-0001"`)
- El área viene en hectáreas con 2 decimales

## Métricas del dashboard (`summarizeAssignments`)

Solo cuenta asignaciones del día actual (`dateKey === todayKey`) y excluye `CANCELADA`:

```ts
plannedArea   = suma de area de todas las no-canceladas de hoy
executedArea  = suma de executedArea de las COMPLETADAS de hoy
completion    = Math.round((executedArea / plannedArea) * 100)
inProgress    = count de EN_PROCESO de hoy
```

## Inicio de labor — validación de equipo

Al iniciar (`handleStartAssignment`), el equipo DEBE estar en el catálogo `equipment`. Si el operador no selecciona uno, se usa en cascada:
1. `startEquipmentDrafts[assignment.id]`
2. `assignment.equipmentCode`
3. `session.equipmentCode`

Si ninguno resuelve a un equipo válido → error, no iniciar.

## Finalización de labor

`executedArea` viene del draft del operador. Si no ingresó nada, default al `area` planificada:

```ts
const executedArea = Number(draft?.area ?? assignment.area)
```

## Modal de detalle de labor (AssignmentDetailModal)

Componente compartido en `src/components/AssignmentDetailModal.tsx`. Recibe `assignment: Assignment | null` y `onClose`. Renderiza secciones read-only, todas hide-if-empty:

- Header: hacienda + "Suerte N", status pill + kind badge (Programada / Campo libre)
- Labor
- Áreas (ejecutada, planificada, % cumplimiento, barra de progreso)
- Personas y equipo
- Tiempos (programada / creada / iniciada / finalizada)
- Horómetros (solo si hay valores)
- Contexto (zona, cliente — solo si hay)
- Aprobación (solo si APROBADA o RECHAZADA)
- Notas (solo si hay texto)

Actualmente lo abre `EntityHistoryModal` al hacer click en una fila `.movement-row--clickable` del listado del histórico. Se renderiza como **sibling** dentro del overlay del modal padre (no portal). Ver gotcha sobre bubbling.

Si exponés un campo nuevo en `Assignment` que un supervisor quiera ver, agregalo aquí — es el render path único para detalle desde el modal histórico.

## Filtro de búsqueda en secciones del Resumen

Pestaña Resumen tiene un `<input className="user-search-input" type="search">` arriba del grid de cards en las secciones **Por Operador** y **Por Equipo**. Estados independientes (`summaryOperatorSearch`, `summaryEquipmentSearch`). Memos `filteredOperators` / `filteredEquipment` filtran case-insensitive por `.name` DESPUÉS del agrupamiento — no recalcula métricas globales ni la sección "Por Labor".

Empty state contextual:
- Filtro vacío + sin datos → "Sin labores en el periodo seleccionado."
- Filtro con texto + 0 matches → "Sin coincidencias."

Reutilizable para cualquier sección con grid de cards que necesite filtro por nombre.

## Etiquetas de estado en EntityHistoryModal y AssignmentDetailModal

En estos dos componentes específicos, `getStatusMeta(assignment)` usa **"Programada"** para `status === 'PENDIENTE'` (en lugar del "Pendiente" del resto de la app). Decisión textual del usuario (2026-05-11): "completada, parcial o programada" como los tres estados que quería ver en el modal histórico.

La regla "Parcial" (`COMPLETADA && executedArea > 0 && executedArea < area`) es idéntica a la de SupervisorView/OperatorView — solo cambia el label de PENDIENTE.

## Gotchas

- **[2026-05-11]** Modales anidados: el `<div className="modal-overlay">` del modal interno es DOM-hijo del overlay del modal padre. Click en backdrop del interno burbujea al padre y dispara ambos `onClose` (cierran los dos modales). → En el onClick del overlay interno: `(e) => { e.stopPropagation(); onClose() }`. El `stopPropagation` en el `.modal-card` NO basta porque solo protege el content, no el backdrop.

- **[2026-05-11]** `getStatusMeta(assignment)` está duplicado en 4 archivos: `SupervisorView.tsx`, `OperatorView.tsx`, `EntityHistoryModal.tsx`, `AssignmentDetailModal.tsx`. Si cambia la regla de "Parcial" o se agrega un nuevo estado derivado, actualizar TODOS. Decisión consciente: no centralizar todavía — un refactor que toque las 4 vistas a la vez en producción tiene riesgo de regresiones sutiles. Verificar con `grep -rn "function getStatusMeta" src/` antes de declarar cerrado.

- **[2026-05-11]** Trampa de cascada CSS: una regla más nueva con la misma especificidad **sobreescribe el override de un media query previo**, porque el orden en el archivo gana al haber empate de especificidad. En `App.css` la regla mobile `@media (max-width: 900px) { .movement-row { flex-direction: column; align-items: stretch } }` (línea ~1424) quedó pisada por una nueva `.movement-row { align-items: center }` que el socio agregó después (línea ~2769) para el contenedor `.entity-history-list`. Síntoma: en mobile las cards del histórico se renderizaron centradas en lugar de stack o de 2 columnas. → Al agregar una regla con el mismo selector que ya tiene override en un media query, **subir la especificidad** del override (ej. `.entity-history-list .movement-row { ... }`) y ponerla AL FINAL del archivo, o duplicar el override dentro del media query con esa especificidad mayor.

- **[2026-04-10]** Reemplazos masivos en App.tsx con tool multi_replace fallan cuando el target tiene mixed CRLF/LF o caracteres JSX encoded (&&&, <>). → solución: Usar PowerShell -replace con Get-Content -Raw / Set-Content para reemplazos bulk seguros. Para eliminar líneas específicas, usar slicing de array: lines[0..N] + lines[M..end].

- **[2026-04-09]** `getSuggestedLabor` filtra solo labores que están en `WORKFLOW` usando `normalizeText` (trim + uppercase). Si una labor en DB tiene acento o diferente capitalización, no se cuenta como completada → revisar consistencia en datos
- **[2026-04-09]** El tablero (`supervisorTab === 'tablero'`) usa `programmedSuerteRows` que solo incluye suertes con `kind === 'ASIGNADA'` — las de campo libre (`LIBRE`) no aparecen en el tablero aunque estén completadas
- **[2026-04-09]** `operatorAssignments` hace matching por nombre además de ID porque filas históricas no tienen `operador_id` consistente — no eliminar ese fallback por nombre
- **[2026-04-09]** El `dateKey` se calcula en zona `America/Bogota`. Si el servidor guarda `created_at` en UTC, una asignación creada a las 11pm Colombia (3am UTC del día siguiente) puede aparecer en el día incorrecto si se calcula sin zona
- **[2026-04-09]** Los caracteres `Â·` en la UI son un bug de encoding (UTF-8 leído como Latin-1). El separador correcto es `·` (U+00B7). Verificar encoding del archivo antes de editar App.tsx
