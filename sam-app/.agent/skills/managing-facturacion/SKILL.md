---
name: managing-facturacion
description: >
  Tarifas por labor y cliente, facturacion de las labores ejecutadas, cartera
  (cuentas por cobrar) e integracion con Siigo. Usala cuando el usuario mencione
  "tarifa", "precio por hectarea", "facturar", "factura", "cartera", "cuentas por
  cobrar", "cobrar", "cliente", "Siigo", "DIAN", "ajuste anual" o "aumento de
  precios".
---

# Facturacion y cartera — SAM

⚠️ **Estado al 28-sep-2026:** el codigo de Tarifas YA esta en `main`, pero la
entrada del menu sigue COMENTADA (`SupervisorView`, buscar "TARIFAS NO SE
MUESTRA") porque la tabla solo tiene **27 tarifas de EJEMPLO**. `FacturacionTab`
lista las realizadas y pone N° de factura en lote, pero **no muestra pesos**.
Medido el 28-sep: **4.739 labores cerradas (16-may → 28-sep), ≈26.252 ha, cero con
`factura_numero`.** Siguiente paso: ver «28-sep-2026: razon social y plantilla» abajo.

## 🔴 28-sep-2026: razon social y plantilla para el cliente

Pedido de Ivan: **ver el valor a facturar de cada linea de labor realizada**
(ha × tarifa), lo mas automatico posible. Mando la tabla real de precios (imagen):

- **CEBALLOS Y LOZANO NO es otra operacion ni otra empresa con maquinaria: es la
  otra RAZON SOCIAL con la que se emiten algunas facturas** (palabras de Ivan: «en
  la facturacion se hace con esta razon social»). La misma labor de la misma
  maquinaria se factura como AGROMORALES o como CEBALLOS Y LOZANO, y el precio
  cambia. → **La llave de la tarifa pasa a ser (razon social, cliente, labor
  [+ variante], unidad, vigencia)**, no solo (cliente, labor, vigencia).
- La tabla trae **37 precios**: AGROMORALES → San Carlos, Riopaila, **Riopaila
  Agricola**, Mayaguez, Risaralda; CEBALLOS Y LOZANO → Pichichi, Riopaila,
  **Proveedor**. Unidades: casi todo por ha; «Of. varios» por **hora ($50.000) y
  por jornal ($640.000)**; acequias sin unidad clara (en la app hay ha y hm).
- **Riopaila Agricola ≠ Ingenio Riopaila** y en la app ambas quedan como
  `ingenio_id = riopaila`. Lo que dice la tabla: el **despeje** solo tiene precio en
  «Riopaila»; **abono, subsuelo y acequias** solo en «Riopaila Agricola»;
  reencalle, triple y cultivo en las dos → se decide por hacienda.
- Variantes con precio propio: abono plantilla / 2x1 / 4x1, subsuelo y triple 4x1,
  cultivo plantilla / 2x1, reencalle caña cruda/verde (= se asume `REENCALLE V`).
  Propuesta: labores nuevas en `labores_catalogo` y que el supervisor escoja.

**Cruce tabla × lo realizado** (regla propuesta en la plantilla): 40 % con precio
claro · 51 % falta decidir · 8 % sin precio. Lo que mas pesa: **razon social del
DESPEJE de Riopaila (8.097 ha / 1.320 labores)**; luego Riopaila vs Riopaila
Agricola por hacienda (3.560 ha); REENCALLE V en San Carlos sin precio (1.140 ha).

**Entregado** (todo en `asm/sam/facturacion/`, ver su `LEEME.md`):
- `ASM_solicitud_tarifas_facturacion.xlsx` — PRELLENADA; el cliente solo confirma
  celdas amarillas y escoge de listas (hoja oculta «Listas»). 🔴 **Hojas y
  encabezados FIJOS: el importador los va a leer tal cual.** Hojas: 1 Tarifas ·
  2 Faltan precios · 3 Razon social · 4 Haciendas (529, con cliente y razon social
  por hacienda) · 5 Labores y variantes · 6 Preguntas.
- `generar_plantilla.py` (regenera; necesita `combos.csv` y `haciendas.csv`, que NO
  se versionan) y `plan_facturacion.html` (artifact
  https://claude.ai/artifact/HgxrS719q4K44jaQUr1ABg).

### 🔴 2-oct-2026: MODALIDAD de la labor (en producción, commit `f8bcae8`)

El precio depende de la labor **y su modalidad** (lógica que mandó Ivan escrita a mano):
DESPEJE 0X0 / 2X1 MECANIZADA (verde, limpio) / 4X1 QUEMADA · REENCALLE SENCILLO / 2X1 /
VERDE · SUBSUELO y TRIPLE PLANTILLA / 2X1 / 4X1 · ACEQUIAS 1 / 2 / 3 PASES. Fertilización
quedó SIN modalidad en la hoja (la tabla de precios sí trae abono plantilla/2x1/4x1 →
preguntado en la hoja 5; si dicen que sí, es solo crear la lista).

- Columna `asignaciones.modalidad` (null = sin modalidad) — migración `20261002090000`.
- Listas en `catalogos_valores`, tipo **`MODALIDAD:<LABOR>`** → se editan en Más → Listas
  SIN publicar. Una labor sin lista no pide nada. `lib/modalidad.ts` (`useModalidades` con
  copia local para sin señal, `faltaModalidad`, `modalidadEfectiva`, `laborFacturable`).
- **DESPEJE 0 X 0** y **REENCALLE V** (labores viejas del catálogo) cuentan como DESPEJE·0X0
  y REENCALLE·VERDE sin tocarlas (`IMPLICITA`).
- Dónde se escoge: **Asignar** (obligatoria si la labor tiene lista), **Aprobar** (si le
  falta: mismo cuadro de cliente y zona, ahora también para ASIGNADAS) y **Facturación**
  (filtro «Sin modalidad (N)» + «Poner modalidad» en lote, solo si lo marcado es UNA
  labor). Al 2-oct: 978 labores de septiembre sin modalidad (todo lo anterior).
- 🔴 **El OPERARIO escoge la modalidad AL CERRAR** (commit `a0afc40`, pedido del cliente:
  es quien ve el encalle real). Viene puesta la del supervisor o la sugerida; también en
  «Registrar labor realizada». Al tomar en campo no se pide (se pide al cerrar).
- 🔴 **De entrada TODO viene SUGERIDO en 2X1** (despeje 2X1 MECANIZADA) y **ACEQUIAS en 2
  PASES** — se puede cambiar (`modalidadSugerida`: la que empieza por «2X1», si no «2 PASES»).
  Por eso lo nuevo nunca queda sin modalidad y nada se frena.
- 🔴 **ACEQUIAS: el hectómetro pagado incluye hasta 2 pases; desde el 3.º cada pase es
  ADICIONAL** (`pasesAdicionales`). Facturación lo marca «+N adicional». Falta el precio del
  pase adicional (hoja 5 de la plantilla).
- La llave de tarifa al importar: razón social + cliente + labor + **modalidad** + unidad +
  vigencia. La plantilla ya pide «LABOR · MODALIDAD» («· TODAS» = el precio no cambia).

### 🔴 2-oct-2026: SOPORTE + FACTURA + CARTERA (en producción, commits `9eb7090`, `1905318`)

Flujo: **realizado → soporte del cliente → factura → pagos (cartera)**.
- `fact_documentos` (tipo SOPORTE / FACTURA; número, fecha, razón social, cliente, valor,
  `plazo_dias` 30, archivo) + `asignaciones.soporte_id` / `factura_id`. Vincular SIEMPRE por
  `fact_vincular(doc, ids, usuario, reemplazar)` / `fact_desvincular` (solo owner/administración;
  una línea no cambia de factura sin `reemplazar`; la factura llena `factura_numero`). Número único
  por tipo+razón social+cliente. Lista `TIPO_SOPORTE` en Más → Listas.
- Archivos en el depósito PRIVADO **`facturacion`** (no `avatars`); se abren con enlace firmado
  de 10 min (`abrirArchivo`). ⚠️ La llave de servicio de este servidor NO sirve para la API de
  archivos («signature verification failed»): para borrar a mano hay que quitar el archivo del
  disco (`/opt/supabase/docker/volumes/storage/stub/stub/facturacion/...`) y el registro con
  `set_config('storage.allow_delete_query','true',true)`.
- **Cartera**: `fact_pagos` (abonos, comprobante, se ANULAN con motivo) y vista
  `cartera_facturas_v`: vence = fecha + plazo; AL_DIA ≤30 · VENCIDA 31–60 · CRITICA 61–180 ·
  OTRAS_MEDIDAS >180 · PAGADA (los días se CONGELAN en el último pago) · SIN_VALOR. Pantalla
  Más → 💰 Cartera (owner y administración; Viviana NO tiene usuario al 2-oct: crearla como
  administración). Trazabilidad en el detalle de la labor (`TrazaFacturacion`, solo owner/admin).
- Facturación arranca en TODO el realizado (4.864 labores / 26.961,76 ha al 2-oct) con tarjetas
  por etapa.
- **Modalidad histórica**: el 2-oct se puso la sugerida a las 4.474 realizadas sin modalidad
  (despeje 2X1 MECANIZADA 2.813, reencalle 2X1 1.322, triple 162, subsuelo 108, acequias 2 PASES
  69). Respaldo: tabla `respaldo_modalidad_20261002` (id, modalidad_antes). Oficios varios:
  modalidad POR HORA / POR JORNAL (sugerida POR HORA).
- Probado con datos de prueba contra la base y TODO borrado después (editor original restaurado
  desde `asignaciones_auditoria`).

**Para no contradecir lo decidido en agosto** («no facturar hacia atras»): la
plantilla separa **vigencia del precio** (desde el 16-may, solo para VER el valor)
de la **fecha desde la que se FACTURA desde la app** (propuesta 1-oct-2026). Antes
de esa fecha la app valora pero no arma cobro. Y pregunta en que programa emiten
(¿Siigo?): el numero legal sale de ahi.

**Al recibir el Excel (plan ≈4 dias):** importador → `tarifas` (+ columnas razon
social, unidad, variante) · regla de razon social por cliente/hacienda · Riopaila
Agricola como cliente · valor por linea y «sin tarifa» en rojo en `FacturacionTab`
· pre-factura Excel por quincena + razon social + cliente · variantes en el
catalogo · luego conciliar UNA quincena contra la factura real antes de salir.

## El punto de partida: cero facturas

Medido el 17-ago-2026: **3.192 labores cerradas, 17.475,8 hectareas ejecutadas y
ni una sola con `factura_numero`.** El campo existia desde siempre y nadie lo uso,
porque faltaban las dos mitades de una factura: **a quien** se le cobra y **a
cuanto**.

## 🔴 A quien se le cobra: la llave son TRES campos, no dos

Cada suerte sabe a que ingenio pertenece. Pero unir por `nombre_hacienda + suerte`
es una trampa medida:

| Llave contra `maestro_risaralda` | Resultado |
|---|---|
| `nombre_hacienda + suerte` | **233 labores / 1.300,3 ha al cliente equivocado** |
| `codigo_hacienda + nombre_hacienda + suerte` | 3.192 de 3.192, **cero ambiguedad** |

El maestro tiene 16.506 suertes y 16.506 llaves distintas con los tres campos. Hay
haciendas que se llaman igual en ingenios distintos — TURIN puede ser Pichichi o
Riopaila.

⚠️ **`asignaciones.cliente` NO es el cliente.** Solo tiene `ingenios` (3.094) y
`proveedores` (94): es un segmento. Usarlo se ve correcto en la pantalla y factura
mal.

⚠️ **`terceros` esta huerfana**: no existe `tercero_id` en ninguna tabla. Son dos
catalogos de lo mismo (`ingenios` 6, `terceros` 7).

Reparto real de las 3.192 labores cerradas: Riopaila 8.647 ha (48%), Pichichi
3.604, San Carlos 3.300, Risaralda 1.702, Mayaguez 580, Trapiche Lucerna 30.

## Tarifas: (cliente, labor, vigencia)

Tabla `tarifas` + funcion `tarifa_de(tercero, labor, fecha)`. Pantalla en
**Mas → 💲 Tarifas** (dueno y administracion).

**Dos reglas que sostienen todo:**

1. **La tarifa se resuelve a la fecha de EJECUCION de la labor, no a la de la
   factura.** Una labor de julio facturada en agosto se cobra al precio de julio.
2. **Cambiar un precio NO es editar la fila**: cierra la vigencia que estaba y
   abre una nueva. Editar el precio de una vigencia pasada reescribiria facturas
   ya emitidas.

Por eso el boton dice **"Cambiar precio"** y no "Editar". La pantalla ensena la
regla, no solo la aplica.

`tercero_id` en **null = tarifa GENERAL**, que aplica a quien no tenga una propia
— asi un cliente nuevo no bloquea el cobro mientras se le negocia. La del cliente
le gana (el `order by (tercero_id is null)` de `tarifa_de`).

⚠️ Si `cambiarPrecio` falla al abrir la nueva vigencia, **reabre la anterior**. Un
hueco sin tarifa deja labores que no se pueden facturar y nadie se entera hasta el
cierre de mes.

### Ajuste anual en bloque

Los precios se renegocian cada ano, y subirlos de a uno son catorce pasos: una
tarea de catorce pasos que se hace una vez al ano **termina haciendose en Excel
por fuera del sistema**, que es lo que el modulo vino a reemplazar.

**Mas → Tarifas → 🗓 Ajuste anual**: fecha + % + redondeo → **tabla de vista
previa editable** → aplicar.

- La vista previa es **editable linea por linea** y cada una se puede excluir: el
  aumento casi nunca es parejo en todas las labores. Obligar a aplicar el
  porcentaje tal cual llevaria a corregir catorce lineas despues.
- **Redondeo comercial al mil** por defecto. Nadie cotiza $104.312,40 por hectarea,
  y sin eso el cliente pide redondear en la primera llamada.
- 🔴 **Corre en una funcion de la BD (`aplicar_ajuste_tarifas`), no como updates
  desde el navegador.** Si se cae la senal a mitad, la mitad de las labores
  quedaria con precio nuevo y la otra con el viejo, y nadie se entera hasta que
  sale una factura rara. Es todo o nada. **Probado forzando un fallo: no queda
  nada a medias.**
- **Aplicarlo dos veces esta bloqueado**: si la vigencia ya empieza en esa fecha,
  falla con mensaje claro. Sin eso, un doble clic sube 16% en vez de 8%.
- Verificado: DESPEJE queda en 95.000 para junio, 104.000 para agosto y 112.000
  para 2027. **Cero huecos y cero solapes** entre vigencias.

⚠️ Hay **27 tarifas de EJEMPLO** cargadas (nota «EJEMPLO…» o «Ajuste anual 8%»).
**Son inventadas.** Borrarlas (con respaldo) antes de cargar las reales.

## Siigo — lo investigado (18-ago-2026, sin credenciales)

`https://api.siigo.com` · https://developers.siigo.com/docs/siigoapi

**Credenciales:** las genera el DUENO en su Siigo (Configuracion → Alianzas e
integraciones → Credenciales de integracion). Solo `username` + `access_key`.
Header **`Partner-Id`** obligatorio y lo define uno mismo — Siigo bloquea a quien
mande informacion falsa ahi. Token de **24 h**: cachearlo, no pedirlo por request.

⚠️ **No hay sandbox con otra URL.** Siigo habilita una **empresa de pruebas** si
se solicita a soporteapi@siigo.com indicando el NIT. Pedirlo desde el dia 1.

### 🔴 Idempotencia nativa — usarla o duplicar facturas

Header **`Idempotency-Key`**, alfanumerico, **maximo 30 caracteres**. Si se repite
la key, devuelve el documento ya creado en vez de crear otro.

⚠️ Un UUID en hex son 32 caracteres: **no cabe**. Generarla mas corta y
**persistirla ANTES de enviar**, reusandola en el reintento.

**Un timeout NO es un fallo.** Reintentar con una key nueva tras un timeout es el
error mas caro de esta clase de integracion: el documento ya se creo.

### 🔴 Crear la factura emite ante la DIAN

`"stamp": { "send": true }` → sale con CUFE de una. Sin eso queda en borrador.
**Una factura aceptada por la DIAN no se puede editar ni borrar**, solo corregirse
con nota credito. Un duplicado no es un bug: es un documento fiscal.

El cliente y el producto **deben existir y estar activos en Siigo** antes
(`POST /v1/customers`, `/v1/products`). Los impuestos van **por `id`** del
catalogo `GET /v1/taxes`; Siigo calcula el valor.

### ⚠️ NO hay endpoint de cuentas por cobrar

Existe el de cuentas **por pagar** (`/v1/accounts-payable`); el simetrico no
aparece en la documentacion ni en ningun SDK. La cartera es reconstruible desde
`GET /invoices` (trae `balance` por factura, con filtro `updated_start/end` para
sincronizar), pero eso cubre solo facturas de venta — notas credito y recibos de
caja habria que consolidarlos aparte.

**Decision tomada: la cartera vive en SAM.** Siigo es la fuente del numero legal y
el CUFE. **Confirmar con soporteapi@siigo.com antes de prometer lo contrario.**

### Quien manda sobre que

| Dato | Fuente de verdad |
|---|---|
| Que labores, ha y precio se facturan | **SAM** |
| Numero de factura, prefijo, CUFE | **Siigo** — jamas generar numeros propios |
| Estado DIAN | **Siigo** |

### Reglas de arquitectura para cuando se implemente

🔴 **Nunca llamar a Siigo desde el clic ni dentro de una transaccion de BD.** Una
transaccion no puede hacer rollback de un POST HTTP: si el commit falla despues,
Siigo ya emitio la factura y la app no tiene registro. Va por **outbox**: se
escribe la intencion en una transaccion, y un worker aparte la envia.

🔴 **Facturar NO puede salir de la cola offline de los celulares.** Esa cola
reenvia al volver la senal, y reenviar una factura es emitir un documento fiscal
dos veces. Es accion de oficina, con conexion, y solo administracion/dueno.

🔴 **Las credenciales no pueden vivir en el front.** La `anon_key` es publica en
el bundle; cualquier otro secreto ahi queda expuesto. Van en una Edge Function
que **valide el JWT y el rol** — *un proxy sin autorizacion es la nueva llave
publica*.

**Limites:** 100 req/min en produccion. Errores reintentables: `requests_limit`,
`request_timeout`, `service_unavailable`. NO reintentables: `parameter_empty`,
`invalid_amount`, `duplicated_document`.

**Trampa reportada:** no se permite mas de una forma de pago si alguna tiene
vencimiento → `400 invalid_array`. Mezclar contado + credito revienta.

**Reconciliacion:** job diario que compara `GET /invoices` contra lo enviado. Si
esta en Siigo y no en la app, **adoptar** el numero (ese es el caso "respondio OK
pero no alcance a guardarlo"). El job **nunca anula en Siigo automaticamente**:
detecta y alerta; la nota credito la decide administracion.

## Lo que se decidio NO hacer

- **Facturacion electronica DIAN dentro de SAM.** Es habilitacion, resolucion de
  numeracion y proveedor tecnologico: un proyecto aparte. SAM emite la cuenta de
  cobro y lleva la cartera; el numero legal sale de Siigo.
- **Facturar hacia atras las 17.475 ha.** Reconstruir cinco meses con tarifas que
  nadie recuerda produce cartera falsa, que es peor que ninguna.
- **Tarifa por operario, maquina o zona.** La llave es (razon social, cliente,
  labor, unidad, vigencia) — la razon social entro el 28-sep porque la tabla real
  la trae; nada mas hasta que un contrato real lo pida.
- **Intereses de mora, multimoneda, conciliacion bancaria.** Con 7 clientes, quien
  cobra sabe a quien llamar; lo que le falta es el numero.
- **Flujo de aprobacion de facturas.** Emitir ya es un acto del dueno. El segundo
  par de ojos aplica al aval de combustible porque el que registra no es el que
  paga; aqui es la misma persona.

## Lo que bloquea seguir

1. **Las tarifas reales** — 28-sep: llego la tabla (37 precios, 2 razones
   sociales); falta que el cliente devuelva la plantilla diligenciada.
2. **La fecha de corte** desde la que se empieza a facturar (preguntada en la hoja 6).
3. **Las credenciales de Siigo** y la empresa de pruebas (hoja 6 pregunta en que
   programa facturan).
