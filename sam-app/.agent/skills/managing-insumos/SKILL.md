---
name: managing-insumos
description: >
  Guía del MÓDULO INSUMOS Y COMBUSTIBLE de SAM (inventario/kardex, solicitudes
  del operario, despachos con evidencia, costeo por máquina/tractor). Úsala
  cuando toques insumos, kardex, solicitudes, despachos, el rol "supervisor de
  insumos", o el consumo por equipo. También si el usuario menciona "insumos",
  "combustible", "diésel", "inventario", "kardex", "solicitud", "despacho",
  "entrega", "bodega", "bodega satelite", "traslado", "estacion de servicio",
  "tanqueo", "tirilla", "cargar al tractor", "catalogos", "placa", "engrase",
  "informe semanal", "galones por hora" o "horas trabajadas".
---

# Módulo Insumos y Combustible — SAM

Segundo módulo de la app. Ciclo completo: **catálogo/inventario → el operario
solicita → bandeja del supervisor → programar → entregar con evidencia →
descuenta inventario (kardex SALIDA) → costeo por máquina**.

## 🏢 BODEGAS: principal + satélites (28-jul-2026)

El inventario **NO es una sola cifra**: es **stock POR BODEGA** (`insumos_stock`).
`insumos.stock` quedó como TOTAL consolidado (lo recalcula `refrescarTotalInsumo`).

- **PRINCIPAL** — fija, compra y almacena. La manejan **owner/administración**.
- **SATÉLITE** — el **vehículo de cada supervisor de insumos** (Genaro, Eduvin).
  De ahí consumen los operarios. `bodegas.responsable_id` = su usuario.

**Cómo se llena un satélite (2 caminos, ambos terminan sumando a su bodega):**
1. **Traslado** desde la principal → queda `EN_TRANSITO`; **descuenta ya** de la
   principal y **NO suma al satélite hasta que su responsable confirme** (aval).
   Si recibió menos, la diferencia **regresa a la principal**. `crearTraslado` /
   `confirmarTraslado`.
2. **Carga en estación de servicio** (`combustible_externo`, `destino='CARRO'`):
   llena el **TANQUE DE DISTRIBUCIÓN** del vehículo → ENTRA a su bodega. ⚠️ **NO
   es tanquear el carro para andar** — ese gasto va por fuera del app (decisión
   del dueño). Exige **foto de la tirilla**, sin horómetro.

**Tanqueo del OPERARIO en la bomba** (`destino='MAQUINA'`): **no toca inventario**
(nunca pasó por bodega) pero el consumo **sí se carga a la máquina** → exige
**horómetro** + tirilla. El reporte de consumo suma ambas fuentes con columna
`Origen` (Bodega / Estación).

Despachos y entregas directas **salen del satélite del supervisor**
(`bodegaDeResponsable`), validando su stock — no del consolidado.
`insumos_solicitudes.bodega_id` guarda de dónde salió, para que una devolución
por diferencia regrese a la **misma** bodega.

Vistas: `BodegasTab` (admin, acordeón: cada bodega despliega su stock debajo),
`MiBodegaTab` (supervisor: su carro, recibir traslados, cargar en estación),
`InsumosResumenTab` (dueño: entregas por supervisor, ordenado por actividad).

## Cantidades: 2 decimales, y enteros donde aplica

`src/lib/cantidad.ts` es la fuente única:
- `redondear2` **al calcular saldos** (raíz del `1020.4100000000001`; sin esto la
  basura de punto flotante se guarda en la BD).
- `fmtCantidad(n, unidad)` al mostrar: unidades **enteras** (unidad, gancho,
  tornillo, arandela, tuerca, caja, bulto, par…) **sin decimales**; medidas
  (galón, litro, kg, docena) hasta 2. `esUnidadEntera` decide por el nombre.
- `stepDe(unidad)` para los inputs (step=1 en enteras) y `normalizarCantidad`
  al guardar.

## Insumos frecuentes

`insumos.frecuente` → los de uso diario salen de entrada en los selectores; el
resto queda tras **"⋯ Otros (N)"** (`SearchableSelect`). Al escribir busca en
TODOS. Se marca en Inventario → ⋯ → "⭐ Marcar como frecuente".

## Rol nuevo: `supervisor_insumos`
- Etiqueta "Supervisor de insumos". ⚠️ `app_usuarios.rol` **SÍ tiene CHECK
  constraint** (confirmado 2026-06-23) → crear un usuario con este rol fallaba con
  23514 hasta la mig. `20260623140000_rol_supervisor_insumos.sql` que agrega el
  valor al CHECK. Cualquier rol futuro: misma historia.
- Mapeado en `samApi.loadAppUsers` (DB→app). **OJO:** si en el futuro este rol
  necesitara login directo, mapearlo también en `appLogin` (igual que soporte).
- Ruteo: `App.tsx` → `session.role === 'supervisor_insumos'` renderiza
  `InsumosView` (vista propia). Owner/admin entran por **Más → 🛢️ Insumos**
  (tab `'insumos'` en `SupervisorView`, renderiza `InsumosModule`).
- `getRoleLabel` actualizado en 3 sitios: `OperatorView`, `SupervisorView`,
  `ImpersonationBar`. Y opción en el dropdown de rol del form de Usuarios +
  picker en `SupportSwitcher`.

## Tablas (todas anon_key, RLS `FOR ALL` abierta)
| Tabla | Para qué | Migración |
|---|---|---|
| `insumos` | catálogo: `id`, `nombre` (unique), `categoria` (`COMBUSTIBLE`/`MATERIAL`), `unidad`, `stock`, `activo` | `20260622120000` |
| `insumos_kardex` | movimientos: `insumo_id`, `tipo` (`ENTRADA`/`SALIDA`/`AJUSTE`), `cantidad`, `saldo`, `motivo`, `referencia`, `creado_por`, `equipo_codigo`, `created_at` | `20260622120000` + `equipo_codigo` en `20260623120000` |
| `insumos_solicitudes` | cabecera: `operario_id`, `operario_nombre`, `estado`, `nota`, `zona`, `motivo_rechazo` + entrega: `entregado_en`, `despachado_por`, `ruta`, `evidencia_urls text[]`, `horometro`, `equipo_codigo` + **aval:** `confirmado_en`, `confirmado_por`, `conforme bool`, `confirmacion_nota` | `20260622130000` (+ `...140000` despachos, `...150000` horómetro, `20260623120000` equipo, **`20260711120000` aval**) |
| `insumos_solicitud_items` | ítems: `solicitud_id`, `insumo_id`, `insumo_nombre` (snapshot), `unidad` (snapshot), `cantidad`, `cantidad_despachada`, **`cantidad_recibida`** | `20260622130000` (+ `cantidad_despachada` en `...140000`, **`cantidad_recibida` en `20260711120000`**) |

**Estados de solicitud:** `PENDIENTE → PROGRAMADA/RECHAZADA`; `ENTREGADA` la pone el despacho. La confirmación del operario (aval) usa **campos sobre ENTREGADA, NO estados nuevos** (mapSolicitud de clientes viejos convierte estados desconocidos en PENDIENTE → un estado nuevo rompería pantallas ya desplegadas).

## Fase 4 — Aval del operario (handshake de 2 partes) [2026-07-11]
El despachador marca ENTREGADA, pero **SOLO el operario confirma la recepción** (antifraude estructural — proof-of-delivery, investigado en la red). Operario (tab **Activas**): tarjeta amarilla "¿Recibiste estos insumos?" con botones 1-toque **✔ SÍ, RECIBÍ TODO** (`conforme=true`) / **⚠ HUBO UN PROBLEMA** (chips de motivo: Llegó menos/Otro producto/Máquina equivocada/No recibí nada → `conforme=false`). Con **"Llegó menos"** rectifica la **cantidad recibida por ítem** (inputs precargados con lo despachado, clamp 0..despachada; "No recibí nada"=0). `confirmarRecepcion({solicitudId,operarioId,conforme,nota,equipoCodigo,items})` guarda `cantidad_recibida` y por cada diferencia registra **DEVOLUCIÓN al kardex** (ENTRADA, referencia=solicitudId, misma máquina) — el despacho original NO se toca (correcciones = eventos nuevos). Bandeja: badge ✔ Confirmada / ⚠ DIFERENCIA / ⏳ Sin confirmar + filtro "Entregadas". **Consumo por máquina = NETO:** `loadKardexSalidasEquipo` trae SALIDA+ENTRADA con equipo; `ConsumoEquiposTab` resta las ENTRADAs. `loadSolicitudes` cambió a `select('*')` (no rompe si la migración de columnas no está). Pendiente opcional: auto-confirmación 72h + métrica % autoconfirmadas por despachador. Ver [[project-insumos-modulo]].

## Flujo y archivos
- **Inventario** (`InsumosInventarioTab`): CRUD de insumos + registrar ENTRADAS
  (suman stock + kardex) + ver kardex por insumo. El kardex muestra 🚜 la máquina
  en cada SALIDA.
- **Solicitud (operario)** (`OperatorView`): botón "🛢️ Solicitar insumos" → modal
  multi-ítem. El historial de solicitudes va en la pestaña **Historial** (botón
  desplegable), NO en Activas.
- **Bandeja (supervisor)** (`BandejaInsumosTab`): filtro Pendientes/Programadas/Todas.
  Programar / Rechazar (con motivo) / **📦 Entregar**.
- **Entrega** (modal en `BandejaInsumosTab`): cantidad despachada por ítem (avisa
  si excede stock), **Máquina (tractor)** obligatoria (default = equipo del
  operario, editable con `sortedEquipment`), **horómetro** obligatorio, fotos de
  evidencia. Al confirmar: `entregarSolicitud` genera SALIDA por ítem + descuenta
  stock + marca ENTREGADA.
- **Costeo por máquina**: pestaña **🚜 Por máquina** (`ConsumoEquiposTab`) suma el
  consumo por tractor; y tocar una tarjeta en **Equipos** (`SupervisorView`) abre
  un modal con lo cargado a esa máquina.
- Contenedor con pestañas: `InsumosModule` (Bandeja | Inventario | Por máquina),
  reutilizado en `InsumosView` (rol) y en `SupervisorView` (owner/admin).

## API (samApi.ts) — sin caché Dexie (en línea)
- Catálogo: `loadInsumos`, `createInsumo`, `updateInsumo`, `deleteInsumo`.
- Kardex: `loadKardex(insumoId?)`, `registrarMovimientoInsumo({insumoId,tipo,cantidad,motivo?,referencia?,creadoPor?,equipoCodigo?})`
  (lee stock → calcula saldo → inserta kardex → actualiza `insumos.stock`; **2 pasos,
  sin transacción** — suficiente para el volumen; si se vuelve crítico, pasar a RPC).
- Solicitudes: `createSolicitud`, `loadSolicitudes({operarioId?,estados?})` (`select('*')`
  + items anidados), `updateSolicitudEstado`, `entregarSolicitud(...)`, `uploadEvidencia`,
  **`confirmarRecepcion(...)`** (aval del operario + devolución al kardex).
- Costeo: `loadKardexSalidasEquipo()` (SALIDA **+ ENTRADA** con equipo → neto) y
  `loadKardexDeEquipo(equipoCodigo)` (de una máquina).

**UI rediseñada [2026-07-14]:** pestañas de `InsumosModule` = tarjetas grandes con ícono+etiqueta+descripción (`.insumos-tab`). Filtros de la Bandeja = píldoras (`.sol-filtro`, activo verde, badge de pendientes). Tarjeta de solicitud estilo "orden de pedido" (`.sol-card`: acento lateral por estado, avatar, chips de cantidad, banner de aval, metadatos como chips). Inventario desaturado (`.inv-row`: chip de stock + acciones en menú `⋯`; crear insumo en modal; filtros píldora).

## Gotchas
- **[2026-06-23] Una columna faltante en el `select` de `loadSolicitudes` rompe TODO.**
  Síntoma traicionero: las solicitudes existen en la BD pero NO aparecen ni al
  operario ni en la bandeja (todo vacío). Causa: el `select` con join anidado pide
  columnas (`horometro`, `entregado_en`, `equipo_codigo`, `cantidad_despachada`…) y
  si UNA no existe, PostgREST devuelve 400 y `loadSolicitudes` cae al `catch` →
  `[]`. **Regla: cada feature que agrega columna a estas tablas DEBE correr su
  migración en Studio ANTES (o junto) del push del código que la lee.** Diagnóstico:
  `select ... from insumos_solicitudes order by created_at desc limit 5;` (si la fila
  está, es problema de carga, no de creación).
- **[2026-06-23] Crear equipos fallaba por RLS, no por el form.** "No se pudo crear
  el equipo" aunque los valores eran válidos (el enum `estado_equipo` SÍ tiene
  `activo/en_mantenimiento/inactivo`, coinciden con el form). La tabla `equipos`
  solo tenía policy de SELECT → el INSERT del rol `anon` se bloqueaba (en Studio
  funciona porque `postgres` ignora RLS). Fix: mig. `20260623130000_equipos_rls_write.sql`
  (`CREATE POLICY equipos_rw ... FOR ALL TO anon, authenticated` + `GRANT ALL`).
  **Lección: si "crear/editar X" falla desde la app pero el INSERT manual en Studio
  funciona, es RLS faltante (policy por comando), no el código.**
- **El tractor es acumulador de costos.** El material se carga a una máquina en la
  entrega; cada SALIDA del kardex lleva `equipo_codigo`. El default en la entrega
  sale del perfil del operario (`users.find(operarioId).equipmentCode`), pero lo
  que se ELIGE en la entrega es lo determinante. El campo "Ruta" se reemplazó por
  "Máquina".
- **Evidencia de fotos:** se suben al bucket `avatars` (el mismo de fotos de
  usuario, público) con prefijo `despachos/` vía `uploadEvidencia`. NO requiere
  bucket nuevo. Input con `capture="environment"` (cámara en móvil).
- **Stock negativo:** la entrega NO bloquea si la cantidad excede el stock (solo
  avisa en rojo). El kardex refleja la realidad; negativo = señal de problema.
- **Sin offline:** insumos/solicitudes/kardex NO se cachean en Dexie (a diferencia
  de maestro/labores). Si el dispositivo abre sin señal, salen vacíos hasta el
  primer sync.

## Tanqueo y aval del analista (29-jul-2026)

**El supervisor de insumos ya NO tiene Inventario.** `InsumosModule` le filtra la
pestaña. La razón es dura: con "+ Entrada" a mano el combustible aparecía de la
nada y no había forma de saber de dónde salió. Si alguien pide devolvérsela, la
respuesta es no — lo que necesita se resuelve con un tanqueo o un traslado.

### El modelo

Todo evento de combustible que no sea un despacho vive en `combustible_externo`
con dos ejes **independientes**:

| Eje | Valores | Qué implica en inventario |
|---|---|---|
| `origen` | `ESTACION` | se compró en la bomba → no sale de ninguna bodega |
| | `SEDE` | sale de la **PRINCIPAL** → SALIDA inmediata |
| `destino` | `CARRO` | tanque de distribución → **ENTRADA** al satélite |
| | `PIMPINAS` | N × capacidad → **ENTRADA** al satélite |
| | `VEHICULO` | consumo, exige **placa** (catálogo `vehiculos`) |
| | `MAQUINA` | consumo, exige **horómetro** + equipo |

Los dos ejes se combinan: "en sede, a pimpinas" sale de la principal Y entra al
satélite; "en estación, a máquina" no toca stock en absoluto.

El descuento de la principal ocurre **al registrar**, no al avalar: el
combustible físicamente ya se lo llevaron. El aval es una validación posterior.

### El aval

Todo nace `PENDIENTE`. Lo revisa el rol `analista_insumos` (Diego) en
`AvalesCombustibleTab`; owner y administración también lo ven (Más → Avales).

- **Aprobar** solo sella el registro.
- **Rechazar** llama a `revisarCombustible` con `aprobar:false`, que **reversa**
  los movimientos: ENTRADA de vuelta a la principal y SALIDA del satélite.
  ⚠️ Si tocas `registrarCombustibleExterno`, la reversa tiene que quedar
  simétrica o el stock se descuadra.

### Placas

⚠️ **Desmontado el 1-ago-2026.** Antes había una tabla `vehiculos` con su
`VehiculosTab` y un selector: para tanquear un carro nuevo tocaba primero darlo de
alta. En la bomba a las 6 de la mañana eso es un muro, y lo que pasa entonces es
que el registro no se hace. Ahora la placa se **escribe** con `<CampoPlaca>` y el
catálogo solo sugiere. Ver la sección de catálogos de listas más abajo.

### Quién ve qué

| Rol | Destinos que puede registrar |
|---|---|
| `operador` | solo `MAQUINA` (su máquina, horómetro obligatorio) |
| `supervisor_insumos` | `CARRO`, `PIMPINAS`, `VEHICULO`, `MAQUINA` |


## El taller es OTRO inventario conceptual, la MISMA bodega técnica (30-jul-2026)

Los repuestos viven en el mismo catálogo `insumos` y el mismo kardex, en una
bodega `tipo = 'TALLER'`. Lo que los distingue son campos propios
(`es_repuesto`, `referencia`, `marca`, `numero_parte`, `ubicacion`,
`stock_maximo`, `costo_promedio`) y la tabla `insumos_aplicabilidad` (a qué
marca/modelo/máquina sirve cada uno).

No crear un segundo inventario: serían dos verdades. Ver
`.agent/skills/managing-taller/`.

## 🔴 Offline: los insumos también encolan (31-jul-2026)

**El outbox existía solo para las labores.** Todo el módulo de insumos escribía
directo a Supabase, así que sin señal la promesa fallaba, la pantalla decía "no
se pudo" y **el registro se perdía**. El supervisor de insumos trabaja justo
donde no hay cobertura: era el peor sitio posible para no tener cola.

`lib/outboxInsumos.ts` encola seis operaciones de campo: `SOLICITUD`,
`DESPACHO`, `ENTREGA_DIRECTA`, `CONFIRMAR_RECEPCION`, `CONFIRMAR_TRASLADO` y
`TANQUEO`. Inventario, compras y taller NO se encolan: los hace administración
con señal, y ahí un error a la cara es mejor que una cola invisible.

### Tres reglas que sostienen esto

1. **Se encola la INTENCIÓN, no el resultado.** Un despacho guarda "saqué 12
   galones de esta bodega", nunca "el saldo quedó en 78". El saldo del kardex se
   recalcula al sincronizar, contra el stock real de ese momento. Guardar el
   saldo calculado en el celular y aplicarlo días después descuadra el inventario.
2. **Fallo de red ≠ rechazo del servidor** (`esFalloDeRed`). Un "stock
   insuficiente" o un duplicado **no se encolan**: reintentarlos mañana volvería
   a fallar y le habríamos dicho al usuario "quedó guardado". Solo se encola
   cuando de verdad no se pudo hablar con el servidor.
3. **La pantalla dice la verdad.** `enviarOEncolar` devuelve `enviado`, y el
   mensaje cambia: "Entrega registrada" vs "Entrega guardada sin señal. Se envía
   sola cuando haya cobertura". Decir "listo" en los dos casos es como se pierde
   la confianza.

### Fotos

La evidencia se subía al tomarla; sin señal fallaba. Ahora `subirOGuardarFoto`
la guarda en Dexie (`db.fotos`, v8) y devuelve un marcador `local://<id>` que
viaja dentro del registro encolado. Al sincronizar, `resolverFotosDePayload`
sube la foto y cambia el marcador por la URL real **antes** de mandar el
registro. Si una foto no sube, se descarta esa foto pero la entrega sigue: es
mejor perder una foto que perder la entrega.

En el formulario, una foto aún sin subir se muestra como "📷 sin subir" en vez
de un `<img>` roto.

### Que se vea

`components/AvisoPendientes.tsx` va arriba del módulo de insumos y de la vista
del operario: dice cuántos registros esperan señal y, al tocarlo, cuáles. Sin
él la pantalla se ve igual con la cola vacía que con diez despachos dentro —
que es exactamente por qué el supervisor creía que se perdían.

## Autoabastecimiento del satélite (31-jul-2026)

**El supervisor puede tomar material de la principal por su cuenta.** Existe por
un motivo de horario: entra a las 5:30 de la mañana y el analista a las 7:00.
Con el combustible ya podía servirse solo (tanqueo `origen=SEDE`), pero los
materiales solo entraban a su carro por un traslado que creaba administración —
así que si no había nadie, se quedaba sin ganchos o se los llevaba sin
registrar, que es peor.

`autoAbastecer()` en Mi bodega → **📦 Surtirme de la principal**. El material
sale de la principal y entra al carro **en el mismo acto** (ya se lo llevó
físicamente) y queda `aval_estado = 'PENDIENTE'`. El analista lo ve en su
bandeja junto a los tanqueos; si rechaza, `revisarAutoabastecimiento` reversa.

Se reusó `insumos_traslados` con `autoservicio = true` en vez de crear una tabla:
es exactamente lo que ya modela (material entre dos bodegas, con ítems), y dos
tablas para el mismo hecho obligarían a unirlas en cada reporte.

- El traslado nace `RECIBIDO`: quien saca y quien recibe son la misma persona,
  pedirle que "confirme" lo que él mismo tomó sería un paso vacío.
- Los traslados normales (los que envía administración) **no** llevan
  `aval_estado`: ya los avala quien recibe, y pedir dos avales sobra.
- Para combustible sigue el tanqueo, que además pide galones y tirilla. El
  formulario lo dice para que nadie use el camino equivocado.

### 🔴 El doble aval reversaba dos veces

`update(...).eq('estado','PENDIENTE')` **no falla** cuando ninguna fila coincide:
Supabase devuelve 0 filas sin error. Así que avalar algo ya avalado seguía de
largo y ejecutaba la reversa otra vez, descontando el material dos veces.

Ahora los dos avales (`revisarAutoabastecimiento` y `revisarCombustible`) hacen
`.select('id')` y comprueban que el UPDATE tocó una fila antes de reversar. **Si
agregas otro flujo con aval, copia esa guarda.**

## 🔴 Offline también es LEER, no solo guardar (31-jul-2026)

La cola de salida resolvió guardar sin señal, pero el supervisor abría la
pantalla en blanco: **`loadInsumos` devolvía `[]` cuando fallaba la red**. Podía
guardar pero no tenía catálogo del cual escoger. Guardar sin poder leer no sirve
de nada.

Cuatro cargas tienen respaldo en Dexie (v9): `insumosCat`, `bodegas`,
`stockBodega` (clave `insumoId|bodegaId`) y `solicitudes`. Cada `load*` guarda
lo que trae del servidor y, si la red falla, lee del respaldo aplicando los
mismos filtros en memoria.

El caso que más dolía era **el stock**: sin respaldo el carro salía en CERO y la
validación "no tienes suficiente" bloqueaba cualquier despacho. El respaldo es
del último momento con señal — puede estar algo viejo, pero es infinitamente
mejor que un cero que miente.

`AvisoPendientes` muestra **"Sin señal"** aunque no haya nada en cola, para que
quede claro que lo que se ve es de la última conexión.

**Regla para lo que venga:** una pantalla que se use en campo necesita las dos
mitades — cola de salida Y respaldo de lectura. Tener solo una es no tenerlo.

## ⚠️ El AJUSTE fija el saldo, no lo suma

Al reconstruir stock desde el kardex, **`AJUSTE` no se suma**: pone el saldo en
lo que se contó físicamente. Sumar `SALIDA/ENTRADA` a ciegas sobre un insumo que
tiene ajustes da un número que no corresponde — GANCHOS en la principal suma
1480 en el kardex y su saldo real es 1200, y las dos cifras son correctas.

Dos formas de rehacer un saldo, y hay que elegir a conciencia:

1. **Sin ajustes** → sumar el kardex funciona (`recalcularStockBodega`, que sí
   trata el AJUSTE como "fija el saldo").
2. **Con ajustes** → tomar el último AJUSTE como base y sumar solo lo posterior.
   Si se salta el insumo del recálculo "por seguridad", el saldo **no se
   corrige** — y eso es justo lo que pasó al limpiar una entrega de prueba
   (3-ago-2026): se borraron las filas del kardex, el recálculo saltó el par
   insumo/bodega por tener ajustes, y el stock quedó 1 gancho abajo hasta que se
   repuso a mano.

**Regla:** después de borrar movimientos, verificar el saldo contra lo que había
ANTES. No dar por hecho que el recálculo lo dejó bien.

## Catálogos de listas: sugieren, no obligan (1-ago-2026)

Una sola tabla, `catalogos_valores`, para TODAS las listas de los formularios,
separadas por `tipo`. No una tabla por lista: son todas lo mismo —un texto que se
repite— y una tabla nueva por cada una obliga a migración, API y pantalla para
guardar cinco palabras.

| Tipo | Dónde se usa |
|---|---|
| `ESTACION` | bomba donde se compró el combustible |
| `PLACA` | vehículos (reemplazó a la tabla `vehiculos`) |
| `USO` | para qué / dónde se usó |
| `MOTIVO_RECHAZO` | por qué se rechaza una solicitud |

**Agregar una lista nueva NO necesita migración**: se suma un `tipo` al arreglo
`LISTAS` de `CatalogosInsumosTab` y ya existe la pantalla para llenarla.

### El campo

`<CampoLista tipo="ESTACION">` (en `components/CampoPlaca.tsx`) es un input de
texto con `datalist`. Tres fuentes de sugerencias, en ese orden:

1. `catalogos_valores` del servidor,
2. su espejo en `localStorage` — así sigue sugiriendo **sin señal**,
3. lo que ya se escribió antes en ESE equipo (`recordarValor(tipo, v)` al guardar).

Lo importante es lo que **no** hace: no bloquea. Si el valor no está en la lista,
se escribe y se guarda igual. Un catálogo que obliga a dar de alta el valor antes
de registrar no produce datos limpios — produce registros que no se hacen.

`<CampoPlaca>` es el mismo campo con `normalizarPlaca()`: quita espacios y
guiones, así que `abc 123`, `ABC-123` y `ABC123` son el mismo vehículo.

### Todo en MAYÚSCULA

`lib/texto.ts` (`aMayus`, `normalizarPlaca`) + `autoCapitalize="characters"`. Los
mismos datos los escriben cinco personas y "campoalegre" / "CampoAlegre" terminan
siendo dos filas distintas en un reporte. **No tocar fechas, horas ni números.**

## Un despacho es UN hecho, no una fila por insumo (2-ago-2026)

El kardex guarda una fila por insumo, así que una entrega de ganchos +
combustible sale **duplicada** en cualquier listado: misma máquina, misma hora,
mismo operario, dos renglones que no dicen nada distinto. En celular eso llena la
pantalla.

`agruparDespachos(movs)` en `lib/despachos.ts` agrupa por `referencia`. **El TIPO
entra en la llave** (`` `${referencia}|${tipo}` ``): la devolución que hace el
operario comparte la referencia con la salida original, y mezclarlas mostraría una
entrega que nunca fue así.

Aplicado en Reportes (lista y detalle de máquina) y en el modal de Inicio. **Al
listar movimientos de kardex en una pantalla nueva: agrupar.**

### El detalle vive en un componente, no en una pantalla

`<DetalleDespacho>` (`components/`) muestra quién recibió, quién entregó,
horómetro, nota, evidencia y el aval del operario. Se abre desde cuatro sitios
distintos, así que no puede vivir dentro de ninguno.

Se le pasa el movimiento de kardex. Si quien lo abre ya tiene la entrega cargada
se la pasa en `entrega`; si no, el componente la busca solo por `referencia`
(`loadSolicitudPorId` / `loadCombustiblePorId`). Esa segunda vía es la que permite
hacer tocable cualquier lista de movimientos sin cargar antes las solicitudes.

## Anular un traslado lo BORRA, no lo compensa (1-ago-2026)

`anularTraslado()` **elimina** las filas de `insumos_kardex` con esa `referencia`
y recalcula el saldo con `recalcularStockBodega()`.

La primera versión hacía lo contrario —registraba una entrada de devolución— y el
cliente lo reclamó: *"lo que necesitamos es eliminarla, no no hacerla efectiva…
veo que se hizo el consumo de la bodega principal y yo quería era evitar que eso
pasara."* Tenía razón. Compensar cuadra el saldo pero deja **dos movimientos
físicos que nadie hizo**, y la salida original sigue contando como consumo de la
principal en todos los reportes.

Un traslado en tránsito que se anula **nunca ocurrió**. El rastro de la
equivocación vive en el traslado (`estado=ANULADO` + quién, cuándo y por qué), que
es donde debe estar: en el registro del hecho, no en el libro de inventario.

Dos caminos, uno por cada punta:
- **ENVIA** → "Eliminar" en Bodegas (administración se dio cuenta).
- **RECIBE** → "No es para mí" en Mi bodega (el supervisor se dio cuenta).

⚠️ El guard `.eq('estado','EN_TRANSITO').select()` impide anular dos veces — la
misma trampa del doble aval. **NO confundir con "faltó algo"** (recepción
parcial): eso es un traslado válido con menos cantidad.

## CONSUMO ≠ todo lo que salió de la bodega (1-ago-2026)

Surtir un carro es un **movimiento entre bodegas**: el material sigue siendo de la
empresa, solo cambió de sitio. Consumo es lo que se gastó en una máquina.

```ts
if (!k.equipoCodigo) continue      // surtir un carro NO es gastar
if (k.tipo === 'SALIDA') consumo += k.cantidad
else if (k.tipo === 'ENTRADA') consumo -= k.cantidad   // devolución del operario
```

Es el criterio de `ConsumoEquiposTab` y del Resumen de inventario, para que los
dos den el MISMO número. Contarlo mal —sumando los traslados— inflaba el consumo
de la principal en 330 galones y 320 ganchos.

## Resumen de inventario y materiales destacados (1-ago-2026)

`InventarioResumenTab` (Insumos → 📊 Resumen): existencias por material, tabla
bodega × material, y qué es lo que más se gasta.

**⭐ Destacados = la columna `insumos.frecuente`.** Una sola marca con dos
efectos: salen de primeras en los selectores Y llevan tarjeta y columna propias en
el Resumen; todo lo demás se pliega en "Otros". Se eligen desde el propio Resumen
(⭐ Elegir materiales destacados). Hoy: COMBUSTIBLE y GANCHOS. Dos o tres es lo
sano — con diez no destaca ninguno.

⚠️ **"Otros" cuenta MATERIALES, no cantidades.** Sumar galones con unidades da un
número que no significa nada; ya pasó en el Inicio ("Entrega directa 63,95" era 40
ganchos + 23,95 galones). Cuando una serie mezcla unidades: o se cuentan
MOVIMIENTOS, o cada punto lleva su unidad al lado (`Punto.sufijo`).

## El engrase y los materiales adicionales (3-ago-2026)

### ¿Engrasó la máquina?

Columna `insumos_solicitudes.engraso` (`boolean`, **nullable**) + `<SwitchEngraso>`
en el modal de entrega.

Se pregunta en la ENTREGA porque el engrase se hace justo cuando el supervisor
llega a la máquina. Preguntarlo después es garantizar que nadie se acuerde.

**Tres estados, no dos.** `true` engrasó · `false` no engrasó · `null` no se
preguntó. Un `boolean NOT NULL DEFAULT false` diría que ninguna máquina se ha
engrasado nunca, que es una afirmación distinta de "no sabemos" — y todas las
entregas anteriores a la migración caerían ahí. Por lo mismo el switch arranca sin
elegir: un descuido no debe quedar grabado como "no engrasó".

En el informe semanal sale como **"2 de 3"** y no como un sí/no: en una semana hay
varias entregas y el engrase no se hace en todas.

### Entregar material que no se pidió

El supervisor llega a la máquina y ve que además necesita otra cosa. Antes tenía
que rechazar la solicitud o crear una nueva; ahora `entregarSolicitud` acepta
ítems **sin `itemId`** y los inserta en `insumos_solicitud_items` con
`cantidad: 0` y `cantidad_despachada` = lo que entregó.

Ese `cantidad 0` es deliberado y hay que respetarlo: **lo pedido sigue siendo
cero**, porque el operario no lo pidió. Lo entregado es lo que se ve. Si se
igualaran las dos cifras se perdería la diferencia entre lo que se solicita y lo
que de verdad hace falta en campo, que es justamente el dato interesante.

## Informe semanal por máquina (3-ago-2026)

`InformeSemanalTab` + `lib/informeSemanal.ts`. Reemplaza una hoja de Excel que se
llenaba a mano —una fila por entrega con el horómetro anotado— y agrega lo que ahí
no se podía calcular: horas entre eventos, horas de la semana y **galones/hora**.

Cruza dos fuentes que ya existían y nunca se habían juntado: las entregas de
material (`insumos_solicitudes`) y los tanqueos (`combustible_externo`). Las dos
piden horómetro, así que las dos sirven para medir horas.

Decisiones que no son obvias:

- **Los eventos se ordenan por HORÓMETRO, no por fecha.** Dos entregas del mismo
  día pueden quedar registradas al revés, y lo que manda para calcular horas es
  cuánto había andado la máquina.
- **Semana ISO-8601** (`semanaDe()`), que es la numeración de la hoja que ya
  llevan. No inventar una propia.
- **La desviación se compara contra el propio promedio de esa máquina**, no contra
  el de la flota: un tractor grande y uno chico no son comparables. ±25% se
  resalta — puede ser una fuga, un filtro tapado o combustible que no llegó donde
  dice.

### ⚠️ Los horómetros vienen sucios y el informe lo DICE

`marcarSospechosos()` descarta las lecturas cuyo **orden de magnitud** no coincide
con el dominante de esa máquina. El criterio es la magnitud y no la distancia
porque los errores reales son un dígito de más o de menos, no un 5%.

Medido en producción (3-ago-2026): la VALTRA 9901 tiene en la misma semana
`10288.2`, `294.9` y `10298.6`. Restar a ciegas daría −9.993 horas y luego +10.003.

**La lectura descartada NO se borra: se devuelve marcada** y sale contada en la
pantalla ("⚠ N lectura(s) no cuadran") y en el Excel. Ignorarla en silencio dejaría
la pantalla más limpia, pero entonces nadie va a corregir el dato de origen y el
problema sigue creciendo. Es el mismo criterio de `equipo_horometro_v` — ver
`managing-taller`, que tiene la medición de toda la flota.

Si una máquina no llega a **dos** lecturas confiables en la semana, las horas
quedan vacías. Una casilla en blanco es mejor que un número inventado.

## Corregir un despacho entregado (4-ago-2026)

`editarDespacho()` + `<EditarDespachoModal>`. Cambia **fecha, maquina y
cantidades** de un despacho ya ENTREGADO. Lo pueden hacer `supervisor_insumos`,
`analista_insumos`, `owner` y `administracion`, desde la bandeja (tarjeta
entregada) y desde `<DetalleDespacho>`.

Existe porque **el registro y el hecho no ocurren al mismo tiempo**: el supervisor
entrega a las 6 de la manana en el lote y registra a las 4 de la tarde cuando
vuelve a tener senal. Antes eso quedaba mal para siempre y la unica salida era
tocar la BD a mano.

### 🔴 Las DOS fechas, y por que son dos

| Columna | Que es | Quien la usa |
|---|---|---|
| `created_at` | cuando se **tecleo**. Inmutable | solo auditoria |
| `fecha_efectiva` | cuando **ocurrio** de verdad. Editable | **todos los reportes** |

Pisar `created_at` habria sido mas simple y es exactamente lo que no se puede
hacer: se perderia la evidencia de cuando se registro, que es lo unico que
permite detectar a alguien retrofechando movimientos.

**El truco que evito tocar veinte archivos:** `mapKardex` devuelve
`createdAt = fecha_efectiva`. Como Reportes, el Excel, el consumo por maquina y
el informe semanal ya leian `.createdAt`, la correccion se propaga sola. El valor
real de registro sale aparte, en `registradoEn`.

⚠️ `fecha_efectiva` es **NOT NULL con default**, a proposito: PostgREST no filtra
sobre expresiones, y un `null` suelto dejaria el movimiento fuera de todo rango
de fecha — invisible en los reportes, que es el peor modo de fallar.

### Se corrige en su sitio, no se compensa

Igual que al anular un traslado: un despacho de 25 galones **siempre fue** de 25,
y dejar una salida de 20 mas un ajuste de 5 mete en el libro un movimiento fisico
que nadie hizo. El rastro de la correccion vive en
**`insumos_despachos_auditoria`** (`{campo: {antes, despues}}`, mismo patron que
`asignaciones_auditoria`), no en el inventario.

En cantidad **0 la fila del kardex se borra**: un movimiento de cero unidades no
es un hecho, es ruido.

### ⚠️ Solo se tocan las filas SALIDA

La ENTRADA que genera el aval cuando el operario reclama una diferencia es un
hecho **suyo**, aparte. Pisarla borraria su reclamo. El filtro
`.eq('tipo','SALIDA')` no es una optimizacion: es la regla.

### Lo verificado en produccion (4-ago-2026)

Movida una salida real de agosto a julio: el conteo del reporte de julio paso de
0 a 1, `created_at` siguio en 4-ago, y al restaurar volvio a 0. Los cinco
permisos del rol `anon` (leer/escribir kardex, insertar/leer/borrar auditoria)
probados contra produccion antes de desplegar.

⚠️ Despues de editar cantidades, **verificar el saldo**: `recalcularStockBodega`
salta los pares insumo/bodega que tienen AJUSTE. Ver la seccion del AJUSTE.

### Eliminar un despacho (4-ago-2026)

`eliminarDespacho()`, detras de un paso mas dentro del mismo modal y **pidiendo
motivo**: no es una correccion, es deshacer un hecho y devolver material al
inventario.

**Borra, no compensa** — misma decision que `anularTraslado`. Y borra **TODAS**
las filas de esa referencia, no solo las SALIDA: aqui si entra la ENTRADA del
aval, porque si el despacho no ocurrio la devolucion por diferencia tampoco
tiene de que ser devolucion. (Es justo lo contrario de `editarDespacho`, que solo
toca las SALIDA. La diferencia esta en si el hecho existio o no.)

**Nada se pierde:** el despacho completo —items, evidencia y aval— se guarda en
`insumos_despachos_auditoria` con `accion='ELIMINAR'` **antes** de borrar nada.

**A donde vuelve la solicitud:**

| Origen | Queda en | Por que |
|---|---|---|
| operario | `PROGRAMADA` | el sigue necesitando el material; borrar la entrega mal hecha no borra su necesidad, y reaparece en la bandeja para despacharla bien |
| `DIRECTA` | `CANCELADA` | no hay pedido detras: el registro ERA la entrega |

Se limpia tambien el **aval** (`confirmado_en`, `conforme`, la nota) y las
`cantidad_despachada`/`cantidad_recibida` de los items. Sin eso, al re-despachar
el operario veria su confirmacion vieja sobre material que no ha recibido. Lo
**pedido** (`cantidad`) NO se toca: es lo que precarga el proximo despacho.

**Verificado en produccion** (transaccion + rollback, 4-ago): GANCHOS 40 -> 80,
COMBUSTIBLE 71,48 -> 83,48, cero movimientos restantes, copia guardada, y todo
restaurado al deshacer.

### ⚠️ El `datetime-local` corta los segundos

Al corregir una fecha y volverla a dejar "como estaba", `fecha_efectiva` queda
distinta de `created_at` por segundos (el input solo tiene precision de minuto).
No afecta ningun reporte, pero **no sirve comparar las dos fechas para saber si
algo fue editado** — para eso esta la tabla de auditoria, que es lo que usa
`<DetalleDespacho>`.


## Agregar material a un despacho ya entregado (17-ago-2026)

Genaro o Eduvin entregan, y más tarde el operario pide algo más para la misma
máquina. Antes la única salida era una entrega directa aparte, y en el reporte
aparecían **dos despachos donde hubo uno**.

`editarDespacho` acepta `nuevos[]`. Cada material entra con:

- **`agregado_en`** = el momento exacto, puesto por el sistema. **La hora no se
  digita**, así que nadie la puede acomodar. Y `agregado_por`, que puede ser
  distinto de quien hizo la entrega.
- `cantidad = 0` (el operario no lo pidió) y `cantidad_despachada` = lo que se
  llevó — igual que los adicionales de la entrega.
- Un **movimiento de kardex real**: sale de la bodega, no es una anotación.

🔴 **`agregado_en` en null significa "venía en el despacho original".** Con fecha
significa "se sumó después". Son dos hechos distintos y mezclarlos borraría justo
lo que el cliente quiere poder ver. Se muestra etiquetado tanto al corregir como
en `<DetalleDespacho>`, que es donde mira el que revisa.

## 🔴 La foto sin señal hay que PODERLA VER (17-ago-2026)

De las tres partes, dos ya funcionaban: la foto se guardaba en Dexie y se subía
sola al reconectar. Pero en pantalla salía **un cuadrito gris que decía "sin
subir"**.

Eso la hacía inútil como evidencia: el supervisor no podía comprobar lo que
acababa de tomar, y si salió movida, tapada o de la máquina equivocada se
enteraba al día siguiente, cuando ya no se puede repetir.

**`<FotoEvidencia url>`** (`src/components/`) muestra la foto salga de donde
salga: si ya está en el servidor la carga por URL y se abre en grande al tocarla;
si está en el equipo la arma desde el blob con `URL.createObjectURL` y le pone un
reloj encima.

⚠️ **Revocar la URL al desmontar** (`URL.revokeObjectURL`) o el navegador retiene
el blob completo por cada foto abierta.

Verificado simulando sin señal: la foto se ve, queda comprimida a ~7 KB, y al
volver la señal sube y se borra de la caché. **Al listar fotos en una pantalla
nueva: usar este componente, no un `<img src>` pelado.**

## Tablero de consumo: el papel y la app en una sola serie (5-ago-2026)

`ConsumoDashboardTab`, en el tablero del dueño (Inicio → ⛽ Eficiencia
maquinaria).

Se cargaron **2.891 registros del formato de control diario en papel**
(mar–jul 2026) en `consumo_historico`. Sin eso el tablero arranca en agosto y no
hay contra qué comparar: 1.376 galones no dicen nada si no se sabe que julio
fueron 9.252.

🔴 **Tabla APARTE, no `insumos_kardex`.** La tentación es meterlo todo al kardex
para no tener dos fuentes, y sería un error: el kardex mueve el stock, y cargarle
cuatro meses de salidas históricas dejaría el inventario en negativos absurdos.
Es un registro de lo que pasó, no un movimiento de inventario.

🔴 **El corte es el 31 de julio.** El Excel llegaba hasta el 4 de agosto y la app
también tiene agosto: cargar el traslape contaría dos veces los mismos galones.

**El cruce del traslape validó la app**: del 1 al 4 de agosto, 1.080,8 gal en
papel contra 1.072,1 en la app — **0,8%**. En ganchos faltaron 80 (dos entregas
de 40) — eso sí hay que mirarlo.

`consumo_unificado_v` resuelve las **TRES** fuentes. ⚠️ Olvidar la tercera es el
error clásico: el **tanqueo en estación NUNCA pasó por bodega**, así que no está
en ningún kardex pero sí es consumo de la máquina. Solo en agosto son 76 galones
que no aparecerían.

### 🔴 Antes de acusar a una máquina, revisar el denominador

La primera versión marcaba **12 de 21 máquinas en rojo**. Mirando los números, el
problema no era el combustible: la PUMA 2301 mostraba 210 galones en 19,5 horas.
Pero con su referencia de 5,27 gal/h, esos galones implican **~40 horas** — o sea
faltan horas por registrar, no sobra consumo.

```ts
const horasImplicitas = ref > 0 ? gal / ref : null
const horasIncompletas = horasImplicitas != null && h > 0 && h < horasImplicitas * 0.6
```

Ahora separa **"faltan horas (≈40)"** de una desviación real. Una alerta que suena
doce veces no la lee nadie.

⚠️ **Los ganchos se entregan por paquetes de 40**, no gota a gota. En pocos días
el promedio salta (una máquina marcó +103% con una sola entrega) y solo se
estabiliza en un mes completo. La pantalla lo advierte. Y los **PUMA no usan
ganchos**: su referencia en null no es dato faltante, por eso se filtran de esa
vista en vez de mostrarlos con guiones.
