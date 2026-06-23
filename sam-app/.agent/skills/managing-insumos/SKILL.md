---
name: managing-insumos
description: >
  Guía del MÓDULO INSUMOS Y COMBUSTIBLE de SAM (inventario/kardex, solicitudes
  del operario, despachos con evidencia, costeo por máquina/tractor). Úsala
  cuando toques insumos, kardex, solicitudes, despachos, el rol "supervisor de
  insumos", o el consumo por equipo. También si el usuario menciona "insumos",
  "combustible", "diésel", "inventario", "kardex", "solicitud", "despacho",
  "entrega", "bodega" o "cargar al tractor".
---

# Módulo Insumos y Combustible — SAM

Segundo módulo de la app. Ciclo completo: **catálogo/inventario → el operario
solicita → bandeja del supervisor → programar → entregar con evidencia →
descuenta inventario (kardex SALIDA) → costeo por máquina**.

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
| `insumos_solicitudes` | cabecera: `operario_id`, `operario_nombre`, `estado`, `nota`, `zona`, `motivo_rechazo` + entrega: `entregado_en`, `despachado_por`, `ruta`, `evidencia_urls text[]`, `horometro`, `equipo_codigo` | `20260622130000` (+ `...140000` despachos, `...150000` horómetro, `20260623120000` equipo) |
| `insumos_solicitud_items` | ítems: `solicitud_id`, `insumo_id`, `insumo_nombre` (snapshot), `unidad` (snapshot), `cantidad`, `cantidad_despachada` | `20260622130000` (+ `cantidad_despachada` en `...140000`) |

**Estados de solicitud:** `PENDIENTE → PROGRAMADA/RECHAZADA`; `ENTREGADA` la pone el despacho.

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
- Solicitudes: `createSolicitud`, `loadSolicitudes({operarioId?,estados?})` (select
  ANIDADO de items), `updateSolicitudEstado`, `entregarSolicitud(...)`, `uploadEvidencia`.
- Costeo: `loadKardexSalidasEquipo()` (todas las SALIDA con equipo) y
  `loadKardexDeEquipo(equipoCodigo)` (de una máquina).

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
