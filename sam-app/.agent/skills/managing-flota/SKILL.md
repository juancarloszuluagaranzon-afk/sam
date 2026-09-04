---
name: managing-flota
description: >
  Módulo FLOTA / ESCOLTA y la planilla CDA-F-68. Úsala cuando toques FlotaTab,
  FlotaForm, FlotaView, `flota_servicios` o cualquier exportación a Excel con
  formato. También si el usuario menciona "flota", "escolta", "CDA-F-68",
  "planilla de camionetas", "IMECOL", "membrete", "Julián", o pide que un Excel
  salga con bordes, logo o cuadrícula.
---

# Flota / Escolta — y la planilla que se entrega

El escolta registra cada servicio de camioneta y de ahí sale el **CDA-F-68**, un
formato que **se imprime y se le entrega a IMECOL**. Eso cambia el estándar: no
es un reporte interno, es un documento de un tercero.

## 🔴 `xlsx` NO ESCRIBE ESTILOS. Probado.

La versión comunitaria de `xlsx@0.18.5` —la que usa el resto de la app— **ignora
bordes, negritas y rellenos al guardar**. Se comprobó poniéndole un borde a una
celda, guardando y volviendo a leer: había desaparecido, dejando solo un
`patternType: 'none'`.

Por eso la planilla salía con la estructura correcta y **sin una sola línea**, y
una planilla que se entrega sin cuadrícula se ve a medio hacer.

**Solución: `exceljs`, solo en esta exportación.** Entra por `import()` dinámico
y queda en su propio chunk de ~930 kB que NO toca el bundle inicial — mismo
patrón que ya tenía `xlsx`.

⚠️ **Las otras siete exportaciones siguen con `xlsx` y así deben quedarse.** No
necesitan estilos y migrarlas sería riesgo sin beneficio. Si aparece una octava
que SÍ se imprima y se entregue, esa sí va con `exceljs`.

⚠️ Es un **chunk nuevo**, y la regla 3 del CLAUDE.md pide verificar el preview
real de Vercel. Se verificó descargando desde producción: el chunk carga y genera
un archivo válido.

## Cómo se arma el formato

`aoa_to_sheet` y no `json_to_sheet`: el segundo solo sabe hacer una fila de
encabezados, no un bloque de membrete con celdas combinadas encima.

- **Membrete**: `A1:A4` el logo, `B1:N1` "FORMATO", `B2:N4` el título,
  `O1..O4` los códigos de normalización.
- **`MEMBRETE`** es una constante con nombre arriba del archivo. Cuando salga la
  versión 2 del formato, se edita ahí y ya.
- **El logo** se lee de `/logo-imecol.png` dentro de un `try/catch`: si falta,
  queda el texto "IMECOL" en rojo. **Que no aparezca un logo no puede tumbar una
  descarga.**
- 🔴 **El PNG venía cuadrado (447×447) con la marca en medio de un mar de
  blanco**, y dentro de la celda salía diminuta. Se recortó con `jimp`
  (`autocrop`) a 404×80 — proporción 5:1, la forma real de la marca. Si mañana
  entra otro logo, recortarlo antes.
- **Filas vacías hasta 18** para que la cuadrícula se vea igual aunque el rango
  tenga pocos viajes.
- **Orden cronológico ascendente**, al revés que la pantalla: una planilla que se
  entrega se lee de arriba abajo como pasaron los días.

## 🔴 Cero peajes es una casilla VACÍA, no un cero

`s.numPeajes || ''`. En el formato en papel esas casillas van en blanco cuando no
hubo peaje, y un **0 impreso se lee como "alguien contó y dio cero"** — que no es
lo mismo que no haber pasado por ningún peaje.

El **total de km sí conserva el cero**, porque ahí el cero sí dice algo.

## El formulario pide 9 campos, no 16

En las seis filas del formato lleno que mandó el cliente, **centro de costo,
proceso solicitante, las dos horas de regreso, la hora de espera, los peajes y
los otros gastos están TODAS en blanco.**

Se plegaron detrás de *"Otros campos del formato"* — **no se borraron**: un peaje
pagado hay que poder anotarlo el día que pase. Y el Excel sigue sacando las 16
columnas, porque el formato impreso es el formato impreso.

## El conductor descarga la suya

El botón de Excel estaba solo para administración. **El conductor es quien
entrega la planilla**: pedirle que le escriba a la oficina para que se la manden
es ponerle un intermediario a su propio trabajo. Solo baja los suyos, porque
`conductorScope` ya acota la consulta.

## La placa por defecto

Ver el mismo apartado en `managing-madera`: sale de la máquina asignada por dos
caminos, porque `equipmentCode` se guarda en la sesión AL ENTRAR y nadie cierra
sesión en campo.

⚠️ Hay **dos camionetas** registradas (`AVD300` y `VCQ605`... y `LQX955`), así que
el respaldo de "el único vehículo" no aplica: con varias se deja en blanco a
propósito. Proponer el carro equivocado es peor que no proponer nada.

## Son DOS formatos, no uno con variantes (3-sep-2026, commit `08ecd95`)

| | **CDA-F-68** (IMECOL) | **F-OPE-22** (AgroMorales) |
|---|---|---|
| Título | CONTROL DE TRANSPORTE FLOTA NO PROPIA | GESTIÓN OPERATIVA |
| Columnas | 16 | 14 |
| Propias | centro de costo, proceso solicitante, peajes, otros gastos | **número de maquinaria**, **km inicial/final/total**, N° servicio, firma responsable |
| Encabezado | ninguno | **FECHA · PLACA · NOMBRES · CÉDULA · SEMANA** |
| Archivo | `views/FlotaTab.tsx` | `lib/planillaOpe22.ts` |

Dos botones, no un selector escondido: quien necesita el otro no lo encontraría.
Se guardan **todos** los campos y cada exportación toma los suyos.

🔴 **Una hoja por conductor Y placa.** El encabezado del F-OPE-22 lleva un solo
nombre, una sola cédula y una sola placa. Dos conductores en la misma hoja dan un
encabezado que le miente a la mitad de sus propias filas. `porConductorYPlaca()`.

🔴 **La cédula vive en `app_usuarios`, no en `flota_servicios`.** Es un dato de la
PERSONA: en la tabla de servicios se repetiría por fila y podría contradecirse
entre una y otra. ⚠️ Hubo que agregarla también al **`select` explícito** de
usuarios (`samApi.ts`) — el tipo por sí solo no la habría traído.

## 🔴 Km inicial y final: el campo suelto se llenaba con el odómetro

Antes había un solo campo «Total km» tecleado a mano. Medido sobre los 34
servicios existentes:

- **Julián** — 23 servicios entre 18 y 98 km. Distancias reales.
- **Camilo** — **8 de 9 con valores > 1000**: 147952, 147977, 148001, 148060,
  148113, 148138, 148238. Son **lecturas del odómetro consecutivas y
  ascendentes**, no distancias. Su planilla decía 147.952 km en un viaje de 50
  minutos.

No es descuido: un campo que pide «total km» al lado del tablero del carro se
llena con lo que dice el tablero. Con las dos lecturas el total **no se teclea**,
es la resta — y se muestra la operación completa (`148.001 − 147.977`) para
comprobarla contra el carro sin calculadora.

- Final < inicial → **avisa en rojo, no bloquea** (misma regla que el horómetro).
- Sin poder leer el odómetro → sigue habiendo un campo para el total directo.
- `kmDelServicio()` devuelve **`null`** y no cero cuando falta una lectura.

🔴 **KM TOTAL sin lecturas es casilla VACÍA en el papel, no cero** — misma regla
que los peajes: un 0 impreso afirma «no recorrió nada», que no es lo mismo que
«no se anotó». El total del pie **sí** conserva el cero.

⚠️ **Los 8 registros de Camilo siguen con la lectura en `total_km`.** Se pueden
recuperar: las diferencias entre lecturas consecutivas dan 25, 24, 59, 53, 25,
75 y 25 km. El `1482.13` del 4-sep encaja como **148213** (punto decimal mal
puesto, el mismo error de las tirillas de combustible).


## Lo que faltaba del formato, medido contra el papel (4-sep-2026, `cb2d33c`)

- **TALLER no estaba en la lista de tipos.** El pie del F-OPE-22 dice
  «TRANSPORTE PERSONAL - ESCOLTAS - TALLER» y el formulario ofrecía ESCOLTA /
  TRANSPORTE / DISPONIBILIDAD / OTRO. **6 de 34 servicios (18%) cayeron en
  «OTRO»** siendo viajes de repuestos — *«se recogieron 2 baterías, 1 alternador
  y unas platinas»*. 🔴 **Una categoría que falta no desaparece: se disfraza de
  «otro» y deja de poder contarse.**
  ⚠️ Los valores se dejaron **cortos y como estaban** (`TRANSPORTE`, no
  `TRANSPORTE PERSONAL`): renombrarlos dejaría a los registros ya hechos hablando
  otro idioma que los nuevos.
- **«Tiempo de espera» estaba plegado.** Correcto para el CDA-F-68 — ahí va
  siempre en blanco — pero en el F-OPE-22 es **columna principal**, y solo 2 de
  34 la traían. Es lo que pasa cuando un campo del papel vive tras un
  desplegable. 🔴 **Los dos formatos no están de acuerdo en qué campos importan,
  y el formulario estaba optimizado para uno solo.** Al tocar el formulario,
  revisar contra AMBOS papeles.

Comprobado columna por columna: las 14 del F-OPE-22 tienen su campo, y el orden
del formulario quedaró calcado del papel.

## El conductor tiene manual propio (`56454b1`)

`manual-conductor.html`. Antes el rol `conductor` caía al `default` de
`manualesDe()` y le salía **el manual del operario** — labores agrícolas —, o
sea quien llena la planilla no tenía guía de la planilla.

La sección que más pesa es la del kilometraje, y va con el número real: *«ocho
registros seguidos quedaron con 147.952, 147.977, 148.001… la planilla decía que
un viaje de 50 minutos había sido de 147.952 kilómetros»*. Un manual que explica
la regla en abstracto no cambia lo que hace la gente; uno que le muestra el
error que ya ocurrió, sí.

⚠️ **Al agregar un rol nuevo hay que sumarlo a `manualesDe()`** — el `default`
no falla, entrega el manual equivocado en silencio.
