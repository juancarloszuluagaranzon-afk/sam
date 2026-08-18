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

⚠️ **Estado al 18-ago-2026: las TARIFAS viven en la rama `pruebas`, NO en
produccion.** Decision del cliente: quiere probarlo antes. De este documento solo
la investigacion es firme; el codigo esta en `pruebas`.

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

⚠️ Hay **14 tarifas de EJEMPLO** cargadas (marcadas en la pantalla con aviso).
**Son inventadas.** Para limpiarlas: `delete from tarifas;`

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
- **Tarifa por operario, maquina o zona.** La llave es (cliente, labor, vigencia)
  hasta que aparezca un contrato real que pida mas.
- **Intereses de mora, multimoneda, conciliacion bancaria.** Con 7 clientes, quien
  cobra sabe a quien llamar; lo que le falta es el numero.
- **Flujo de aprobacion de facturas.** Emitir ya es un acto del dueno. El segundo
  par de ojos aplica al aval de combustible porque el que registra no es el que
  paga; aqui es la misma persona.

## Lo que bloquea seguir

1. **Las tarifas reales.** ¿Cambia el precio segun el ingenio? ¿Cada cuanto se
   renegocia? Sin esto no se factura nada.
2. **La fecha de corte** desde la que se empieza a facturar.
3. **Las credenciales de Siigo** y la empresa de pruebas.
