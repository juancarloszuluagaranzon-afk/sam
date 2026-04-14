---
name: managing-supabase
description: >
  Guía para todas las operaciones con Supabase en SAM. Úsala cuando escribas
  queries, nuevas funciones en samApi.ts, mapeos de filas, o manejes errores
  de Supabase. También cuando el usuario mencione "supabase", "tabla", "query",
  "rpc", "fallback" o "maestro".
---

# Managing Supabase — SAM

## Patrón de retorno obligatorio

Todas las funciones de carga usan el tipo `Source` y deben retornar así:

```ts
type Source = 'supabase' | 'fallback'

// SIEMPRE retorna { data, source } — nunca lances directamente
if (error || !data?.length) {
  return { data: LOCAL_MAESTRO, source: 'fallback' }
}
return { data: mapped, source: 'supabase' }
```

## Tablas existentes en Supabase

| Tabla | Campos clave |
|-------|-------------|
| `asignaciones` | `id`, `suerte_codigo`, `numero_suerte`, `codigo_hacienda`, `nombre_hacienda`, `labor_nombre`, `tractor`, `equipo_codigo`, `equipo_nombre`, `area_asignada`, `estado`, `fecha_inicio`, `fecha_fin`, `area_realizada`, `observaciones`, `supervisor_id`, `supervisor_nombre`, `operador_id`, `operador_nombre`, `tipo_registro`, `created_at` |
| `maestro_risaralda` | `hacienda`, `nombre_hacienda`, `suerte`, `area_neta`, `activo` |
| `app_usuarios` | `id`, `nombre_completo`, `rol`, `equipo_codigo`, `activo`, `orden` |
| `equipos` | `codigo`, `nombre`, `activo` |

## mapAssignment — mapeo canónico

La función `mapAssignment` es la única fuente de verdad para convertir filas de DB a `Assignment`. Úsala siempre, no hagas mapeos inline:

```ts
// El suerteCode puede venir de suerte_codigo (ej: "103-0001") o de campos separados
const suerteCode = String(row.suerte_codigo ?? '')
const parts = suerteCode.includes('-') ? suerteCode.split('-') : []
const haciendaCode = Number(row.codigo_hacienda ?? parts[0] ?? 0)
const suerte = String(row.numero_suerte ?? parts[1] ?? '')
```

## normalizeStatus — aliases de estado

La DB puede tener valores legacy. Siempre normaliza:

```ts
'ASIGNADO' | 'PENDIENTE'  → 'PENDIENTE'
'EN_PROGRESO' | 'EN PROGRESO' | 'EN_PROCESO' → 'EN_PROCESO'
'FINALIZADO' | 'COMPLETADA' → 'COMPLETADA'
'CANCELADA' → 'CANCELADA'
default → 'PENDIENTE'
```

## RPC de login

```ts
const { data, error } = await supabase.rpc('app_login', {
  p_user_id: userId,
  p_pin: pin,
})
// data es un array, tomar data[0]
```

## mapAssignmentPayload — campos escritura

Al insertar en `asignaciones`, el campo `tractor` es alias legacy de `equipo_nombre`. Siempre escribe ambos:

```ts
tractor: input.equipmentName || input.equipmentCode,
equipo_codigo: input.equipmentCode,
equipo_nombre: input.equipmentName || input.equipmentCode,
```

## dayKey — zona horaria Colombia

Siempre usar `'America/Bogota'` para calcular la fecha clave:

```ts
function dayKey(value: string | null | undefined) {
  if (!value) return ''
  return new Date(value).toLocaleDateString('en-CA', {
    timeZone: 'America/Bogota',
  })
}
```

## Gotchas
- **[2026-04-13]** La tabla maestro no coincide con la base de datos porque Supabase/PostgREST limita los requests GET a 1000 registros por defecto. → solución: Implementar paginación usando un bucle con el método .range(start, end) de supabase-js, concatenando los resultados hasta obtener todo el conjunto de datos.

- **[2026-04-09]** `supabase.rpc('app_login')` retorna array aunque sea un solo usuario → siempre usar `data[0]`, nunca `data` directo
- **[2026-04-09]** El campo `equipo_codigo` en filas históricas puede estar vacío; usar `row.equipo_codigo ?? row.tractor ?? ''` para leer, nunca solo `row.equipo_codigo`
- **[2026-04-09]** `normalizeStatus` debe existir porque la DB tiene valores legacy (`ASIGNADO`, `EN PROGRESO`, `FINALIZADO`) que NO coinciden con el tipo `AssignmentStatus`
- **[2026-04-09]** El `suerteCode` en filas antiguas puede estar ausente — reconstruirlo como `${haciendaCode}-${suerte}` si `suerte_codigo` viene vacío
- **[2026-04-09]** Al usar `.eq('activo', true)` en `maestro_risaralda`, si no hay resultados retorna fallback a `LOCAL_MAESTRO` — no lanzar error, es comportamiento esperado
