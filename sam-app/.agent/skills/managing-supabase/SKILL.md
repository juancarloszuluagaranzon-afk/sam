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
| `maestro_risaralda` | `hacienda`, `nombre_hacienda`, `suerte`, `area_neta`, `ingenio_id`, `activo`, `creado_manual`, `creado_por`, `creado_en` |
| `app_usuarios` | `id`, `nombre_completo`, `rol`, `equipo_codigo`, `activo`, `orden` |
| `equipos` | `codigo`, `nombre`, `activo` |

### Constraints relevantes

- `asignaciones_estado_check`: `estado IN ('PENDIENTE', 'EN_PROCESO', 'COMPLETADA', 'CANCELADA', 'PARCIAL')`
- `uniq_maestro_suerte`: UNIQUE `(hacienda, suerte, ingenio_id)` en `maestro_risaralda` — evita duplicados ad-hoc cross-supervisores. Violación → error 23505 (PostgREST `unique_violation`).
- `app_usuarios.rol` CHECK: `('supervisor', 'operador', 'owner', 'administracion')`

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
'PARCIAL' → 'PARCIAL'
default → 'PENDIENTE'
```

## CHECK constraint del estado de asignaciones

Vive en `public.asignaciones.asignaciones_estado_check`. Valores válidos actuales:

```
PENDIENTE, EN_PROCESO, COMPLETADA, CANCELADA, PARCIAL
```

Al agregar un nuevo valor de status, **NO** olvidar:
1. Crear migración SQL en `supabase/migrations/YYYYMMDDHHMMSS_*.sql` con `DROP CONSTRAINT IF EXISTS` + `ADD CONSTRAINT` (idempotente) + `NOTIFY pgrst, 'reload schema';`
2. Aplicar en VPS via Supabase Studio (SQL Editor) — más fácil que `docker exec` y no requiere SSH/password root
3. Verificar con: `SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'asignaciones_estado_check';`
4. Si el frontend ya está deployado con el valor nuevo y el CHECK aún no se actualizó en DB, los UPDATE/INSERT fallarán con error 23514. **Aplicar la migración SIEMPRE antes de hacer push del código que usa el valor nuevo.**

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
- **[2026-06-01]** El VPS hospeda MÚLTIPLES proyectos, cada uno con su propio Postgres: `pos_postgres`, `surco_postgres`, `saas_barberias_postgres`, `karpos-postgres` (todos `postgres:16-alpine`) MÁS la pila Supabase. **SAM/AgroMorales usa el contenedor `supabase-db`** (`supabase/postgres:15.8.1.085`), NO los `*_postgres`. Al aplicar SQL por SSH+docker exec, apuntar SIEMPRE a `supabase-db`; detectar por "primer contenedor con 'postgres'" toma `pos_postgres` por error (y ahí el rol `postgres` ni existe → "role postgres does not exist"). Comando correcto: `docker exec -i supabase-db sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" psql -U postgres -d postgres'` y la SQL por stdin. Verificar policies con la VISTA `pg_policies` (tiene `cmd`), NO la tabla `pg_policy` (usa `polcmd`).
- **[2026-06-01]** Para EDITAR el maestro desde el cliente (pestaña "Maestros": `updateMaestroRow` cambia `area_neta`) hace falta una policy RLS de UPDATE, igual que la de INSERT. Migración `20260601150000_maestro_rls_update.sql`: `CREATE POLICY maestro_anon_update ... FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true)`. Sin ella: error de RLS al guardar. La autorización por rol (solo dueño/admin/supervisor) es en la UI, no en DB (auth por PIN propia, todos usan anon_key). NO rompe flujos existentes si se despliega antes (solo falla el guardado del área hasta aplicarla), pero igual aplicar antes por consistencia. `updateMaestroRow` identifica la fila por la clave única `(hacienda, suerte, ingenio_id)` y refleja el cambio en Dexie con `db.maestro.put`.
- **[2026-05-30]** Al agregar una columna nueva que `updateAssignment` SIEMPRE escribe en cierto flujo (ej: `liberada` se pone en `false` al reasignar), aplicar la migración en Studio **ANTES** del push. Si no, PostgREST devuelve 42703 (`column "liberada" does not exist`) y **rompe el flujo existente** (la reasignación del supervisor empezaría a fallar, no solo la feature nueva). Patrón de columna boolean: migración `ADD COLUMN IF NOT EXISTS liberada boolean NOT NULL DEFAULT false;` + `NOTIFY pgrst, 'reload schema';` → `domain/sam.ts` (Assignment + UpdateAssignmentInput) → `mapAssignment` (`Boolean(row.liberada ?? false)`) → `updateAssignment` (`if (input.liberada !== undefined) payload.liberada = input.liberada`). Verificar con `SELECT column_name FROM information_schema.columns WHERE table_name='asignaciones' AND column_name='liberada';`.
- **[2026-05-29]** Para INSERT/UPDATE/DELETE desde el cliente (anon_key) en una tabla con RLS, NO basta el `GRANT`: hace falta una **policy permisiva por comando**. Síntoma: `new row violates row-level security policy for table "X"`. Si el error fuera de GRANT diría `permission denied for table X` (distinto). `maestro_risaralda` tenía solo policy de SELECT (catálogo cargaba) pero faltaba la de INSERT → `createMaestroRow` fallaba. Fix: migración `20260529130000_maestro_rls_insert.sql` con `CREATE POLICY ... FOR INSERT TO anon, authenticated WITH CHECK (creado_manual = true)`. El `WITH CHECK (creado_manual = true)` es un guard: el cliente solo puede insertar suertes ad-hoc, no falsificar catálogo oficial. Las policies aplican de inmediato (no requieren `NOTIFY pgrst`). Verificar con `SELECT polname, cmd FROM pg_policy WHERE polrelid = 'public.maestro_risaralda'::regclass;`.
- **[2026-05-29]** Bug "se borran los campos del modal": un `useEffect` de reset que dependía de un prop array recalculado por el padre (`haciendas`, derivado del maestro). Al llegar un evento de Realtime, la referencia del array cambiaba y el efecto se re-disparaba borrando lo escrito. Fix: el reset debe depender SOLO de `open` (transición cerrado→abierto), leyendo prefills/arrays por closure. Regla general: efectos de "inicializar al abrir un modal" → dependencia única el flag de apertura, nunca props derivados que cambian de referencia.
- **[2026-05-29]** Al agregar columnas a `maestro_risaralda`, NO olvidar incluirlas en `select(...)` del `loadMaestro` y mapearlas en el `.map()` a camelCase en `MaestroRow`. Si solo agregas en la migración SQL, las columnas existen pero el cliente no las ve. Patrón: SQL → domain interface → loader select → loader map → uso en UI.

- **[2026-05-29]** El error 23505 (`unique_violation`) de PostgREST viene como `error.code === '23505'`. En `createMaestroRow` se atrapa y se re-lanza como `new Error('DUPLICATE')` para que el llamador muestre un mensaje accionable sin exponer el error técnico al usuario. Patrón reusable para otros INSERTs con UNIQUE constraints.

- **[2026-05-27]** Para agregar campos editables nuevos al `updateAssignment` (samApi.ts), recordar el mapeo camelCase → snake_case del DB: `operatorId → operador_id`, `operatorName → operador_nombre`, `equipmentCode → equipo_codigo`, etc. El `UpdateAssignmentInput` (domain/sam.ts) debe declarar el campo Y `updateAssignment` debe agregar la línea `if (input.X !== undefined) payload.x_snake = input.X`. Si solo agregas a uno de los dos lados, TypeScript no se queja pero el campo nunca llega a la DB.

- **[2026-05-27]** El comando para verificar un CHECK constraint en Studio: `SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'public.asignaciones'::regclass AND conname = 'asignaciones_estado_check';`. El resultado se trunca visualmente en la tabla del SQL Editor. Para confirmar inclusión de un valor específico sin truncado, usar: `SELECT CASE WHEN pg_get_constraintdef(oid) LIKE '%PARCIAL%' THEN 'OK' ELSE 'FALTA' END FROM pg_constraint WHERE conname = 'asignaciones_estado_check';`.

- **[2026-04-16]** Al importar CSVs masivos (12k+ filas) en Supabase, la operación puede truncarse silenciosamente por timeouts o límites de payload, dejando registros faltantes (ej: faltaban 231 filas de pichichi). → solución: Verificar siempre el conteo total por categoría (ingenio_id) contra el CSV original y completar los huecos mediante scripts de SQL que generen INSERTs por lotes.
- **[2026-04-16]** Al generar scripts de ayuda en Node.js para Windows (PowerShell), la redirección `node script.js > output.sql` puede usar encoding UTF-16LE por defecto, causando errores de lectura. → solución: Escribir el archivo directamente desde el script usando `fs.writeFileSync(file, content, 'utf8')` y usar la extensión `.cjs` si el proyecto es ESM.
- **[2026-04-13]** Cambios hechos localmente no se ven en Vercel de inmediato → solución: Asegurarse siempre de hacer commit y push de las correciones al repositorio (branch main) para que Vercel haga el redespliegue automático y refleje los cambios en producción.
- **[2026-04-13]** La tabla maestro no coincide con la base de datos porque Supabase/PostgREST limita los requests GET a 1000 registros por defecto. → solución: Implementar paginación usando un bucle con el método .range(start, end) de supabase-js, concatenando los resultados hasta obtener todo el conjunto de datos.

- **[2026-04-09]** `supabase.rpc('app_login')` retorna array aunque sea un solo usuario → siempre usar `data[0]`, nunca `data` directo
- **[2026-04-09]** El campo `equipo_codigo` en filas históricas puede estar vacío; usar `row.equipo_codigo ?? row.tractor ?? ''` para leer, nunca solo `row.equipo_codigo`
- **[2026-04-09]** `normalizeStatus` debe existir porque la DB tiene valores legacy (`ASIGNADO`, `EN PROGRESO`, `FINALIZADO`) que NO coinciden con el tipo `AssignmentStatus`
- **[2026-04-09]** El `suerteCode` en filas antiguas puede estar ausente — reconstruirlo como `${haciendaCode}-${suerte}` si `suerte_codigo` viene vacío
- **[2026-04-09]** Al usar `.eq('activo', true)` en `maestro_risaralda`, si no hay resultados retorna fallback a `LOCAL_MAESTRO` — no lanzar error, es comportamiento esperado
