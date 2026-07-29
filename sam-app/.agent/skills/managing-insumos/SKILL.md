---
name: managing-insumos
description: >
  Guía del MÓDULO INSUMOS Y COMBUSTIBLE de SAM (inventario/kardex, solicitudes
  del operario, despachos con evidencia, costeo por máquina/tractor). Úsala
  cuando toques insumos, kardex, solicitudes, despachos, el rol "supervisor de
  insumos", o el consumo por equipo. También si el usuario menciona "insumos",
  "combustible", "diésel", "inventario", "kardex", "solicitud", "despacho",
  "entrega", "bodega", "bodega satelite", "traslado", "estacion de servicio",
  "tanqueo", "tirilla" o "cargar al tractor".
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
