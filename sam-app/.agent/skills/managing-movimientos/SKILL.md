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
