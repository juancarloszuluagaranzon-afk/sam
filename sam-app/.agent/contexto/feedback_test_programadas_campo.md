---
name: feedback-test-programadas-campo
description: "Regla del usuario — al tocar edición/labores, SIEMPRE revisar la lógica en programadas (ASIGNADA) y tomadas en campo (LIBRE)"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 28aa41c3-1db2-4e9f-bbd1-5f104a70108e
---

Al hacer cambios que toquen labores (edición, estado, guardado, guardas de duplicados, reutilización de línea, columnas nuevas), **SIEMPRE revisar/probar la lógica en los DOS tipos**: labores **programadas** (`kind='ASIGNADA'`, creadas por el supervisor) y **tomadas en campo** (`kind='LIBRE'`, `takeFreeField`).

**Why:** llegan por caminos distintos con datos distintos (ej. LIBRE nace con cliente/zona en null hasta que el supervisor aprueba). Un cambio que funciona en una puede romper la otra. El usuario lo ha repetido.

**How to apply:** antes de dar por cerrado un cambio en `editAssignment`/`updateAssignment`/`finishAssignment`/guardas, verificar ambos `kind`. Ver el gotcha en `managing-assignments` (2026-07-06) y [[project-reglas-asignaciones]].

**Caso 2026-07-06 (tope área ejec ≤ área suerte):** el usuario repitió la regla al blindar que no se pueda pagar más área de la que tiene la suerte. Verificado: `mapAssignmentPayload` llena los mismos campos para ASIGNADA y LIBRE, y el trigger `asignaciones_cap_area` suma **ambos tipos juntos** (filtra por suerte+labor+hacienda+ciclo+estado, NO por `tipo_registro`) contra el área. La toma en campo nace ya topada vía `getRemainingArea`. Regla: cualquier tope/suma de área debe contar programadas Y campo contra el mismo límite.
