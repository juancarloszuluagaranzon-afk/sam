---
name: managing-taller
description: Taller de maquinaria — hoja de vida, horómetro consolidado, preventivo por horas, órdenes de trabajo, repuestos, compras e indicadores ($/hora, disponibilidad, TMEF, TMR). Leer antes de tocar cualquier cosa de mantenimiento.
---

# Taller de maquinaria

Implementado el 30-jul-2026 a partir de los apuntes del cliente. Responde una
pregunta distinta a la del inventario de uso diario:

| | Insumos (uso diario) | Taller |
|---|---|---|
| Pregunta | ¿Qué le entregué hoy al operario? | ¿Qué le he metido a esta máquina en toda su vida y cuánto me cuesta la hora? |
| Ítem | nombre, unidad, stock | + referencia, marca, N° de parte, ubicación, **a qué modelos aplica** |
| Movimiento | despacho / entrega directa | **orden de trabajo** |

## Decisión de fondo: NO hay un segundo inventario

El taller es una **bodega más** (`bodegas.tipo = 'TALLER'`) sobre el mismo kardex.
El catálogo `insumos` ganó los campos del repuesto (`es_repuesto`, `referencia`,
`marca`, `numero_parte`, `ubicacion`, `stock_maximo`, `costo_promedio`). Dos
inventarios paralelos serían dos verdades.

## 🔴 El horómetro: lo más frágil de todo

El plan preventivo se dispara por horómetro, así que si el horómetro está mal,
**el módulo entero no sirve**. Y los datos reales vienen sucios de dos formas:

1. **Dedazos sueltos.** PUMA2101 tenía un `14.142.545` entre lecturas de
   ~145.200. CASE903 tenía `1.146,53` donde iban `11.465,3` (un dígito de menos).
2. **Escalas mezcladas.** En CASE952 unos digitan `5407` y otros `54030` — la
   misma lectura, con y sin la décima pegada — y va mitad y mitad.

Por eso `equipo_horometro_v` **no** usa el máximo (un dedazo alto clava la
máquina para siempre) **ni** la mediana (con dos escalas 50/50 cae en el medio y
elige la equivocada: en CASE952 daba 29.612 y se quedaba con 54.030).

**Criterio vigente: magnitud dominante.** Se agrupan las últimas 12 lecturas por
orden de magnitud (`floor(log10(h))`), gana el grupo con más lecturas —a
igualdad, el que tenga la más reciente— y dentro de ese grupo se toma la última.

Y **la lectura manual manda siempre** (`equipos.horometro_manual`): es una
corrección humana explícita, ningún criterio automático la pisa. Es la salida
cuando el algoritmo no acierta.

Las lecturas descartadas no se esconden: salen en `equipo_horometro_dudoso_v`,
en el banner de `MaquinasTab` y en un badge por máquina (**"⚠ N lectura(s)
dudosa(s)"**). Es una decisión, no un descuido: ignorarlas en silencio dejaría la
pantalla más limpia, pero entonces nadie va a corregir el dato de origen y el
problema sigue creciendo. El botón **⏱ Corregir horómetro** de la tarjeta escribe
`horometro_manual`, que manda sobre todo — pero arregla el número de HOY, no las
lecturas malas del historial.

### Qué son en realidad esas lecturas (medido 3-ago-2026)

**85 lecturas descartadas en 16 máquinas** (eran 71 en 21 al implementar). La
CASE1303, que anda por 3.534 h, tiene estas seis:

| Lo que quedó escrito | Qué era |
|---|---|
| `34051` | un dígito de más (iba ~3.405) |
| `15`, `11`, `2`, `9` | **no son horómetros: son las horas del día** |
| `350.3` | un dígito de menos |

El patrón dominante no es el dedazo sino el **campo equivocado**: el operario
escribe las horas que trabajó ese día donde va la lectura del horómetro. Eso es
diseño de formulario, no torpeza — si alguna vez se rediseña la captura de labores,
ahí está la causa raíz.

Mientras no se limpien, dos cosas quedan cojas: el preventivo no se dispara cuando
debe, y el **informe semanal** (`lib/informeSemanal.ts`, módulo de insumos) deja las
horas en blanco en esas máquinas. Ese informe reusa el MISMO criterio de magnitud
dominante, calculado en TypeScript en vez de SQL porque trabaja sobre entregas y
tanqueos, no sobre labores. **Si cambias el criterio, cámbialo en los dos sitios.**

## La orden de trabajo es la pieza central

Sin OT no hay dónde colgar repuestos, mano de obra ni servicios externos, y sobre
todo **no hay paro**. Sin `paro_en` y `arranque_en` no se pueden calcular
disponibilidad ni TMR.

- Los repuestos se agregan a la OT pero **se descuentan al CERRAR**, no antes:
  mientras está abierta uno todavía está armando la lista.
- El descargue va marcado uno por uno (`ot_repuestos.descargado`) para que cerrar
  dos veces —o reintentar tras un fallo a mitad— no descuente doble. **Probado.**
- Al crear la orden se pregunta si la máquina queda parada. Un cambio de aceite
  con la máquina disponible NO debe descontar disponibilidad.
- Cerrar un preventivo reinicia el contador de su plan (`ultima_horas`).

## Definiciones de los indicadores (`lib/indicadores.ts`)

Cada empresa las cuenta distinto; estas son las que quedaron:

- **Disponibilidad** = (horas del periodo − horas paradas) / horas del periodo,
  medido contra horas **calendario** (24 h/día). Es la definición conservadora.
  Para medir contra horas programadas, cambiar `HORAS_DIA`.
- **TMEF/MTBF** = horas operando / número de **fallas**. Solo cuentan los
  CORRECTIVOS: meter los preventivos haría ver la máquina peor mientras mejor la
  cuiden — el incentivo al revés.
- **TMR/MTTR** = horas paradas / número de reparaciones.
- **# Paradas** = correctivos cerrados en el periodo.

## Costo por hora

Tres bolsas, como el apunte:

| Bolsa | De dónde sale |
|---|---|
| Administrativos | `equipo_costos` (seguros, impuestos) + **depreciación** |
| Operativos | combustible (kardex + tanqueos, ya se captura) |
| Mantenimiento | repuestos + mano de obra + servicios externos de las OT |

La **depreciación se calcula por USO**, no por calendario: `(valor − residual) /
vida_util_horas × horas del periodo`. Una máquina quieta no se gasta. Si el
equipo no tiene esos datos cargados la depreciación es 0 **y la pantalla lo
dice** — un costo por hora sin depreciación se ve engañosamente barato y alguien
podría fijar tarifas con él.

Una depreciación cargada a mano en `equipo_costos` manda sobre la calculada.

## Tablas

`proveedores`, `insumos_proveedores` (precio y referencia por proveedor),
`insumos_aplicabilidad` (a qué marca/modelo/máquina sirve el repuesto),
`compras` + `compra_items`, `mtto_planes`, `ordenes_trabajo` + `ot_repuestos`,
`equipo_costos`. Vistas: `equipo_horometro_v`, `equipo_horometro_dudoso_v`.

Una compra nace en **BORRADOR** y solo al **recibirla** entra al inventario, con
su movimiento de kardex. Recibir dos veces se rechaza y no duplica stock.
**Probado.**

## Pantallas

`views/TallerModule.tsx` con seis pestañas en el orden en que se usan: Máquinas
(hoja de vida) → Preventivo → Órdenes → Repuestos → Compras → Ciclo de vida.
El contexto compartido (`views/taller/TallerContext.tsx`) carga una sola vez lo
que las seis necesitan; sin él, cambiar de pestaña recargaría todo otra vez.

Las pestañas de Preventivo y Órdenes llevan **badge** con lo vencido y lo
abierto: un módulo de mantenimiento que no grita cuando algo está vencido es un
archivador.

Acceso: Más → Taller (owner y administración). Rol nuevo `taller` en la BD para
segregar, todavía sin vista propia.

## Qué falta

- Serie histórica de horómetro por fecha: hoy las horas trabajadas del mes se
  escriben a mano en Ciclo de vida. Con la serie saldría solo.
- Vista propia para el rol `taller` (hoy entra por SupervisorView).
- Adjuntar la ficha técnica del repuesto (`insumos.ficha_url` ya existe, sin UI).
- `stock_seguridad` se guarda pero todavía no alerta.

## Codificación de repuestos (la estructura del cuaderno, 15-jul)

```
LLAVE                DESCRIPCIÓN                     SOPORTE
# Código propio  │  Nombre, Ref, Marca, Partida  │  Texto soporte
                 └──────────────┬────────────────┘
                  Históricos · $ · Proveedores vinculados
```

**Dos capas, y confundirlas es el error clásico:**

| | Para quién | Campo |
|---|---|---|
| Código propio `ROD-0002` | **interno** — que todos aquí hablen del mismo ítem | `insumos.codigo` |
| Referencia del fabricante `30206` | **el proveedor** — es lo único inequívoco | `referencia` / `numero_parte` |
| Marca `SKF` | el proveedor | `marca` |
| Para qué máquina | el proveedor | `insumos_aplicabilidad` |
| Referencia del proveedor `SKF-30206-N` | ese proveedor, en SU sistema | `insumos_proveedores.referencia_proveedor` |

El código propio **no se le manda al proveedor** para que lo busque (no lo tiene);
va al final del pedido solo para emparejar la cotización cuando responda.

### El código

`FAM-####`, familia de 3 letras + consecutivo. Las familias viven en
`insumos_familias` (FIL, LUB, COM, ROD, COR, HID, ELE, MOT, TRA, LLA, TOR, IMP,
HER, OTR).

El consecutivo lo genera **la base** (`siguiente_codigo_insumo(familia)`), no el
cliente: si dos personas crean un repuesto a la vez, en el cliente les tocaría
el mismo número.

### Por qué hacía falta

El catálogo tenía "PUNTERA" y "PUNTERAS" como ítems distintos, y "RODAMIENTO
30206" con la referencia del fabricante metida dentro del nombre, donde nadie la
puede buscar. La migración `20260730140000` clasificó los 16 ítems existentes por
familia, les asignó código y extrajo la referencia del final del nombre cuando
era claramente una (`\s[0-9][0-9A-Z/\-\.]{3,}$`).

### El texto del pedido

`lib/pedidoTexto.ts` traduce el registro interno a lo que entiende un proveedor:

```
1) RODAMIENTO — Cónico, 30x62x17,25 mm
   Su referencia: SKF-30206-N
   Referencia fabricante: 30206
   Marca: SKF
   Aplica a: CASE JX95
   Cantidad: 4 unidad
   (cód. interno ROD-0002)
```

Texto plano a propósito: se manda por WhatsApp y ahí cualquier formato se rompe.
`faltantesParaPedir()` avisa en la ficha qué le falta al repuesto para que el
proveedor no tenga que preguntar — mejor antes de mandarlo que después.

## Cómo se llena la información (y el manual del cliente)

El módulo tiene un **orden de carga** que no es opcional: cada pantalla se apoya
en la anterior.

| # | Pantalla | Qué deja listo | Si se salta… |
|---|---|---|---|
| 1 | 🚜 Máquinas | marca, modelo, serie, valor de compra, vida útil | el preventivo por modelo **no encuentra máquinas** y el pedido sale sin describir el equipo |
| 2 | 🔩 Repuestos | código propio + `aplica_a` | se duplican ítems (PUNTERA / PUNTERAS) y no se pueden elegir en la orden |
| 3 | 🗓️ Preventivo | cada cuántas horas y desde qué horómetro | sin `horometro_ultima_vez` la tarea nace vencida |
| 4 | 🔧 Órdenes | el día a día | — |
| 5 | 🧾 Compras | entrada de repuestos | — |
| 6 | 📈 Ciclo de vida | sale solo de lo anterior + horas del mes y precio del galón | — |

### Los cinco errores que dañan los indicadores

1. **No marcar «la máquina queda parada»** → sin `paro_en` no hay disponibilidad
   ni TMR. Es el que más se olvida.
2. **Marca y modelo vacíos** → hoy los 25 equipos los tienen en blanco; hasta que
   no se carguen, el preventivo por modelo no aplica a nadie.
3. **Crear el repuesto sin buscarlo antes** → el duplicado parte el stock en dos.
4. **Abrir la orden al final del día** → la hora del paro queda mal y la
   disponibilidad miente.
5. **Horómetro mal copiado** → ver la sección del horómetro arriba.

### El manual

`sam/manuales/_cuerpo_taller.html` → se publica en
`agroserviciosmorales.vercel.app/manuales/manual-taller.html`.

Cubre el orden de carga, qué significa cada campo y los cinco errores. **Al
cambiar un campo o una regla de este módulo, revisar si el manual quedó
mintiendo** — ya pasó una vez con el manual de insumos.


## Chequeo diario del operario (5-ago-2026)

Sale del Excel del cliente `02 Maquinaria 2026.xlsx`, que traía tres hojas
mezclando dos cosas: las filas **Diario/OPERADOR** son la lista de chequeo y las
de frecuencia numérica/**TÉCNICO** son el plan preventivo.

**Hallazgo que cambió el encargo: las hojas 108 y 135 traen la MISMA lista
diaria** — 30 ítems idénticos, mismo orden. Listas diarias reales hay **2**, no
3; solo la de los PUMA difiere (32 ítems, 30 puntos de engrase, silla y aire
acondicionado). Se guardan las tres por separado igual, para poder
diferenciarlas después sin tocar código.

### Lo que se reescribió del Excel, y por qué

**Polaridad.** El Excel mezclaba *"Estado de frenos"* (bien = bueno) con
*"¿Ruidos extraños en motor?"* (sí = malo). En una lista de 30 que se llena todos
los días, eso garantiza respuestas invertidas. Todo quedó como **estado deseado**
("Motor sin ruidos extraños") y se responde **Bien / Mal**.

**Tareas vs verificaciones.** Engrasar, drenar la trampa, desairear y calentar el
motor **no son preguntas**: responder "bien" a *lubricar 13 puntos* no significa
nada. Son `tipo='ACCION'` y se responden **Hecho**.

### El diseño de la interacción es lo que decide si el dato sirve

**Un ítem por pantalla, no una lista de 30 filas.** Con una lista, el pulgar
barre la columna "Bien" en cuatro segundos y el dato nace muerto.

**Tres vueltas que siguen el recorrido físico** (capó arriba · alrededor ·
encendido y mandos), no el orden del Excel. Agrupar por dónde está parado el
operario corta el tiempo a la mitad y hace imposible contestar sin moverse.

**El orden rota cada día** (`ordenarDelDia`, semilla = fecha + máquina). Es lo
más barato contra el "todo bien" sin mirar y lo único que no castiga al que sí
revisa. La semilla es estable dentro del día: no se puede reordenar cerrando y
abriendo.

**Se mide el tiempo, no se bloquea.** Bajo 90 segundos el chequeo se marca
`sospechoso` y sale en el tablero del taller, no en la cara del operario.
Bloquear produce que lo llenen en el parqueadero. *(Verificado: unos clics
automáticos de 42 s quedaron marcados.)*

**El horómetro va al final, con la última lectura al lado y validación en el
acto.** Aquí está la causa raíz de los datos sucios. Probado: `9` y `15` (las
horas del día) y `123440` (un dígito de más) se atrapan; `12350` pasa.

Lo que **NO** hace a propósito: no pide foto en cada ítem (serían 30), no exige
GPS (falla bajo la caña), y no bloquea la máquina — un semáforo automático a las
5:30 a.m. en un lote produce que al día siguiente contesten "bien" a todo.

### Ficha técnica y plan preventivo cargados del mismo Excel

- **22 máquinas** con marca, modelo, HP, línea y procedencia. Antes estaban
  **las 23 en blanco**, que era lo que impedía que cualquier plan por modelo
  aplicara a alguna.
- **`equipo_metas`**: galones/hora y ganchos/hora **de 2025**. ⚠️ Son consumo
  REAL del año, no una meta negociada. Los PUMA tienen `ganchos_hora` en null
  porque **no usan ganchos** — no es dato faltante.
- **88 tareas de plan preventivo**, solo de 300 a 2.100 h.

### 🔴 Por qué NO se cargaron los servicios de 6.000 h en adelante

Sin `ultima_horas`, `vencimientosDe()` hace `floor(h/cada)*cada + cada` y **los
da por hechos**. Medido: la CASE951 con 12.765 h mostraría su próximo overhaul de
12.000 h en las 24.000 — o sea, afirmando en silencio que ya se hizo. Lo mismo en
media flota para el de 6.000. **Un plan que miente es peor que no tener plan.**

Cárguense cuando exista, por máquina, el horómetro de la última intervención
mayor — dato que hoy no está en ninguna parte.

### Los dos horómetros que estaban rotos

**PUMA 2101** marcaba 145.609. La prueba definitiva: con la lectura cruda habría
trabajado **132.068 horas en 2026** (el año tiene 8.760); dividida por 10 da
1.020, unas 146 al mes. **Se teclea sin el punto decimal.** Corregida a
`horometro_manual = 14.560,9`.

**VALTRA 9902** marcaba 6 h. El diagnóstico de agosto fue "horómetro dañado, se
teclean las HORAS DEL DÍA (5, 10, 15, 22…), necesita lectura física" — y estaba
**equivocado**. El cierre de julio lo desmintió: la máquina fue de **795,4 a
1.076,8** en el mes, y la app tiene lecturas de 940, 1.104, 1.162 y 1.184, una
escala ascendente coherente.

🔴 **Le CAMBIARON el horómetro.** La unidad nueva arrancó cerca de cero, así que
las lecturas pequeñas no eran las horas del día: eran la escala nueva empezando.
Corregida a `horometro_manual = 1184` (20-ago-2026).

⚠️ La lección para la próxima máquina "rara": **una escala que arranca de cero y
sube sola es un horómetro reemplazado, no uno dañado.** El dañado no sube — repite
o salta sin orden. Distinguirlos mirando UN día es imposible; hace falta la serie,
y el cierre mensual es el que la muestra.

**CASE 1001** nunca ha tenido lectura. El Excel la cerró en 12.118 h.

Tras corregir la PUMA, **19 de 21 máquinas calculan bien su próximo servicio de
300 h**.

## El cierre mensual de horómetros (`equipo_horas_mes`, 20-ago-2026)

Una fila por **máquina y mes**: `horometro_inicial`, `horometro_final`, `horas`,
`galones`, `ganchos`, `fuente`, `nota`. Migración
`20260820100000_equipo_horas_mes.sql`.

Nació para el tablero de eficiencia (ver `managing-insumos`), pero es **la fuente
más limpia de horas que tiene el sistema** y sirve para todo lo demás: dos lecturas
por mes en vez de cientos de tramos de `labor_sesiones`, así que un dedazo no la
contamina.

🔴 **`horas` NO es una columna calculada, y es deliberado.** Normalmente vale
`final − inicial`, pero cuando el horómetro se **reemplaza** a mitad de mes la resta
miente (sale negativa o absurda) y hay que escribirlas a mano. Un `GENERATED ALWAYS`
habría hecho imposible registrar el mes en que se cambió la unidad — que es
justamente el mes que hay que poder registrar.

**No reemplaza a `labor_sesiones`, la complementa.** El tablero usa esta cuando el
mes tiene cierre y cae a las sesiones cuando no.

Se carga del Excel de combustible que administración ya lleva
(`cargar_julio.py` en el scratchpad es la plantilla: lee el `.json` extraído del
Excel y genera el SQL con `on conflict do update`). ⚠️ El Excel escribe
`CASE 1002` y la BD usa `CASE1002` — hay que normalizar el código o el `insert`
falla contra la FK de `equipos`.
