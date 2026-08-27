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
