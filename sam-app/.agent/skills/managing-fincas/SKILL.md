---
name: managing-fincas
description: >
  Módulo de ADMINISTRACIÓN DE FINCAS DE CAÑA dentro de la app de ASM (segundo inicio, al lado
  de la maquinaria). Úsala al tocar fincas, suertes administradas, ciclos de corte a corte,
  paquete de labores, reportes de campo con foto (GPS apagado de momento), «por aceptar», la cuenta del dueño
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
| dueño de la tierra (enlace) | enlace `https://…/#finca=<llave>` que crea administración (`af_crear_acceso`, tarjeta «Acceso del dueño» en «Lo que ve el dueño») | SOLO leer SU finca (`af_datos` filtra por la finca del enlace); ninguna escritura |
| dueño de la tierra (**usuario**, 17-oct-2026) | rol `dueno_finca` en `app_usuarios` (Más → Usuarios), ligado a sus fincas en **`af_finca_duenos`** (N a N; `af_asignar_dueno` / `af_quitar_dueno`, misma tarjeta). Entra con ID + PIN; su llave sale de `af_abrir_sesion(_sin_pin)` como la del personal | SOLO leer SUS fincas (`af_datos` rama `dueno_finca`: sin paquete, sin accesos, sin nombres de operarios); `af__usuario` lo deja fuera de toda escritura. `PortalDueno` con `usuario` abre el **tablero macro** (`lib/fincas.macroDueno`) y baja a cada finca. 🔔 **Avisos push también con usuario** (migración `20261017200000`): `af_suscripciones.usuario_id` y unicidad `(endpoint, finca_id)` → el dueño queda suscrito con **una fila por cada finca suya**, así la función del servidor `avisos-finca` (manda por finca) no cambia ni se redespliega; ligar una finca nueva hereda la suscripción, quitarla la apaga, desactivar el usuario o cambiarle el rol las apaga todas (`trg_af_apagar_avisos_usuario`). Soporte lo ve con «Ver como» (selector «Dueño de finca» en `SupportSwitcher` y grupo en `ImpersonationBar`). Probado en transacción: 7 casos (incluido que el enlace sigue igual). Pedido de Iván: «una data macro de su negocio» |

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
  - **Enlaces de Riogrande II** (25-sep): «Ana María Llanos» (la dueña) e «Iván · copia ASM» (el de
    prueba, que se quedó como copia permanente: a Iván le llegan los mismos avisos que a la dueña; 2
    Android). «Por confirmar» (lo creó U001) se QUITÓ. Para probar, usar el de Iván, no el de la dueña:
    en Android abrir otro enlace reemplaza la llave guardada en ese celular y suma a los usos.
    Además «ENSAYO dueña (Iván)» (id 23506ad4, creado 25-sep por SQL con `af_token_nuevo`) para
    ensayar el recorrido de la dueña desde cero (abrir → instalar → activar avisos) en un celular
    que nunca abrió la app. Quitarlo cuando ya no haga falta.
- **Quién reporta en fincas** (26-sep): **Julio César Niño (U033, supervisor, zona SUR)** hace los
  registros de las labores. Decisión de Iván: se queda como SUPERVISOR (solo reportar; también
  puede aceptar reportes de otros, nunca el suyo). El paquete de labores lo arman owner/administración:
  sin paquete no hay nada que reportar (al 26-sep en Riogrande solo estaba el madurante de la 0007).
  Verificado en la base con sesión de prueba en transacción + ROLLBACK.
- **Paquete de Riogrande II** (26-sep, decisión de Iván: «solo lo que viene»): los ciclos se
  cargaron el 23-sep SIN las labores del paquete. Se agregaron por SQL (mismo cálculo que
  `af_abrir_ciclo`, `editado_por = 'CARGA_INICIAL'`) CONTROL DE MALEZAS y RIEGO en las 10 suertes
  0001–0006 (20 labores, sin ventana). NO se cargaron ROTURACIÓN ni FERTILIZACIÓN: en las cortadas
  en febrero ya pasaron (las hizo el administrador anterior) y en las de julio las hizo la
  maquinaria de ASM → habrían salido «tarde / sin hacer» en rojo ante la dueña. La 0007 queda
  solo con MADURANTE.
- **Labores de VARIAS PASADAS** (28-sep, migración `20260928090000`, pedido de Iván): columna
  `repetible` en `af_paquete` y `af_labores` (el ciclo la hereda al abrirse en `af__abrir_ciclo`).
  RIEGO y CONTROL DE MALEZAS quedaron repetibles (paquete + las 20 de Riogrande).
  - `af__reportar`: si es repetible, cada REPORTE ≤ área de la suerte (una pasada); el TOTAL no se
    topa. Las demás siguen con el tope acumulado (SUPERA_AREA).
  - `af__revisar`: una repetible NUNCA pasa a TERMINADA sola (queda EN_CURSO todo el ciclo).
  - `af_guardar_paquete`: al editar, si no llega `repetible` (app vieja) conserva el que tenía.
  - App: `cantidadPlan` = UNA pasada; `avanceLabor` da `pasadaEnCurso`, `pasadas` y `restante` de
    la pasada en curso. «Reportar labor» muestra «riego · pasada 2 · faltan 5,68 ha». Casilla
    «Se hace varias veces en el ciclo» en el paquete.
  - Probado en transacción + ROLLBACK (8 casos) y el cálculo con Node sobre `lib/fincas.ts`.
- **Bitácora y «Labores por suerte» con la maquinaria** (25-sep, commit `0594114`): `bitacoraFinca`
  recibe también `maquinaria` (la misma que pinta el mapa). Antes el banner decía «5 labores en 30
  días» y la bitácora «Todavía no hay movimientos». En «Labores por suerte» cada suerte lista lo
  que hizo la maquinaria de ASM debajo del ciclo.
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

## 🔴 Interruptores «de momento» — se prenden/apagan sin migración

| Qué | Estado | Por qué | Dónde se cambia |
|---|---|---|---|
| **La plata** (cuenta, presupuesto, costos, honorario, «se cargan $X») | ✅ PRENDIDA desde el 6-oct (`675cca2`); estuvo apagada desde el 23-sep | «quita lo de las transferencias, de momento no valoremos nada» | `VER_PLATA` en `lib/fincas.ts` (la base lo guarda siempre) |
| **El PIN para entrar a Fincas** | ⛔ apagado (23-sep) | «déjame ver sin el PIN, después lo volvemos a mostrar» | `update af_config set valor = 'true' where clave = 'pin_requerido'` — las sesiones abiertas SIN PIN (`af_sesiones.sin_pin`) dejan de servir al instante y la app vuelve a pedirlo |
| **La FOTO obligatoria del reporte** | ⛔ apagada (17-oct) | «de momento quítale la foto obligatoria, después lo volvemos a activar» | DOS llaves, van juntas: `FOTO_OBLIGATORIA` en `lib/fincas.ts` (el formulario) y `af_config.foto_requerida` (la base, `af_foto_requerida()` en `af__reportar`; migración `20261017090000`). Volver a exigirla: `true` en las dos. Mientras tanto: `af_reportes.foto_url` admite NULL (la app lo recibe como `''` y no dibuja imagen: «📷 sin foto»), el GASTO de un reporte aceptado tiene como soporte el propio reporte (check `af_movimientos_gasto_con_soporte`: `reporte_id` o soporte; los gastos A MANO siguen exigiendo soporte), y los textos del dueño salen de `evidenciaDeLabor()` |
| **La UBICACIÓN del reporte** | ⛔ apagada (16-oct) | «debo permitir que Julio pueda registrar sus labores así no esté en la finca; de momento no le actives la ubicación» | `PEDIR_UBICACION` en `lib/fincas.ts`. Apagada: «Reportar labor» no pide el permiso del GPS ni muestra «Sin ubicación…», «Por aceptar» no marca en rojo, y el portal, el mensaje del enlace y el resumen de WhatsApp no prometen «ubicación». La base nunca la exigió (`af__reportar` guarda `lat`/`lng` solo si llegan; no hay geocerca). El botón «dónde estoy» del mapa es aparte |

⚠️ Con el PIN apagado, `af_abrir_sesion_sin_pin(usuario)` da una llave a cualquier usuario del
personal (owner/administración/supervisor) que se nombre: es la concesión que se aceptó. Los
enlaces del dueño no cambian.

## El MAPA de la finca (migración `20260923090000_fincas_mapa.sql`)

Pedido del cliente para **RIOGRANDE II** (hacienda 627, Ingenio Risaralda, vereda Molina, Toro):
banner grande con el título + mapa donde se ve el avance. Ideas del geovisor de AgroControl.

- 🛰 **Capas satelitales Sentinel** (17-oct-2026, traídas de AgroCampo para la reunión con Cristian):
  desplegable «🛰 Satélite» en la barra de modos → Foto reciente (color real 10 m), Vigor (NDVI),
  Humedad de la planta (NDMI), Nitrógeno en caña adulta (NDRE) y Humedad del suelo por radar
  (Sentinel-1, atraviesa nubes). Mosaico de los últimos 30 días. Las teselas las sirve el proxy
  **ya publicado de AgroCampo** (`https://agrocampo-seven.vercel.app/api/s2-tile`, Copernicus
  gratis, claves de Iván allá): cero secretos en ASM. `op=info` da la fecha y % de nubes de la
  imagen que se ve (leyenda `LeyendaSat`). El proxy responde vacío fuera de z 9–16 →
  `maxNativeZoom: 16`. Si ASM necesita claves propias: copiar `agrocampo-repo/api/s2-tile.ts`
  a `sam-app/api/`, poner `SENTINEL_HUB_CLIENT_ID/SECRET` en Vercel, excluir `/api` del rewrite
  de `vercel.json` y cambiar `SAT_BASE` a `/api/s2-tile`. Medido 17-oct sobre Riogrande II:
  imagen despejada del 14-oct (33 % nubes), radar del 13-oct, tesela NDVI en ~2 s.
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
  fila 2, 4 = franjas del centro-sur, 3A, 3, 2A, 2, 1, 7). Dueña: Ana María Llanos.
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
| Sin foto no hay reporte (⛔ apagado de momento: `af_config.foto_requerida`); la hora es la del servidor | `af__reportar` (el check de la columna `foto_url` se quitó el 17-oct) |
| Nadie acepta su propio reporte | `af_revisar` (`NO_PROPIO`) + check `revisado_por <> reportado_por` |
| En ha, lo reportado no pasa del área de la suerte (+2 %) | `af_reportar` (`SUPERA_AREA`) |
| Fecha no futura ni anterior al corte | `af_reportar` |
| Aceptar crea el gasto UNA vez; su soporte es el reporte (y su foto, si la trae) | `af_revisar` + `reporte_id unique` + check `af_movimientos_gasto_con_soporte` |
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
  inventa). Ventanas vigentes: roturación soca 16/30; **fertilización soca 30/45** (era 45/60;
  17-oct-2026, migración `20261017120000` — es la misma regla de AgroCampo `shared/edadLote.ts`:
  `EDAD_EN_VENTANA = 30`, `EDAD_APURA = 45`, y Cenicaña ST21 dice ~30 DDC); **fertilización
  plantilla 30/60** desde la siembra (era 60/90; 16-oct, migración `20261016180000`, Cenicaña ST21).
  Convención: (inicio, fin) de la ventana → (`ventana_ideal`, `ventana_normal`): hasta ideal = ideal,
  hasta normal = normal, más = tardía.
- 🌱 **Ventana POR VARIEDAD** (17-oct-2026, migración `20261017150000`, punto B de la reunión con
  Cristian): `af_paquete.variedad` (NULL = todas). Al abrir un ciclo, `af__abrir_ciclo` toma por cada
  labor la fila de la variedad de la suerte si existe (`af_variedad_coincide`: «1940» = «CC 01-1940»)
  y si no la genérica — `DISTINCT ON (labor, aplica, unidad)`, nunca dos fertilizaciones. Cargadas
  para SOCA desde las curvas de N de Cenicaña: **CC 01-1940 20/46 · CC 05-430 7/26 · CC 11-595
  11/31**; plantilla sigue 30/60 hasta que Iván confirme. Se editan en «Paquete de labores» (campo
  Variedad). ⚠️ **Medido al aplicarla: 0 de las 11 suertes de Riogrande II tiene `variedad`** → las
  ventanas por variedad no aplican hasta llenarla (por SQL con `af.via_funcion` o agregando un campo
  de edición de suerte; hoy solo se pone al crear la suerte, `af_agregar_suertes`). Probado en
  transacción: suerte «cc 01-1940» → una sola fertilización con 20/46.
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

## 🧪 Finca de EJEMPLO para ver el módulo funcionando (23-oct-2026)

Riogrande II tiene las suertes y ciclos pero **cero reportes y cero movimientos**, así que el
módulo se veía vacío y no se apreciaba ninguna funcionalidad. Se creó una finca de prueba
APARTE, **RIOGRANDE PRUEBAS**, con datos completos que encienden cada pantalla. Scripts en
`sam-app/supabase/` (se corren por SSH como `supabase_admin`, `-v ON_ERROR_STOP=1
--single-transaction`; se ensayó antes en `begin…rollback`):
- `seed_riogrande_pruebas.sql` — la crea. Reusa la cartografía de la real (hacienda 627 ·
  Ingenio Risaralda, por eso salen satélite y plano) copiando `af_poligonos` y `datos_ingenio`
  por código de suerte. Usa las funciones INTERNAS (`af__abrir_ciclo` / `af__reportar` /
  `af__revisar`, con U005 = admin que acepta y U033 = Julio que reporta) para que el demo sea
  idéntico a producción; los movimientos a mano van por INSERT directo con `af.via_funcion`.
  Estados variados: a tiempo / normal / tardía / por aceptar / rechazada, riego y malezas con
  pasadas, anticipo + gastos + honorario + un gasto ANULADO, un polígono «por asignar» y un
  reporte con GPS. 11 suertes · 44 labores · 25 reportes · saldo **+$3.212.750**. Lleva candado
  anti-duplicado. El enlace del dueño del demo se generó al aplicar (no está en el repo).
- `borrar_riogrande_pruebas.sql` — la borra sin dejar rastro: guarda los ids ANTES y limpia
  **también la auditoría que genera el propio borrado** (el gotcha de la sección «Pruebas»).
🔴 Es DATO de prueba viviendo en producción: para quitarlo, corre el borrador.
- 🔴 24-oct-2026: el seed **ya no copia** los datos del ingenio de la finca real (el enlace se le
  muestra a clientes). Después del seed se corre `ajuste_riogrande_pruebas_ejemplo.sql`: datos de
  cosecha de EJEMPLO (incluida la sacarosa), 58 kg/t y $1.983/kg, y costos COMPLETOS por rubro
  (~$7,8 M/ha) con anticipos que los cubren. Requiere la migración `20261024090000`.

## 📊 Tablero de costos e indicadores del gremio (24-oct-2026)

Pedido de Iván: los costos «parecían los de una tienda». Investigado en Cenicaña (Informe Anual 2025,
tabla 1) y Procaña (Plantilla de costos 2022). Construido por OpenCode con la especificación de Claude,
cálculos validados por Codex con prueba automática, revisado por Claude.

- **Dónde**: `views/fincas/TableroFinca.tsx`, primer bloque del Resumen de `FincaDetalle` (lo ven el dueño
  y administración). Cálculos puros en `lib/fincas.ts`: `indicadoresCosecha`, `costosGremio`, `rubroDe`,
  `comparar`, `RUBROS`.
- **Productividad de la última cosecha** (de `datos_ingenio`): TCH y edad ponderados por área; rendimiento
  y sacarosa por toneladas; TAH = TCH × rendimiento; TCHM y TAHM sobre la edad. Comparados con el sector.
- **Costos del ciclo en curso**: gastos de las labores de los ciclos abiertos + gastos a mano de cada suerte
  desde su corte + gastos de la finca y honorarios desde el corte más antiguo. **Los anticipos nunca son
  costo.** $/ha; $/t sobre el TCH de la última cosecha (solo suertes con TCH > 0); $/kg de azúcar liquidado
  (÷ kg por tonelada); kilos de azúcar que se van en costos (÷ precio del kg), los que le quedan al dueño de
  los 58, punto de equilibrio en t/ha y lo que le queda por hectárea. Rubros en $/ha y kg/t.
- **Datos** (migración `20261024090000`): `af_fincas.kg_azucar_tc` y `precio_kg_azucar` (NULL = sin
  definir); `af_movimientos.rubro` (NULL = se deduce); `datos_ingenio.sacarosa`; las referencias del sector
  son la fila `af_config.referencias_sector` (con fuente y año) que lee `af_referencias()` con la llave
  pública. **Se actualizan con un UPDATE, sin publicar**; la app guarda copia en `localStorage['sam:af-referencias']`.
- **El precio del kg NUNCA sale de la referencia**: lo fija administración con la liquidación del ingenio. Sin
  precio no hay kilos ni punto de equilibrio (la pantalla dice qué falta). Los kg por tonelada sí caen a la
  referencia (58) y se avisa.
- **Rubro de un gasto**: el guardado manda; honorario → administración; si no, `rubro_por_labor` por nombre
  de la labor (sin tildes); si no, «otros».
- 🔴 **Sin costos registrados no se muestra «$0/ha» ni el medidor**: con $0 diría «le quedan los 58 kg».
  La Riogrande II real tiene ciclos abiertos y ningún gasto: ve la nota.
- «Su cuenta» pasó a «Cuenta de anticipos (caja)»; conserva «Saldo por girar» cuando es negativo.
- ⚠️ «El ciclo contra lo presupuestado» solo cuenta las labores del PAQUETE; el tablero cuenta TODO el costo.
  Son dos cifras distintas a propósito.
- **Prueba**: `node scripts/prueba-costos-gremio.mts` desde `sam-app/` (Node 24 corre TypeScript directo, sin
  tsx): 10 casos sobre `scripts/fixtures/fincas-riogrande-pruebas.json`, con las cifras validadas contra
  SQL ($7.816.183/ha, $60.895/t, 30,7 kg de costo y 27,3 libres, equilibrio 68,0 t/ha).
- ⏳ **Falta (fase 2, con maqueta antes)**: formularios para el precio y los kg por finca, el rubro en el
  gasto a mano y la liquidación de la cosecha (TCH, toneladas, rendimiento, sacarosa). Hoy solo por SQL.

## 📈 Historia corte a corte + IYOMA PRUEBAS (24-oct-2026)

- 🔴 **VOCABULARIO DEL CLIENTE (Iván, 24-oct-2026): un CICLO va de RENOVACIÓN a renovación** —destrucción
  de cepas, arado, surcado, siembra— y es un **conjunto de CORTES** de ~1 año (plantilla, soca 1, soca 2…).
  **Cada fila de `af_ciclos` es un CORTE**, no un ciclo: la tabla y las funciones se quedan con su nombre
  (renombrarlas era romper sin ganar nada, como con aval/aprobación), pero lo que ve la gente dice
  «corte». Y una nueva PLANTILLA (renovación) **reinicia el conteo**: después de «Soca 5» viene
  «Plantilla», no «Soca 6» (prueba «una renovación reinicia el conteo de cortes»). ✅ Desde el
  24-oct-2026 TODO el módulo y el manual dicen «corte» (lista aprobada por Iván, 26 textos): «Iniciar
  corte», «Corte en curso (soca) desde…», «cortes en curso», «Costos del corte en curso». Tres frases de
  la base que aún dicen «ciclo» se traducen en `mensajeDeError()` (`FRASES_DE_CORTE`, sin migración).
  ⚠️ Las capturas del manual (`public/manuales/fincas/*.jpg`) son de ANTES: muestran «Abrir ciclo».

- **La cosecha de CADA ciclo** queda en `af_ciclos.datos_cosecha` (jsonb, mismas llaves que
  `datos_ingenio`; NULL = no se sabe). Antes solo había la ÚLTIMA cosecha de la suerte. Migración
  `20261024170000_fincas_historia_ciclos.sql`. `af_datos` arma los ciclos con `to_jsonb(c)`: la columna
  llegó sola, sin tocar esa función.
- **La inflación es un DATO**: fila `af_config.inflacion` (`ipc_anual` del DANE a diciembre + el salario
  mínimo de referencia), y `af_referencias()` la devuelve en la llave `inflacion`. Al salir el IPC de un
  año nuevo: actualizar esa fila; la app compara sola, sin publicar.
- **`historiaCiclos()`** (`lib/fincas.ts`): una fila por AÑO de cosecha (ciclos CERRADOS por el año del
  corte) + «en curso». Costo de un ciclo = GASTO por labor o por suerte y fecha; honorarios y gastos sin
  suerte se reparten por área entre los ciclos vivos en su fecha; anticipos y anulados nunca. **Pesos de
  hoy** = cada movimiento × IPC acumulado desde su año hasta el último año con IPC (convención: precios de
  fin de año). 🔴 **Filtra por finca**: la primera versión repartía los honorarios de OTRA finca.
  $/t solo con los ciclos que tienen toneladas (un ciclo sin cosecha no infla el $/t).
- **Tarjeta «Historia corte a corte»** (`TableroFinca`): selector «Pesos de cada año / Pesos de hoy»
  (arranca en hoy), frase calculada que compara la primera soca con la última cosecha en las dos
  escalas («la diferencia es inflación, no la finca»), columnas de $/ha y tabla Año · TCH · Rend. % · $/ha ·
  $/t · $/kg. La fila en curso va en pesos de este año. 🔴 La tabla lleva `min-width: 0` (hija de
  `.af-card`, que es flex: sin eso medía 820 px en una tarjeta de 347) y anchos medidos a 320 px.
- **IYOMA PRUEBAS** — finca de prueba sobre el plano de la **Hda. IYOMA 1403 (Riopaila Castilla,
  Roldanillo)**: 5 suertes (55,25 ha), al principio 18 pedazos del plano digitalizados de la imagen con la cuadrícula
  **MAGNA-SIRGAS Colombia Oeste** (E 1.107.750, N 985.000…) y verificados sobre la foto satelital y el plano
  georreferenciado del ingenio. 🔴 **25-oct-2026: los linderos se ajustaron a los SURCOS de la foto**
  (Iván: «los surcos no deben quedar por fuera del polígono»). El plano tal cual dejaba surcos por fuera
  (la punta de la 10, 10–25 m del occidente de la 30) y franjas de 3–9 m sin dueño entre suertes vecinas
  (la 10 se metía en surcos de la 20 cruzando la zanja). Ahora son **5 polígonos, uno por suerte**: cada
  uno llega a donde terminan sus surcos (medido sobre la foto Esri z18 con contraste e índice verde−rojo),
  la 10 y la 20 se parten por la **zanja**, y las demás vecinas por la mitad del camino. Lo dibujado da
  **60,16 ha contra 55,25 oficiales**: el área oficial descuenta caminos, zanjas y rondas, y la app sigue
  usando la oficial para todo (el mapa muestra las dos). Parche sobre una base cargada:
  `supabase/ajuste_iyoma_pruebas_poligonos.sql` (lo escribe el generador desde
  `scripts/fixtures/iyoma-poligonos.json`; lo borrado queda en la auditoría). ⚠️ La franja norte de la 20
  (15–55 m entre el plano 2020 y el camino) tiene surcos seguidos en la foto pero el plano no la traía: con
  un cliente real, confirmarla con el dueño. ⚠️ Iván aclaró (24-oct) que ese plano lo **dio ASM y es público**: se usa
  con el **dueño de Iyoma** (volante y folleto en `caso-exito/fincas/*-iyoma.*`, sin marca del ingenio y con
  las cifras marcadas como simulación); para otros clientes sigue siendo mejor RIOGRANDE PRUEBAS. Datos SIMULADOS y reproducibles: `node
  scripts/generar-iyoma-pruebas.mts` escribe `supabase/seed_iyoma_pruebas.sql`, `borrar_iyoma_pruebas.sql`
  y `scripts/fixtures/iyoma-datos.json` (idéntico a lo que queda en la base: el saldo cuadra al peso). UN
  ciclo por suerte que arranca en 2020 con la **renovación nombrada** (destrucción de cepas, arado,
  surcado, siembra) y 5 cortes cerrados (plantilla → soca 4 cosechada en 2025) + el abierto con roturación,
  fertilización en su ventana por variedad, 3 pasadas de malezas, riegos, un rechazo y un pendiente. Costos
  con inflaciones distintas: IPC para todo y **salario mínimo para la mano de obra**; supuestos marcados en
  el SQL (IPC 2026 = el de 2025; insumos +20 % en 2022). Prueba: `node scripts/prueba-historia-ciclos.mts`
  (10 casos, cifras exactas a mano + dos fincas + el fixture).
- 🔴 **Presupuesto del corte en curso: PASADAS y COSTO APARTE (25-oct-2026, migración `20261024200000`).**
  Antes presupuesto = Σ cantidad × costo: una labor que se repite (riego, malezas) contaba UNA pasada y el
  fertilizante, la mano de obra y el agua (gastos a mano) no tenían línea; IYOMA marcaba **$355,7 M de $27,9 M =
  1275 %**. Ahora cada labor (paquete `pasadas_plan`/`costo_aparte_unitario`; corte `pasadas_plan`/
  `costo_aparte_unitario_plan`) lleva: **tarifa** (lo que se COBRA al aceptar cada reporte, igual que siempre),
  **costo aparte** por unidad y pasada (entra al presupuesto, se paga como gasto a mano) y **pasadas**
  (solo una labor repetible puede tener más de 1: lo exige un CHECK). Fórmula ÚNICA en `presupuestoLabor()`:
  cantidad × pasadas × (tarifa + aparte). `presupuestoFinca()` desglosa «Servicios de AgroMorales» (gastos con
  `reporteId`) y «Pagado aparte» (el resto). Por defecto 1 y 0: lo existente quedó igual al peso (RIOGRANDE II
  $4.034.400 antes y después). En la pantalla: tarjeta del corte con el desglose, «Presupuesto» por labor (editor
  DEBAJO de la tabla: dentro de ella no cabía en el celular) y el paquete con tarifa, costo aparte y pasadas.
  IYOMA: roturación 225.000 · fertilización 160.000 + 2.490.000 aparte · malezas 120.000 + 980.000 × 3 · riego
  0 + 125.000 × 8 → **90 %** ($41,2 M de servicios al 100 %, $314,5 M aparte al 89 %). Prueba:
  `node scripts/prueba-presupuesto-fincas.mts` (6 casos). ⏳ Falta que administración ponga en el PAQUETE GLOBAL
  el costo aparte y las pasadas de riego y malezas: hoy siguen en 0 y 1 (por eso los cortes nuevos nacen igual
  que antes). Las fechas de reportes y movimientos (que `af__reportar`/`af__revisar` y los `insert` ponen con la
  hora de la carga) se corrigen al final de la semilla; el parche para una base ya cargada es
  `supabase/ajuste_iyoma_pruebas_fechas_presupuesto.sql` (lo genera el mismo script).
- 🗺 **Capa «Solo bordes» del mapa (25-oct-2026):** sin relleno, lindero con borde doble (halo `#0f172a` + blanco)
  para que se vea el índice satelital; se activa sola al escoger vigor/humedad/nitrógeno/radar y vuelve al modo
  anterior con la foto base (`modoAntesRef`); si se escoge a mano, se respeta. Sin leyenda de labores en ese modo.

## 🌱 «Sencillo pero funcional» — paquete 1 (16-oct-2026)

Revisión de Iván con tres agentes (herramientas del mercado, agronomía Cenicaña y el código). Lo
que se aplicó, todo para Julio (U033) en el campo:

| Qué | Dónde |
|---|---|
| **Abre y reporta SIN SEÑAL**: cada carga buena se guarda (`lib/cacheFincas.ts`, en `db.meta`, rellenada contra la carga vacía — regla 2b). Sin señal, Fincas abre con ella y lo dice («📵 Sin señal: datos guardados el …»); al volver la señal recarga solo. Sin llave y sin señal espera la señal (no pide un PIN que no serviría). Al salir se borra (`App.tsx`, `borrarCargasFincas`) | `FincasView` |
| El **supervisor entra directo a «Reportar labor»**; finca/suerte únicas quedan escogidas; las labores ya reportadas completas no salen como «faltan 0»; se explica si una suerte no tiene nada pendiente | `FincasView`, `ReportarLabor` |
| **Lo guardado sin señal cuenta en «faltan»** (`reportesConCola`): ya no invita a duplicar | `lib/fincas.ts` |
| **Cola en dos listas**: «⏳ Esperando señal» (sale sola) y «⚠ No salieron» (`esRechazo`: el servidor lo rechazó → ya NO se reintenta sin fin). Las dos con **Quitar** (confirma; borra también la foto guardada) | `lib/outboxFincas.ts`, `ReportarLabor` |
| **Rechazos visibles**: «⚠ Le rechazaron…» arriba, con **Corregir y reenviar** (llena el formulario; la foto se vuelve a poner) y **No hace falta**. Lo atendido se guarda en el celular (`sam:af-rechazos-atendidos:<usuario>`). La pestaña dice «⚠ N por corregir» (`rechazosPorAtender`) | `ReportarLabor`, `FincasView` |
| **Aceptar pide confirmación** (es definitivo) | `PorAceptar` |
| **«Borrar caché» (Diagnóstico) ya NO borra los reportes de fincas** que esperan señal | `DiagnosticModal` |
| Ventana de fertilización plantilla 30/60 y el aviso al dueño sin «ubicación» | migraciones `20261016180000`, `20261016170000` |

Pendiente (paquete 2): hora del celular además de la del servidor («guardado 7:10 · llegó 18:40»),
fecha de la foto para quien acepta, edad de la caña y fecha prevista de corte en la vista del dueño,
aporque / control de *Diatraea* / madurante con ventana en el paquete, separar descepada (renovación)
de roturación soca. NO conviene (revisión del mercado): IA que «verifica» fotos, QR en lotes,
geocerca que bloquea, telemetría de máquinas, capturar por WhatsApp desde ya.

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

## 🔴 18-oct-2026: el CALENDARIO satelital necesita el puente `/api/s2-tile`

El proxy de AgroCampo (`agrocampo-seven.vercel.app/api/s2-tile`) **no manda `Access-Control-Allow-Origin`**.
Las baldosas (`<img>`) cargan igual, pero el JSON de `op=info` (fecha de la imagen + histórico de un año)
lo bloqueaba el navegador desde ASM: en producción NUNCA salían la fecha ni el selector 📅 (pasó
desapercibido desde `0561463`). Arreglo: `vercel.json` reescribe `/api/s2-tile` → AgroCampo y
`vite.config` hace lo mismo en desarrollo; `MapaFinca` pide `op=info` a `SAT_INFO = '/api/s2-tile'`.
Comprobado con los datos reales de RIOGRANDE II vistos como dueño: 28 fechas claras en el último año
(más reciente 14-oct, 33 % nubes; radar 13-oct). La suerte 7 sale con menos vigor (NDVI) y seca (NDMI).

## 📖 21-oct-2026: manual nuevo para el cliente (`public/manuales/manual-fincas.html`)

Reescrito con capturas REALES de la app (antes eran recortes dibujados y le faltaba octubre): 15
pasos en 4 partes (Para empezar · Montar la finca · El día a día · El dueño de la tierra) + reglas y
«Qué hacer si…». Incluye el dueño con usuario, el mapa y el satélite (enlaza `satelite-fincas.html`)
y las ventanas VIGENTES del paquete (roturación soca 16/30; fertilización soca 30/45, plantilla 30/60,
CC 01-1940 20/46, CC 05-430 7/26, CC 11-595 11/31). Capturas en `public/manuales/fincas/` con una
finca de EJEMPLO («FINCA LA ESPERANZA», dueña «María Gómez», operarios inventados, costos de ejemplo):
la forma real de `af_datos` (sacada en una transacción deshecha) con todo lo identificable cambiado.
⚠️ Para rehacer capturas: los códigos de usuario del ejemplo NO deben existir en `app_usuarios`
(`UEJ00`, `UEJ01`…): la app toma el nombre de la lista real de usuarios antes que de `nombres`, y con
`U033` salió el nombre real del operario. PDF de 18 páginas con Edge (`--print-to-pdf`).


## 🧭 25-oct-2026: REDISEÑO de Fincas — maqueta TÉCNICA aprobada (catálogo y plan del corte CONSTRUIDOS; tablero pendiente)

**Estado al 25-oct-2026 (rama `fincas-rediseno`, NO publicada):**
- ✅ **«Aparte» → «Ppto por ha»** en pantalla y manual (`PaqueteLabores`, `FincaDetalle`, `manual-fincas.html`). Las columnas
  de la base no se renombran.
- ✅ **Catálogo de labores** (`PaqueteLabores.tsx`, pestaña «Catálogo de labores»): una tarjeta por labor con su rubro
  (de `af_config.referencias_sector.rubro_por_labor`), filas por tipo de corte y variedad, ventana en DDC, servicio, Ppto por
  ha y **Total por ha**; indicadores arriba; «Duplicar» para crear una variante. Los cálculos viven en
  `lib/catalogoFincas.ts` (`node scripts/prueba-catalogo-fincas.mts`, 11 casos). En celular cada fila es una tarjetita
  de 2 columnas (`.af-cat__tabla`, `data-label`); ⚠️ las reglas llevan `.af-tabla.af-cat__tabla` para ganarle a
  `.af-tabla` (misma especificidad, el orden del archivo decidía).
- ✅ **Plan y presupuesto del corte** (`PlanCorte.tsx`, reemplaza el mini formulario «Iniciar corte»): Parámetros → Punto de
  partida (catálogo / copiar el corte anterior / copiar de otra suerte) → Ajustar costos → Revisar y activar (con
  cronograma ideal/normal en fechas). Lógica en `lib/planCorte.ts` (replica `af__abrir_ciclo`: la fila de la variedad le gana
  a la genérica; `node scripts/prueba-plan-corte.mts`, 16 casos). **Nada se guarda hasta el paso 4**, y entonces la función
  `af_abrir_ciclo_plan` (migración `20261025190000`, 21 pruebas en `supabase/pruebas_fincas_plan_corte.sql`) abre el corte y
  aplica los ajustes **en una sola transacción**. 🔴 Si la migración no está aplicada, «Activar corte» falla: **aplicarla
  ANTES de publicar la app**. La función vieja `af_abrir_ciclo` sigue intacta (cliente viejo en caché).
  ⚠️ Copiar de otro corte trae solo costos y pasadas; las labores y ventanas salen siempre del catálogo y la variedad.
- ⏳ **Pendiente: tablero del corte con curva S** (presupuesto, plan a la fecha, ejecutado, variación, rubros, alertas).
- ⏳ **Pendiente de confirmar con Carlos David**: etapas «Cosecha (CAT)» e «Indirectos» y su lista de rubros del gremio.
- 🔴 Lecciones: (1) un `<input type="radio">` dentro de un `label` flex heredaba `width:100%` global y desbordaba el
  panel 42 px en celular — fijarle ancho; (2) DeepSeek Flash se pegó compilando y entregó la pantalla incompleta y fuera de
  la especificación: la terminó Claude (ver `registro-desempeno-modelos.md`).

Iván, sobre la pantalla de la finca («Lo que ve el dueño / Labores por suerte / Cuenta / Bitácora»): *«no se ve
profesional… no veo bien los módulos donde se alimentarían los presupuestos, catálogos de labores…, quiero algo
funcional, intuitivo y que funcione»*. Diagnóstico medido: el presupuesto se alimenta en un botón escondido dentro de la
tabla del corte y en «Paquete de labores» (solo administración); el catálogo global tiene **8 filas** (fertilización
sale 5 veces: genérica soca, plantilla y una por variedad) y **ninguna con «Ppto por ha» cargado**.

**Aprobó la versión TÉCNICA (la 2.ª de tres maquetas; la «limpia» la descartó) con un cambio de nombre:**
la columna **«Aparte por ha» pasa a llamarse «Ppto por ha»** (presupuesto por hectárea de lo que paga el dueño fuera del
servicio) y la última columna del plan, «Total por ha». Hay que renombrarlo también en `PaqueteLabores`,
`FincaDetalle` (editor de presupuesto), el manual y los tipos de pantalla; las columnas de la base
(`costo_aparte_unitario`, `costo_aparte_unitario_plan`) **no se renombran** (misma regla que aval/aprobación).

Lo que construye, en este orden:
1. **Catálogo de labores** (pantalla propia, no pestaña de la finca): agrupado por etapa, con código (propuesto),
   labor, aplica (soca/plantilla), rubro, variedad, ventana ideal/normal en **DDC** (días después del corte),
   servicio $/ha, **Ppto por ha**, pasadas y «se repite». Aviso cuando faltan costos. Un cambio NO toca los cortes activos.
2. **Plan y presupuesto del corte**: asistente de 4 pasos (Parámetros → Punto de partida [plantilla / copiar el corte
   anterior / copiar otra suerte] → Ajustar costos → Revisar y activar), con cronograma por variedad. Total de cada línea =
   (servicio + Ppto por ha) × pasadas × hectáreas. Nada afecta a la finca hasta el paso 4.
3. **Tablero del corte**: presupuesto, plan a la fecha, ejecutado y variación; indicadores del gremio (costo/t y costo/ha
   contra Procaña 2022, punto de equilibrio, costo en kg de azúcar); **curva S**; estructura por rubro; alertas; tabla
   presupuesto vs ejecutado por etapa con avance físico. Semáforo: verde ±5 %, amarillo 5–15 %, rojo >15 % o ventana vencida.

⚠️ **Lo que NO existe todavía y la maqueta propone:** etapas «Cosecha (CAT)» e «Indirectos» (administración, arriendo en
kg de azúcar/ha, cuotas gremiales). Su lista exacta **debe confirmarla Carlos David con la plantilla Procaña**; la
investigación de Antigravity NO sirvió para eso (sus enlaces a Procaña, Aliare y Agroptima no abren). Verificado en la
red solo esto: Agworld guarda planes como plantillas reutilizables y compara presupuesto contra real; Conservis permite
armar el presupuesto desde cero o copiar uno anterior.

Cifras de la maqueta = finca simulada IYOMA PRUEBAS (55,25 ha, presupuesto $396,4 M = $7,18 M/ha, costo/t $62.717 con el
TCH 114,4; punto de equilibrio 62,4 t/ha a $115.000/t; 3.618 kg de azúcar/ha de 6.635). La distribución por etapa y la
curva S son de EJEMPLO. Antes de construir: confirmar con el cliente la lista de etapas y rubros.