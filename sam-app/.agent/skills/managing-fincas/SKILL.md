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
- **Instalar la finca como app** (25-sep, `InstalarApp.tsx` + `llaveDueno.ts`): aviso «📲 Deje su finca en
  el celular». Android/Chrome: botón con `beforeinstallprompt` (la app instalada comparte el
  almacenamiento del navegador: con la llave guardada basta). 🔴 **iPhone NO comparte** lo guardado en
  Safari con la app de la pantalla de inicio: por eso en iOS la llave se QUEDA en la dirección (no se
  borra con `replaceState`) y se cambia el manifiesto por uno en blob con `start_url` = enlace con la
  llave y el nombre de la finca; se explica «Compartir → Agregar a inicio». El título y el
  `apple-mobile-web-app-title` pasan a ser el nombre de la finca. «Ahora no» lo oculta
  (`localStorage['sam:af-instalar-oculto']`); abierta desde el ícono no sale.
- **Lo último sin pedirlo** (25-sep): la vista del dueño trae datos al abrir, al volver a la app y
  **cada 2 minutos** mientras está visible (`CADA_MS` en `PortalDueno`). **Novedades desde su
  última visita**: `localStorage['sam:af-visto:<12 primeros de la llave>']` se lee UNA vez por carga
  (Map del módulo: React en desarrollo monta dos veces) y se compara contra `HechoSuerte.registradoEn`
  (maquinaria: `fecha_fin`; campo: aceptado o enviado). Tarjeta 🆕 + esas suertes con borde amarillo
  en el mapa (`ctx.resaltar`), hasta «Entendido».
- 🔔 **Avisos al celular** (migración `20260925090000_fincas_avisos.sql`, función del servidor
  `supabase/functions/avisos-finca`, receptor `public/sw-avisos.js` importado por el service worker
  con `workbox.importScripts`). Camino: trigger → `af_avisar` → `pg_net` a
  `http://functions:9000/avisos-finca` (red interna de Docker, sin esperar) → Web Push (VAPID) → el
  celular. Avisan: reporte de campo ACEPTADO (`trg_af_aviso_reporte`) y maquinaria COMPLETADA o
  PARCIAL en la hacienda+ingenio de la finca (`trg_af_aviso_maquinaria` sobre `asignaciones`, envuelto
  en excepciones: un aviso NUNCA tumba una labor). Solo el DUEÑO se suscribe (`af_suscribir` con la
  llave de su enlace); «Probar aviso» = `af_probar_aviso` solo a ese celular.
  - Llaves VAPID + secreto en `af_config` clave `avisos` {publica, privada, contacto, secreto}: se
    cargaron APARTE (no están en el repo). La pública la entrega `af_clave_avisos()`.
  - 🔴 En ese servidor las funciones NO verifican JWT (`VERIFY_JWT=false`, abiertas a internet): la
    función exige el header `x-aviso-secreto`. 🔴 Con la llave de servicio del contenedor, PostgREST
    responde «permission denied for schema public»: la función lee la base DIRECTO con
    `SUPABASE_DB_URL` (rol `postgres`, que necesitó `grant select/update` en `af_suscripciones`).
  - 🔴 `web-push` fuerza https: para probar el envío sin celular, suscripción falsa con llaves ECDH
    válidas y endpoint `https://supabase.surcoapp.tech/functions/v1/hello` → `enviados: 1`.
  - Desplegar la función = copiar la carpeta a `/opt/supabase/docker/volumes/functions/` (sin reiniciar).
  - 🔴 **Quitar el enlace apaga sus avisos** (migración `20260926090000`): antes la suscripción seguía
    activa y el celular de un enlace quitado SEGUÍA recibiendo notificaciones. Ahora `af_revocar_acceso`
    apaga las suscripciones de ese enlace y, además, tanto `af_avisar` como la función solo mandan a
    suscripciones con el enlace vigente (`af_suscripcion_vigente`).
  - Probado en un celular real el 26-sep (Iván, enlace «PRUEBA AVISOS (Iván)»): llegó el aviso de prueba.
  - iPhone: avisos SOLO con la app instalada (iOS 16.4+); el permiso se pide en el mismo toque, antes
    de cualquier espera. 404/410 del servicio de push = suscripción muerta (`activa=false`).
- ⚠️ `usos` cuenta CADA carga de la vista (también al volver a la pestaña), no visitas: 7 usos en 4
  minutos es una sola persona mirando. Para probar la vista del dueño usar un enlace de PRUEBA (y
  borrarlo), no el del dueño real, o se le suman aperturas falsas.
- 🔴 `psql -c "a; b; c"` corre todo en UNA transacción: si la última consulta falla, los DELETE de antes
  se deshacen aunque digan «DELETE 1». Borrar en un `-c` aparte y verificar en otro.
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

## 🔴 Dos cosas APAGADAS «de momento» (23-sep-2026) — se prenden sin migración

| Qué | Por qué | Dónde se prende |
|---|---|---|
| **La plata** (cuenta, presupuesto, costos, honorario, «se cargan $X») | «quita lo de las transferencias, de momento no valoremos nada» | `VER_PLATA` en `lib/fincas.ts` → `true` (la base lo sigue guardando) |
| **El PIN para entrar a Fincas** | «déjame ver sin el PIN, después lo volvemos a mostrar» | `update af_config set valor = 'true' where clave = 'pin_requerido'` — las sesiones abiertas SIN PIN (`af_sesiones.sin_pin`) dejan de servir al instante y la app vuelve a pedirlo |

⚠️ Con el PIN apagado, `af_abrir_sesion_sin_pin(usuario)` da una llave a cualquier usuario del
personal (owner/administración/supervisor) que se nombre: es la concesión que se aceptó. Los
enlaces del dueño no cambian.

## El MAPA de la finca (migración `20260923090000_fincas_mapa.sql`)

Pedido del cliente para **RIOGRANDE II** (hacienda 627, Ingenio Risaralda, vereda Molina, Toro):
banner grande con el título + mapa donde se ve el avance. Ideas del geovisor de AgroControl.

- `views/fincas/MapaFinca.tsx`: satélite ESRI + (botón ▦) el plano del ingenio desde `mapas`
  (se busca por el nombre del ingenio). Polígonos en canvas, número de suerte encima con zoom ≥ 15,
  tocar = ficha (edad desde el corte, último corte, n.º de corte, TCH/toneladas/rendimiento/edad de
  la última cosecha, y TODAS las labores). Tres formas de pintar: última labor · edad · una labor.
- `af_poligonos` son **pedazos**, no «la geometría de la suerte»: el plano puede ser más viejo que
  las suertes de hoy. Pedazo sin suerte = gris punteado con el número del plano; administración lo
  asigna en la ficha (`af_asignar_poligono`). También se cargan desde KML (`kmlPoligonos.ts`,
  el nombre del Placemark se cruza con el código de suerte).
- **Maquinaria de ASM en el mapa**: `af_fincas.hacienda_codigo` + `ingenio_id` cruzan con
  `asignaciones` (COMPLETADA/PARCIAL/EN_PROCESO) dentro de `af_datos` (clave `maquinaria`). 🔴 El
  código de hacienda se repite entre ingenios (hay 627 en Risaralda, Mayagüez y Carmelita): SIEMPRE
  con el ingenio. Al dueño no le llega el nombre del operario.
- `af_suertes.datos_ingenio` (jsonb): lo del reporte del ingenio. ⚠️ Su `edad_meses` es la edad AL
  COSECHAR (la del reporte), no la de hoy; la de hoy se calcula desde el corte.
- **Cómo se ubicó Riogrande II**: el «PLANO GENERAL_2025.pdf» es un **GeoPDF vectorial** (/VP →
  /Measure con /GPTS, EPSG 3115). `scripts/geopdf-poligonos.py` saca los polígonos y los
  georreferencia (error de las esquinas: 0,1 m; los linderos calzan con el satélite). Los rótulos son
  dibujos, no texto: el número se reconoce por la cantidad de puntos del glifo.
- **Estado (23-sep, tarde)**: el mapa de Riogrande II usa el **plano oficial de la hacienda**
  («HDA. RIO GRANDE II», código 627, mayo 2024, imagen que mandó el cliente): 20 pedazos, TODOS
  asignados, las 11 suertes (incl. la 0007, el triángulo al occidente de la vía, que no estaba en el
  GeoPDF). Cómo: la imagen se vectorizó (umbral + cerrar líneas 1 px + regiones con
  `scipy.ndimage.label` + envolvente convexa) y se ubicó con una afín por mínimos cuadrados usando
  como anclas los centroides de 10 pedazos del norte que coinciden con el GeoPDF 2025 (error medio
  2,6 m, máx 4,9 m). Áreas contra el ingenio: 0007 5,57/5,56 · 0001 0,60/0,61 · total 38,51/39,18.
  Los 18 pedazos del GeoPDF 2025 se reemplazaron (quedan en `af_auditoria`). La suerte de cada
  pedazo salió de las etiquetas del plano (6, 5B = 5 del norte, 5 = 5 del oriente y centro, 4A =
  fila 2, 4 = franjas del centro-sur, 3A, 3, 2A, 2, 1, 7). Dueño «Por confirmar».
- **Suerte 0007 ajustada a la foto** (pedido del cliente con captura): el triángulo del plano 2024
  quedaba corrido. Se redibujó sobre el satélite ESRI z17 con grilla: arriba la vía, a la derecha la
  línea de árboles, a la izquierda el borde del lote, punta al suroccidente → **6,53 ha dibujadas**
  (bruta; la neta del ingenio es 5,56 — la relación 0,85 es la misma de la hacienda: 39,18/47,08).
  Para ajustar otra: recortar el satélite con grilla de píxeles, marcar esquinas, pasar píxel →
  lon/lat con la fórmula de teselas y `update af_poligonos set anillo = …` con `af.via_funcion`.
- **Pantalla**: el mapa en la página va a **media altura** (`min(32vh, 280px)`, pedido del cliente) y
  tiene **⛶ pantalla completa** (`.af-mapa--grande`, fijo a toda la pantalla, Esc sale, sin scroll
  detrás). En grande, la barra de colores va arriba DENTRO del mapa y la ficha sube como hoja desde
  abajo. Al cambiar de tamaño: `invalidateSize` en doble `requestAnimationFrame` + 300 ms + 700 ms.
- 🔴 **Un solo `L.canvas`** (en `lienzoRef`, creado con el mapa). Crear uno en cada repintada dejaba
  lienzos apilados — uno más por cada cambio de color o de selección — y el toque de prueba caía en uno
  viejo sin polígonos. En desarrollo el mapa queda en `window.__mapaFinca` para probar desde consola.

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
