---
name: managing-movimientos
description: >
  Tablero de MOVIMIENTOS DE INSUMOS y medición de despachadores para el pago por
  productividad. Úsala cuando toques MovimientosTab, movimientosApi,
  `resumen_movimientos_insumos`, o cualquier métrica sobre quién entrega, cuánto
  y con qué calidad. También si el usuario menciona "pago por productividad",
  "cuántas entregas por día", "ranking de despachadores", "Genaro", "Castañeda",
  "cuadre del carro", "entregas por visita" o "índice de calidad del registro".
---

# Movimientos de insumos — medir a la gente sin romper la medida

**Más → 📦 Movimientos de insumos.** Lo ven el dueño y administración.

Nació porque el cliente quiere arrancar un **pago por productividad** con los tres
despachadores. Eso cambia todo: no es un reporte, es la base de la nómina de tres
personas con nombre propio.

## 🔴 La lista por despachador SE QUITÓ (21-sep-2026)

El cliente mandó captura con la lista por persona (Eduvin, Genaro, Diego: entregas, días,
por hora, % de registro, cuadre del carro) y el aviso «Estos números todavía no son para
pagar», y escribió: **«quita esto»**. Salió de `MovimientosTab` junto con su ventana de
detalle por persona. Lo que sigue en la pantalla: la cinta (sin foto · sin aprobar · gal sin
cuadrar), las cuatro cifras, las tortas, combustible por hora con sus semáforos y «A quién se
entrega». Las funciones (`indiceCalidad`, `ritmoPorHora`, `cuadreCarro`, `esDeRuta`) siguen
en `services/movimientosApi.ts`: si vuelve el pago por productividad, no hay que rehacer los
cálculos. Las secciones de abajo que hablan de esa lista describen cómo era, no cómo es.

## 🔴 La regla que ordena toda la pantalla

**El volumen NUNCA se muestra solo.** Al lado del número de entregas va siempre la
calidad del registro y las visitas. Un tablero con el ranking pelado sería más
bonito y le costaría plata mal repartida al dueño.

No es desconfianza en la gente: es lo que pasa siempre cuando una medida se vuelve
la meta. Goodhart, Campbell, el caso Wells Fargo. La medida deja de medir.

## 🔴 Un despacho es UN hecho

Se cuentan filas de `insumos_solicitudes` con `estado='ENTREGADA'`. **Nunca** filas
de `insumos_kardex` ni de `insumos_solicitud_items`.

La diferencia no es cosmética. Medido sobre agosto: contar líneas infla a Genaro un
**51%** y al analista un 23% — o sea premia a quien reparte materiales sueltos y
castiga a quien lleva un solo insumo por viaje. Con ese número se iba a pagar.

⚠️ **La regla aplica también a los NUMERADORES.** El primer brief decía "375 con
foto" sobre 263 entregas: 143%. Era el conteo por línea. Cualquier porcentaje que
pase de 100 es este error.

## Las métricas, y por qué cada una

| Métrica | Qué mide | Trampa que evita |
|---|---|---|
| **Entregas** | El volumen | — |
| **Por día trabajado** | Divide entre días ACTIVOS | El calendario castigaría a quien estuvo incapacitado |
| **Por hora en ruta** | El ritmo real | Revela que el volumen es presencia, no velocidad |
| **Visitas** | Entregas a la misma máquina en 90 min = una | **Partir un tanqueo en dos** |
| **Registro completo** | foto × aval × sin diferencia | Correr sin dejar prueba |
| **Cuadre del carro** | Cargó menos entregó | Galones que no aparecen |

### 🔴 El hallazgo que justifica la pantalla entera

Genaro entregó **2,5 veces** más que Castañeda. Por hora van **1,23 y 1,25**: el
mismo ritmo. Toda la diferencia es **presencia** — 29 días con jornadas de 7 h
contra 20 días con jornadas de 4. Y se turnan el domingo.

**Premiar la presencia y premiar la productividad son decisiones distintas.** Con
el total del mes a secas, el dueño toma una creyendo que toma la otra. Por eso el
tablero calcula esa comparación y la escribe en palabras.

⚠️ **Pero el «por hora» NO sirve para pagar**, y lo dice donde se lee: las horas
salen de la primera y la última entrega del día, o sea del mismo dato que se está
midiendo. Dos entregas separadas ocho horas se ven como «lento» y dos seguidas como
«rápido». Sirve para entender que los totales engañan, no para calificar.

### El índice de calidad se MULTIPLICA, no se promedia

`foto × aval × sin-diferencia`. Es la lógica del *perfect order rate*. Un promedio
deja compensar una foto faltante con un aval sobrando; multiplicando, fallar en
cualquiera de los tres baja el resultado — que es lo que se quiere de un control.

### Visitas: la defensa que no necesita vigilancia

El único truco que de verdad paga es partir un tanqueo de 40 galones en dos
registros. Contando **visitas** (misma máquina, 90 minutos), partir no sirve de
nada *por definición*. Eso vale más que un auditor, porque no queda nada que
auditar.

📌 **Línea base medida el 31-ago-2026: 1,01 entregas por visita en los tres.** Nadie
está partiendo. Si ese número sube después de anunciar el pago, ahí está la
respuesta.

## 🔴 Errores que ya se cometieron aquí (no repetirlos)

Salieron de una revisión adversarial de la primera versión. Todos producían un
número que alguien iba a usar para pagar:

1. **El ritmo estaba inflado.** `jornadas` mide solo los días con más de una
   entrega —un día de una sola no tiene ventana medible— pero el ritmo dividía
   TODAS las entregas entre esas horas recortadas. El analista salía en 0,83 y su
   ritmo real es 0,63. **Numerador y denominador tienen que salir del mismo
   conjunto de días.**
2. **Cifras quemadas en el texto.** El párrafo del hallazgo tenía los números de
   agosto escritos a mano: servía ese mes y mentía al cambiar las fechas. Es la
   peor clase de error, porque suena bien y nadie vuelve a revisarlo. **Todo lo que
   el dueño lee sale del periodo cargado.**
3. **`array_length` de un arreglo vacío devuelve NULL, no 0.** Por eso `con_foto`
   quedaba en NULL y `not con_foto` no era verdadero: la lista de "entregas sin
   foto" salía VACÍA teniendo 59. El hueco justo que la lista existe para mostrar.
4. **Los usuarios de PRUEBA** entraban en los totales y en el denominador de
   adopción. Hoy se marcan con `app_usuarios.es_prueba`, no se filtran por nombre —
   el nombre cambia y el filtro se queda mintiendo.
5. **Dos fuentes para la misma unidad.** Los galones se contaban contra el catálogo
   vivo mientras la tabla de insumos usaba la unidad guardada en el ítem: dos
   totales distintos del mismo combustible en la misma pantalla.
6. **El orden por volumen es un podio implícito** y el ojo lo lee antes que
   cualquier advertencia. Van alfabéticos.

## Detalles que muerden

- **El analista no compite.** Se separa por **ROL** (`esDeRuta`), no por nombre ni
  cédula: la gente cambia de cargo. No hace ruta, despacha de mostrador, y
  compararlo con los supervisores lo deja último por algo que no es su trabajo.
- **El tiempo del aval es MEDIANA, no promedio.** La mitad se avala en 2-3 horas;
  unos pocos rezagados llevaban el promedio a 32 h. ⚠️ Y ese reloj lo para el
  operario: **no se le puede cobrar a quien entrega**, o se responde presionando al
  operario para que firme sin revisar y ahí se pierde el control entero.
- **Cargues por encima de 500 galones quedan FUERA del cuadre** y se cuentan
  aparte. En las tirillas de la estación el punto es decimal, y ya hubo quien
  tecleó `108.571` como ciento ocho mil: un solo dedazo destruye la cifra. Mejor
  avisar que mostrar un número roto.
- **El panel de solicitudes explica su propio vacío.** Ese flujo tiene 6 registros
  contra 404 entregas directas; con seis, el primer puesto lo decide una sola
  solicitud. Un panel en blanco sin explicación se lee como sistema roto.
- **Espejo en `localStorage`, no en Dexie.** Agregar una tabla obliga a subir la
  versión de la base local, y esas migraciones han sido destructivas aquí. Misma
  decisión que la referencia del horómetro.

## Dónde vive

- `supabase/migrations/20260831140000_resumen_movimientos_insumos.sql` (v1) y
  `20260901090000_resumen_movimientos_v2.sql` (las correcciones).
- `src/services/movimientosApi.ts` — tipos y los cálculos derivados.
- `src/views/MovimientosTab.tsx` — la pantalla.
- `components/Charts.tsx` — `ColumnasApiladas` y `Leyenda` nacieron aquí.

**Una sola llamada** trae el resumen ya agregado: ~20 KB, 2,5 KB comprimidos. Traer
las entregas al celular para sumarlas allá serían cientos de KB cada vez que
alguien abre el tablero, y los datos móviles son el gasto que la gente sí nota.

## ⚠️ Lo que NO se construyó, a propósito

- **Ranking de quién solicita**: no hay datos (n=6).
- **Tabla de configuración del pago** (modo espejo, umbrales, porcentaje
  variable): el dueño todavía no ha definido el esquema. Construir la
  configuración de un pago que no existe es adivinar.
- **Totales que crucen unidades**: galones y unidades van en dos listas separadas,
  siempre.

## Cómo está armada la pantalla (rediseño 2-sep-2026, commit `f2c2244`)

El cliente dijo «no me gusta el diseño». Medida la pantalla, la causa principal no
era estética: `MovimientosTab` escribía **`<strong>/<span>/<small>` pelados dentro
de `.dash-kpi`**, y `App.css` solo estiliza `.dash-kpi__val/__lbl/__pie`. En la
misma pestaña de Inicio, la cara vecina (`DashboardTab`) mostraba cifras de 1,7 rem
en verde marca y esta mostraba negrita de párrafo. **Al agregar un KPI: usar las
tres clases, no etiquetas peladas.**

Lo demás era volumen: ~830 palabras de prosa visible y 6.500-7.000 px de alto.
Quedó en ~95 palabras y **1.628 px medidos a 375 px**, sin scroll lateral.

**Tres capas, y el orden importa:**

1. **Sin rodar** — veredicto en 2 frases, las tres filas de despachador, el freno
   «todavía no son para pagar» y la cinta de pendientes. Iván decide a quién le
   pagaría más, y si el dato es confiable, sin desplazar.
2. **Primer scroll** — los 4 KPI del periodo y la tira de presencia.
3. **Plegado** — cuatro acordeones cerrados, cada uno **con su cifra en el renglón
   cerrado**. Sin esa cifra hay que abrir los cuatro para saber cuál mirar, y
   plegar solo habría agregado toques.

**🔴 Las tres cifras de la fila van en UNA rejilla, no en tres celdas sueltas.**
Con celdas independientes cada una alinea sus propios hijos y las cifras quedaban
a 354, 360 y 355 px — medido en el navegador. `.mov-fila__cifras` es un grid de
`repeat(3, auto)` con `align-items: baseline`: así 148 (1,7 rem) y 26 (0,94 rem)
se leen como una fila. Y las columnas van **al ancho de su contenido**: con
anchos fijos, «POR HORA» pedía 49 px en una columna de 46 y se partía en dos.

**🔴 La tira de presencia reemplazó arriba a las 31 columnas apiladas, no las
borró.** El cliente pidió la serie diaria; sigue estando, a un toque en «Ver día
a día». Apilar por semana se descartó porque **borra justo el patrón de
asistencia por persona**, que es lo que sostiene el veredicto de «presencia, no
ritmo». La casilla de 7,9 px es **lectura, no objetivo táctil** — el toque está
en la fila de la persona.

**🔴 El CSS nuevo va scopeado bajo `.mov`, nunca en `:root`.** La regla
`.dash-kpi > span` tiene especificidad (0,1,1) y le ganaría a `.dash-kpi__val`
(0,1,0): una escala global habría encogido los KPI del `DashboardTab`. Por lo
mismo `.mov .dash-barra { padding: 11px 4px }` sube el objetivo táctil a 44 px
solo aquí, porque `.dash-barra` la comparte el tablero del dueño.

**Color:** `--mov-amber` / `--mov-rojo` con su par en `[data-theme="dark"]`. Antes
`#8a6116` y `#b3261e` estaban quemados en 6 sitios **sin ninguna variante
oscura**. Rojo solo cuando hay consecuencia real (cuadre > 50 gal, aprobación
vencida), nunca por énfasis.

**Ningún `title=`**: no existe en táctil y la mitad de la audiencia está en
celular. Lo que define plata va como renglón visible o dentro de `<Ayuda>`.

⚠️ `MovimientosTab` **se monta dos veces con el mismo componente y sin props**
(`SupervisorView.tsx`: tercera cara de Inicio y pestaña propia). Por eso no hay
cabecera fija ni versión «reducida» para Inicio — un `position:sticky` con
márgenes negativos se comportaría distinto en cada montaje.


## «Insumos y materiales» en el tablero de Operación general (8-sep-2026)

Tres tortas y un número, con los filtros Hoy/Ayer/quincena/Mes/Rango del tablero:
**entregas por material** (cuenta entregas — galones + ganchos no se suman),
**combustible por máquina**, **ganchos por máquina**, y **galones por hectárea**.

🔴 **Cada toque segrega un nivel** (`InsumosCard.tsx`, estado `vista`): torta → ese
material por máquina → lista de entregas (`detIns`, ya existía) → entrega completa
(`<DetalleDespacho>`). O máquina → sus materiales → entregas. O labor → sus máquinas
con gal/ha. «Otros» de cualquier torta se despliega como lista. «← Insumos» siempre
vuelve al principio.

**La lógica vive en `lib/insumosDash.ts`, no en el componente**, para poder probarla
contra datos REALES sin entrar a la sesión: en el navegador del dev server,
`await import('/src/lib/insumosDash.ts')` + `loadKardexReporte` + `loadAssignments`.
Verificado así contra agosto: combustible y ganchos por máquina **idénticos al SQL**
(PUMA2302 995 gal, CASE1302 360 ganchos), cobertura 69%, ambiguos 24%.

### El gal/ha: lo que se aprendió midiendo

- **El denominador es SOLO hectáreas.** ACEQUIAS va en hm; meterla infla la base.
  Por eso PUMA2302 da **4,87 gal/ha** y no 2,87 como dio un SQL rápido: hizo 142 hm
  que no cuentan. Cada labor lleva su unidad (`gal/hm` en el punto).
- **Los días se bucketean en Bogotá** (`executionDateKey` para la labor, `diaKey`
  para el kardex). El SQL con `::date` corta a las 7 p.m. y desalinea el puente.
- **Compárese por labor, no por máquina.** Agosto: TRIPLE 3,6 · SUBSUELO 3,4 ·
  FERTILIZACIÓN 2,2 · DESPEJE 0,9 · REENCALLE 0,8 · ACEQUIAS 0,6 gal/hm. Tres a cuatro
  veces entre la pesada y la liviana. Las PUMA (3–5) hacen TRIPLE/SUBSUELO/FERTILIZACIÓN:
  **es la labor, no la máquina**. Por eso cada fila lleva su labor dominante — elegida
  entre labores en **ha**, para no poner «4,87 gal/ha · ACEQUIAS».
- **Dos cautelas que la pantalla dice sola**: 24% de días-máquina con más de una labor
  (reparto por área) y 70% de cobertura de tanqueo el mismo día (para Hoy/Ayer el
  número es orientativo y se muestra la cobertura).

### Trampa del arnés de prueba

La paleta de los gráficos (`--dash-s1…`) está scopeada bajo **`.dash`** (App.css).
Al montar `InsumosCard` suelto en un div para probarlo, barras y arcos salen
**transparentes**. No es un bug: en el tablero real vive dentro de
`<section className="dash">`. Si se monta aparte, ponerle esa clase al contenedor.
`Donut` acepta `decimales` (0 para contar entregas; 2 por defecto).

## El tablero se llama «Insumos y materiales» (8-sep-2026)

El cliente pidió el cambio de nombre y las tortas **sobre esta pantalla**, no sobre
Operación general. Se le construyó primero en la cara equivocada porque su captura de
referencia era la de Operación general; en realidad esa captura mostraba **los filtros
que quería copiar**, no el destino. La frase que lo desambigua es «con los filtros que
tiene el de operación general»: solo tiene sentido pedirlos para una pantalla que NO
los tiene.

- **`<h2>` = «Insumos y materiales»**, la píldora de la cara y la entrada de Más
  también. ⚠️ El archivo (`MovimientosTab`), la tabla, el RPC
  (`resumen_movimientos_insumos`) y las props **siguen diciendo «movimientos»**: es la
  misma capa de traducción permanente que aval → aprobación. Renombrarlas era romper
  producción para ganar una palabra.
- **Los filtros salen de `lib/periodos`**, compartidos con Operación general: Hoy,
  Ayer, 1ra quinc., 2da quinc., Mes y Rango. Antes eran Quincena / Mes / 30 días /
  Otro. Copiarlos al otro archivo habría durado hasta que alguien corrigiera la
  quincena en uno solo. ⚠️ Arranca en **Mes**, no en Hoy: con un solo día el ritmo por
  hora se calcula sobre una jornada a medias y este tablero es de tendencia.
- **La `<InsumosCard>` va debajo de los KPI del periodo**, antes de «Quién estuvo, día
  por día». Las capas de arriba responden QUIÉN entregó; la tarjeta responde QUÉ salió.
  Es el **mismo componente** que el de Operación general, no una copia.
- **`<ModalEntregas>`** (`components/`) es la lista de entregas detrás de un dato, y de
  ahí `<DetalleDespacho>`. Se sacó de `DashboardTab` cuando la segunda pantalla la
  necesitó: es justo el sitio donde el dueño va a comprobar una cifra que le pareció
  rara, y dos copias terminan contando distinto.

### 🔴 La trampa que casi lo deja invisible

`SERIES` son `var(--dash-s1)`… y esas variables vivían **solo bajo `.dash`**. Este
tablero es `.mov`, así que sus gráficas se pintaban **transparentes** desde antes de
este cambio, sin un error en consola. Medido en el navegador: dentro de `.mov`,
`--dash-s1` devolvía vacío y el fondo resolvía `rgba(0, 0, 0, 0)`.

El arreglo separa la paleta de la maquetación: `.dash, .mov { --dash-s1… }` y `.dash`
se queda con su flex. **Al montar gráficas en una pantalla nueva, sumar su clase ahí** y
comprobarlo midiendo, no mirando:

```js
getComputedStyle(el).backgroundColor  // 'rgba(0, 0, 0, 0)' = la paleta no llegó
```

## Revisión de diseño del bloque de tortas (8-sep-2026)

El cliente mandó una captura con la leyenda de la primera torta **escrita encima de
la segunda** y una frase que conviene recordar: *«no me puedo dar el lujo de que las
cosas queden mal»*. Se revisó con tres agentes en paralelo (layout, visualización de
datos, responsive) y se midió todo en el navegador con datos reales.

### Lo que estaba roto y ya está corregido

| Defecto | Medida | Corrección |
|---|---|---|
| La leyenda se salía de su columna y pisaba el donut vecino | hasta **206 px** fuera, en todo el rango **860–1600 px** | dentro de `.dash-tres` el donut se queda apilado; `min-width: 0` en celdas y en `.dash-leyenda` |
| La pista de la rejilla no cabía en un celular de 320 px | 3 px de holgura | `minmax(min(260px, 100%), 1fr)` |
| Dos formatos numéricos en la misma tarjeta | `2347` junto a `2.347 gal` | `nfGrafico()` con `toLocaleString('es-CO')` en donut, barras y columnas |
| Una etiqueta recortada no se podía leer entera | — | `title` con el nombre completo |
| El arco no acusaba recibo del mouse en escritorio | — | `<title>` de SVG + `:hover` dentro de `@media (hover: hover)` |
| La fila de gal/ha exprimía el nombre de la máquina | **82 px** a 320 px | por debajo de 520 px el detalle en gris baja a su renglón |

🔴 **La trampa técnica que vale la pena recordar**: `.dash-leyenda__lbl` es `flex: 1 1 0%`,
y **un item flexible con base 0 propaga su max-content al min-content del contenedor**.
Por eso el `ellipsis` de la etiqueta no dispara y por eso `min-width: 0` en la etiqueta no
sirve de nada: lo que desborda es el `<ul>`, una caja más arriba. El `min-width: 0` va en el
**contenedor** y en las **celdas de la rejilla**.

### Lo que la revisión recomienda y NO se hizo, porque lo pidió el cliente así

El agente de visualización argumenta —bien— que **«Combustible por máquina» y «Ganchos por
máquina» deberían ser barras, no tortas**: en las dos, «Otros» pesa ~50 %, las cinco máquinas
nombradas quedan en 14/12/10/7/6 % (comparar ángulos parecidos es justo lo que la dona no
sabe hacer) y son 21 máquinas, muy por encima de las ~7 clases de color que aguanta un
gráfico categórico. **Pero el cliente pidió tres tortas, explícitamente.** Se le presenta la
recomendación; no se cambia sin su visto bueno.

Otras recomendaciones pendientes de decisión: unificar la jerarquía de cifras (hoy compiten
cinco tamaños), quitar `tabular-nums` de `.dash-galha__num`, y vigilar que en modo oscuro
`--dash-s6` y `--dash-s1` cierran el anillo con ΔE 1,9 en protanopia — solo se pintan juntos
cuando hay exactamente 6 categorías sin «Otros».

### Cómo se midió (repetible)

Montar el componente suelto contra datos reales y **medir**, no mirar:

```js
// en el dev server, sin entrar a la sesión
const { InsumosCard } = await import('/src/views/InsumosCard.tsx')
// ...montar dentro de un contenedor con la clase del host real...
for (const w of [320, 360, 860, 900, 1280, 1850]) {
  seccion.style.width = w + 'px'
  // comparar el borde derecho del TEXTO contra el de su celda,
  // y contra el borde izquierdo de la celda vecina de la MISMA fila
}
```
⚠️ Comparar solo celdas con el mismo `top`: cuando la rejilla reflowa a una columna, la
«vecina» está debajo y cualquier comprobación ingenua da un falso positivo.

## «Se ve muy saturado» (8-sep-2026, tarde)

Después de meter la `<InsumosCard>` al tablero de insumos, el cliente abrió el acordeón
«Qué se entrega y a quién» y mandó captura: *«revisa todo esto, se ve muy saturado»*.
Tenía razón, y la causa era **duplicación**, no densidad: el acordeón traía cuatro
gráficas de barras —material en galones, material en unidades, operarios, máquina por
combustible— y **tres de las cuatro eran la misma pregunta que las tortas de arriba**, con
otra forma. «Máquinas por combustible» era exactamente el mismo dato que el donut.

Lo que se hizo:

- **El acordeón quedó solo con «A quién se entrega»** (operarios con más entregas), que es lo
  único que la tarjeta no tiene. Las otras tres barras se borraron con sus `useMemo`.
- **La tarjeta bajó** de entre los KPI y la tira de días a **después** de la tira. Partía
  la historia de las personas en dos y ponía dos filas de cifras seguidas. Ahora la
  pantalla habla primero de PERSONAS (quién, cuánto, qué días) y después de MATERIAL.
- **`<InsumosCard compacta>`**: sin sus tres cajas de resumen, porque los KPI del tablero
  ya dicen entregas y galones justo arriba. Operación general la sigue usando completa.

🔴 **Regla que deja**: antes de montar un componente compartido en una pantalla, buscar
qué de esa pantalla ya responde lo mismo, y quitarlo. Dos formas del mismo dato en la
misma vista no son «más información»: son ruido, y el cliente lo llama saturado.

## Combustible por hora de máquina (18-sep-2026, commit `ea90ee7`)

Pedido: *«una barra por máquina con el consumo de combustible y una etiqueta con el consumo
por hora; importante siempre tomar el horómetro inicial del día o el periodo trabajado, así
como el final»*. Y después: *«revisa también contra horómetros de tanqueo»*.

`views/ConsumoHoraCard` (bajo las tortas de «Insumos y materiales», con el MISMO filtro de
periodo de la pantalla) + `lib/consumoHora.ts`. Los galones salen de
`combustiblePorMaquina` — los mismos de la torta, porque dos números distintos del mismo
hecho obligan a preguntar cuál es el bueno.

**horas = horómetro FINAL − INICIAL del periodo**, con las lecturas de TODAS las fuentes
(cierre de labor, entrega y tanqueo). 🔴 Solo con labores no alcanza: la PUMA 2302 gastó 496
galones y su operario cierra con horómetro **0** (32 de 33 cierres del mes); sus lecturas
buenas estaban en las entregas.

**Limpieza de lecturas, en orden** (cada regla salió de un caso real):
1. ceros y pares imposibles de una labor (final &lt; inicial, o más de 24 h);
2. **magnitud dominante** (el «2» de la CASE 951 contra sus 5.719 h);
3. a más de 24 h × día de la **mediana** (la CASE 901 tenía un 12.946 entre lecturas de 10.6xx);
4. **el horómetro no retrocede**: cadena más larga en el tiempo, margen 12 h (la CASE 1303
   tomaba 3.650 de un cierre del 14-sep cuando ya iba en 3.955 → daba 342 h en 18 días).

**Cruce con el tanqueo:** las mismas cuentas solo con los horómetros anotados al tanquear o
entregar, comparadas **en las mismas fechas** (del primer al último tanqueo) y ⚠ si se
separan más del 25%. Comparar el periodo entero contra la ventana de tanqueos marcaba
máquinas sanas (la CASE 1101 trabajó antes del primer tanqueo y después del último).

Medido 1–18 sep 2026: flota **1,86 gal/h**; PUMA 2302 5,37 · PUMA 2301 3,99 · CASE y VALTRA
1–2. Para UN día el número es orientativo (el tanqueo de hoy alimenta mañana) y la tarjeta lo
dice. La FIAT sale «sin horas»: recibió 103 gal y no tiene ninguna lectura.

⚠️ **En celular, una fila de barra con cuatro columnas hay que ubicarla a mano**: con
`auto auto` la grilla la partió en TRES renglones (95 px por máquina) y las cifras quedaban
corridas entre filas (177 a 202 px). Va `grid-row`/`grid-column` explícitos y anchos FIJOS
para las dos columnas de cifras (`.dash-barra--galh`, medido con `getBoundingClientRect`).

También: `equipo_horometro_v` lee ahora el horómetro de las **entregas**
(`20260918140000_horometro_lee_entregas.sql`). Antes leía labores, tanqueos y órdenes, y por
eso la pantalla de Horómetros mostraba la PUMA 2302 quieta 16 días. ⚠️ Siguen atascadas las
máquinas con **lectura manual vieja** (la manual manda siempre: PUMA 2101 del 4-ago, VALTRA
9902 del 20-ago) — pendiente de decisión del cliente.

## ✅ Semáforos de gal/hora y ganchos/hora por máquina (21-sep-2026, commit `6029b5a`)

Pedido: *«semáforos en el análisis de combustible y ganchos»*, con esta tabla del cliente
(copiada tal cual):

| Máquina | MÍNIMO (verde) | MEDIO (naranja) |
|---|---|---|
| CASE 1001 | 1,2 a 1,5 | 1,51 a 1,7 |
| CASE 1002 | 1,2 a 1,5 | 1,51 a 1,7 |
| CASE 1101 | 1,7 a 2,1 | 2,11 a 2,3 |
| CASE 1102 | 1,2 a 1,5 | 1,51 a 1,7 |
| CASE 1301 · 1302 · 1303 · 1304 | 1,7 a 2,1 | 2,11 a 2,3 |
| CASE 901 · 902 · 903 · 951 · 952 | 1,2 a 1,5 | 1,51 a 1,7 |
| FIAT | — (vacío) | — (vacío) |
| PUMA 2101 · 2301 · 2302 | «5 A 6 / 4 A ,5» | «6,1 A 6,5 / 4,51 A 5» |
| VALTRA 1351 | 1,3 a 1,7 | 1,71 a 1,8 |
| VALTRA 9901 · 9902 · 9903 · 9904 | 1,1 a 1,5 | «1.70» |
| GANCHOS | 0,7 a 1,1 | 1,11 a 1,4 |
| GANCHOS | «40 DE 0 A 45 HR» | «80 DE 45,1 A 90» |

### Qué mide cada rango — comprobado, no supuesto

- **Galones por HORA** de horómetro, no por hectárea. Con septiembre 1–20: los CASE 9xx dieron
  1,16–1,36 gal/h (tabla 1,2 a 1,5) y 0,77–0,86 gal/ha — el gal/ha queda debajo de TODOS los
  rangos.
- **Ganchos por HORA** de máquina. La segunda fila de GANCHOS («40 de 0 a 45 h / 80 de 45,1 a
  90») es la misma cuenta dicha de otra forma: 40/45 = 80/90 = 0,89 por hora, dentro del verde.
  En septiembre dieron 0,53–1,37.
- ≤ verde_max = ✓ verde · ≤ naranja_max = ▲ medio · más = ⚠ alto. **Debajo de verde_min es
  «▽ debajo del rango»**, no verde: casi siempre es un tanqueo o una entrega sin registrar, o un
  horómetro que corrió de más. En septiembre salieron **10 de 21** máquinas debajo — dice más
  del registro de combustible que de las máquinas.
- **PUMA**: la tabla trae dos rangos. Se usa **4 a 4,5** (lo que gastan hoy: 3,5–5 gal/h) con
  la nota en la fila, hasta que el cliente diga qué los distingue. VALTRA 99xx: naranja «1.70»
  se leyó 1,51 a 1,70. FIAT sin fila → sin semáforo (no se pinta verde lo que no tiene rango).

### Dónde vive

- Tabla **`semaforo_consumo`** (indicador, maquina, verde_min, verde_max, naranja_max, nota) —
  migración `20260921130000`. `maquina` = nombre como lo escribe el cliente, se compara en
  mayúsculas; `'*'` = todas (así va ganchos). **Cambiar un rango = un UPDATE, sin publicar.**
- `lib/semaforo.ts` (nivel, símbolo, texto) y `views/ConsumoHoraCard.tsx`: la etiqueta de gal/h
  toma color + símbolo; los ganchos/h van en su propia etiqueta solo en máquinas que recibieron
  ganchos; arriba, la cuenta por nivel; al tocar, el rango y la nota.
- El aviso de horómetro de tanqueo descuadrado pasó de «⚠» a **«≠»**: ⚠ ahora es «alto».
- 🔴 En celular los ganchos van en un **tercer renglón**: puestos al lado, la barra se encogía
  de ~290 a 110 px. Medido en 375 px de ancho.
- **También en «Eficiencia maquinaria»** (`ConsumoDashboardTab`, tabla «Máquina por máquina»,
  21-sep-2026, pedido con captura: «esto también hazlo con la misma lógica de semáforos»): la
  columna «vs 2025» pasó a «Semáforo», para combustible (gal/h) y ganchos (ganchos/h). La
  referencia 2025 queda en el `title` y en el Excel, que además trae «Semáforo gal/h» y
  «Semáforo ganchos/h». Se conserva el freno de antes: si las horas están incompletas (menos
  del 60 % de las que implica la referencia) sale «⏱ faltan horas» y NO un color. En celular
  solo la franja verde («✓ 1,2–1,5»): el rango entero partía la fila en tres renglones. En
  ganchos ahora salen todas las máquinas que recibieron ganchos (antes solo las que tenían
  referencia 2025). Medido en septiembre: PUMA 2302 da 5,17 gal/h → «⚠ alto» con el rango
  4–4,5 que se usa hoy; con el otro rango de la tabla (5–6) sería verde → la pregunta de las
  PUMA sigue abierta y aquí se nota.
- **Gráfica del dibujo del cliente** en «Eficiencia maquinaria» (`views/GraficaGalHora.tsx`,
  21-sep-2026; mandó una hoja cuadriculada con dos barras): una columna por máquina — barra =
  galones del mes, encima gal/h con su semáforo, y debajo la tabla alineada **Máquina ·
  Horómetro inicial · Horómetro final · Horas**. Es una rejilla (no gráfico + tabla aparte)
  para que cada columna se lea de arriba abajo. `loadHorasPorRangoMes` ahora devuelve también
  `extremos` (primera y última lectura buena del mes). 🔴 En las máquinas cuya serie se
  desplomó (Σ = horas por suma de labores; 6 de 22 en sep) **no se muestran** el inicial y el
  final: la limpieza deja restos como «1 → 55» o «147.284 → 147.284» que harían creer que la
  resta da esas horas. Anchos medidos: columnas de 3,3em (≈53 px, lo que ocupa «11.490,2»);
  con `max-content` 22 máquinas pedían 2.094 px en un monitor de 1.440 — ahora caben en 1.377
  y en celular la rejilla se desliza con los rótulos quietos. El Excel del tablero suma las
  columnas «Horómetro inicial» y «Horómetro final».
- **Eficiencia maquinaria, ajustes del mismo 21-sep** (tres pedidos con captura):
  1. «Máquina por máquina» **abre en Ganchos** («déjalo predeterminado en ganchos»).
  2. **Se quitaron las notas** («quita estos comentarios»): la de debajo de la gráfica, «⏱ Las
     horas salen del horómetro…» y «⚠ En N máquinas las lecturas vienen tan sucias…». Lo
     sucio sigue marcado con «Σ» en la casilla de horas, con la explicación al pasar el dedo.
     No volver a ponerlas sin que las pida.
  3. **Filtros de periodo** («ponle estos filtros»): Hoy · Ayer · 1ra quinc. · 2da quinc. ·
     Mes · Rango, los mismos de `lib/periodos` y con la misma barra `.mov-periodo`, entre el
     título/Excel y las cuatro cifras. Hoy y Ayer son fechas reales; quincenas y Mes son del
     **mes elegido en las barras** (tocar agosto y luego «1ra quinc.» = 1–15 ago). Cifras,
     gráfica y tabla siguen al periodo. El cierre mensual de horas solo aplica con «Mes»; en
     cualquier otro periodo las horas salen de las lecturas del rango. Medido: 1ra (3.932,5
     gal) + 2da quinc. (1.092,9) = mes (5.025,2); ganchos 1.440 + 440 = 1.880. El papel
     (mar–jul) viene por día, así que las quincenas también sirven para esos meses.
- **«Por despachar»** en Insumos y materiales (`views/PorDespacharCard.tsx`, 21-sep-2026). Pedido:
  *«que se vean las solicitudes pendientes por entregar con el fin de poder planificar los
  despachos… algo gerencial, simple y que no sature»*. Va justo después de las cuatro cifras
  (y también cuando el periodo no tiene entregas). Dos renglones y una lista plegada:
  cuántas y **para cuándo** (⚠ atrasada · para hoy · para mañana · después · sin fecha, por
  `requerido_para` en hora de Colombia), cuántas aprobadas vs por aprobar, y **qué alistar**
  (total por material y unidad, nunca sumando materiales). Pendiente = `PENDIENTE` (falta
  aprobar) o `PROGRAMADA` (aprobada, falta despachar). 🔴 **No sigue el filtro de periodo**:
  es la cola viva — lo atrasado es lo que más importa y «Hoy» lo escondería. Recarga con
  «Actualizar». Al construirla había 3: una aprobada para el **15-sep 11:00** que nunca se
  entregó (13 gal, finca La Carilera) y dos sin aprobar ni fecha. ⚠️ El 96 % de lo que se
  entrega es **entrega directa** (650 de 679), que no pasa por solicitud: esta cola solo ve lo
  que los operarios PIDEN. Mide 143 px en escritorio y 239 en celular, plegada.
- Para mirar la tarjeta sin sesión: montarla en un archivo temporal dentro de un contenedor
  **`.mov`** — fuera de él `--dash-s1` no existe y las barras salen vacías (no es un error de
  la tarjeta).
