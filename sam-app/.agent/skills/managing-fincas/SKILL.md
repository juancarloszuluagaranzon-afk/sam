---
name: managing-fincas
description: >
  Módulo de ADMINISTRACIÓN DE FINCAS DE CAÑA dentro de la app de ASM (segundo inicio, al lado
  de la maquinaria). Úsala al tocar fincas, suertes administradas, ciclos de corte a corte,
  paquete de labores, reportes de campo con foto/GPS, «por aceptar», la cuenta del dueño
  (anticipos, gastos, honorarios, saldo), el resumen por WhatsApp o las tablas `af_*`.
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

- `supabase/pruebas_administracion_fincas.sql` — 40 casos, dentro de `begin … rollback`, más los
  permisos del rol anónimo (no borra, no reporta ni acepta directo, sí lee).
- `scripts/prueba-fincas-e2e.mjs` — **el código real de la app contra la base real**, cargado por
  Vite (`server.ssrLoadModule`), porque `lib/supabase` lee `import.meta.env` y `tsx` no lo trae.
  16 chequeos de punta a punta. Deja datos «PRUEBA E2E»: borrarlos después (ver abajo).
- Borrar datos de prueba: SQL con `set_config('af.via_funcion','1', true)`, en orden movimientos →
  reportes → labores → ciclos → suertes → fincas, y sus filas de `af_auditoria`. 🔴 Las fotos NO se
  borran por SQL («Direct deletion from storage tables is not allowed»): con la Storage API.
  Y con `ON_ERROR_STOP` + `begin`, un error deja TODO sin aplicar — revisar el conteo final.

## Límites conocidos del MVP (decírselos al cliente)

- **Acceso directo del dueño de la tierra: todavía no.** La app entra con la llave anónima y el
  usuario lo dice el celular; un dueño externo con esa llave podría leer otras fincas. Primero,
  autenticación real + acceso por finca en la base. Mientras tanto: la pestaña «Lo que ve el dueño»
  y el resumen por WhatsApp.
- El reporte **necesita señal** (no entra a la cola sin conexión). Tiene tope de 90 s con mensaje y
  la misma id en los reintentos (la base no duplica).
- Fotos en el bucket `avatars` (público), como el resto de SAM.
- Honorario: se registra a mano (el modo y valor de la finca quedan guardados, aún no se calcula).
- Sin cosecha ni liquidación del ingenio (etapa 3 de la propuesta).
