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

## Gotchas
- **[2026-04-10]** Reemplazos masivos en App.tsx con tool multi_replace fallan cuando el target tiene mixed CRLF/LF o caracteres JSX encoded (&&&, <>). → solución: Usar PowerShell -replace con Get-Content -Raw / Set-Content para reemplazos bulk seguros. Para eliminar líneas específicas, usar slicing de array: lines[0..N] + lines[M..end].

- **[2026-04-09]** `getSuggestedLabor` filtra solo labores que están en `WORKFLOW` usando `normalizeText` (trim + uppercase). Si una labor en DB tiene acento o diferente capitalización, no se cuenta como completada → revisar consistencia en datos
- **[2026-04-09]** El tablero (`supervisorTab === 'tablero'`) usa `programmedSuerteRows` que solo incluye suertes con `kind === 'ASIGNADA'` — las de campo libre (`LIBRE`) no aparecen en el tablero aunque estén completadas
- **[2026-04-09]** `operatorAssignments` hace matching por nombre además de ID porque filas históricas no tienen `operador_id` consistente — no eliminar ese fallback por nombre
- **[2026-04-09]** El `dateKey` se calcula en zona `America/Bogota`. Si el servidor guarda `created_at` en UTC, una asignación creada a las 11pm Colombia (3am UTC del día siguiente) puede aparecer en el día incorrecto si se calcula sin zona
- **[2026-04-09]** Los caracteres `Â·` en la UI son un bug de encoding (UTF-8 leído como Latin-1). El separador correcto es `·` (U+00B7). Verificar encoding del archivo antes de editar App.tsx
