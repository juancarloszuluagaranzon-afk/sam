---
name: managing-maestro
description: >
  Gestión del catálogo de suertes (maestro) en SAM, incluyendo creación
  ad-hoc cuando faltan suertes/haciendas en el catálogo oficial del
  ingenio. Úsala cuando el usuario mencione "maestro", "suerte nueva",
  "hacienda nueva", "catálogo", "ingenio", "createMaestroRow",
  "NewSuerteModal", "maestro_risaralda", o cuando trabajes con
  selectores de hacienda/suerte en formularios.
---

# Managing Maestro — SAM

El catálogo de suertes de SAM vive en **una sola tabla** `maestro_risaralda` (nombre legacy — contiene los 5 ingenios distinguidos por `ingenio_id`). El maestro lo "alimenta" cada ingenio enviando un Excel periódicamente, que se importa a la tabla. Pero los ingenios no actualizan constantemente: aparecen suertes nuevas en el campo que no están en el catálogo y trabarían la operación si no hubiera una vía manual.

## Estructura de `maestro_risaralda`

```sql
hacienda         text       -- código numérico/string de la hacienda (ej: "105")
nombre_hacienda  text       -- nombre legible en MAYÚSCULAS (ej: "SAN MIGUEL")
suerte           text       -- número de suerte con ceros a la izquierda (ej: "0042")
area_neta        numeric    -- hectáreas
ingenio_id       text       -- risaralda / pichichi / mayaguez / san_carlos / riopaila
activo           boolean    -- false = soft delete (no aparece en cliente)
creado_manual    boolean    -- NEW: true si se creó desde la app, false si vino del Excel oficial
creado_por       text       -- NEW: session.id del usuario que la creó
creado_en        timestamptz -- NEW: cuándo se creó
```

Constraints relevantes:
- **UNIQUE `(hacienda, suerte, ingenio_id)`** — `uniq_maestro_suerte`. Evita duplicados cross-supervisores que crean ad-hoc al mismo tiempo. Violación → error 23505.
- Sin tabla aparte para haciendas — la hacienda "existe" porque tiene al menos una fila con su código en el maestro.

Migración canónica: `supabase/migrations/20260529120000_maestro_creado_manual.sql`.

## Crear suertes/haciendas desde la app

Componente: `src/components/NewSuerteModal.tsx`. Se usa en `SupervisorView` (form Asignar) y en `OperatorView` (Tomar suerte en campo). Botón `+ Nueva suerte` aparece arriba del checklist de suertes solo cuando hay ingenio seleccionado.

Flujo:
1. Modal pide: ingenio, código hacienda, nombre hacienda, número suerte, área neta
2. Si el código de hacienda escrito no existe en el maestro del ingenio actual → chip verde **"+ Hacienda nueva — se creará al guardar"**
3. Validación cliente: chequea duplicados en el maestro local antes de pegar al servidor (mejor UX que el 23505)
4. `samApi.createMaestroRow(input)` → INSERT en `maestro_risaralda` con `creado_manual = true`, `creado_por`, `creado_en`
5. El componente padre recibe la fila en `onCreated(row)` y:
   - La agrega a `setMaestro((prev) => [...prev, row])` — aparece al instante sin esperar `loadMaestro`
   - Auto-selecciona ingenio + hacienda en el form padre
   - Agrega la suerte al checklist de seleccionadas

Roles permitidos: **supervisor, owner, administracion, operador**. El operador puede crear porque el caso típico es justo el operario que llega a campo y ve una suerte nueva.

## Pestaña "Maestros" — gestionar el catálogo (owner/admin/supervisor)

Componente `src/views/MaestrosTab.tsx`. Tab `'maestros'` en `SupervisorTab`. Acceso: **owner** y **supervisor** (menú "Más"), **administración** (tab directo). Operadores NO la ven.

Lista el catálogo con **búsqueda + panel de filtros emergente** (mismo patrón que Labores: ingenio / hacienda / origen oficial-vs-manual). El maestro tiene ~15K filas → la lista se topa en `LIMIT = 300`; si hay más, pide refinar (no renderiza todo, por rendimiento).

Acciones:
- **+ Nueva suerte** (header) → reusa `NewSuerteModal` (mismo flujo de `createMaestroRow`).
- **Editar** (por fila) → modal que cambia `area_neta` vía `samApi.updateMaestroRow(key, { area })`. La clave es `(haciendaCode, suerte, ingenio_id)`. Requiere la **policy RLS de UPDATE** (migración `20260601150000_maestro_rls_update.sql`).
- **Eliminar** (por fila) → confirmación → `samApi.deleteMaestroRow(key)` que hace **soft-delete** (`activo = false`), NO DELETE físico. Sale del catálogo/dropdowns (`loadMaestro` filtra `activo=true`) pero NO rompe el histórico de asignaciones que referencian la suerte. Reusa la MISMA policy de UPDATE — no necesita policy de DELETE.
- **Cargue masivo** (header) → `BulkMaestroModal`. **[2026-06-29] Pasó de "solo insertar" a RECONCILIACIÓN completa** (el ingenio actualiza su catálogo: aparecen/desaparecen suertes y cambian áreas). Ver la sección "Cargue masivo = reconciliación" abajo.

Tras editar/eliminar/crear, el componente actualiza `setMaestro` (in-memory) y `db.maestro` (Dexie) para reflejar el cambio al instante. La autorización por rol es en la UI (auth por PIN propia, todos usan anon_key a nivel DB).

## Cargue masivo = reconciliación [2026-06-29]

`BulkMaestroModal` (sube .xlsx, autodetecta hoja+columnas, valida ingenio/área>0/dedup interno) ahora **compara el archivo contra el catálogo ACTIVO** y muestra un **preview en 4 grupos** antes de tocar nada (decisión consciente del usuario para no duplicar ni variar arbitrariamente):

- 🟢 **Nuevas** (en archivo, no en catálogo) → se insertan (`bulkInsertMaestro`, ON CONFLICT DO NOTHING, `creado_manual=true`).
- 🟡 **Área cambiada** (misma suerte, área distinta) → lista con **checkbox por fila** (default marcado). Marcadas → `bulkUpdateMaestroArea`. Desmarcar = conservar el área actual.
- 🔴 **Desaparecidas** (en catálogo, no en archivo) → checkbox por fila → `bulkDeactivateMaestro` (soft-delete `activo=false`, conserva histórico). **ALCANCE por hacienda:** solo se evalúan desaparecidas en las **haciendas presentes en el archivo** (una hacienda ausente NO se toca) → seguro para cargas parciales. **Aviso ⚠ "labor activa":** una suerte a desactivar que tiene labor PENDIENTE/EN_PROCESO/PARCIAL **arranca SIN marcar** (no desactivar algo en uso).
- ⚪ **Sin cambios** → no se tocan.

**Reaparición:** una suerte que estaba soft-deleted y vuelve en el archivo se detecta como "nueva" que choca con la fila inactiva (el insert la omite) → el modal la **reactiva** con `bulkReactivateMaestro` (`activo=true` + área). Por eso el resultado del modal (`BulkApplyResult`) trae `inserted` (incluye reactivadas), `updated`, `deactivated`; `MaestrosTab.onApplied` actualiza `setMaestro` (agrega/actualiza área/quita) en consecuencia.

Funciones nuevas en `samApi` (todas reusan la policy RLS de UPDATE del maestro, mig. `20260601150000` — **NO requieren migración**): `bulkUpdateMaestroArea(rows)`, `bulkReactivateMaestro(rows)`, `bulkDeactivateMaestro(keys)`. Para el aviso de labor activa, `MaestrosTab` arma un `Set` de `"hacienda-suerte"` con labor activa desde `assignments` y se lo pasa al modal.

> ⚠️ La reconciliación depende de que `loadMaestro` traiga TODO el catálogo activo (pagina hasta ~20K). Si en algún momento se capa, las "desaparecidas" saldrían falsas (filas más allá del cap). Hoy pagina completo — no romper eso.

## Convenciones de datos

- **Nombre de hacienda**: SIEMPRE en mayúsculas. El input del modal aplica `.toUpperCase()` en `onChange` + `autoCapitalize="characters"` + `textTransform: uppercase` (3 capas). Razón: consistencia con el catálogo oficial del ingenio y los reportes.
- **Código de hacienda**: numérico/alfanumérico tal como lo manda el ingenio (no se normaliza).
- **Número de suerte**: ceros a la izquierda preservados (ej: `'0042'`, no `42`). El campo es texto, no número.
- **Área neta**: hectáreas con decimales. Validación: > 0.

## Marca visual de suertes manuales

En el checklist (`SupervisorView` y `OperatorView`), las suertes con `creadoManual === true` muestran un chip ámbar **"manual"** al lado del código. Estilo: `.suerte-manual-tag`. Permite distinguir visualmente del catálogo oficial sin invadir el flujo normal.

## Auditoría posterior por el owner

```sql
-- Lista de suertes creadas a mano, más recientes primero
SELECT hacienda, nombre_hacienda, suerte, area_neta, ingenio_id, creado_por, creado_en
FROM public.maestro_risaralda
WHERE creado_manual = true
ORDER BY creado_en DESC;
```

Cuando el ingenio envía el catálogo oficial y trae la misma suerte, el owner puede:
1. Actualizar `area_neta` si difiere del oficial
2. Marcar `creado_manual = false` (queda validada)

Hay índice parcial `idx_maestro_creado_manual` que solo indexa las manuales — query rápida sin escanear toda la tabla.

## loadMaestro y cache

`samApi.loadMaestro` ya trae los campos `creado_manual` y `creado_por` (incluidos en `select`). El mapeo a `MaestroRow.creadoManual` y `creadoPor` (camelCase) ocurre en el `.map()` del loader.

Dexie cache (`db.maestro`) tiene como PK `[haciendaCode+suerte]` — los campos opcionales nuevos no afectan el schema porque no son índices. NO requiere bump de versión de Dexie.

`createMaestroRow` también hace `db.maestro.put(row)` para reflejar la nueva fila en el cache local de inmediato (sin esperar al próximo `loadMaestro`).

## Realtime — propagación a otros dispositivos

El channel `asignaciones-changes` en `useSync.ts` propaga solo `asignaciones`, NO `maestro_risaralda`. Una suerte creada por OP-A NO aparece automáticamente en el dropdown de OP-B hasta que OP-B recargue o llame manualmente a `loadMaestro`. Si esto se vuelve un problema (típicamente no, porque las creaciones son raras), agregar suscripción a `maestro_risaralda` en el useSync.

## Gotchas

- **[2026-06-01]** "Eliminar" una suerte (pestaña Maestros) = **soft-delete** (`activo = false`), NO DELETE físico. Razón: un DELETE rompería los reportes/cruces y las asignaciones históricas que referencian la suerte (no hay FK pero la app las usa por `suerteCode`). `deleteMaestroRow` reusa la policy RLS de UPDATE → no hace falta policy de DELETE. Para "reactivar" bastaría `UPDATE ... SET activo=true` (aún no hay UI; se podría sumar un filtro "inactivas" + botón Reactivar). Editar el área requiere esa misma policy de UPDATE (migración `20260601150000`).

- **[2026-05-29]** El modal `NewSuerteModal` usa `.modal-overlay` genérico (z-index 100), pero se abre desde dentro de `.more-sheet` / `.assign-sheet` que tienen `z-index: 195`. Resultado: el modal queda detrás del sheet padre. Fix: clase específica `.new-suerte-overlay { z-index: 250 }` para que esté al frente con su backdrop oscuro propio. Si creas otro modal que se invoque desde dentro de un sheet, recuerda este patrón.

- **[2026-05-29]** La hacienda "no es una entidad propia" en la DB — solo existe porque hay filas en `maestro_risaralda` con su código. Crear una hacienda nueva = crear la primera suerte de esa hacienda con código + nombre nuevos. El `isNewHacienda` del modal lo detecta filtrando el maestro por `ingenio_id` actual + `haciendaCode` igual al escrito; si no hay match, es nueva.

- **[2026-05-29]** Los nombres de hacienda DEBEN ir en mayúsculas. Si llega minúscula desde el ingenio (raro pero pasa), el cliente lo normaliza al renderizar pero NO al guardar — los reportes pueden quedar inconsistentes. Si agregas un nuevo punto de entrada de datos al maestro, aplica `.toUpperCase()` al `nombre_hacienda` antes del insert.

- **[2026-05-29]** `createMaestroRow` lanza `new Error('DUPLICATE')` cuando el server responde con error 23505 (UNIQUE constraint). El llamador debe traducir ese error a un mensaje accionable: *"Otro usuario ya creó esa suerte. Cierra este modal y selecciónala del listado."* No mostrar el error técnico.

- **[2026-05-29]** El datalist del input "Código de hacienda" filtra por `ingenio_id` actual. Si una hacienda existe en otro ingenio pero no en el actual (caso raro), el sistema la trata como hacienda nueva para este ingenio. Es semánticamente correcto — cada ingenio tiene su propio universo de haciendas.

## La suerte se identifica por INGENIO + código + suerte (18-sep-2026, commit `2652d61`)

Caso: un DESPEJE de **14,50 ha** en VALPARAISO **3104-010** (Riopaila, 16,32 ha) no se dejaba
guardar: *«el área ejecutada no puede superar el área de la suerte 010 (5,22 ha)»*. Hay **tres**
haciendas llamadas «VALPARAISO» con suerte 010 y el tope tomó la de Pichichí.

Medido ese día sobre **17.584 suertes activas**:

| Llave | Choques |
|---|---|
| código de hacienda + suerte | **19** (el `1` de Mayagüez; 1214 = ABEJONES en Riopaila y PRAGA en Carmelita…) |
| nombre de hacienda + suerte | **473** (tres «VALPARAISO» 010) |
| **ingenio + código + suerte** | **0** ← ya es el índice único `ux_maestro_ingenio_hacienda_suerte` |

🔴 **Cada labor guarda su ingenio** (`asignaciones.ingenio_id`, migración
`20260918120000_asignaciones_ingenio_id.sql`): lo llena un trigger al crearla o al cambiarle la
suerte, buscando por código+nombre+suerte (solo si hay UNA), así lo llenan todos los caminos
—formularios, cola sin señal, registro rápido— incluidas las PWA viejas en caché. Relleno de
4.376 labores; 73 quedaron en null porque su suerte no está activa.

🔴 **Toda búsqueda de la fila del maestro para una labor va por `filaMaestro()`**
(`lib/areaSuerte.ts`): ingenio+código+suerte → código+nombre+suerte → si los candidatos se
contradicen, `null` (mejor no saber que tomar la suerte de otro ingenio). Nunca un
`maestro.find` a mano. Con datos reales el tope cambió en **87 labores**, y en **51** la
búsqueda vieja podía bloquear un área correcta (LA ADRIANA 1064-020 tenía tope de 1,58 ha en
una suerte de 44,64).

⚠️ El trigger de la base `asignaciones_cap_area` YA buscaba bien (código+nombre+suerte). El
error era solo del cliente — y dependía del ORDEN en que cada celular cargaba el maestro, por
eso a unos les pasaba y a otros no.

⚠️ Los formularios de asignar y de tomar en campo filtran la suerte **por el ingenio elegido**;
sin eso, con un código compartido salían suertes de otro ingenio.

## ID de suerte visible: `PIC-1001-010` (21-sep-2026)

El cliente volvió a pedir *«id diferenciador por suerte, en diferentes ingenios existen las
mismas suertes»*. Por dentro ya estaba resuelto (llave ingenio + código + suerte), pero en
pantalla y en el Excel «1001-010» se leía igual para Pichichí y Carmelita: **971 códigos de
hacienda se repiten entre ingenios**.

`idSuerte(ingenioId, hacienda, suerte)` en `data/ingenios.ts` → prefijo de 3 letras del ingenio
(RIS, PIC, MAY, SCA, RIO, LUC, CAR, PRO; fijos porque salen en Excel que la gente archiva) + código
+ suerte. `getIdSuerte(a, maestro)` en samApi para una labor. Sale en el Reporte (pantalla y
Excel, columna «ID suerte»), en el detalle de la labor y en el Maestro. «??» = no se sabe el
ingenio (medido: 0 de 756 labores de septiembre). Comprobado: **0 repetidos** en las 17.565
suertes del maestro.

