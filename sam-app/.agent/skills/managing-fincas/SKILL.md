---
name: managing-fincas
description: >
  Módulo de ADMINISTRACIÓN DE FINCAS DE CAÑA dentro de la app de ASM (segundo inicio, al lado
  de la maquinaria). Úsala al tocar fincas, suertes administradas, ciclos de corte a corte,
  paquete de labores, reportes de campo con foto/GPS, «por aceptar», la cuenta del dueño
  (anticipos, gastos, honorarios, saldo), el resumen por WhatsApp, el ACCESO DIRECTO DEL
  DUEÑO (enlace personal, `PortalDueno`), las llaves del módulo o las tablas `af_*`.
---

# Administración de fincas — MVP (22-sep-2026)

## Qué es y por qué

ASM quiere administrar fincas de caña de terceros con **transparencia total hacia el dueño de
la tierra** (propuesta «Finca a la vista»). El cliente pidió el MVP **dentro de la app de ASM**,
«en un módulo adicional teniendo dos inicios: uno para la operación de la maquinaria y otro para
esto». Por eso:

- `components/ModoSwitch.tsx` — el selector **🚜 Maquinaria | 🌱 Fincas** arriba de todo, solo para
  owner, administración y supervisor (`isSupervisorOrOwner` en `App.tsx`). Recuerda el último en
  `localStorage['sam:modo']`. Las etiquetas son cortas a propósito: «Operación de maquinaria /
  Administración de fincas» se cortaba en un celular de 375 px.
- `views/fincas/*` — el módulo, con su propio encabezado y pestañas: Inicio · Fincas · Por aceptar ·
  Reportar labor · Paquete de labores (este último solo administración).

## El modelo

finca (`af_fincas`, con el dueño) → suerte (`af_suertes`, con el área) → **ciclo de corte a corte**
(`af_ciclos`, un solo ABIERTO por suerte) → labores del ciclo (`af_labores`: el plan con cantidad,
costo y ventana, copiado del paquete `af_paquete` al abrir) → reportes de campo (`af_reportes`) →
aceptación → gasto en la cuenta (`af_movimientos`). Todo cambio en `af_auditoria`.

La **pestaña «Lo que ve el dueño»** de la finca ES la vista del dueño: hoy, ciclo contra presupuesto,
¿a tiempo?, su cuenta y la bitácora. Mismas cifras que usa ASM, no una versión preparada.

## 🔴 Nadie lee ni escribe las tablas directo: todo va con LLAVE (migración `20260922150000_fincas_acceso_dueno.sql`)

La llave pública de la app está en el bundle: con ella cualquiera podría leer tablas abiertas.
Por eso las tablas `af_*` están CERRADAS a `anon` (sin grants, RLS sin políticas) y el módulo
entero pasa por funciones `security definer` que reciben `p_token`:

| Quién | Cómo saca la llave | Qué puede |
|---|---|---|
| owner / administración / supervisor | `af_abrir_sesion(usuario, pin)` — el MISMO hash del PIN que `app_login`. App.tsx la pide sola al iniciar sesión con el PIN que acaba de escribir; si falta o venció, `FincasView` pide el PIN (`ConfirmarPin`). 30 días. 5 PIN errados en 15 min → `BLOQUEADO`. Al salir (`saveSession(null)`) se cancela. | según su rol, como antes |
| dueño de la tierra | enlace `https://…/#finca=<llave>` que crea administración (`af_crear_acceso`, tarjeta «Acceso directo del dueño» en «Lo que ve el dueño») | SOLO leer SU finca (`af_datos` filtra por la finca del enlace); ninguna escritura |

- La base guarda solo la **huella** (`af_hash` = sha256) de cada llave: el enlace se muestra UNA vez
  y nadie lo puede volver a leer. Perdido o reenviado → «Quitar acceso» (`af_revocar_acceso`) y otro nuevo.
- La llave va después del `#`: no viaja al servidor web. `llaveDueno.ts` la guarda en
  `localStorage['sam:af-dueno']` y la borra de la barra de direcciones. Si en el celular hay sesión
  del personal, la llave guardada del dueño se ignora (solo manda el enlace recién abierto).
- `App()` abre `PortalDueno` ANTES de `AppDataProvider`: el dueño no carga nada de la maquinaria.
- **Quién hizo qué sale de la llave**, no de un parámetro: `af__usuario(p_token, roles)` → id o
  `SIN_SESION`/`SIN_PERMISO`. Las funciones viejas quedaron como internas `af__abrir_ciclo`,
  `af__reportar`, `af__revisar`, `af__anular_movimiento` (sin permiso para `anon`).
- Lectura: UNA función, `af_datos(p_token)` → `{rol, usuario, fincas, suertes, ciclos, labores,
  reportes, movimientos, paquete, accesos, nombres}`. Al dueño: `paquete` y `accesos` vacíos, y
  `nombres` (id → nombre) de quien reportó/aceptó, porque no tiene la lista de usuarios.
  Cada lectura del dueño suma `usos` y `ultimo_uso` (administración ve «lo ha abierto N veces»).
- Escrituras: `af_guardar_finca`, `af_agregar_suertes`, `af_guardar_paquete`, `af_actualizar_labor`,
  `af_anular_labor`, `af_registrar_movimiento` (+ las cuatro de antes con `p_token` primero).
- ⚠️ Soporte en «Ver como» un supervisor NO entra a Fincas sin el PIN de esa persona (a propósito).

## Las reglas las hace cumplir la BASE (migración `20260922120000_administracion_fincas.sql`)

| Regla | Dónde |
|---|---|
| Sin foto no hay reporte; la hora es la del servidor | `af_reportar` + check de `foto_url` |
| Nadie acepta su propio reporte | `af_revisar` (`NO_PROPIO`) + check `revisado_por <> reportado_por` |
| En ha, lo reportado no pasa del área de la suerte (+2 %) | `af_reportar` (`SUPERA_AREA`) |
| Fecha no futura ni anterior al corte | `af_reportar` |
| Aceptar crea el gasto UNA vez, con la foto de soporte | `af_revisar` + `reporte_id unique` |
| Labor TERMINADA solo por lo aceptado (≥ 98 % del plan); a mano solo se ANULA con motivo | `af_guardia_labor` |
| Fincas, suertes, paquete y presupuesto: solo administración | `af_guardia_config`, `af_guardia_labor` |
| Anticipos y gastos a mano: solo administración; un GASTO sin soporte no entra | `af_guardia_movimiento` + check |
| Un movimiento no se edita ni se borra: se ANULA con motivo | `af_movimiento_inmutable`, `af_anular_movimiento` |
| La app no borra nada ni escribe reportes/ciclos directo | grants: sin DELETE; reportes y ciclos solo por funciones |

🔴 **El patrón `af.via_funcion`.** Las funciones `af_*` marcan la transacción
(`set_config('af.via_funcion','1', true)`) y las guardias las dejan pasar; lo que llega directo de la
app pasa por las guardias. ⚠️ La marca vive toda la TRANSACCIÓN: en una prueba dentro de un solo
`begin … rollback` queda prendida después de la primera función y las guardias «no disparan» — por eso
`pruebas_administracion_fincas.sql` la apaga antes de cada caso, y la migración la apaga tras la carga
inicial. En producción cada petición es su propia transacción.

⚠️ **El rol lo dice la base, no la pantalla** (`af_rol(p_usuario)` lee `app_usuarios.rol`). Para
probar con U058 hay que darle un rol que pueda (p. ej. administración) **y devolverlo a `taller`**.

## Cálculos (`lib/fincas.ts`, puros)

- `oportunidad`: se CALCULA, no se guarda. Hecha → días del corte al primer reporte aceptado;
  sin hacer → con HOY («tardía» = se pasó la ventana y sigue sin hacerse). Sin ventana → null (no se
  inventa). El paquete inicial solo trae ventanas documentadas: roturación soca 16/30, fertilización
  soca 45/60, fertilización plantilla 60/90 (desde la siembra).
- `cuentaFinca`: anticipos − gastos − honorarios (sin anulados).
- `presupuestoFinca`: ciclos ABIERTOS; ejecutado = gastos de sus labores + gastos a mano de esas
  suertes desde el corte.
- `resumenParaDueno`: texto para WhatsApp (`wa.me/57…`). «Aceptadas en 7 días» cuenta por el día
  en que se ACEPTARON (cuando el dueño se entera); antes contaba por el día hecho y daba 0.
- «Aceptadas hoy · N ha» suma SOLO labores en hectáreas (un jornal no es terreno).

## Pruebas

- `supabase/pruebas_administracion_fincas.sql` — 40 casos (llaman las internas `af__*`) y
  `supabase/pruebas_acceso_dueno.sql` — 25 de llaves y dueño. Correr JUNTAS dentro de
  `begin; <las dos migraciones si no están>; <pruebas>; rollback;` → 65/65 ✓ y los avisos `ANON_*` ✓.
  🔴 No usan ningún PIN real: usuarios temporales (TST_AF/TST_OP) y llaves directas en `af_sesiones`,
  todo dentro del rollback.
- `scripts/prueba-fincas-e2e.mjs` — **el código real de la app contra la base real**, cargado por
  Vite (`server.ssrLoadModule`), porque `lib/supabase` lee `import.meta.env` y `tsx` no lo trae.
  ~30 chequeos de punta a punta, incluido el enlace del dueño. Necesita dos llaves de prueba
  (`AF_LLAVE_ADMIN`, `AF_LLAVE_OTRO`): crearlas por SQL en `af_sesiones` con
  `af_hash('<texto al azar>')`, `expira_en = now() + interval '1 hour'`, y BORRARLAS al final.
  Devuelve solo el costo del paquete. Deja datos «PRUEBA E2E»: borrarlos después (ver abajo).
- Borrar datos de prueba: SQL con `set_config('af.via_funcion','1', true)`, en orden accesos →
  movimientos → reportes → labores → ciclos → suertes → fincas, y sus filas de `af_auditoria`. 🔴 Las fotos NO se
  borran por SQL («Direct deletion from storage tables is not allowed»): con la Storage API
  desde el VPS: `K=$(docker exec supabase-storage printenv SERVICE_KEY)` y
  `curl -X DELETE -H "Authorization: Bearer $K" -H "apikey: $K" -H 'Content-Type: application/json'
  -d '{"prefixes":["fincas/reportes/<archivo>"]}' http://localhost:8000/storage/v1/object/avatars`.
  ⚠️ La `SERVICE_ROLE_KEY` de `/opt/supabase/docker/.env` NO sirve («signature verification failed»).
  Y con `ON_ERROR_STOP` + `begin`, un error deja TODO sin aplicar — revisar el conteo final.
- 🔴 Borrar también la **auditoría** que dejó la prueba (`af_auditoria`, incluidas las filas
  `DELETE` que genera la propia limpieza y los cambios del paquete): queda a nombre de los
  usuarios reales dueños de las llaves de prueba (U005/U002) y confunde al revisar quién hizo qué.

## Límites conocidos del MVP (decírselos al cliente)

- El resto de SAM (maquinaria) sigue con el modelo de siempre: la llave pública lee sus tablas.
  Fincas es la excepción a propósito, porque ahí entra gente de afuera (el dueño) y está su plata.
- La vista del dueño **necesita señal** (se trae en vivo; sin conexión muestra «No hay conexión»).
- El reporte **funciona sin señal** (`lib/outboxFincas.ts`, 22-sep-2026): va a `db.outbox` con
  `type: 'FINCA'` y la foto a `db.fotos` con marcador `local://`; al sincronizar se sube la foto,
  se anota su URL en la cola (para no subirla dos veces) y se manda con `af_reportar`. Sale por tres
  caminos: el evento «volvió la señal» (`useSync`, paso 4), al abrir `FincasView` con conexión, y el
  botón «Intentar enviar ahora». 🔴 Los tres pasan por el MISMO candado `enVuelo` — sin él, dos
  envíos a la vez suben la misma foto dos veces (pasó en la prueba del 22-sep). Tope de 90 s: al
  vencer cuenta como falta de red y va a la cola. La id se fija al llenar el formulario y `af_reportar`
  es idempotente con ella: reintentar NO duplica. Quien reportó sale de la LLAVE de ese usuario
  (`leerLlavePersonal(payload.usuario)`); si venció, el reporte espera y pide confirmar el PIN.
  Un rechazo del servidor (área, fecha, labor cerrada) NO se encola: se muestra para corregirlo.
- Fotos en el bucket `avatars` (público), como el resto de SAM.
- Honorario: se registra a mano (el modo y valor de la finca quedan guardados, aún no se calcula).
- Sin cosecha ni liquidación del ingenio (etapa 3 de la propuesta).
