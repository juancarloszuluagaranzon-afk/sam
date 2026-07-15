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
| `equipos` | `id` (serial), `codigo`, `nombre`, `tipo` (enum `tipo_equipo`, def `tractor`), `estado` (enum `estado_equipo`: `activo`/`en_mantenimiento`/`inactivo`), `marca`, `modelo`, `año` (con ñ), `placa`, `numero_serie`, `observaciones`, `activo` (bool). **RLS de escritura: mig. `20260623130000`** (antes solo SELECT → crear equipo desde la app fallaba). |
| `labor_sesiones` | log inmutable de cada sesión (inicio→cierre): `asignacion_id`, `fecha`, `horometro_inicial/final`, `horas`, `area_ejecutada` (mig. `20260614120000`) |
| `labores_catalogo` | catálogo CRUD de TIPOS de labor: `id` (uuid), `nombre` (unique), `activa` (bool), `tipo` (`MECANIZADA`/`MANUAL`), **`meta_ha_dia numeric`** (meta de productividad, mig. `20260712120000`), `created_at`, `updated_at` (migs. `20260615120000` + `20260615130000`) |
| `ingenios` | catálogo REAL de ingenios/compradores (el `ingenio_id` del maestro): `id` (text SLUG estable — amarra `maestro.ingenio_id`, NO cambia al renombrar), `nombre`, `activo`, `created_at`, `updated_at` (mig. `20260708120000`). Editable en Catálogos → Ingenios. Centralizó la lista fija de 5 que estaba duplicada en 6 archivos (`src/data/ingenios.ts`). |
| `motivacion` | config del refuerzo motivacional (fila única `id='default'`): `mensaje`, `imagen_url`, `umbral` (%, def 100), `meta_dia_ref` (ha/día indicador diario, def 15, mig. `20260712130000`), `activo` (mig. `20260712120000`). Editable en Catálogos → 🏆 Motivación (owner/admin). |
| `planilla_revisiones` | **resaltado** de celdas (operario×día) de la Planilla: `id`, `operador_id`, `fecha`, `color` (`azul`/`rojo`/`amarillo`/`verde`, def `azul`, mig. `20260617120000`), `revisado_por`, UNIQUE(`operador_id`,`fecha`) (mig. `20260615140000`) |
| `labor_revisiones` | **(creada pero SIN USO en el cliente — el marcado de tarjetas se revirtió)** `id`, `asignacion_id` (unique), `revisado_por` (mig. `20260615150000`) |
| `operario_novedades` | novedad/disponibilidad por día del operario: `id`, `operador_id`, `fecha`, `tipo` (texto libre: `V T NP D P E C/CD/CN MV F OV MT IN` = Vacaciones/Taller/No-programado/Descanso/Permiso/Enfermedad/Camioneta/Máquina-varada/Falta-sin-justa-causa/Oficios-varios/Máquina-en-traslado/Incapacidad), UNIQUE(`operador_id`,`fecha`) (mig. `20260616130000`). El `tipo` es texto libre → **agregar nuevos tipos NO requiere migración** (solo código: ver managing-assignments "Patrón para agregar una novedad"). |
| `empresas` | catálogo SOLO informativo (CRUD): `id`, `nombre` (unique), `activo` (mig. `20260619120000`). NO se liga a nada (decisión del usuario). |
| `terceros` | catálogo informativo de ingenios/terceros: `id`, `nombre` (unique), `activo` (mig. `20260619120000`). NO se enlaza a suertes (se quitó el `tercero_id`). |
| `zonas` | catálogo: `id`, `codigo` (unique, p.ej. `NORTE`), `nombre`, `activo` (mig. `20260621120000`). `app_usuarios.zona` (= codigo) se asigna al SUPERVISOR para auto-llenar la zona al aprobar. |
| `insumos`, `insumos_kardex`, `insumos_solicitudes`, `insumos_solicitud_items` | **Módulo Insumos y Combustible** (catálogo/kardex, solicitudes, despachos con evidencia, costeo por máquina). Ver el skill **`managing-insumos`** para detalle completo. |

> ⚠️ **NO confundir `labores_catalogo` (nuestro) con `labores` (singular).** Existe una tabla `labores` que pertenece a OTRO módulo (recibos/nómina): es transaccional, `id` **entero serial**, ~18 columnas (`tipo_labor_id`, `maestro_id`, `hacienda`, `nombre_hacienda`…), y tiene una FK desde `recibos` (`recibos_labor_id_fkey`) + policy `operario_ver_sus_recibos`. **NUNCA hacer DROP ni ALTER de `labores`.** Por eso el catálogo de labores se llama `labores_catalogo`.

### Constraints relevantes

- `asignaciones_estado_check`: `estado IN ('PENDIENTE', 'EN_PROCESO', 'COMPLETADA', 'CANCELADA', 'PARCIAL')`
- `uniq_maestro_suerte`: UNIQUE `(hacienda, suerte, ingenio_id)` en `maestro_risaralda` — evita duplicados ad-hoc cross-supervisores. Violación → error 23505 (PostgREST `unique_violation`).
- `app_usuarios.rol` CHECK: `('supervisor', 'operador', 'owner', 'administracion', 'soporte', 'supervisor_insumos')` (soporte en mig. `20260611120000`; **`supervisor_insumos` en mig. `20260623140000`**). ⚠️ **SÍ existe el CHECK** (confirmado 2026-06-23) → cualquier rol nuevo DEBE agregarse al CHECK o crear el usuario falla con 23514. La mig. `20260623140000` busca el CHECK por su nombre real (DO block) y lo recrea. Verificar: `SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='public.app_usuarios'::regclass AND contype='c';`
- **Rol `soporte` (impersonación):** entra a una pantalla "Ver como…" (`SupportSwitcher`) que intercambia la sesión efectiva para ver/actuar como propietario, administración, o un supervisor/operario concreto. **GOTCHA:** el rol DB→app se mapea en DOS sitios de `samApi.ts` — `loadAppUsers` Y **`appLogin`**. Si agregas un rol y solo tocas uno, el login lo manda al fallback `'operador'`. Actualizar AMBOS.

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

## RPC de gestión de usuarios (CRUD)

Las 3 funciones viven en la migración `20260514120000_user_crud_md5.sql` (un
solo commit, `SECURITY DEFINER`, `search_path = public,pg_catalog`, grants a
`anon, authenticated`). **Todas usan `md5(pin || ':sam-piloto')`** — consistente
con `app_login`. NUNCA `crypt`/`gen_salt`/bcrypt (esos PINs nunca podrían
loguearse y `gen_salt` falla fuera del search_path).

```ts
// crear (samApi.createAppUser) — el id lo GENERA EL SERVIDOR (ver abajo); p_pin obligatorio
supabase.rpc('app_create_user', { p_id, p_nombre, p_rol, p_pin, p_equipo_codigo, p_zona })
// editar (samApi.updateAppUser) — p_pin NULL/'' deja el hash sin tocar
supabase.rpc('app_update_user', { p_id, p_nombre, p_rol, p_pin, p_equipo_codigo, p_zona })
// eliminar (samApi.deleteAppUser) — SOFT delete: activo=false
supabase.rpc('app_delete_user', { p_id })
// activar/desactivar (samApi.setAppUserActivo) — mig. 20260623160000
supabase.rpc('app_set_user_activo', { p_id, p_activo })
```

- **[2026-06-24] `app_create_user` GENERA el id en el servidor** (mig. `20260623170000`): `U + (max número existente + 1)` sobre TODOS los usuarios (activos o no). `p_id` se ignora. Antes el cliente calculaba el id sobre la lista cargada; si esa lista no traía inactivos, repetía un id ocupado → `duplicate key app_usuarios_pkey` al crear. Con el id server-side **nunca colisiona**.
- **[2026-06-24] Activar/desactivar usuarios:** `app_set_user_activo(p_id, p_activo)` (SECURITY DEFINER). La pestaña Usuarios lista activos e inactivos (chip "Inactivo" + botón Activar/Desactivar; no auto-desactivarse). `setAppUserActivo` cachea 23505 (índice único de nombre) → "Ya existe un usuario ACTIVO con ese nombre."
- **[2026-06-24] `loadAppUsers` ya NO filtra `activo`** (carga TODOS y mapea `active`). Los selectores/asignación filtran activos aparte (`AppDataContext`: operators/supervisors con `active !== false`; `ImpersonationBar`/`SupportSwitcher` no impersonan inactivos).
- **`app_delete_user` es soft-delete** (`activo=false`); el histórico de labores (FK por `operador_id`) se conserva.
- **Quién puede gestionar usuarios:** `owner` Y `administracion`. La pestaña
  Usuarios y el modal en `SupervisorView` están gateados a
  `role === 'owner' || role === 'administracion'`. `administracion` tiene su
  botón Usuarios en la nav plana (no usa el menú "Más", que solo es owner/superv).
- **Guard anti-bloqueo:** el botón Eliminar se deshabilita si
  `editingUserId === session.id` (no auto-eliminarse). El borrado de usuarios
  es SIN confirmación nativa: usa un modal superpuesto (z-index 2000, renderizado
  DESPUÉS del modal de usuario en el DOM para quedar encima — el usuario se
  quejó antes de confirmaciones que quedaban detrás del formulario).
- Tras crear/editar/eliminar se llama `loadAppUsers()` + `setUsers()` para
  refrescar la lista al instante (las RPC no devuelven la fila).

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
- **[2026-07-08→14] Migraciones nuevas (todas idempotentes, anon_key/RLS abierta salvo nota).**
  - **`20260708120000_ingenios_catalogo`**: tabla `ingenios` (slug PK). El cliente la corre en Studio; el código NO se rompe sin ella (fallback a semilla en `src/data/ingenios.ts`).
  - **`20260708130000_retention_ciclo_vida`**: función `public.sam_run_retention()` (SECURITY DEFINER, `GRANT EXECUTE anon`) → Nivel 1 cancela PENDIENTE/EN_PROCESO con `area_realizada=0` +3d; Nivel 2 borra CANCELADA con `area_realizada=0` +3d. NUNCA toca COMPLETADA/PARCIAL ni EN_PROCESO con área. La dispara owner/admin 1×/día desde el cliente (`runRetention`, throttle `sam-retention-last`) + opcional pg_cron. **Las rechazadas (CANCELADA con area>0) NO se purgan** → quedan como auditoría.
  - **`20260711120000_insumos_confirmacion`** + **`...130000` (cantidad_recibida)**: aval del operario (ver `managing-insumos`).
  - **`20260712120000_rendimiento_operario`**: `labores_catalogo.meta_ha_dia` + tabla `motivacion`. **`20260712130000`**: `motivacion.meta_dia_ref` (def 15). El KPI de rendimiento es 100% cliente (cero carga BD).
  - **RECHAZAR labor** (14-jul, sin migración): `decideApproval` con RECHAZADA pone `estado='CANCELADA'` (+ `aprobacion='RECHAZADA'`) → sale de todo conteo de área. **Datos viejos** normalizados 1 vez: `update asignaciones set estado='CANCELADA' where aprobacion='RECHAZADA' and estado in ('COMPLETADA','PARCIAL')` (16 filas). Ver `managing-assignments`.
- **[2026-07-05] Facturación: `asignaciones.factura_numero text`** (mig. `20260705150000` + índice parcial). Administración le pone N° de factura a labores realizadas (desde el modal Editar); alimenta el KPI "Área facturada" (`summarizeAssignments.billedArea`). `updateAssignment` mapea `factura_numero` (`|| null`). Detalle en `managing-assignments`.
- **[2026-07-05] Auditoría integral (6 agentes) — correcciones aplicadas.**
  - **Sync/offline (críticos):** (1) el outbox ya **recuenta incluyendo `error`** (antes `setOutboxCount(0)` ocultaba trabajo rechazado → pérdida silenciosa), **reintenta** los `error` y guarda `errorMessage`; `getPendingOutboxIds` incluye `error`. (2) **DELETE reconciliado en Realtime** (`useSync.ts`): el delta NO trae borrados → se captura el `payload.old.id` del evento DELETE y se hace `db.assignments.bulkDelete` (antes la fila borrada "resucitaba" en los otros equipos). (3) **Anti-cap también en el delta**: si el delta trae ≥1000 filas, cae al full sync (que sí tiene open+recent).
  - **Trigger cap-área (fix):** la suma del ciclo ahora filtra TAMBIÉN por `nombre_hacienda` (`20260630120000` re-corrida) — el código de hacienda compartido (`1`+mayagüez) mezclaba dos haciendas. Re-correr la migración.
  - **Índices** (`20260705120000`): `created_at`, `updated_at`, `estado`, `operador_id`, `supervisor_id` + funcional `(suerte_codigo, upper(btrim(labor_nombre)), estado)` para el trigger. Antes CERO índices → seq-scan en cada sync.
  - **Auditoría registra DELETE** (`20260705130000`): rama `AFTER DELETE` (antes el borrado —lo más sensible— no dejaba traza).
  - **Baseline** (`20260401000000`): `asignaciones` no la creaba ninguna migración (solo ALTERs) → restore/staging fallaba. `CREATE TABLE IF NOT EXISTS` reconstruido; NO afecta producción.
- **[2026-07-05] ⚠️ SEGURIDAD (el dueño lo tiene como baja prioridad, pero documentado).** Con el `anon_key` (público en el bundle) cualquiera puede: leer `pin_hash` de todos (`app_usuarios` con `USING(true)`, sin revoke de columna) → PIN `md5(pin+':sam-piloto')` de 4 dígitos se revierte en segundos; los PIN semilla están en el repo (`SOP01=1357`, `SOP02=2468`, `U032=1234`); `DELETE` de cualquier tabla; y crear un usuario `owner` vía `app_create_user` (RPC `DEFINER` + `GRANT anon` sin verificar rol). **Raíz:** un solo `anon_key` compartido usado como auth + control de acceso solo en la UI. Mitigaciones baratas: rotar los 3 PIN semilla, `REVOKE SELECT(pin_hash)` (via grant de columnas explícito), mover DELETE/gestión-usuarios a RPC con rol. Ver informe de auditoría (artifact).
- **[2026-06-29] Nuevos paths de escritura (sin migración, reusan policies existentes).** (1) **`registrarLaborRealizada`** — INSERT directo en `asignaciones` que nace `estado=COMPLETADA` + `aprobacion=APROBADA` (registro rápido del supervisor; ver `managing-assignments`). (2) Maestro: **`bulkUpdateMaestroArea`**/**`bulkReactivateMaestro`**/**`bulkDeactivateMaestro`** (UPDATE sobre `maestro_risaralda`, reusan la policy de UPDATE mig. `20260601150000`; ver `managing-maestro`). (3) **`updateAssignment` ya mapea `aprobacion`/`aprobada_por`/`aprobada_en`** → el `EditPatch` del Reporte (editar ESTADO) los usa para mandar a la bandeja: COMPLETADA/PARCIAL → `aprobacion=PENDIENTE`. Ningún path nuevo necesitó policy nueva.
- **[2026-06-24] ⚠️ RLS, no el cliente: los INACTIVOS no llegaban aunque el query no filtrara.** Síntoma: tras quitar `.eq('activo', true)` de `loadAppUsers`, los usuarios inactivos **seguían sin aparecer** — ni en incógnito ni tras rebuild. **Causa:** la policy de SELECT de `app_usuarios` restringía a `activo=true` → RLS los filtra **en el servidor** para el rol `anon` (Studio/`postgres` los ve porque bypassa RLS — pista clásica). **Fix:** mig. `20260623180000` agrega policy permisiva `app_usuarios_select_all ... FOR SELECT TO anon, authenticated USING (true)` (las permisivas se combinan con OR → con `USING(true)` pasan todos). `pin_hash` nunca se selecciona. **Regla:** si una fila existe en Studio pero el cliente anon no la recibe pese a un query sin filtro, sospechar de la policy de SELECT (su `USING`), no del frontend ni de la caché.
- **[2026-06-24] `loadAssignments` (full sync) carga SIEMPRE todas las ABIERTAS — anti-cap de PostgREST.** Antes hacía `select('*').order('created_at', desc)` sin paginar → PostgREST capa en ~1000 filas; ordenando por `created_at`, las asignaciones VIEJAS (incluidas programadas/abiertas) se salían de la ventana y **desaparecían de Activas en cada full sync** (caso real con 1020 filas totales). **Fix:** dos consultas combinadas (dedupe por id): (1) `not('estado','in','(COMPLETADA,CANCELADA,FINALIZADO)')` = TODAS las abiertas sin importar antigüedad; (2) las recientes para historial. Una abierta nunca se pierde hasta cerrarse/cancelarse. El delta sync no se tocó (acumula).
- **[2026-06-24] `updateAssignment` ganó `created_at` + `supervisor_id`/`supervisor_nombre`.** `UpdateAssignmentInput` acepta `createdAt`, `supervisorId`, `supervisorName`. Se usan al **reutilizar** una línea PENDIENTE (re-toma/re-asignación): resetear `created_at` a hoy reinicia el reloj de 72h y reaparece en Activas; cambiar el supervisor deja la reasignación bajo quien la toma (scope correcto). Detalle del flujo en `managing-assignments` → "Reutilizar la línea PENDIENTE original".
- **[2026-06-23]** **Usuarios DUPLICADOS por nombre descuadran el Resumen vs el Reporte.** Existían dos `app_usuarios` "JULIO CESAR NIÑO" (U033 real + U040 dup); una labor quedó con `supervisor_id='U040'`. **Síntoma:** la labor salía en el **Reporte** pero no en el **Resumen**. **Causa:** el Resumen (`scopedAssignments`) filtra `supervisorId === session.id` (id, NO nombre); como el id de sesión era U033, excluía la de U040. El Reporte no scopeaba → la mostraba. **Diagnóstico clave:** `select supervisor_id, supervisor_nombre, count(*) from asignaciones where operador_nombre ilike '%X%' group by 1,2;` revela dos ids con el mismo nombre. **Arreglo de datos:** reasignar TODAS las referencias del dup al id real ANTES de borrarlo — `asignaciones.supervisor_id`/`operador_id`, `insumos_solicitudes.operario_id`/`despachado_por`, `insumos_kardex.creado_por`, `operario_novedades.operador_id`, `planilla_revisiones.operador_id`/`revisado_por` (en las tablas con UNIQUE(operador_id,fecha), borrar primero las del dup que choquen) → luego `update app_usuarios set activo=false where id=dup`. **Prevención (doble):** (1) índice único parcial `app_usuarios_nombre_activo_uniq on (lower(btrim(nombre_completo))) where activo=true` (mig. `20260623150000`) — imposible crear dos activos con igual nombre; (2) guard en el form de Usuarios (`SupervisorView`) que bloquea nombres repetidos contra la lista `users`. **Regla general: el scope/agrupación por persona SIEMPRE debe ser por `id`, no por nombre; y los nombres de usuario deben ser únicos.**
- **[2026-06-23]** **Reporte y Resumen ahora scopean IGUAL por supervisor.** `filteredReport` (App.tsx) filtra `supervisorId === session.id` cuando `role==='supervisor'` (owner/admin/soporte ven todo), igual que `scopedAssignments` del Resumen. Antes el Reporte mostraba TODO a un supervisor (inconsistente con su Resumen). Si una labor no aparece para un supervisor en ninguno de los dos, revisar que su `supervisor_id` sea el del supervisor (ver gotcha anterior).
- **[2026-06-18]** **Nombres de `app_usuarios.nombre_completo` con espacio/NBSP al inicio rompen el orden alfabético** (quedan arriba de todo porque el espacio ordena antes que las letras). Diagnóstico: `select '['||nombre_completo||']', ascii(left(nombre_completo,1)) from app_usuarios where ...` (32=espacio, 160=NBSP). Limpieza de raíz: `UPDATE app_usuarios SET nombre_completo = btrim(replace(nombre_completo, chr(160), ' ')) WHERE nombre_completo IS DISTINCT FROM btrim(...);`. El cliente además hace `.trim()` defensivo al ordenar (Planilla) — `.trim()` de JS quita espacio Y NBSP.
- **[2026-06-18]** **Editar la FECHA de ejecución** de una labor (Reporte/Labores → Editar → "Fecha de ejecución"): se setean `fecha_inicio` y `fecha_fin` al nuevo día a las **12:00 hora Colombia** (`new Date('YYYY-MM-DDT12:00:00-05:00').toISOString()`) para que `dayKey`/`executionDateKey` (en America/Bogota) caiga EXACTO en ese día. Usar una fecha-solo (`'YYYY-MM-DD'`) daría medianoche UTC → en Bogota retrocede un día. Requiere `startedAt`/`finishedAt` en el `EditPatch` de `useAssignmentActions` (ya mapeados en `updateAssignment` → `fecha_inicio`/`fecha_fin`). Mueve la labor al día correcto en Planilla/Reporte.
- **[2026-06-16]** **Borrar líneas del Reporte = DELETE real sobre `asignaciones`.** El cliente usa anon_key y antes solo hacía INSERT/UPDATE → faltaba policy de DELETE. Sin ella, un `DELETE` vía RLS borra **0 filas sin lanzar error** y la fila **reaparece al siguiente full sync** (síntoma traicionero: "se borró pero volvió"). Fix: mig. `20260616120000_asignaciones_delete_policy.sql` (`CREATE POLICY asignaciones_delete ... FOR DELETE TO anon, authenticated USING (true)` + `GRANT DELETE`). `samApi.deleteAssignment(id)` hace el delete; el llamador limpia caché con `setAssignments(filter)` + `db.assignments.delete(id)`. Lo usa solo el Reporte (dueño/admin) para ajustar liquidación; tiene modal de confirmación.
- **[2026-06-15]** **Colisión de nombre de tabla.** Al crear el catálogo de labores, `CREATE TABLE IF NOT EXISTS labores (...)` NO hizo nada porque ya existía una `labores` (del módulo recibos) con otro esquema → el `INSERT (nombre, activa)` reventó con `42703 column "nombre" does not exist`. Y el `DROP TABLE labores` falló con `2BP01` (FK `recibos_labor_id_fkey` depende). **Lección: antes de crear una tabla, verifica que el nombre no exista** (`SELECT * FROM information_schema.columns WHERE table_name='X'`). Solución aplicada: renombrar nuestro catálogo a `labores_catalogo`.
- **[2026-06-15]** **Catálogo de labores con caché offline (Dexie v7).** `labores_catalogo` se carga en `AppDataContext` (fase 1 caché `db.labores.toArray()` + fase 2 `loadLabores()`), se cachea en el store Dexie `labores` (nombre local, distinto del remoto). El contexto expone `activeLabores` (activas, alfabético, fallback a `WORKFLOW` si aún no carga) y `fieldLabores` (activas + `tipo !== 'MANUAL'`, para el picker del operario de tractor en campo). Los pickers de asignar/Tablero usan `activeLabores`; el de campo usa `fieldLabores`. La lógica de "siguiente labor"/progreso sigue usando la constante `WORKFLOW`. **GOTCHA:** al agregar un store Dexie nuevo, bump de versión (`this.version(7).stores({ labores: 'id, nombre' })`) + declarar la propiedad en la clase.
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
