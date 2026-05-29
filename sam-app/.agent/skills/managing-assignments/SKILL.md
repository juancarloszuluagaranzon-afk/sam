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
                      ↘  PARCIAL (sigue activa) → EN_PROCESO → COMPLETADA
                      ↘  CANCELADA
PENDIENTE / PARCIAL → CANCELADA
```

- Solo el **supervisor u owner** puede crear y cancelar asignaciones (cancelar también aplica a PARCIAL)
- Solo el **operador** puede iniciar (`EN_PROCESO`) y finalizar (→ `COMPLETADA` o `PARCIAL`)
- `COMPLETADA` y `CANCELADA` son inmutables desde la UI
- `PARCIAL` **sigue activa**: el operario original puede continuar al día siguiente, otro operario la puede tomar en campo, o el supervisor la puede reasignar desde el modal de detalle de Labores

## Estado PARCIAL — reglas operativas

Cuando un operario finaliza con `executedArea < area` planificada, el `finishAssignment` decide:
- `executedArea + ε >= area` → `COMPLETADA` (toggle "100%" o el área ingresada cubre el total)
- `executedArea < area` → `PARCIAL` (la labor sigue activa)

Migración SQL canónica: `supabase/migrations/20260527160000_status_parcial.sql` — extiende el CHECK constraint de `estado` para incluir `'PARCIAL'`. Aplicada en VPS via Studio SQL Editor (2026-05-27).

Filtros del operador (`operatorAssignments` en `OperatorView.tsx`):
- **Activas** = PENDIENTE + EN_PROCESO + **PARCIAL**
- **Historial** = COMPLETADA + CANCELADA (NO PARCIAL — sigue activa)

Al abrir una PARCIAL en el sheet de finalizar, un `useEffect` pre-llena `finishDraft.area` con el `executedArea` previo. Banner amarillo `.partial-progress-banner` muestra "Acumulado previo: X.XX ha de Y.YY ha".

## Métricas con PARCIAL

`summarizeAssignments` (samApi.ts) y todas las agregaciones por operador/equipo/labor del Resumen suman `executedArea` de **COMPLETADA + PARCIAL**. El área hecha cuenta aunque la labor siga abierta. `inProgress` sigue contando solo EN_PROCESO. `completed` (conteo) sigue contando solo COMPLETADA.

`executionDateKey` trata PARCIAL como COMPLETADA (agrupa por `finishedAt`).

`getRemainingArea` resta el `executedArea` de COMPLETADA + PARCIAL del área del maestro — evita oversubscribir trabajo si otro operario toma la PARCIAL.

## Reasignación de operario (supervisor)

Desde **Labores → click en la card → Editar**: aparece un `SearchableSelect` "Operador (reasignar)". Al cambiar:
- Se actualiza `operador_id` + `operador_nombre` en DB (mapeo en `samApi.updateAssignment`)
- El status NO cambia (PARCIAL sigue PARCIAL, PENDIENTE sigue PENDIENTE)
- El `executedArea` previo se preserva — el nuevo operario ve la labor con el banner de continuación
- Hint contextual en el form si reasigna una PARCIAL: "El nuevo operario verá esta labor como parcial con X.XX ha ya hechas."

`editAssignment` en `useAssignmentActions.ts` valida que el operario destino NO tenga ya una activa con el mismo `suerteCode + labor` antes de aceptar el cambio.

`UpdateAssignmentInput` (domain/sam.ts) acepta `operatorId` y `operatorName`.

## Validación de duplicados (suerte + labor + operario activos)

Tres puntos de chequeo:

1. **`useAssignmentForm.createAssignment`** (supervisor asigna): chequea contra operador 1 y operador 2 si está presente.
2. **`useFreeFieldForm.takeFreeField`** (operario toma en campo): chequea contra sí mismo.
3. **`useAssignmentActions.editAssignment`** (supervisor reasigna): chequea cuando `patch.operatorId` cambia.

"Activa" = PENDIENTE + EN_PROCESO + PARCIAL. COMPLETADA y CANCELADA no bloquean (se puede reprogramar la misma labor en otro ciclo).

**Permitido a propósito:** asignar la misma labor en la misma suerte a operarios distintos (el supervisor puede repartir trabajo entre dos operarios para acelerar).

## Filtro por `dateKey` en avance compartido

**CRÍTICO:** `getSuerteProgress` y el cálculo del cap en `finishAssignment` filtran por **`dateKey === assignment.dateKey`**. Sin este filtro, asignaciones COMPLETADAs históricas de ciclos pasados (ej: DESPEJE en marzo) sumarían al `executedTotal` del frente operativo actual (ej: DESPEJE en mayo) y romperían las cards: aparecerían como "X realizadas · Falta 0" o incluso con totales que exceden el área planificada.

Cada `dateKey` representa un **ciclo agrícola independiente**: dos asignaciones de la misma suerte+labor en fechas distintas son ciclos distintos y no comparten avance. Solo se "fusionan" las del mismo día de programación (caso de varios operarios divididos por el supervisor).

## Asignaciones "zombie" — filtrar de Activas si `remaining = 0`

Si la suerte se cierra por trabajo conjunto (otro operario aportó lo suficiente), las asignaciones del mismo ciclo del mismo operario con `executedArea` parcial pueden quedar **huérfanas en Activas** con un cap de 0 — el operario no puede agregar nada pero la card sigue ahí confundiendo.

`activeAssignments` aplica un segundo filter:
- Si `progress.remaining > 0` → muestra (aún hay trabajo)
- Si `remaining = 0` y status `EN_PROCESO` → muestra igual (operario está adentro, no se la quitamos a medio camino)
- Si `remaining = 0` y status PENDIENTE/PARCIAL → **oculta** (suerte cerrada, nada que hacer)

La asignación sigue en DB con su `executedArea` propio (no se borra ni modifica el status) — preserva atribución para métricas y reportes. El operario la ve en **Historial** con su aporte real.

## Avance compartido entre operarios (multi-operario en la misma suerte)

Cuando el supervisor asigna a OP-A y OP-B la misma labor + suerte, **ambos tienen su propia asignación en DB con `area` = área total de la suerte**. Comparten el trabajo en campo. Si OP-A reporta 5 ha de las 10 totales, OP-B debe ver al instante que ya solo le quedan 5 ha por hacer (no 10).

Helper en `OperatorView.tsx`:

```ts
getSuerteProgress(assignment, allAssignments) → {
  executedTotal,      // suma executedArea de todas las asignaciones COMPLETADA + PARCIAL de la misma suerte+labor (incluida la propia)
  sharedExecuted,     // executedTotal - ownExecuted (lo aportado por otros operarios)
  ownExecuted,        // assignment.executedArea
  remaining,          // max(0, assignment.area - executedTotal)
  hasProgress,        // executedTotal > 0
  hasSharedProgress,  // sharedExecuted > 0
}
```

Esto modifica:

- **Card en Activas**: si `hasProgress`, agrega inline `"X.XX realizadas · Falta Y.YY"` con la clase `.partial-inline` (ámbar). NO crea una tercera línea — va en la misma línea de la labor.
- **Status pill derivado**: si DB dice `PENDIENTE` pero `hasSharedProgress`, el badge se muestra como "Parcial". El status DB no cambia (sigue PENDIENTE hasta que el operario aporte).
- **Sheet de detalle**: el banner ámbar cambia título según el caso ("Continuando labor parcial" propio vs "Labor compartida con otro operario" ajeno). Mensaje explica cuánto hizo cada uno y cuánto falta.
- **Input pre-llenado** con `progress.remaining` (no solo el propio remaining).
- **finishAssignment cap**: el sessionMax = remaining global de la suerte (no solo el propio). Mensaje específico: *"Otro operario ya avanzó en esta suerte. Solo puedes registrar hasta X ha."*

## Semántica del input en el finish form (DELTA, no TOTAL)

El campo "Ha ejecutadas" cambia su significado según el contexto:

| Caso | El input representa | Al finalizar |
|---|---|---|
| PENDIENTE / EN_PROCESO sin shared progress | Total ejecutado de SU asignación | `executedArea = inputValue` |
| PARCIAL propia (continuando) | **Delta de esta sesión** | `executedArea = previousOwn + inputValue` |
| PENDIENTE con shared progress | Su aporte de esta sesión | `executedArea = inputValue` (primer aporte) |
| Toggle "100%" (cualquier caso) | n/a | `executedArea = ownExecuted + sessionMax` |

`sessionMax` = remaining global de la suerte. El input se pre-llena con `sessionMax` para que el operario solo confirme si hizo todo lo que faltaba.

Label cambia para PARCIAL/multi-op: *"Ha ejecutadas en esta sesión"*. Para PENDIENTE puro: *"Ha ejecutadas"*.

## Cierre por suerte completa (multi-operario)

`isFullyDone` en `finishAssignment` ahora considera 3 condiciones:

1. `isComplete` (toggle "100%" activado)
2. `executedArea propio + ε >= assignment.area` (su parte sola cubre el total — caso single-operario)
3. **`suerteExecutedOthers + executedArea propio + ε >= assignment.area`** (la suerte completa se cierra con el aporte conjunto)

Sin la condición 3, en multi-operario las dos asignaciones quedarían PARCIAL para siempre aunque la suerte esté operativamente terminada. Con la condición 3, el operario que aporta para cerrar la suerte queda COMPLETADA aunque su parte sea menor al área planificada individual.

## Historial del operario incluye PARCIAL

`historyAssignments` = `COMPLETADA + CANCELADA + PARCIAL`. La PARCIAL aparece en **Activas** (para continuarla) Y en **Historial** (para ver avance del mes). Es decisión consciente — el badge ámbar la diferencia visualmente.

KPIs del Historial:
- `ha planificadas` y `ha ejecutadas` suman `COMPLETADA + PARCIAL`
- `completadas` (count) cuenta solo `COMPLETADA`; el label muestra `(+N parciales)` si las hay
- `eficiencia` = ejecutadas / planificadas sobre el set ampliado

"Tu jornada" (pestaña Campo):
- `cerradas` excluye PARCIAL
- `ha ejecutadas` incluye PARCIAL

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

## Filtros del Tablero — mes, zona, ingenio

El tablero tiene tres filtros combinados que se aplican simultáneamente:

- **Mes** (`tableroMonth`): default = mes actual America/Bogota. Filtra `tableroAssignments` por `a.dateKey.startsWith(YYYY-MM)`.
- **Zona** (`tableroZone`): `TODAS / NORTE / SUR`. Filtra `tableroAssignments` por `a.zone`.
- **Ingenio** (`tableroIngenio`, agregado 2026-05-11): `TODOS / risaralda / pichichi / mayaguez / san_carlos / riopaila`. Filtra `programmedSuerteRows` (no `tableroAssignments`) por `row.ingenio_id === tableroIngenio`.

**Diseño:** los filtros mes/zona se aplican sobre `tableroAssignments`. El filtro de ingenio se aplica sobre `programmedSuerteRows` (las filas a renderizar). Como las celdas WORKFLOW se llenan con `tableroAssignments.find(... === suerteCode)`, filtrar las filas alcanza para que las celdas solo muestren labores de las suertes visibles. No hay inconsistencia.

**Estados viven en App.tsx** y se pasan como props a SupervisorView. La lista `INGENIOS` ya está hardcodeada arriba de SupervisorView.tsx — reutilizar, no duplicar.

## Etiquetas de estado en EntityHistoryModal y AssignmentDetailModal

En estos dos componentes específicos, `getStatusMeta(assignment)` usa **"Programada"** para `status === 'PENDIENTE'` (en lugar del "Pendiente" del resto de la app). Decisión textual del usuario (2026-05-11): "completada, parcial o programada" como los tres estados que quería ver en el modal histórico.

La regla "Parcial" (`COMPLETADA && executedArea > 0 && executedArea < area`) es idéntica a la de SupervisorView/OperatorView — solo cambia el label de PENDIENTE.

## Gotchas

- **[2026-05-29]** Bug visible reportado: SAN MIGUEL 020 mostraba "34.02 ha realizadas" cuando el área es 14.51. Causa: `getSuerteProgress` sumaba 2 VALENCIA COMPLETADAs históricas (14.51 c/u, ciclos viejos) + DOMÍNGUEZ PARCIAL (5.00). Fix permanente: filtrar por `dateKey === assignment.dateKey` en `getSuerteProgress` Y en el cálculo de `suerteExecutedOthers` en `finishAssignment`. NO eliminar este filtro.

- **[2026-05-29]** Las asignaciones "zombie" (PARCIAL del operario con `remaining = 0` por trabajo conjunto de otro operario) deben filtrarse de `activeAssignments` para no confundir al operario. EXCEPCIÓN: si la asignación está EN_PROCESO, dejarla aunque `remaining = 0` (operario está adentro). La asignación sigue en DB intacta — solo cambia el render. Aparece en Historial con su `executedArea` propio.

- **[2026-05-28]** El input del finish form cambió de "TOTAL acumulado" a "DELTA de la sesión". Si una asignación está PARCIAL con executedArea = 5 y el operario ingresa "3", `finishAssignment` calcula `5 + 3 = 8`, NO `executedArea = 3` (que sería reemplazo). Para asignaciones PENDIENTE/EN_PROCESO sin avance previo, el comportamiento es retrocompatible (el input es el aporte total). Si tocas finishAssignment, NO confundir `sessionDraftValue` con `executedArea_final`.

- **[2026-05-28]** En multi-operario, el `sessionMax` del finish form NO es el `area - executedArea` propio, sino el `remaining` global de la suerte (calculado por `getSuerteProgress`). Esto evita que dos operarios "se pasen" del área total de la suerte (cap de 10 ha aunque cada uno tenga `area = 10` en su DB row).

- **[2026-05-28]** `isFullyDone` en finishAssignment tiene 3 condiciones — no eliminar la condición 3 (`suerteExecutedOthers + executedArea + eps >= assignment.area`). Sin ella, en multi-operario las dos asignaciones quedan PARCIAL para siempre aunque la suerte se haya terminado por trabajo conjunto.

- **[2026-05-28]** El status DB sigue siendo PENDIENTE para una asignación de OP-B cuando OP-A ya finalizó parcial — el "Parcial" que ve OP-B es un **status derivado** calculado en el render del badge (`assignment.status === 'PENDIENTE' && progress.hasSharedProgress`). Si refactorizas getStatusMeta para aceptar `allAssignments`, mantén ambos caminos: el directo (legacy + PARCIAL) y el derivado (multi-operario).

- **[2026-05-28]** Realtime channel `asignaciones-changes` en `useSync.ts` propaga cualquier UPDATE de la tabla y dispara un re-sync con debounce. NO requiere config extra para multi-operario — el `getSuerteProgress` recalcula automáticamente porque depende de `assignments`. Pero verifica que la tabla esté en la publication: `SELECT * FROM pg_publication_tables WHERE pubname = 'supabase_realtime';`.

- **[2026-05-27]** Antes de agregar PARCIAL, el código usaba "Parcial" solo como **label visual** cuando `status === 'COMPLETADA' && executedArea < area`. Al migrar al status real PARCIAL, dejé el fallback legacy en `getStatusMeta` (4 archivos: `OperatorView`, `SupervisorView`, `AssignmentDetailModal`, `EntityHistoryModal`) para que asignaciones históricas cerradas con executed < area sigan mostrándose con label "Parcial". El nuevo `if (a.status === 'PARCIAL')` va PRIMERO, el legacy `if (a.status === 'COMPLETADA' && executedArea < area)` va después. NO eliminar el fallback hasta que se confirme que no quedan filas legacy en DB.

- **[2026-05-27]** Al extender `AssignmentStatus` con `'PARCIAL'`, hay que tocar **TODOS** los `status === 'COMPLETADA'` que cuentan area ejecutada y agregarles `|| status === 'PARCIAL'`. Lugares: `summarizeAssignments`, `summaryMetrics`, `summaryLabor/ByOperator/ByEquipment`, `getRemainingArea` (en 3 archivos: useAssignmentForm, useFreeFieldForm, OperatorView, SupervisorView), `executionDateKey`, EntityHistoryModal `executed`, los displays de `formatArea` en Reporte y Tablero. **NO incluir PARCIAL** en `historyAssignments` (sigue activa) ni en el conteo `completed` (eso cuenta cierres definitivos).

- **[2026-05-27]** El supervisor edita asignaciones desde un modal **propio** en `SupervisorView.tsx` (línea ~1928), NO el `AssignmentDetailModal` compartido. Si agregas un campo editable nuevo (como hice con `operatorId`), hay que tocar: (a) el state `editLaborDraft`, (b) el pre-llenado al entrar a editar, (c) la UI del form, (d) el handler `onClick` del botón "Guardar cambios" para incluir el campo en el patch.

- **[2026-05-27]** Validación de duplicados activos: `hasActiveDuplicate(assignments, suerteCode, labor, operatorId)` definida idénticamente en dos archivos (`useAssignmentForm.ts` y `useFreeFieldForm.ts`) + verificación inline en `editAssignment` (`useAssignmentActions.ts`). Decisión consciente de NO centralizar todavía — cada hook usa su propio scope y refactor de las 3 rutas a la vez tiene riesgo. Si cambias la regla (ej: incluir COMPLETADA), actualiza los tres lugares.

- **[2026-05-11]** Modales anidados: el `<div className="modal-overlay">` del modal interno es DOM-hijo del overlay del modal padre. Click en backdrop del interno burbujea al padre y dispara ambos `onClose` (cierran los dos modales). → En el onClick del overlay interno: `(e) => { e.stopPropagation(); onClose() }`. El `stopPropagation` en el `.modal-card` NO basta porque solo protege el content, no el backdrop.

- **[2026-05-11]** `getStatusMeta(assignment)` está duplicado en 4 archivos: `SupervisorView.tsx`, `OperatorView.tsx`, `EntityHistoryModal.tsx`, `AssignmentDetailModal.tsx`. Si cambia la regla de "Parcial" o se agrega un nuevo estado derivado, actualizar TODOS. Decisión consciente: no centralizar todavía — un refactor que toque las 4 vistas a la vez en producción tiene riesgo de regresiones sutiles. Verificar con `grep -rn "function getStatusMeta" src/` antes de declarar cerrado.

- **[2026-05-11]** Trampa de cascada CSS: una regla más nueva con la misma especificidad **sobreescribe el override de un media query previo**, porque el orden en el archivo gana al haber empate de especificidad. En `App.css` la regla mobile `@media (max-width: 900px) { .movement-row { flex-direction: column; align-items: stretch } }` (línea ~1424) quedó pisada por una nueva `.movement-row { align-items: center }` que el socio agregó después (línea ~2769) para el contenedor `.entity-history-list`. Síntoma: en mobile las cards del histórico se renderizaron centradas en lugar de stack o de 2 columnas. → Al agregar una regla con el mismo selector que ya tiene override en un media query, **subir la especificidad** del override (ej. `.entity-history-list .movement-row { ... }`) y ponerla AL FINAL del archivo, o duplicar el override dentro del media query con esa especificidad mayor.

- **[2026-04-10]** Reemplazos masivos en App.tsx con tool multi_replace fallan cuando el target tiene mixed CRLF/LF o caracteres JSX encoded (&&&, <>). → solución: Usar PowerShell -replace con Get-Content -Raw / Set-Content para reemplazos bulk seguros. Para eliminar líneas específicas, usar slicing de array: lines[0..N] + lines[M..end].

- **[2026-04-09]** `getSuggestedLabor` filtra solo labores que están en `WORKFLOW` usando `normalizeText` (trim + uppercase). Si una labor en DB tiene acento o diferente capitalización, no se cuenta como completada → revisar consistencia en datos
- **[2026-04-09]** El tablero (`supervisorTab === 'tablero'`) usa `programmedSuerteRows` que solo incluye suertes con `kind === 'ASIGNADA'` — las de campo libre (`LIBRE`) no aparecen en el tablero aunque estén completadas
- **[2026-04-09]** `operatorAssignments` hace matching por nombre además de ID porque filas históricas no tienen `operador_id` consistente — no eliminar ese fallback por nombre
- **[2026-04-09]** El `dateKey` se calcula en zona `America/Bogota`. Si el servidor guarda `created_at` en UTC, una asignación creada a las 11pm Colombia (3am UTC del día siguiente) puede aparecer en el día incorrecto si se calcula sin zona
- **[2026-04-09]** Los caracteres `Â·` en la UI son un bug de encoding (UTF-8 leído como Latin-1). El separador correcto es `·` (U+00B7). Verificar encoding del archivo antes de editar App.tsx
