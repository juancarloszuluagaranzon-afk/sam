# Caso de éxito — SAM / AgroMorales

> **Qué es este documento.** Es el insumo para que un modelo de IA (Gemini) arme el
> caso de éxito dentro del plan de negocios: tiene el relato, las cifras medidas en
> producción, los diferenciadores defendibles y la identidad de marca con
> instrucciones de imagen. Todo lo que dice está verificado contra la base de datos
> el **4 de agosto de 2026**. Nada está redondeado hacia arriba.

---

## 0. Ficha rápida

| | |
|---|---|
| **Producto** | SAM — sistema de gestión de labores agrícolas mecanizadas |
| **Marca visible** | AgroMorales |
| **Cliente** | AgroServicios Morales (AgroMorales) — prestador de servicios agrícolas para el sector cañicultor |
| **Sector** | Agroindustria de la caña de azúcar · servicios mecanizados |
| **Usuarios** | 50 cuentas · 44 activas |
| **En producción desde** | 16 de mayo de 2026 |
| **Tiempo medido** | 81 días de operación real |
| **Tipo** | PWA (aplicación web instalable), offline-first |
| **Infraestructura** | Servidor propio (VPS) — sin dependencia de nube de terceros para los datos |

---

## 1. El problema: el papel

AgroServicios Morales presta servicios de maquinaria agrícola a haciendas cañeras.
Treinta y un operarios, veintiún máquinas, más de trescientas haciendas. **Y toda la
operación corría sobre planillas de papel.**

Eso trae cinco problemas que se alimentan entre sí:

1. **El operario cobra por lo que registra.** Si la planilla se moja, se pierde o se
   traspapela, ese trabajo no existe. La quincena de una persona real depende de una
   hoja de papel que viajó en un tractor.
2. **Nadie sabe dónde está la operación hasta el otro día.** El supervisor se entera
   de lo que se hizo cuando el operario vuelve y entrega el papel. Para entonces ya
   no se puede corregir nada.
3. **El combustible se va sin dejar rastro.** Entra por la bomba, sale hacia una
   máquina y en el medio no hay ningún registro que cuadre. Es el insumo más caro de
   la operación y era el menos controlado.
4. **Facturarle al ingenio es un trabajo de arqueología.** Recopilar, sumar y
   verificar las hectáreas de treinta personas al cierre de cada quincena.
5. **Y no hay memoria.** Cuando alguien pregunta "¿esa suerte quién la hizo y cuándo?"
   la respuesta está en una caja.

**El punto que hay que dejar claro en el plan de negocios:** esto no es un problema de
software. Es un problema de dinero, de confianza entre la empresa y su gente, y de
capacidad de crecer. Una operación sobre papel no escala: cada máquina nueva agrega
carga administrativa proporcional.

---

## 2. La solución: SAM

Una aplicación que el operario abre en su propio celular, en el lote, **sin señal**, y
donde queda registrado lo que hizo en el momento en que lo hizo.

Alrededor de eso se construyeron ocho módulos, en el orden en que la operación los
fue necesitando:

| # | Módulo | Qué resuelve |
|---|---|---|
| 1 | **Labores y asignaciones** | El núcleo. Asignar, tomar en campo, cerrar, aprobar |
| 2 | **Planilla quincenal** | La cuadrícula de nómina con sus novedades (vacaciones, incapacidad, permiso…) |
| 3 | **Maestro de suertes** | 15.930 lotes con su área oficial: nadie inventa hectáreas |
| 4 | **Insumos y combustible** | Inventario por bodega, solicitudes, despachos con evidencia y doble confirmación |
| 5 | **Taller de maquinaria** | Hoja de vida, mantenimiento preventivo por horómetro, órdenes de trabajo, costo por hora |
| 6 | **Mapas offline** | El plano de la hacienda en el celular, sin datos, con GPS |
| 7 | **Flota y escolta** | El formato de control vehicular, con firma táctil |
| 8 | **Rendimiento del operario** | Indicador quincenal por persona: qué tanto cumplió su meta |

---

## 3. Resultados medidos en producción

> Ventana: **16 de mayo → 4 de agosto de 2026** (81 días con registro).
> Fuente: consulta directa a la base de datos de producción, 4-ago-2026.

### Volumen

| Métrica | Valor |
|---|---|
| Labores registradas | **2.766** |
| Hectáreas ejecutadas | **15.088,4 ha** |
| Promedio diario | **34 labores/día** |
| Operarios activos | **31** |
| Máquinas en operación | **21** |
| Haciendas atendidas | **323** |
| Horas-máquina registradas | **6.869 h** |

### Adopción — la cifra que más pesa

**El 64,5% de las labores (1.784 de 2.766) las abrió el operario por su cuenta en el
campo**, no vinieron programadas desde la oficina.

Esta es la métrica que hay que destacar en el plan de negocios, y la razón es esta:
un sistema impuesto se llena porque toca. Un sistema que la gente usa sin que nadie
se lo pida ya ganó. Dos de cada tres registros nacen de la decisión del operario de
sacar el celular en el lote.

### Crecimiento mes a mes

| Mes | Labores | Hectáreas |
|---|---|---|
| mayo 2026 (desde el 16) | 260 | 1.994,5 |
| junio 2026 | 888 | 5.270,5 |
| julio 2026 | **1.463** | **7.164,6** |
| agosto 2026 (al día 4) | 155 | 658,7 |

De 260 a 1.463 labores mensuales en dos meses. **La curva es de adopción, no de
temporada**: la operación era del mismo tamaño en mayo.

### Calidad del registro

| Indicador | Resultado |
|---|---|
| Labores que llegan a cierre (completada o parcial) | **98,0%** (2.711 de 2.766) |
| Labores con horómetro registrado | **97,7%** (2.703) |
| Labores con trazabilidad de aprobación | **100%** (2.766) |
| Eventos de auditoría guardados | **7.019** sobre 1.742 labores |
| Entregas de material con confirmación del operario | **83%** (35 de 42) |
| Entregas con diferencia reclamada | **0** |

Esos 7.019 eventos de auditoría son la respuesta a *"¿quién cambió esto y cuándo?"*.
Cada edición de una labor queda registrada con autor, momento y el detalle de qué
cambió. En papel esa pregunta no tiene respuesta.

### Base de datos maestra

**15.930 suertes activas · 1.718 haciendas · 117.405 hectáreas** cargadas con su área
oficial. Cuando un operario registra un trabajo, el área no la digita: la trae el
maestro. Es lo que hace que la facturación no se discuta.

### Lo que ya se controla del combustible

El módulo de insumos se reinició desde cero el 1 de agosto para arrancar con
inventario limpio. **En sus primeros 4 días**: 102 movimientos de kardex, 11
materiales, 13 tanqueos y **703,8 galones** con origen, destino, foto de la tirilla y
firma de quien recibió.

---

## 4. Los seis diferenciadores defendibles

Esta es la sección que sostiene el argumento de producto. No son características:
son decisiones de diseño que resuelven un problema que los competidores genéricos no
ven porque no han estado en un cañaduzal.

### 1. Offline de verdad, no "offline de folleto"

En un lote de caña no hay señal. Casi cualquier app dice ser offline y lo que hace es
guardar en cola lo que el usuario escribe. **Eso es la mitad del problema.** La otra
mitad es leer: si el operario abre la app sin señal y el catálogo sale vacío, puede
guardar pero no tiene de dónde escoger. SAM guarda respaldo local de lo que necesita
para trabajar, y avisa en pantalla que lo que se ve es de la última conexión.

> El caso que más dolía: sin respaldo, el inventario del carro salía en CERO y la
> validación bloqueaba cualquier despacho. Un cero que miente es peor que un dato viejo.

### 2. Nadie firma lo suyo

Todo lo que un operario recibe —material o combustible— **lo confirma él con un toque**
en su propio celular. Y quien registra un movimiento no puede ser quien lo avala.
Es el estándar de *proof-of-delivery* de la logística, aplicado a una operación agrícola.

No es desconfianza: es lo que permite que nadie tenga que defender su palabra.

### 3. El combustible no se puede inventar

El supervisor de insumos **no tiene acceso a "registrar entrada"**. Si lo tuviera, el
combustible podría aparecer de la nada y se acabó la trazabilidad. Todo lo que entra
a su carro entra por un traslado avalado o por un tanqueo con foto de la tirilla.
Es una restricción deliberada, y es exactamente lo que un gerente financiero quiere
oír.

### 4. La calidad del dato es una función, no un supuesto

Los horómetros que llegan del campo vienen sucios: dedazos, un dígito de más, y sobre
todo las horas del día escritas en la casilla del horómetro. **SAM detecta esas
lecturas y las marca en pantalla en vez de esconderlas.**

La decisión importa: ignorarlas en silencio dejaría la pantalla más limpia, pero
entonces nadie corrige el dato de origen y el problema crece. Un sistema que dice
"este número no me cuadra" vale más que uno que promedia y entrega una cifra falsa
con dos decimales.

### 5. El área ejecutada es dinero, y se trata como tal

Se paga por hectárea ejecutada, no por hectárea asignada. Ese criterio está aplicado
de forma idéntica en la pantalla, en el Excel y en la facturación, y los reportes
muestran las dos cifras separadas: **plan** y **ejecutado**. Cuando el número que ve
el operario y el que ve la administración es el mismo, la discusión de quincena se
acaba.

### 6. Se opera solo

Cada cambio se publica automáticamente y **la versión activa se ve dentro de la app**,
así que soporte no depende de que el usuario adivine si actualizó. Los manuales viven
adentro, uno por rol, y también se comparten por enlace de WhatsApp.

---

## 5. Qué significa esto para el negocio

- **Escala sin carga administrativa.** Pasar de 260 a 1.463 labores mensuales no
  requirió contratar a nadie en la oficina.
- **La quincena se cierra con datos, no con papeles.** 15.088 hectáreas ya
  cuadradas contra el maestro oficial.
- **El activo de datos es propio.** 2.766 labores, 7.019 eventos de auditoría y un
  maestro de 117.405 ha en servidor propio. Ese histórico es la base de cualquier
  análisis de productividad, costo por hectárea o negociación con el ingenio.
- **Es replicable.** Nada de esto es específico de una hacienda. Cualquier prestador
  de servicios agrícolas mecanizados tiene los mismos cinco problemas.

---

## 6. Identidad de marca

> Esta sección es para que el modelo genere piezas visuales coherentes. La paleta
> **no es una propuesta: son los colores reales de la aplicación en producción.**

### Paleta

| Rol | Hex | Uso |
|---|---|---|
| **Verde corporativo** | `#155b30` | El color de la marca. Encabezados, acciones principales |
| Verde profundo | `#0e3b1f` | Fondos oscuros, degradados |
| Verde medio | `#1f7a40` | Acentos, estados de éxito |
| Verde papel | `#e9f3ed` | Fondos suaves, tarjetas destacadas |
| Tinta | `#161a14` | Texto principal (casi negro, con verde adentro) |
| Tinta media | `#4a5040` | Texto secundario |
| Papel | `#fafaf7` | Fondo general (blanco cálido, no blanco puro) |
| Alerta | `#b3261e` | Solo para lo que se daña si se hace mal |

**Regla dura:** el verde corporativo **no sirve para texto pequeño sobre fondo oscuro**
(contraste 3,58:1, por debajo del mínimo legible). En oscuro, el estado se marca con
borde o fondo, nunca tiñendo la letra.

### Tipografía

Sans-serif geométrica de alta legibilidad (Inter, Source Sans, IBM Plex Sans).
Números tabulares en cifras y tablas. Sin serifas: esto se lee al sol, en un celular,
con las manos sucias.

### Tono de voz

- **Concreto, nunca corporativo.** "Lo que se gastó", no "el consumo neto".
- **Dice por qué importa, no solo qué hace.** "Sin esto no hay disponibilidad" pesa
  más que "campo obligatorio".
- **Habla como el que usa la app**, no como el que la programó: "el carro", no "la
  bodega satélite".
- **Corto.** Si necesita tres párrafos, la pantalla está haciendo demasiadas cosas.

### Iconografía

Trazo simple, sin relleno, esquinas suaves. El vocabulario visual de la app:
🚜 máquina · 📦 material · ⛽ combustible · 🗺️ mapa · 🔧 taller · 📅 informe ·
📊 reporte · 🏢 bodega.

### Qué NO hacer

- Nada de tractores brillantes en atardeceres dorados. Es una herramienta de trabajo.
- Nada de gráficas 3D, degradados de arcoíris ni fondos con textura.
- **Nunca dos escalas en una misma gráfica.**
- No usar imágenes de personas sonriendo con tabletas en un campo perfecto. La caña
  es alta, polvorienta y hay barro.

---

## 7. Instrucciones de imagen (para generación)

Cinco piezas. Todas con la misma paleta, sin texto incrustado salvo donde se indique.

**PIEZA 1 — Portada del caso de éxito.**
Fotografía realista, hora dorada tardía pero sin saturar: un operario de mediana edad
con camisa de trabajo y sombrero, de pie junto a un tractor agrícola cubierto de polvo
al borde de un cañaduzal alto. Sostiene un teléfono a la altura del pecho, mirándolo
con concentración, no sonriendo a la cámara. Caña de azúcar densa y verde de fondo,
ligeramente desenfocada. Realismo documental, no publicidad. Colores terrosos y
verdes; sin cielo naranja intenso. Formato horizontal 16:9.

**PIEZA 2 — Antes y después.**
Ilustración plana de dos paneles divididos por una línea vertical. Izquierda: una pila
desordenada de planillas de papel arrugadas y manchadas, un lápiz, tonos grises y
sepia apagados. Derecha: un teléfono limpio mostrando tarjetas de datos ordenadas,
sobre fondo verde papel `#e9f3ed`, con el verde `#155b30` en los elementos activos.
Estilo vectorial de trazo fino, sin sombras dramáticas. Sin texto.

**PIEZA 3 — Diagrama del ciclo de una labor.**
Diagrama circular limpio de cinco pasos con flechas entre ellos: *Asignar → Tomar en
campo → Ejecutar → Cerrar con área y horómetro → Aprobar y facturar*. Cada nodo es un
círculo con un icono de línea simple. Verde `#155b30` para los nodos, gris `#4a5040`
para las flechas, fondo `#fafaf7`. Estilo de infografía editorial, mucho aire.
Con texto, en español.

**PIEZA 4 — Mural de métricas.**
Composición de tarjetas rectangulares de esquinas redondeadas sobre fondo blanco
cálido, cada una con una cifra grande en verde profundo y una etiqueta pequeña en gris
debajo. Las cifras: **2.766** labores · **15.088** hectáreas · **31** operarios ·
**64,5%** iniciadas por el operario · **98%** cerradas · **7.019** eventos auditados.
Sin iconos, sin adornos. Tipografía sans geométrica, números muy grandes. Estilo de
reporte anual moderno.

**PIEZA 5 — Arquitectura de confianza.**
Ilustración isométrica sobria de tres actores conectados: el operario con su teléfono
en el campo, el supervisor con el suyo en el carro, y un servidor propio representado
como un bloque sólido. Flechas bidireccionales entre ellos; una de las flechas del
operario tiene un icono de nube tachado, indicando que funciona sin señal. Paleta
verde y gris exclusivamente. Trazo fino, sin brillos ni reflejos. Sin texto.

---

## 8. Frases utilizables tal cual

> «El operario cobra por lo que registra aquí. No es una app de reportes: es la
> nómina de una persona real.»

> «Dos de cada tres labores las abre el operario por su cuenta, en el lote, sin que
> nadie se lo pida. Ese es el único indicador de adopción que no se puede fingir.»

> «Un cero que miente es peor que un dato viejo.»

> «El sistema dice cuándo el dato está sucio, en vez de promediarlo y entregar una
> cifra falsa con dos decimales.»

> «Nadie firma lo suyo. No por desconfianza: para que nadie tenga que defender su
> palabra.»

> «De 260 a 1.463 labores al mes en dos meses, sin contratar a nadie en la oficina.»

---

## 9. Advertencias de honestidad

Para que el plan de negocios no quede expuesto:

- **La ventana es de 81 días.** Es una implantación exitosa y en crecimiento, no un
  histórico de años. Decirlo tal cual es más fuerte que insinuar lo contrario.
- **El módulo de insumos se reinició el 1-ago-2026** para arrancar con inventario
  limpio. Sus cifras son de 4 días. Presentarlas como "primeros días de operación".
- **No hay cifras de facturación** todavía: el módulo existe pero aún no se ha
  emitido ninguna factura desde el sistema. **No inventar ahorros en pesos.**
- **El 20% de las sesiones tiene horas mal capturadas** (445 de 2.212). Es un problema
  de captura en campo que el sistema ya detecta y señala. Mencionarlo como trabajo en
  curso da más credibilidad que omitirlo — y demuestra que el sistema lo ve.
- Todas las demás cifras de este documento están medidas, no estimadas.
