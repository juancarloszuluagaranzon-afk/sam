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

Las lecturas descartadas no se esconden: salen en `equipo_horometro_dudoso_v` y
se muestran en la hoja de vida para que alguien las corrija en la labor origen.

> Al momento de implementar había **71 lecturas descartadas** en 21 máquinas.
> Es un problema de captura en campo, no del app.

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
