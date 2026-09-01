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
- **Activas** = PENDIENTE + EN_PROCESO + **PARCIAL**, **excluyendo `liberada === true`** (ver "Liberar un parcial")
- **Historial** = COMPLETADA + CANCELADA + PARCIAL (la PARCIAL sigue activa pero el operario necesita ver su avance)

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

"Activa" = ~~PENDIENTE +~~ EN_PROCESO + PARCIAL. COMPLETADA y CANCELADA no bloquean. **[2026-06-24] PENDIENTE ya NO bloquea: se REUSA** (ver sección "Reutilizar la línea PENDIENTE original" abajo) — `hasActiveDuplicate` en `useFreeFieldForm`/`useAssignmentForm` ahora solo considera `EN_PROCESO`/`PARCIAL`.

**Permitido a propósito:** asignar la misma labor en la misma suerte a operarios distintos (el supervisor puede repartir trabajo entre dos operarios para acelerar — ver el par operador1/operador2).

## Reutilizar la línea PENDIENTE original — NO duplicar programadas [2026-06-24]

**Regla de negocio:** una suerte+labor **nunca** debe quedar programada dos/tres veces. Si una labor se **abrió y quedó PENDIENTE** (incluida una vencida por la regla de 72h — sigue PENDIENTE en la base, solo oculta de Activas), al **re-tomarla en campo** o **re-asignarla** (al mismo operario o a otro) se **reutiliza esa misma fila**, cambiando operario/equipo/supervisor/fecha — NO se crea otra línea. Reasignar la misma programación 10 veces en 10 meses → **1 sola línea**, no 10.

**COMPLETADA real es "otra situación":** una labor que SÍ se trabajó y cerró NO se reusa → crea línea nueva = re-laboreo (preserva el histórico del ciclo anterior). El STATUS separa los dos casos solo.

- Helper único: `findReusableAssignment(assignments, suerteCode, labor, excludeIds?)` en `src/utils/suerteCycle.ts` → línea `PENDIENTE && !startedAt && executedArea===0 && !liberada` (el `excludeIds` evita que el par-2 tome la misma que reusó el par-1).
- `useFreeFieldForm.takeFreeField` y `useAssignmentForm.createAssignment`: por cada suerte (y por cada operario del par) deciden **reuse-or-create**, online (`updateAssignment`) **y** offline (outbox `UPDATE`). Mensaje "N reutilizada(s) de la programación existente".
- **Al reutilizar se resetea `createdAt` a hoy** (vía `UpdateAssignmentInput.createdAt` → `payload.created_at`) → reinicia el reloj de 72h y la labor **reaparece en Activas** (no queda oculta). `dateKey` se recalcula de `created_at`.
- `UpdateAssignmentInput` ganó `createdAt`, `supervisorId`, `supervisorName` (la reasignación queda bajo el supervisor que la toma, para el scope correcto). `updateAssignment` mapea `created_at`/`supervisor_id`/`supervisor_nombre`.
- El botón manual `reuseExisting` (supervisor) sigue existiendo y ahora también resetea fecha + supervisor (consistente con el auto-reuse).

## Agrupación por CICLO en avance compartido (`isSameCycle`, ventana de días)

**CRÍTICO:** `getSuerteProgress`, el cap en `finishAssignment` (`suerteExecutedOthers`) y los 4 `getRemainingArea` agrupan el avance de la misma suerte+labor por **CICLO**, usando `isSameCycle(a.dateKey, b.dateKey)` de `src/utils/suerteCycle.ts` (ventana `CYCLE_WINDOW_DAYS = 21` días) — **NO** por `dateKey === dateKey` exacto.

**Por qué NO exacto:** el filtro exacto (`a.dateKey === assignment.dateKey`) rompía las **labores tomadas en campo (LIBRE)** trabajadas por varios operarios en **días distintos**. Cada operario crea su propia row con `dateKey = día de creación`; si Julio toma la suerte el lunes y Rolando el martes, sus `dateKey` difieren, no se ven entre sí, y la labor **nunca cierra** aunque entre ambos cubran el área total (caso real: LA ESPERANZA-04U, 18.86 ha = Julio 9.66 + Rolando 9.20, ambos atascados en PARCIAL).

**Por qué tampoco sin filtro:** sin ninguna separación, una COMPLETADA histórica de un ciclo viejo (ej: DESPEJE en marzo) sumaría al frente operativo actual (DESPEJE en mayo) → "X realizadas · Falta 0" o totales que exceden el área (bug SAN MIGUEL 020).

**La ventana resuelve ambos:** una colaboración real entre operarios ocurre en días (≤ 21) → mismo ciclo, su avance se suma. Un re-laboreo meses después queda fuera de la ventana → ciclo distinto, no comparte avance. Para los `getRemainingArea` (que no tienen una asignación "ancla") la ventana se mide contra `todayKey` — por eso ahora reciben `todayKey` como último parámetro.

Si necesitas ajustar la tolerancia, cambia **solo** `CYCLE_WINDOW_DAYS` en `src/utils/suerteCycle.ts` (fuente única). No vuelvas a `dateKey === dateKey`.

## Asignaciones "zombie" — filtrar de Activas si `remaining = 0`

Si la suerte se cierra por trabajo conjunto (otro operario aportó lo suficiente), las asignaciones del mismo ciclo del mismo operario con `executedArea` parcial pueden quedar **huérfanas en Activas** con un cap de 0 — el operario no puede agregar nada pero la card sigue ahí confundiendo.

`activeAssignments` aplica un segundo filter:
- Si `progress.remaining > 0` → muestra (aún hay trabajo)
- Si `remaining = 0` y status `EN_PROCESO` → muestra igual (operario está adentro, no se la quitamos a medio camino)
- Si `remaining = 0` y status PENDIENTE/PARCIAL → **oculta** (suerte cerrada, nada que hacer)

La asignación sigue en DB con su `executedArea` propio (no se borra ni modifica el status) — preserva atribución para métricas y reportes. El operario la ve en **Historial** con su aporte real.

### Regla de 72h + orden de Activas [2026-06-24]

`activeAssignments` (OperatorView) aplica además, al final del chain:
- **Vencimiento a 72h:** una labor **creada hace más de 72 h** sale de Activas (`now - createdAt > 72h`). **Excepción: `EN_PROCESO`** (operario adentro) NO se retira. Si `createdAt` es inválido, no se vence (visible por seguridad). Es solo filtro de **vista** — la fila sigue PENDIENTE en DB, por eso se puede REUSAR (ver sección de reuse). El `STALE_MS = 72*60*60*1000`.
- **Orden:** siempre **más recientes primero** → `.sort((a,b) => b.createdAt.localeCompare(a.createdAt))` (ISO ordena cronológico como texto).

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

## Liberar (rechazar) un parcial — flag `liberada`

Un operario puede **liberar** una labor activa que no va a poder terminar (situación particular). No quiere que le quede "estorbando" en Activas, pero su avance NO se pierde.

**Columna DB:** `asignaciones.liberada boolean NOT NULL DEFAULT false` (migración `20260530140000_asignaciones_liberada.sql`, aplicar en Studio ANTES del push). Mapeada en `mapAssignment` (`Boolean(row.liberada ?? false)`) y `updateAssignment` (`if (input.liberada !== undefined) payload.liberada = input.liberada`). En `domain/sam.ts`: `Assignment.liberada?` y `UpdateAssignmentInput.liberada?`.

**Flujo:**
1. Operario → sheet de la labor activa → botón "No puedo continuar — liberar esta labor" (`.release-labor-btn`) → **modal de confirmación** (`.release-confirm-card`, evita accidentes) → `releaseAssignment` en `useAssignmentActions.ts`.
2. `releaseAssignment` hace `updateAssignment(id, { liberada: true })` — **NO cambia el status** (un PARCIAL sigue PARCIAL con su `executedArea` intacto). Maneja offline igual que `cancelAssignment`.
3. `activeAssignments` (OperatorView) excluye `a.liberada` → sale de las Activas del operario. Sigue en Historial (PARCIAL) con su aporte.
4. **Supervisor** la ve en Labores con badge `.liberada-badge` ("Liberada"). Puede:
   - **Reasignarla**: Editar → cambiar Operador. `editAssignment` pone `liberada = false` automáticamente cuando `operatorId` cambia (si no, quedaría oculta también para el nuevo operario). El nuevo operario la ve en SUS Activas y continúa el restante.
   - **Cancelarla**: botón "Cancelar labor" (status → CANCELADA) si ya no se hará.
5. **Operario** también puede **retomar el restante en Campo**. Las tres `hasActiveDuplicate` (useFreeFieldForm, useAssignmentForm, editAssignment) excluyen `liberada` para no bloquear la re-toma con "ya tienes una activa".

## Área TOTAL de la suerte = MAX de áreas del ciclo (re-tomas del restante)

**CRÍTICO:** `getSuerteProgress` (OperatorView) y el cap/cierre en `finishAssignment` calculan el restante contra `suerteTotalArea = Math.max(assignment.area, ...áreas del ciclo no-CANCELADA)`, **NO** contra `assignment.area` directo.

Por qué: una RE-TOMA en campo del restante (ej: tras liberar un parcial de 12.20 de 19.52) se crea con `area = getRemainingArea = 7.32` (no el área completa). Si `getSuerteProgress` restara `7.32 - executedTotal(12.20)` daría `remaining < 0 → 0` y la card desaparecería al instante como "zombie", o el cap del finish quedaría en 0 (el operario no podría registrar nada). Tomando el MAX de las áreas del ciclo recuperamos el área completa real (la primera toma / la ASIGNADA siempre lleva el área completa), y el restante se calcula bien (`19.52 - 12.20 = 7.32`). En el caso normal (todas las áreas = completa) `MAX = assignment.area` → sin cambio de comportamiento.

## Pestaña Validación (jefe/owner + administración)

Componente `src/views/ValidationTab.tsx` (usa `useAppData()` directo, sin props). Tab `'validacion'` en `SupervisorTab`. Acceso: `owner` (en el menú "Más") y `administracion` (tab directo). Render gated: `(role==='owner'||role==='administracion') && supervisorTab==='validacion'`.

Propósito: que jefe/administración validen que TODO lo del Excel paralelo ya está diligenciado en el app mientras prueban el sistema. Decisiones (2026-05-31):
- **Regla ×2** (DESPEJE/REENCALLE/REENCALLE V se facturan doble): en el Excel es una marca manual `FACTURA X2` (~46 de 4642 filas, NO es factor automático por labor). En el app quedan **dos líneas que suman el doble del área**. El dashboard **NO multiplica por factor**: solo SUMA el `executedArea` (las dos líneas ya dan el doble = el "facturar 2"). Por eso el usuario eligió "sumar las 2 líneas, no tocar flujo".
- **Cruce app ↔ Excel (objetivo real, 2026-06-01):** el usuario SUBE su Excel ("Resumen de Labores") y la app compara contra los registros del app. Parser: `import('xlsx')` dinámico → `XLSX.read(Uint8Array, {type:'array', cellDates:true})` → autodetecta la hoja cuyo header tenga LABOR/HACIENDA/SUERTE/HA (por índice de columna, robusto a reordenar). Agrupa AMBOS lados por `groupKey = normTxt(hacienda) | normSuerte(suerte) | canonLabor(labor)` dentro del mes/quincena elegido. `normSuerte` quita ceros a la izquierda si es numérica ("034"=="34"); `canonLabor` unifica alias Excel↔app (REENCALLE↔RENCALLE, REENCALLE V/EN V↔RENCALLE V, DESPAJE↔DESPEJE). Salida en 3 buckets: 🔴 falta en app (en Excel, no en app — lo clave), 🟡 solo en app, 🟢 en ambos (Ha Excel vs Ha app, deben coincidir). **Regla ×2 corregida (2026-06-01):** NO es por nombre de labor. En el Excel, una línea marcada "FACTURA X2"/"SE FACTURA X2" (detectado escaneando TODAS las celdas de la fila con regex, la columna de nota varía) cuenta su área DOS VECES → así iguala a las dos líneas separadas del app. En el app el ×2 es "data-driven": un grupo suerte+labor cuyo `Σ executedArea >= 1.8 × área de la suerte` (del maestro por haciendaCode+suerte) — eso marca el badge ×2 y la columna "FACTURA X2" del export. Esto distingue un ×2 real (área doblada) de trabajo compartido entre 2 operarios (suma = 1× área, NO es ×2). **Bucket de labor (2026-06-01):** para el cruce, DESPEJE/REENCALLE/REENCALLE V se agrupan como UNA unidad por suerte (`bucketLabor`→'DESPEJE/REENCALLE'), porque el Excel colapsa el par en una línea "DESPEJE X2" mientras el app lo registra como 2 labores separadas (DESPEJE + REENCALLE). Así ambas representaciones suman lo mismo (Excel 3.03×2 = app 3.03+3.03 = 6.06) y cuadran; sin el bucket, COLOMBINA 010 salía partido (DESPEJE en "ambos" con dif y REENCALLE en "solo en app"). FECHA del Excel se parsea de Date real o "M/D/YY" (formato US del archivo). Limitación: el match depende de que el NOMBRE de hacienda coincida (normalizado); si el Excel escribe distinto a la maestra, sale como falta/solo.
- **Validación = consistencia interna** (modo sin Excel cargado): semáforo por registro — 🟢 completa (COMPLETADA con área ejec + horómetro final + operario), 🟡 en curso (EN_PROCESO/PARCIAL), 🔴 incompleta (PENDIENTE o COMPLETADA con campos faltantes). Aprobación va en columna aparte, no en el rojo.
- **Export a Excel** con `aoa_to_sheet` (array-of-arrays) para replicar EXACTO el encabezado de la hoja "Resumen de Labores" (incluye columnas en blanco y "MATAS" duplicada que `json_to_sheet` no soporta). Mapeo app→Excel: EMPRESA fijo `AGROMORALES`, CLIENTE=ingenio (sin prefijo "Ingenio", uppercase), SECTOR=zona, CABO=supervisor (resuelto por `users`), HA=executedArea, FACTURA/VALOR/ACTA/etc=vacío (los llena admin en Excel). `import('xlsx')` dinámico (lazy) como en `App.tsx handleDownloadReport`.

## WORKFLOW — Secuencia de labores

> ⚠️ **Desde 2026-06-15 los selectores de labor usan el catálogo `labores_catalogo`** (`activeLabores`/`fieldLabores` del contexto), NO esta constante. `WORKFLOW` se conserva SOLO para `getSuggestedLabor`/cálculo de progreso y como fallback offline. Ver gotcha del catálogo.

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

## Tomar suerte en campo (LIBRE) — simplificado + cliente/zona en aprobación

**[2026-06-01]** El operario al "Tomar suerte en campo" YA NO captura **Cliente** ni **Zona** (se quitaron del form en `OperatorView`). La labor LIBRE se crea con `cliente=null`, `zona=null` (`takeFreeField` en `useFreeFieldForm`). El operario sí elige Ingenio, Hacienda, Suerte, Labor, Equipo y **Supervisor** (el supervisor es lo que la scopea).

**El supervisor diligencia cliente+zona al APROBAR:** el botón "Aprobar" de la lista de Labores, si la labor es `kind==='LIBRE'` y le falta `cliente` o `zone`, abre un modal (`approveTarget` en SupervisorView) que OBLIGA a elegir Cliente (ingenios/proveedores) + Zona (Norte/Sur) antes de aprobar (botón deshabilitado hasta tener ambos). `approveAssignment(assignment, { cliente, zone })` → `decideApproval` mezcla esos campos en el mismo update; `updateAssignment` mapea `cliente` y `zona`. Las ASIGNADAS sí traen cliente/zona (el form de asignar los exige), así que aprueban directo sin modal.

**Scoping (ya existía):** `scopedAssignments` filtra `a.supervisorId === session.id` para rol `supervisor` → cada supervisor solo ve las de campo donde lo eligieron + las que él asigna. Owner/administración ven todas. `CreateAssignmentInput.cliente` es opcional; `UpdateAssignmentInput` acepta `cliente` y `zone`.

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

## Scope por supervisor: Reporte y Resumen consistentes (id, no nombre)

Tanto el **Resumen** (`scopedAssignments`, SupervisorView) como el **Reporte** (`filteredReport`, App.tsx) filtran `supervisorId === session.id` cuando `role === 'supervisor'` (owner/admin/soporte ven TODO). Antes el Reporte mostraba todo a un supervisor → inconsistente con su Resumen (2026-06-23). El agrupamiento por persona es por **id**, nunca por nombre.

⚠️ **Si una labor aparece en el Reporte pero NO en el Resumen** (o viceversa) para un supervisor: casi seguro su `supervisor_id` no es el del supervisor logueado — típicamente por un **usuario duplicado con el mismo nombre pero id distinto** (caso JULIO CESAR NIÑO U033/U040). Ver el gotcha en `managing-supabase` (consolidar al id real + índice único `app_usuarios_nombre_activo_uniq` + guard anti-duplicados en el form).

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

## Dashboards/KPIs abren en la QUINCENA ACTUAL [2026-06-24]

Todos los dashboards de indicadores **arrancan filtrados en la quincena en curso** (no "todo el mes" ni la quincena pasada). Helper único: `currentQuincena(todayKey)` en `EntityHistoryModal.tsx` → `'PRIMERA'` (día 1–15) | `'SEGUNDA'` (16–fin). Se usa como **default del state**, sigue siendo cambiable a otros períodos por el usuario.

| Módulo | State | Archivo |
|---|---|---|
| **Resumen** (supervisor/owner) | `summaryQuincena` | SupervisorView |
| **Reporte** | `reportFilters.period` | App.tsx |
| **Realizadas** | `dateSeg` | RealizadasTab |
| **Planilla** | `planillaQuincena` | PlanillaTab (ya lo hacía; unificada al helper) |
| **Historial del operario** | `historyMonth` + `historyPeriod` | App.tsx (mes actual + Q1/Q2 según el día) |

**Historial del operario [2026-06-24]:** SIEMPRE abre en mes actual + quincena en curso. Se **ELIMINÓ** la persistencia en localStorage (`HISTORIAL_PREF_KEY`/`sam:historial-operario-pref`, lazy-init + efecto de persistencia) **y** el `useEffect` de auto-salto al "mes más reciente con datos" (contradecía "siempre la quincena actual"). `historyMonths` ahora **siempre incluye el mes actual** (`todayKey.slice(0,7)`) para que sea opción aunque esté vacío. Si el corte actual no tiene labores, se ve vacío y el operario navega manualmente. `historyPeriod` sigue siendo `'Q1'|'Q2'|'MES'` (el usuario puede cambiar a mes completo).

**NO** se aplicó a **Validación** (cola de aprobaciones) — ahí el default amplio es deseable (ocultar la quincena anterior escondería pendientes que sí se necesitan ver).

## Registro rápido de labor REALIZADA por el supervisor [2026-06-29]

Para el ~5% de operarios poco afines a la tecnología, el supervisor anota lo que hicieron desde **Asignar → "✓ Registrar labor realizada"** (`RegistrarLaborModal`, autónomo vía `useAppData`). Una sola pantalla: operario, tipo de cliente, ingenio, hacienda, suerte, labor, equipo, horómetro inicial+final (opcionales), hectáreas. **Supervisor y zona NO se piden** — salen del supervisor logueado (`users.find(session.id).zona`).

- Crea la labor en UN paso vía `samApi.registrarLaborRealizada(input)`: INSERT que nace **`estado=COMPLETADA`**, **`aprobacion=APROBADA`** (el supervisor la respalda), `area_asignada = area_realizada = hectáreas`, `fecha_inicio = fecha_fin = now`, `tipo_registro='ASIGNADA'`.
- **Equipo** se autocompleta con el del operario (`operator.equipmentCode`), editable.
- **Toggle "Hizo el 100% de la suerte"** (APAGADO por default): el área de la suerte se muestra siempre como referencia (recuadro `suerte-area-info`); encender el toggle pone las hectáreas = área completa y bloquea el campo; apagado = editable (parcial).
- Online-only (si `!isOnline`, pide conexión). Tras crear: `setAssignments(prev => [created, ...prev])` + `db.assignments.put`.

## Editar el ESTADO de una labor desde el Reporte [2026-06-29]

El modal **Editar** del Reporte (`selectedLabor` + `editLaborDraft` en SupervisorView) ahora incluye un selector **Estado**: Programada/Pendiente · Laborando · Parcial · Terminada. Al guardar (`handleEditAssignment`), el estado define **fechas, área ejecutada y aprobación** de forma coherente:

| Cambia a… | aprobación (si el estado CAMBIÓ) | fechas | executedArea |
|---|---|---|---|
| **COMPLETADA / PARCIAL** | → **PENDIENTE** (cae en la bandeja del supervisor dueño) | fija `finishedAt` (día elegido o now) | ha ingresadas, o `area` si quedó vacío |
| **EN_PROCESO** | → APROBADA | fija `startedAt`, limpia `finishedAt` | conserva |
| **PENDIENTE** | → APROBADA | limpia inicio y fin | **0** (no cuenta avance) |

- `EditPatch` (useAssignmentActions) ganó `approval`/`approvedBy`/`approvedAt` (fluyen a `updateAssignment`). La aprobación **solo se toca si el estado cambió** — editar otros campos no saca de la bandeja lo ya aprobado.
- Fijar bien `finishedAt`/`startedAt` es CRÍTICO: `executionDateKey` agrupa por esas fechas → sin ellas la labor caería en el día equivocado en Planilla/Reporte/Historial.
- **Bordes conocidos:** (1) revertir a Programada una labor creada hace +72h → no sale en Activas del operario (regla 72h), sigue en el sistema; (2) pasar a estado activo cuando el operario ya tiene esa suerte+labor activa puede duplicar la tarjeta (la validación de duplicados solo corre al cambiar de operario).

## Barras de búsqueda (patrón `user-search-input`) [2026-06-29]

Listas con búsqueda libre que filtra SOLO la vista (no los KPIs): **Historial del operario** (`historySearch` en OperatorView, filtra `visibleHistoryItems` por hacienda/suerte/labor + nombre de novedad) y **"Últimos movimientos"** del supervisor (`movSearch` en SupervisorView, filtra `visibleRecent` por hacienda/suerte/labor/operario/equipo). Mismo input `user-search-input` del Resumen. Empty state contextual: "Sin coincidencias…".

## Correcciones de la auditoría integral [2026-07-05]

Barrido con 6 agentes (correctitud, seguridad, integridad, sync, performance, calidad). Fixes de correctitud aplicados — NO revertir:

- **Doble-conteo del área CORREGIDO en el Resumen/dashboard.** `summarizeAssignments` (samApi) y `summaryMetrics` (SupervisorView) sumaban `a.area` de TODAS las filas → el split de cruce-de-día y el multi-operario (varias filas con el área COMPLETA de la misma suerte) inflaban el planificado (bug de facturación). Ahora `plannedArea` **deduplica por `suerteCode|labor` tomando el MAX**. `executedArea` SÍ se suma (cada aporte real). La Planilla ya lo hacía; esto lo alineó. (Pendiente menor: las cards "Por Operador/Labor/Equipo" pueden tener aún un sobre-conteo en *planificado*.)
- **`finishAssignment`: el cap final usa `suerteTotalArea`, no `assignment.area`** (`useAssignmentActions.ts:282`). Antes truncaba el área en una RE-TOMA del restante (fila con área reducida 7.32) → perdía el acumulado (12.20+7.32→7.32).
- **`getSuerteProgress` cuenta EN_PROCESO solo de la PROPIA asignación** (`a.id === assignment.id`). Antes el EN_PROCESO ajeno (área "en vuelo") cerraba prematuramente la card de un tercero (zombie).
- **`decideApproval` NO pisa la zona con null**: solo setea `cliente`/`zone` si el supervisor los diligenció (antes el spread crudo de `extra` con `zone:null` borraba una zona válida → la labor caía de los filtros del Tablero). También estampa `editadoPor`.
- **Registro rápido**: avisa si el área excede lo ya ejecutado de la suerte (aviso cliente antes del trigger de BD) y crea traza en `labor_sesiones` (antes no aparecía en horas-máquina).
- **[2026-07-06] TOPE de área ejecutada ≤ área de la suerte — blindaje en 4 capas (NO revertir).** El área ejecutada NUNCA puede superar el área de la suerte (se paga por ejecutada → ejec>plan = sobrepago/sobrefacturación; caso real: DESPEJE 25A Miraflores ejec 4.00 sobre plan 2.00 = 200%). Capas: (1) `finishAssignment` topa a `suerteTotalArea`; (2) `RegistrarLaborModal` avisa/bloquea; (3) **`editAssignment` ahora topa** (`useAssignmentActions.ts` — antes solo validaba `>=0`, ERA EL HUECO); (4) **trigger BD `asignaciones_cap_area`** (mig. `20260706120000`): el previo hacía `return NEW` si la suerte no estaba en el maestro (dejaba pasar cualquier área) → ahora, sin maestro, usa como tope el `area_asignada` MAX de la suerte+labor en el ciclo. **Cubre ASIGNADA y LIBRE por igual**: `mapAssignmentPayload` llena los mismos campos para ambas, y el trigger SUMA las dos juntas (filtra por `suerte+labor+nombre_hacienda+ciclo+estado`, NO por `tipo_registro`) contra el área de la suerte. Regla viva: ver [[feedback-test-programadas-campo]].
- **`mapRole` único** (samApi): el mapeo rol DB→app estaba duplicado en `loadAppUsers` y `appLogin`, y `appLogin` omitía `supervisor_insumos` → ese usuario entraba degradado a operador. Fuente única ahora.

## Facturación — Área facturada [2026-07-05]

Administración asigna un **N° de factura** a las labores YA realizadas. Columna `asignaciones.factura_numero text` (mig. `20260705150000`, idempotente, sin FK; `factura_numero` no vacío = facturada). `Assignment.facturaNumero` (`string | null`), `UpdateAssignmentInput.facturaNumero`, `EditPatch.facturaNumero`. `updateAssignment` mapea `factura_numero` (`|| null` para desfacturar).

- **Asignar factura:** (1) **Vista dedicada `FacturacionTab`** (tab `'facturacion'`, menú Más, owner/administración) — lista las realizadas del período con segmento **Sin facturar / Facturadas / Todas**, búsqueda y selección múltiple → asigna un N° **en lote** vía `setFacturaBulk(ids, num, editadoPor)` (o "Desfacturar"). (2) También desde el modal Editar del Reporte/Labores (campo "N° de factura" → `handleEditAssignment({ facturaNumero })`). En el Excel del Reporte hay columna **Factura**.
- **KPI "Área facturada":** `summarizeAssignments` devuelve `billedArea` (Σ `executedArea` de COMPLETADA/PARCIAL con `facturaNumero`). Aparece en la franja "Hoy"/Reporte junto a "Ha ejecut.", **ambas destacadas** (clase `day-status-item--emph`, número más grande) y facturada en morado (`--billed`). El Reporte lo recalcula inline (`facturada`).

## Novedad "Máquina varada" (MV) [2026-06-30]

Tipo de novedad `MV` = "Máquina varada" (día no trabajado por daño de la máquina en campo). Agregado a `NovedadTipo`/`NOVEDAD_TIPOS`/`NOVEDAD_LABEL`/`NOV_ICON` (🚜) + color `.planilla-nov--mv` (naranja-rojo) + leyenda. Aparece como botón automático en la Planilla (clic en el nombre del operario) y en "Registrar novedad" del operario. Sin migración (`operario_novedades.tipo` es texto libre).

**⚠️ OBSOLETO desde el 18-ago-2026 — ya NO se agrega una novedad tocando código.**
Antes había que tocar seis sitios (`NovedadTipo`, `NOVEDAD_TIPOS`, `ALL_NOVEDAD`,
`NOVEDAD_LABEL`, `NOV_ICON`, la leyenda y el CSS `.planilla-nov--xx`) y desplegar.
Hoy **las crea administración** desde Más → 🏷️ Novedades de la planilla. Ver la
sección "Novedades dinámicas" más abajo.

## Sesión julio 2026 — ciclo de vida, "Labores a facturar", rendimiento (NO revertir)

- **[2026-07-08] Prioridad a lo CERRADO + retención automática.** El Reporte abre por defecto en filtro **"Cerradas"** (`reportFilters.estado='CERRADAS'` en App.tsx → `status in (PARCIAL,COMPLETADA)`; selector con Cerradas/Completada/Parcial/Pendiente/En proceso/Cancelada; `''`=Todos). **Retención** (func BD `sam_run_retention`, mig. `20260708130000`): Nivel 1 cancela `PENDIENTE` **y `EN_PROCESO`** con `area_realizada=0` y +3 días → CANCELADA; Nivel 2 borra CANCELADA con `area_realizada=0` y +3 días. **NUNCA toca COMPLETADA/PARCIAL ni EN_PROCESO con avance real** (guarda `area_realizada=0`). La dispara owner/admin 1×/día desde el cliente (throttle localStorage `sam-retention-last` en AppDataContext) + opcional pg_cron. Umbrales elegidos por el usuario: cancelar 3d, purgar 3d.

- **[2026-07-11] "Labores a facturar" = aprobación solo de lo CERRADO.** Nav/pestaña "Aprobar" → **"A facturar"** (heading "Labores a facturar", `supervisorTab='aprobaciones'`). Regla: **solo PARCIAL/COMPLETADA entran a la bandeja**. Bug de raíz: la **toma en campo (`useFreeFieldForm`) nacía `approval='PENDIENTE'`** → labores no cerradas cargaban "por aprobar". Fix: la toma en campo ahora nace **`approval='APROBADA'`** (6 sitios); el "pendiente de aprobación" lo dispara SOLO el cierre (`finishAssignment`) o editar-estado→Terminada/Parcial. `pendingApprovals` filtra `approval==='PENDIENTE' && status in (PARCIAL,COMPLETADA)`.

- **[2026-07-14] RECHAZAR = fuera de toda parte + auditoría.** Al rechazar en "A facturar", `decideApproval` con RECHAZADA ahora **también pone `status='CANCELADA'`** → la labor sale de TODO conteo de área (los que ya filtran CANCELADA) y **NUNCA cuenta como área realizada**. Se conserva la fila con `approval=RECHAZADA`; `getStatusMeta` (OperatorView+SupervisorView, Pick incluye `approval`) la muestra **"Rechazada"** (no "Cancelada") = auditoría. También: `rendimiento` topa a COMPLETADA/PARCIAL; Excel ('Área Ejec.') solo COMPLETADA/PARCIAL (else vacío — antes mostraba executedArea>0 y colaba las rechazadas). **Datos viejos:** normalizar 1 vez `update asignaciones set estado='CANCELADA' where aprobacion='RECHAZADA' and estado in ('COMPLETADA','PARCIAL')` (se hizo: 16 filas). La retención NO las purga (area>0) → quedan como auditoría. **Editar habilitado a supervisores en el Reporte** (columna Acciones con `canEditAssignments`; Eliminar sigue solo owner/admin).

- **[2026-07-12] Rendimiento/productividad del operario (motivación).** Meta **ha/día por labor** (`labores_catalogo.meta_ha_dia`, editable en línea en Catálogos→Labores; `Labor.metaHaDia`; `loadLabores/create/update` usan `select('*')`). KPI en OperatorView (tab Activas), **100% cliente** desde `quincenaHistory`+metas: % quincenal = "jornadas cumplidas" Σ(ejec_labor/meta_labor) / días hábiles transcurridos (sin domingos); **indicador diario** = promedio ha/día (ha_quincena/días trabajados) + último día trabajado, vs `motivacion.meta_dia_ref` (default 15, plano) — aplica aunque no haya metas por labor. Felicitación configurable (tabla `motivacion`, mig. `20260712120000`/`...130000`): mensaje+imagen/GIF (bucket `avatars` prefijo `motivacion/`, máx 3MB)+umbral, editable en Catálogos→**🏆 Motivación** (`MotivacionTab`, owner/admin) con vista previa; se muestra al operario cuando `pct>=umbral`. Ver [[project-rendimiento-operario]].

- **[2026-07-08] KPIs de área del Resumen clicables → `AreaDetailModal`.** Las tarjetas "HA PLANIFICADAS"/"HA EJECUTADAS" del Resumen abren un modal con los registros que COMPONEN el número (búsqueda + filtros hacienda/operador + total). Planificadas = dedup por suerte+labor (MAX, igual que `plannedArea`); Ejecutadas = COMPLETADA/PARCIAL con fallback.

## 🔴 [2026-07-15] Incidente de REPUTACIÓN: "parece ejecutada estando pendiente" (NO revertir)

Reclamo grave del cliente (perdía confianza; el dueño llamó molesto). Investigado con agentes. **Dos problemas distintos** que se confundían:

**A) Display: una PENDIENTE mostraba el PLANIFICADO como ejecutado** (`7.49 / 7.49` en una tomada en campo sin iniciar). La tarjeta de Labores hacía `displayed = (COMPLETADA||PARCIAL) && exec>0 ? exec : area` → el `else` caía a **`area`**. **Fix (commit `a24bbaf`):** helper único **`areaEjecutadaVisible(a)`** en `src/utils/suerteCycle.ts` → cerrada: `exec>0?exec:area`; **NO cerrada: `exec>0?exec:0`** (nunca el planificado). Aplicado en tarjeta Labores (`SupervisorView` ~2857, formato `ejec / asignada` siempre, denominador `maestroRow?.area ?? assignment.area`), "A facturar" (~2962), `EntityHistoryModal` (~215), export `ValidationTab` (~344). **Toda vista nueva con área ejecutada DEBE usar el helper.** Verificado con agente: los 6 puntos de KPI/pago (Resumen, `summarizeAssignments`, Excel, Planilla, OperatorView, Facturación) **ya filtraban bien** por COMPLETADA/PARCIAL → **nunca se pagó de más**; era solo DISPLAY.

**B) Datos anómalos `PENDIENTE + area_realizada > 0`** (7 filas reales). **Causa trazada:** `updateAssignment` escribe columnas **independientes** (samApi ~2076 `estado`, ~2079 `area_realizada`). El culpable: **`AssignmentDetailModal.handleSave` (~111-128)** arma un patch diferencial que manda `executedArea` **pero nunca `status`**; se llega desde `EntityHistoryModal` (que lista PENDIENTE/EN_PROCESO) → un supervisor corrige "Hectáreas ejecutadas" sin cerrar la labor → queda PENDIENTE con área. (El editor de estado de `SupervisorView` es SEGURO: manda ambos y **limpia** `executedArea=0` al pasar a PENDIENTE. Reuso/create/start también seguros. **EN_PROCESO + área>0 es LEGÍTIMO**: PARCIAL reabierta conserva el avance.)
**Fix (commit `74ad052`):** guarda de **coherencia estado↔área** centralizada en `editAssignment` (useAssignmentActions, antes del write): si el RESULTADO tendría `executedArea>0` y `status==='PENDIENTE'` → se promueve a **COMPLETADA** (si cubre el área, +0.001) o **PARCIAL**, y se estampa `finishedAt` si falta. No toca EN_PROCESO.

**Lección de la corrección de datos:** al normalizar las 7 se usó `fecha_fin = coalesce(fecha_fin, now())` → como tenían `fecha_fin=null`, **quedaron con fecha de HOY y saltaron a la quincena actual** (el cliente reclamó: "se hicieron pero no en esta quincena"). Sus `created_at` eran de **junio** y `fecha_inicio=null`. Corregido con `fecha_fin = created_at`. **⚠️ Al normalizar estados masivamente NUNCA usar `now()` para `fecha_fin`** — usar `coalesce(fecha_inicio, created_at)`, que es la fecha real de origen (un UPDATE de estado NO toca `created_at`/`fecha_inicio`, así que la fecha original siempre se puede recuperar sin backup).

## [2026-07-15] Permisos por rol (commit `d73890f`)

- **Ventana de 36 h para aprobar:** `APROBACION_HORAS = 36` + `horasDesdeCierre(a)` (ref: `finishedAt ?? updatedAt ?? createdAt`) en SupervisorView. En "A facturar": si pasaron +36 h desde el CIERRE, el **supervisor** ve chip `⏳ Vencida · solo administración` y el botón Aprobar **disabled**; **administración y owner** sí pueden. Decisión del dueño: que las aprobaciones no se queden colgadas. **[2026-07-17] Rechazar TAMBIÉN escala:** pasadas las 36 h el supervisor no puede Aprobar NI Rechazar — toda la decisión pasa a administración/dueño (ambos botones disabled con el mismo gate `puedeAprobar`).
- **"+ Nueva suerte" solo administración/dueño** (toca el MAESTRO): quitado de los 3 sitios — modal "Tomar suerte en campo" del operario (`OperatorView` ~2040), form Asignar (`SupervisorView` ~1740), pestaña Maestros (`MaestrosTab` ~183).
- **Eliminar en el Reporte: ahora también supervisores** (antes solo owner/admin). La columna Acciones ya se mostraba con `canEditAssignments`; se quitó el gate extra del botón Eliminar. Sigue con confirmación (borrado permanente).

## Gotchas

- **[2026-07-15] ⚠️ La auditoría SOLO tiene lo posterior a su instalación.** `asignaciones_auditoria` (trigger, mig. `20260630130000`) no puede decir quién creó/editó algo **anterior**. En el incidente de las 7 filas, el query de auditoría devolvió **solo nuestra corrección de hoy** — sin "Creación" ni "Edición del área" → eran **legacy**. **No prometer trazabilidad retroactiva.** Para datos viejos, las pistas son del propio registro: `created_at`, `fecha_inicio`, `tipo_registro` (LIBRE=el operario la tomó / ASIGNADA=un supervisor la creó), `operador_nombre`, `editado_por` (último editor). **Query de auditoría (ojo con los tipos):** `asignaciones.id` es **uuid** y `asignaciones_auditoria.asignacion_id` es **text** → el join necesita cast: `join asignaciones s on s.id::text = au.asignacion_id` y `left join app_usuarios u on u.id::text = au.editado_por` (`u.nombre_completo`). `editado_por` null se muestra como **"sistema"** (`nombreUsuario`, SupervisorView ~576) — pasa en las tomas en campo porque **`mapAssignmentPayload` NO estampa `editado_por` al crear** (gap conocido: la Creación de ASIGNADA/LIBRE sale sin autor).

- **[2026-07-06] ⚠️ RECURRENTE: agregar una columna que el cliente ESCRIBE rompe TODA edición si la migración no se corrió** (`Could not find the 'X' column ... in the schema cache`, PostgREST 42703). Pasó con `editado_por` y otra vez con `factura_numero`. **Dos defensas:** (1) **correr la migración ANTES/junto con el deploy** (siempre, para toda columna nueva de escritura); (2) en el patch de edición, **mandar la columna opcional SOLO si cambió** — así una edición normal (estado/área) no depende de esa columna (ej. `facturaNumero` en el save handler del Reporte solo se incluye si `editLaborDraft.facturaNumero !== selectedLabor.facturaNumero`). `editado_por` sí se manda siempre (auditoría) → su migración ya está corrida. **Al agregar una columna nueva de escritura, aplica el patrón (2) para columnas secundarias.**

- **[2026-07-06] ⚠️ SIEMPRE probar la edición/flujos en labores PROGRAMADAS (ASIGNADA) *y* TOMADAS EN CAMPO (LIBRE).** El modal de edición, el cambio de estado, la reutilización de línea y las guardas de duplicados no distinguen por `kind`, pero los dos tipos llegan por caminos distintos (asignar vs takeFreeField) con datos distintos (cliente/zona nulos en LIBRE hasta aprobar, etc.). Un cambio en `editAssignment`/`updateAssignment`/guardas debe verificarse en AMBOS. Regla del usuario (repetida).

- **[2026-07-06] ✅ DECIDIDO: "ha ejecutada" = `executedArea > 0 ? executedArea : area` (fallback), consistente en TODA la app.** Regla de negocio confirmada por el dueño: **a los operarios se les PAGA a razón del área de la labor COMPLETADA** aunque no se haya capturado el `executedArea` (una COMPLETADA = se hizo la labor → cuenta su área planificada). Por eso el número operativo es el **266** (fallback), no el 240 (crudo). El descuadre reportado era: pantalla=266 pero **el Excel exportaba crudo (240)** → misma vista, dos números.
  - **Fix:** el Excel (`App.tsx` `handleDownloadReport`, columna "Área Ejec.") ahora usa el MISMO fallback → Excel = pantalla = 266. La columna "ÁREA" mixta del Reporte se **separó en dos**: **"Ha plan."** (`a.area`) y **"Ha ejec."** (`executedArea>0?executedArea:area` para COMPLETADA/PARCIAL, `—` para el resto) — `SupervisorView.tsx` tabla del Reporte.
  - **Regla:** TODA vista que sume/ muestre ejecutado usa `executedArea > 0 ? executedArea : area` para COMPLETADA/PARCIAL. Vale para KPIs (Resumen/Hoy/Reporte/Facturación), tablas y Excel. (Ya estaba así en pantalla desde `ee4080f`; faltaba el Excel + separar la columna.)
  - **Matiz técnico (documentado, no bloquea):** en trabajo compartido, un 2º operario puede cerrar al 100% una suerte que otros ya hicieron → su fila queda `area=0`; con el fallback cuenta su área planificada. El dueño acepta esto porque **así se paga**. Si en el futuro se quiere el número "neto por suerte" (sin doble), sería otra métrica aparte. Ver [[project-facturacion-240-266]].

- **[2026-06-18]** **Aprobación OBLIGATORIA al finalizar (asignadas y de campo).** Antes solo las LIBRE pedían aprobación; las ASIGNADAS nacían `APROBADA` y nadie revisaba el área → facturación recibía áreas que no cuadraban. Fix: `finishAssignment` (useAssignmentActions) ahora pone `approval: 'PENDIENTE'` en el `finishPayload` (y en el path offline) → TODA labor finalizada (parcial o completa) vuelve a "por aprobar". `decideApproval` se relajó: aprueban el supervisor asignado **O** owner/administración. Bandeja: pestaña `'aprobaciones'` (`pendingApprovals` = `scopedAssignments` con `approval==='PENDIENTE'` y status COMPLETADA/PARCIAL), botón nav **✔ Aprobar** con badge rojo (`.nav-badge`, pulso `.has-pending`) + banner `.mini-banner--approve` en Labores. Aprobar/Rechazar reusa `handleApproveAssignment`/`handleRejectAssignment` (LIBRE sin cliente/zona abre el modal `approveTarget`). **Los dashboards/Planilla siguen sumando área independiente de la aprobación** (el estado es solo gate/flag; si piden "facturar solo aprobadas" hay que filtrar por `approval==='APROBADA'`).

- **[2026-06-18]** **Novedades del operario → Planilla.** Tabla `operario_novedades` (ver managing-supabase), tipos `V/T/NP/D/P/C` (`NOVEDAD_TIPOS`/`NOVEDAD_LABEL` en samApi). El operario las reporta con un botón **"Registrar novedad"** que abre un modal (tipo + rango de fechas). El propietario también desde la Planilla **al oprimir el nombre** del operario. En la celda de la Planilla la novedad muestra la LETRA (color de texto por tipo) y reemplaza las ha. `setOperarioNovedades(opId, fechas[], tipo)` hace upsert por día; `clearOperarioNovedades` borra.

- **[2026-06-18]** **Planilla: muchas mejoras.** (1) Muestra TODOS los operarios del catálogo (`operators`) aunque no trabajen, orden alfabético con `.trim()` (ver gotcha de nombres). (2) **Colores del número**: naranja (`.planilla-num--proceso`) si hay labor EN_PROCESO ese día, verde (`.planilla-num--terminada`) si está cerrada (PARCIAL/COMPLETADA) — `perDayProceso` por celda. (3) **Resaltado** por color (azul/rojo/amarillo/verde pastel) = `planilla_revisiones.color`; herramienta "Resaltar" con picker; es fondo, independiente de la letra de novedad. (4) **Convenciones** (legend) bajo el título. (5) **Selector "Operarios"**: checklist persistido en localStorage (`planilla-operarios-ocultos`) para ocultar/mostrar. (6) **Clic en el número** → modal con las labores de esa celda (operario × `executionDateKey`) con **Editar** (callback `onEditLabor` → `setSelectedLabor` del padre) y **Eliminar** (`deleteAssignment`). La celda cuenta `a.area` de EN_PROCESO/PARCIAL/COMPLETADA por `executionDateKey`.

- **[2026-06-18]** **`SearchableSelect` en móvil**: detecta `(pointer: coarse)`. En móvil el input es `readOnly` hasta que el usuario pide buscar → abrir muestra la lista SIN teclado (ya no lo tapa); tocar el campo de nuevo o la opción "🔍 Buscar…" activa el teclado (`searching` + focus). En escritorio, comportamiento original (foco abre y escribe). NO romper este split si tocas el componente.

- **[2026-06-17]** **Realizadas consolida por CICLO, no por día.** Agrupa por `suerteCode|labor` y dentro clusteriza por ciclo (`isSameCycle`, adyacentes ≤21 días) → una tarjeta por corte con `Σ executedArea / área asignada (maestro)`, rango de fechas, "N parciales". Clic → detalle de cada parcial (operario · fecha · ha · estado). Un re-laboreo en otro ciclo = otra tarjeta.

- ~~**[2026-06-17]** Historial del operario recuerda la última selección en `localStorage`~~ **REVERTIDO [2026-06-24]:** se eliminó la persistencia (`sam:historial-operario-pref`) Y el auto-salto a `historyMonths[0]`. El Historial ahora SIEMPRE abre en mes actual + quincena en curso (ver sección "Dashboards/KPIs abren en la quincena actual"). No reintroducir la persistencia.

- **[2026-06-16]** **Reporte (owner/admin) ahora EDITA y ELIMINA líneas** (ajuste de liquidación final). Vista "Por labor", columna **Acciones** gateada a `canEditAssignments`: **Editar** abre el modal `selectedLabor` existente (`setSelectedLabor(a)` — edita área ejecutada/operario/horómetros/equipo/notas para cualquier estado) y **Eliminar** abre un modal de confirmación (`deleteReportTarget`) → `handleDeleteReportRow` → `samApi.deleteAssignment(id)` (**DELETE real, irreversible**) + `setAssignments(filter)` + `db.assignments.delete(id)`. **Requiere la policy `asignaciones_delete`** (mig. `20260616120000`) — sin ella el delete borra 0 filas en server y la fila REAPARECE al sync (ver managing-supabase). El modal de confirmación es obligatorio (el usuario lo pidió explícito). El "Editar" NO toca cliente/fecha/estado (solo lo del modal); si lo piden, extender `editLaborDraft` + `editAssignment`/`UpdateAssignmentInput`.

- **[2026-06-16]** **Banner "pendientes viejas" → ahora abre DETALLE** (antes era confirmar-y-borrar-todo). En Labores, el botón **Limpiar** del `stale-banner` abre un modal que LISTA cada pendiente vieja (`stalePendientes.list`, hacienda·suerte, labor — operario, ha, "hace N días" vía `diasDesde`) con **✕ Limpiar por ítem** (`handleCleanOneStale`, cancela esa sola → CANCELADA) + **Limpiar todas** (`handleCleanStale`). `stalePendientes` ahora retorna `{list, count, area, ids}`. Reversible (CANCELADA, no borra). **NO confundir con el DELETE real del Reporte.**

- **[2026-06-15]** **Catálogo de labores CRUD (`labores_catalogo`) reemplaza la constante `WORKFLOW` para los PICKERS.** Pestaña `'catalogo'` (`LaboresTab.tsx`, owner+admin, menú "Más" → "Labores"): crear/renombrar/activar-desactivar/eliminar + tipo `MECANIZADA`/`MANUAL`. El contexto expone `activeLabores` (activas, alfabético) y `fieldLabores` (activas + no-manuales). Pickers: asignar (SupervisorView) y Tablero usan `activeLabores`; **el de campo del operario (`OperatorView`) usa `fieldLabores`** → un operador de tractor NO ve labores manuales (REPIQUE). Al asignar una labor manual, aviso `.field-warning` (no bloquea). `WORKFLOW` SOLO se conserva para `getSuggestedLabor`/progreso y como fallback. Detalle de tablas/Dexie en managing-supabase. **REPIQUE arranca DESACTIVADA y MANUAL** (caso que originó esto: era manual mal registrada en operador de tractor).

- **[2026-06-15]** **Caso REPIQUE/operador de tractor (diagnóstico tipo).** Una labor "Laborando" (EN_PROCESO) que lleva días sin cerrar y muestra ha pero **sin hora** = `fecha_fin` NULL (el historial solo muestra hora si hay `finishedAt`). Si además es una labor MANUAL en un operador de TRACTOR (con `equipo` de tractor + horómetro inicial pero sin final ni área), es un **registro errado en campo (LIBRE) que el operario nunca cerró** → se corrige con `UPDATE asignaciones SET estado='CANCELADA', observaciones='...' WHERE id=...`. Por eso se tipificaron las labores (manual/mecanizada) y se filtró el picker de campo.

- **[2026-06-15]** **Vista "Realizadas" del propietario** (`RealizadasTab.tsx`, owner+admin; owner la tiene en la barra principal junto a Labores, admin en "Más"). Lista labores COMPLETADA+PARCIAL, filtros por hacienda y labor (`SearchableSelect`), orden hacienda alfabético → fecha de ejecución desc → suerte. **Segmentador de fecha**: `Todas / Mes / 1ra quinc. / 2da quinc. / Hoy / Rango` (rango = `desde`/`hasta` con `<input type=date>`), reusa `matchesSummaryFilter`. Encabezado "N labores · X ha ejecutadas".

- **[2026-06-15]** **Planilla: orden ALFABÉTICO + resaltado de revisadas (azul celeste, persistente).** Filas ordenadas por `name.localeCompare(...'es',{sensitivity:'base'})` (antes era desc por total). Herramienta de revisión: botón **🖍 Marcar revisadas** (modo) → clic en celda la pinta azul (`planilla-revisada`); en modo marcar el clic NO abre detalle. Persistencia en tabla `planilla_revisiones` (clave `operador_id|fecha`) vía `loadPlanillaRevisiones`/`setPlanillaRevision` (optimista). Botón **📋 Revisadas (N)** → modal con detalle (operario·fecha·ha) + limpiar una (`setPlanillaRevision(false)`) o todas (`clearAllPlanillaRevisiones`). **El marcado equivalente en las TARJETAS de Labores se construyó y luego se REVIRTIÓ** (la tabla `labor_revisiones` y `samApi.*LaborRevision*` quedaron sin uso) — la petición real era el banner de pendientes, no marcar tarjetas.

- **[2026-06-14]** **Parciales que cruzan de día (mismo operario) → SPLIT en entradas por día.** Antes, continuar una PARCIAL al día siguiente SOBRESCRIBÍA la misma fila (executedArea acumulaba, `finishedAt`=hoy, status=COMPLETADA) → toda la labor aparecía HOY y la porción de ayer "desaparecía" (era una sola fila por operario+suerte+labor). Fix en `startAssignment` (useAssignmentActions): si `status==='PARCIAL' && executedArea>0 && executionDateKey(a)!==todayKey && isOnline` → (1) **congela** la fila de ayer como COMPLETADA (conserva su `executedArea` y su `fecha_fin`=ayer), (2) crea una **entrada NUEVA** con `createAssignment` (área completa de la suerte, `initialStatus:'EN_PROCESO'`, `startedAt`=hoy, `approval:'APROBADA'`), (3) `updateAssignment(nueva.id,{horometroInicial})`. Cada día queda en SU fecha y se agrupan por ciclo (`isSameCycle`) — igual que ya pasaba entre dos operarios distintos. `supervisorName` se resuelve de `supervisors` (useAppData). Offline cae al flujo normal (mutar). Aplica a ASIGNADA y LIBRE. El mismo-día NO hace split (solo cruce de día). Limitación: el horómetro sigue siendo 1 par por fila, pero ahora hay 1 fila por día → cada día tiene su par.

- **[2026-06-18] ⚠️ CAMBIO de lógica de la celda — la Planilla suma ÁREA REAL, no planificada.** Antes (2026-06-11) sumaba `a.area` (planificada) al ABRIR, lo que **duplicaba las labores que cruzan de día** (el split crea 2 filas con área completa → 13.3+13.3=26.7 cuando el trabajo real fue 13.3). AHORA, por celda (operario × `executionDateKey`): para **CERRADAS** (PARCIAL/COMPLETADA) suma `executedArea` (lo hecho esa sesión → el split reparte el avance por día, suma = total real); para **EN_PROCESO** suma el **restante estimado** = `a.area − (Σ executedArea de lo CERRADO en la misma suerte+labor del mismo ciclo, isSameCycle)` → así no duplica lo ya hecho y sigue mostrando en naranja lo que se trabaja hoy. `cerradoBySuerte` precalcula el avance cerrado por `suerteCode|labor`. **Limitación:** la distribución por día es perfecta solo si el operario registró un PARCIAL cada día; si solo arrancó un día y cerró todo otro día (sin parcial intermedio), el `executedArea` queda atribuido al día de cierre y el día de arranque muestra el restante (que puede ser 0). El dueño puede corregir con "Editar fecha de ejecución" o el detalle de la celda. Reusa `matchesSummaryFilter` + `buildMonthOptions`. Acceso: owner/admin/supervisor. Excel refleja lo mismo (lee `perDay`). NO volver a `a.area` (reintroduce el doble conteo).

- **[2026-06-04]** Una labor **PARCIAL ahora se RE-INICIA** (antes saltaba directo a "Finalizar"). En `OperatorView` la hoja activa muestra el form de INICIO para `status === 'PENDIENTE' || status === 'PARCIAL'`: el operario pone un **horómetro inicial nuevo** → "Continuar labor" → pasa a **EN_PROCESO conservando `executedArea`** → al terminar registra horómetro final → PARCIAL/COMPLETADA. Aplica a ASIGNADA y LIBRE por igual (la hoja ramifica por **status, no por kind**). Implicaciones que NO romper: (1) `getSuerteProgress` ahora incluye `EN_PROCESO` en el avance (`sameSuerteLabor` filtra COMPLETADA|PARCIAL|EN_PROCESO) — sin eso, una PARCIAL re-iniciada (EN_PROCESO con `executedArea>0`) "perdía" su área hecha al calcular el restante; un EN_PROCESO fresco tiene `executedArea=0`, inocuo. (2) `startAssignment` limpia `finishedAt`+`horometroFinal` del cierre previo (sesión limpia) y **conserva `executedArea`**; inocuo para inicios frescos (ya venían null). (3) **Limitación conocida:** el modelo guarda UN solo par horómetro inicial/final → re-iniciar **SOBRESCRIBE** los del tramo anterior (solo se conserva el último). Histórico por sesión requeriría tabla de tramos aparte. (4) `finishAssignment` ya lo soportaba: lee `ownExecuted` directo de `assignment.executedArea`, no de la agregación por status. (5) Resúmenes/Reportes (SupervisorView/App) cuentan solo COMPLETADA|PARCIAL → durante la sesión re-iniciada el área previa NO suma **temporalmente** (se reintegra al finalizar); no se tocaron esos sitios para evitar regresiones (ver regla de "tocar TODOS los `=== 'COMPLETADA'`").

- **[2026-06-04]** CRUD de usuarios habilitado para `administracion` (antes solo `owner`). La pestaña Usuarios y el modal de alta/edición en `SupervisorView` se gatearon a `role==='owner' || role==='administracion'`; `administracion` tiene su botón Usuarios en la **nav plana** (no usa el menú "Más", que solo es owner/supervisor). Se agregó `deleteAppUser` → rpc `app_delete_user` (**SOFT delete** `activo=false`, RPC ya en prod desde la migración `20260514120000`, conserva histórico de labores). Botón "Eliminar" en el modal de edición, **deshabilitado si `editingUserId === session.id`** (no auto-eliminarse), con confirmación en modal **SUPERPUESTO** (`zIndex:2000`, renderizado DESPUÉS del modal de usuario en el DOM para no quedar detrás — el usuario ya se quejó antes de confirmaciones tapadas por el form). Tras crear/editar/eliminar se llama `loadAppUsers()+setUsers()` para refrescar al instante (las RPC no devuelven la fila). Detalle de las 3 RPC en `managing-supabase`.

- **[2026-06-04]** Reporte (owner/admin) ganó filtros nuevos: período **"Ayer"** (`AYER`, `yesterdayKey = todayKey − 1d`), selector de **Mes** (mes anterior o cualquiera de 12 fijos vía `buildMonthOptions`/`summaryMonthOptions`; aplica a PRIMERA/SEGUNDA/MES) y **Suerte** (`reportSuerteOptions`, distinct de assignments filtradas por hacienda). Todos los filtros son **escribibles** (`SearchableSelect`), no solo listas desplegables. `ReportPeriod` incluye `'AYER'`; estados y `filteredReport` viven en `App.tsx` y se pasan como props.

- **[2026-06-04]** Las tarjetas de **Historial** del operario muestran la **fecha de realizado** (commit `588a29e`). El dato lo agrega `samApi` y lo renderizan `EntityHistoryModal` + `OperatorView`. Si tocas el render de tarjetas de historial, preservar esa fecha.

- **[2026-06-01]** Bug: una labor del operario quedaba INVISIBLE en su Historial si CRUZABA el cambio de mes (creada 31-may, finalizada 1-jun, PARCIAL). Causa: `historyMonths` (las opciones del desplegable de mes) se armaba con `dateKey` (CREACIÓN = mayo), pero `filteredHistory` filtra por `executionDateKey` (EJECUCIÓN = junio). Resultado: en mayo no aparecía (ejecución es junio) y junio ni salía como opción (creación es mayo) → limbo. El propietario sí la veía porque `EntityHistoryModal` usa `buildMonthOptions` (12 meses fijos), no derivados de la data. Fix: `historyMonths` ahora usa `executionDateKey(a).slice(0,7)`, CONSISTENTE con `filteredHistory`. Regla: si el filtro usa `executionDateKey`, las OPCIONES del selector también deben usar `executionDateKey`, nunca `dateKey`.

- **[2026-06-01]** Bug: el Historial del operario "desaparecía" al cambiar de mes. `historyMonth` default = mes ACTUAL (App.tsx); el 1-jun defaulteaba a junio vacío. Fix: `useEffect` en OperatorView salta al mes más reciente con datos (`historyMonths[0]`) si el mes seleccionado no está en `historyMonths`. Afecta a TODOS los operarios a la vez (de ahí "varios operarios" justo con el cambio de mes).

- **[2026-06-01]** Bug: el HISTORIAL del OPERARIO (su propia cuenta) salía vacío para 2da quincena de mayo, PERO el propietario SÍ veía esas labores en Resumen → Por Operador → Julio. Datos correctos en DB (18 labores, operador_id consistente), `executionDateKey` y filtros correctos, `appLogin` arma bien `session.id`. Causa: **caché local incompleta + delta sync**. `loadAssignments` hace delta si hay `assignments_last_sync` + caché; el delta solo AGREGA cambios recientes y devuelve `db.assignments.toArray()` — si la caché ya estaba incompleta, NUNCA rebaja las labores viejas. El login SÍ fuerza full sync, pero un operario con sesión persistida que solo REABRE la PWA (sin reload ni re-login) hacía delta sobre caché parcial. `hydrate` solo forzaba full en reload del navegador. Fix: `hydrate` ahora SIEMPRE borra `assignments_last_sync` al abrir → fase 2 trae todo (tabla ~250 KB, trivial). Workaround inmediato sin redeploy: en el dispositivo del operario, recargar (botón circular) o Diagnóstico → "Forzar sync ahora" o salir+entrar.

- **[2026-06-01]** Bug: en Resumen → "Por Operador/Equipo", la TARJETA mostraba labores (ej. DAVILA 70.38 ha / 5 labores) pero al abrir el detalle (`EntityHistoryModal`) decía "Sin labores en el periodo". Causa: el agrupamiento de las tarjetas usaba `id = a.operatorId || 'sin-operador'` pero el modal filtraba `a.operatorId === entity.id`. Para filas históricas con `operador_id` VACÍO, la tarjeta agrupaba bajo el literal `'sin-operador'` (mostrando el nombre) pero el modal comparaba `'' === 'sin-operador'` → 0. Fix: (1) el agrupamiento ahora keya por `operatorId` o, si vacío, por `name:${NOMBRE}` (evita además mezclar distintos operarios sin id en una sola tarjeta "Sin operador"); (2) el modal reconstruye y compara LA MISMA clave (id-o-nombre), no el id literal. Mismo arreglo para equipos (`equipo_codigo` vacío). Regla: si una tarjeta agrupa por `X || fallback`, el detalle debe emparejar con la MISMA expresión, nunca `=== entity.id`. (3) Además: `EntityHistoryModal` tiene estado interno `month/quincena` con `useState(defaultMonth)` que NO se sincroniza al cambiar el filtro del Resumen; se le agregó `key` por entidad para que re-monte y abra en el período actual.

- **[2026-05-30]** Bug reportado: labor LIBRE multi-operario tomada en campo NO cerraba. LA ESPERANZA-04U (18.86 ha): Julio hizo 9.66, Rolando 9.20 (= 18.86 exacto) pero ambos seguían viendo la labor activa en PARCIAL ("Falta 9.20" / "Falta 9.66"). **Causa raíz:** `getSuerteProgress` y `suerteExecutedOthers` agrupaban con `dateKey === assignment.dateKey` (mismo día EXACTO de creación). Para LIBRE cada operario crea su row en el día que toma la suerte; si la toman en días distintos, sus `dateKey` difieren → no se ven entre sí → la suma conjunta nunca alcanza el área → nunca cierra. **Fix:** reemplazar la igualdad exacta por `isSameCycle(a.dateKey, b.dateKey)` (ventana `CYCLE_WINDOW_DAYS = 21` en `src/utils/suerteCycle.ts`) en los **6 sitios** de agrupación: `getSuerteProgress` (OperatorView), `suerteExecutedOthers` (useAssignmentActions), y los **4** `getRemainingArea` (OperatorView, useFreeFieldForm, useAssignmentForm, SupervisorView — estos miden la ventana contra `todayKey`). Build pasa. NO volver a `dateKey === dateKey`. Ver sección "Agrupación por CICLO".

- **[2026-05-29]** Bug visible reportado: SAN MIGUEL 020 mostraba "34.02 ha realizadas" cuando el área es 14.51. Causa: `getSuerteProgress` sumaba 2 VALENCIA COMPLETADAs históricas (14.51 c/u, ciclos viejos) + DOMÍNGUEZ PARCIAL (5.00). Fix original: filtrar por ciclo. **Actualizado [2026-05-30]:** el filtro pasó de `dateKey === assignment.dateKey` exacto a `isSameCycle` (ventana de 21 días) para no romper labores LIBRE multi-día — el caso SAN MIGUEL (ciclos a meses de distancia) sigue resuelto porque quedan fuera de la ventana. NO eliminar la separación por ciclo.

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

## 🔴 El tope de área sale del MAESTRO, no del máximo planificado (30-jul-2026)

`suerteTotalArea` se calculaba como el **máximo de las áreas planificadas** del
ciclo, asumiendo que cada fila nace con el área completa de la suerte. Eso vale
para el patrón "programo la suerte entera y la ejecuto en varios parciales",
pero **se rompe cuando la suerte se reparte en pedazos**.

Caso real: **EL REFLEJO suerte 040 = 6,82 ha**. El DESPEJE se programó en dos
asignaciones, 3,10 + 3,72 (que suman la suerte). El máximo daba **3,72**, y al
restarle los 3,10 ya ejecutados el tope quedaba en **0,62 ha**: era imposible
registrar las 3,72 que de verdad se hicieron.

Ahora manda `maestro_risaralda.area_neta` (`areaOficialSuerte()`), y el máximo
del ciclo queda solo como respaldo para suertes que aún no están en el maestro.

⚠️ La búsqueda va por **nombre de hacienda**, no por código: hay códigos
compartidos entre haciendas distintas (ver `project_maestro_codigo_compartido`).

Aplica en los DOS sitios donde se topa el área: `finishAssignment` (cierre en
campo) y `editAssignment` (corrección desde el Reporte). Si se toca uno, tocar
el otro — antes ya habían divergido.


## Novedades de la planilla: las crea administración (18-ago-2026)

Los códigos que se marcan en la Planilla (V, T, NP, D…) viven en la tabla
**`novedad_tipos`**, no en el código. Administración crea los que necesite desde
**Más → 🏷️ Novedades de la planilla**: código de 1 a 3 letras, qué significa y
color de una paleta fija.

**No es solo un catálogo: son botones que funcionan igual que los de siempre.**
La leyenda, los botones de marcar y el color de cada celda salen del catálogo.
Antes eran una lista fija y una clase CSS por tipo (`.planilla-nov--v`).

| Campo | Para qué |
|---|---|
| `codigo` | La llave Y lo que se pinta en la celda. Corto: en 15 días no cabe una palabra |
| `color` | Hex. Se aplica en línea, ya no por clase CSS |
| `orden` | En qué orden salen los botones. Los de uso diario arriba |
| `activo` | Deja de ofrecerse como botón, pero el histórico se sigue leyendo |
| `del_sistema` | Los 16 originales. No se borran ni con el botón |

### 🔴 Un código que ya se usó NO se borra, se desactiva

`eliminarNovedadTipo` cuenta primero en `operario_novedades` y se niega si hay
uno solo. El botón de eliminar **ni siquiera aparece** si el código tiene
historia. Borrarlo dejaría las celdas de los meses pasados sin forma de saber
qué significaban, y esa planilla es la base de la nómina.

El `C` viejo de camioneta quedó **inactivo, no borrado**: no se ofrece, pero los
registros que lo usan se siguen viendo.

### El catálogo NO puede tumbar la planilla

`AppDataContext` lo carga **aparte y sin `await`**, y si falla las pantallas caen
a la lista fija de `samApi` (`NOVEDAD_TIPOS`/`NOVEDAD_LABEL`, que se conservan a
propósito). Una tabla nueva que no responda no puede dejar a nadie sin poder
marcar un día.

⚠️ Efecto visible: al abrir la Planilla, la leyenda pinta un instante los 15 de
respaldo en gris y luego los del catálogo con su color. No es un error — es que
el catálogo llega asíncrono.

⚠️ `operario_novedades.tipo` es **TEXT sin CHECK** (verificado), así que un
código nuevo entra sin migración. Si algún día se le pone un CHECK, hay que
ampliarlo a mano por cada tipo — la misma trampa que ya cobró `app_usuarios.rol`.

## 🔴 La Planilla y el Resumen usan el MISMO criterio de área (7-ago-2026)

Daban números distintos para la misma quincena y el cliente lo detectó
(Marulanda: 111,66 en la Planilla contra 98,72 en el Resumen).

**Dos causas, y solo una era un error:**

1. **La Planilla no aplicaba el respaldo del área.** Cerrar una labor sin
   escribir el área significa *"hice lo planificado"*, no *"hice cero"*. El
   Resumen ya lo aplicaba; la Planilla no. Medido antes de corregir: **9 labores
   de 7 operarios, 89,91 ha** desde el 29 de mayo — y como con la Planilla se
   paga, a esas siete personas les faltaban esas hectáreas. Corregido con
   `areaCerrada()` en `PlanillaTab`.

2. **La Planilla cuenta las EN_PROCESO y el Resumen no.** Eso **no es un error**:
   la Planilla muestra lo que se está trabajando, el Resumen solo lo cerrado.
   Para pagar manda el Resumen.

```ts
/** Aplica SOLO a COMPLETADA/PARCIAL. Una labor abierta muestra 0. */
function areaCerrada(a: Assignment): number {
  const ejec = a.executedArea ?? 0
  return ejec > 0 ? ejec : (a.area ?? 0)
}
```

⚠️ El mismo criterio va en el **avance acumulado por suerte** (`cerradoBySuerte`),
o el restante estimado de las EN_PROCESO sale inflado. Cambiar uno sin el otro
cambia un error por otro.

### Ojo con las labores que quedan abiertas

Al revisar salieron **5 labores con más de 3 semanas abiertas** (una de Valencia
con 56 días), inflando la Planilla mes tras mes con área que nunca se cerró. Se
cerraron el 17-ago dejando el parcial ya registrado, y quedaron **47,47 ha por
reportar** en esas cinco suertes.

⚠️ Al cerrar una labor trabada **con área en cero**, el respaldo le paga el área
COMPLETA planificada. Cerrar en cero no es lo conservador: es lo caro.


## 🔴 La unidad ya NO siempre es hectáreas (27-ago-2026)

**ACEQUIAS se mide en hectómetros (hm)**, no en hectáreas. Es lineal: se abre
tanto de zanja, no se cubre tanto de terreno.

`labores_catalogo.unidad` (default `'ha'`) y `asignaciones.unidad`. En la interfaz
manda **`unidadDeLabor(nombre)`** de `lib/texto.ts`, que hoy resuelve por nombre —
una línea que cambiar cuando el catálogo sea la única fuente.

🔴 **`asignaciones.unidad` va NULLABLE y SIN default a propósito.** `null` dice
"se registró cuando todo eran hectáreas", que no es lo mismo que afirmar que
aquella labor de acequias de marzo se midió en ha — nadie lo sabía entonces.
Mismo criterio que `insumos_solicitudes.engraso`.

### ZANJAS y ACEQUIAS eran la misma labor

Estaban las dos en el catálogo y el cliente pidió **una sola**. La migración
renombra en el catálogo **y en las 29 `asignaciones.labor_nombre` históricas**:
`labor_nombre` es texto copiado, no una llave foránea, así que arreglar solo el
catálogo habría dejado 29 labores huérfanas fuera de todo filtro por labor.

### ⚠️ Los totales siguen sumando peras con manzanas

Cualquier total de área que cruce labores está sumando ha con hm — Planilla,
Resumen, Reporte. Con **una sola** labor en hm el error es chico, pero **la
Planilla es la nómina**. Al agregar la segunda labor lineal, separar los totales
por unidad antes que nada.

## ✅ La Planilla separa hectáreas de hectómetros (1-sep-2026)

Dos columnas de total: **Total ha** y **Total hm**. Dentro de la casilla del día,
lo que va en hectómetros aparece **debajo y siempre con su unidad** — suelto se
leería como una hectárea más. El pie de totales y el Excel, igual.

🔴 **No era un detalle teórico.** Medido en la 2da quincena de agosto: a OSORIO
DIEGO FERNANDO se le sumaban **196,88 hm con 59,51 ha** y salía un total de
**256,39** que no significa nada. Y **8 de los 17 días con acequias** tienen
también una labor en hectáreas del mismo operario, o sea que casi la mitad de esas
casillas estaba mal. Con esa planilla se paga.

La columna de hm sale **vacía** cuando no hay acequias en el periodo: meterle una
columna de ceros a quien no la usa es ruido.

⚠️ **El Resumen y el Reporte todavía suman las dos unidades.** Al tocar cualquier
total que cruce labores, separarlo igual.
