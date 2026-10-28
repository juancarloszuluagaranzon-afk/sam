import assert from 'node:assert/strict'
import { propuestaDeducciones, reglasEfectivas, saldoDeFactura, excedeValor, validarItem, etiquetaDeduccion, totalItems } from '../src/lib/deduccionesCartera.ts'
import type { ConceptoDeduccion, ItemDeduccion } from '../src/lib/deduccionesCartera.ts'

let casos = 0
function caso(nombre: string, fn: () => void) { fn(); casos++ }
const conceptos: ConceptoDeduccion[] = [
  { codigo: 'RETEFUENTE', nombre: 'Retención en la fuente', modo: 'PORCENTAJE', orden: 1 },
  { codigo: 'DESCUENTO', nombre: 'Descuento', modo: 'VALOR', orden: 2 },
]

caso('propuesta calcula y redondea los porcentajes', () => {
  assert.equal(propuestaDeducciones(10_000_000, [{ concepto: 'RETEFUENTE', porcentaje: 4 }], [])[0].valor, 400_000)
  assert.equal(propuestaDeducciones(3_333_333, [{ concepto: 'RETEFUENTE', porcentaje: 0.5 }], [])[0].valor, 16_666.67)
})
caso('propuesta omite aplicados salvo conceptos repetibles y sin valor', () => {
  const p = propuestaDeducciones(100, [{ concepto: 'RETEFUENTE', porcentaje: 4 }, { concepto: 'DESCUENTO', porcentaje: 2 }], ['RETEFUENTE', 'DESCUENTO'])
  assert.deepEqual(p.map((i) => i.concepto), ['DESCUENTO'])
  assert.deepEqual(propuestaDeducciones(null, [{ concepto: 'A', porcentaje: 1 }], []), [])
  assert.deepEqual(propuestaDeducciones(0, [{ concepto: 'A', porcentaje: 1 }], []), [])
})
caso('reglas efectivas prioriza pagador y cae al cliente', () => {
  const pagador = [{ concepto: 'P', porcentaje: 1 }], cliente = [{ concepto: 'C', porcentaje: 2 }]
  assert.deepEqual(reglasEfectivas({ pagadorId: 'p', facturadoAId: 'c' }, { p: pagador, c: cliente }), pagador)
  assert.deepEqual(reglasEfectivas({ pagadorId: null, facturadoAId: 'c' }, { c: cliente }), cliente)
  assert.deepEqual(reglasEfectivas({ pagadorId: null, facturadoAId: null }, {}), [])
  assert.deepEqual(reglasEfectivas({ pagadorId: 'p', facturadoAId: 'c' }, { p: [], c: cliente }), cliente)
})
caso('saldo descuenta pagos y deducciones, nunca es negativo', () => {
  assert.equal(saldoDeFactura(null, 1, 1), null)
  assert.equal(saldoDeFactura(100, 30, 20), 50)
  assert.equal(saldoDeFactura(10, 8, 8), 0)
})
caso('excede respeta tolerancia de medio peso', () => {
  assert.equal(excedeValor(100, 50, 50, 0.5).excede, false)
  assert.equal(excedeValor(100, 50, 50, 1).mensaje, 'Lo pagado más lo deducido pasa del valor de la factura por $1')
  assert.deepEqual(excedeValor(null, 0, 0, 1), { excede: true, mensaje: 'La factura todavía no tiene valor' })
})
caso('validarItem detecta concepto, porcentaje y valor', () => {
  const base: ItemDeduccion = { concepto: 'RETEFUENTE', porcentaje: 4, valor: 1 }
  assert.equal(validarItem(base, undefined), 'El concepto no existe')
  assert.ok(validarItem({ ...base, porcentaje: 0 }, conceptos[0]))
  assert.equal(validarItem({ ...base, porcentaje: 100 }, conceptos[0]), null)
  assert.ok(validarItem({ ...base, porcentaje: 100.01 }, conceptos[0]))
  assert.ok(validarItem({ ...base, valor: 0 }, conceptos[0]))
  assert.ok(validarItem({ ...base, valor: -1 }, conceptos[0]))
  assert.equal(validarItem(base, conceptos[0]), null)
})
caso('etiqueta presenta porcentaje en formato colombiano', () => {
  assert.equal(etiquetaDeduccion({ concepto: 'RETEFUENTE', porcentaje: 4 }, conceptos), 'Retención en la fuente · 4 %')
  assert.equal(etiquetaDeduccion({ concepto: 'RETEFUENTE', porcentaje: 0.5 }, conceptos), 'Retención en la fuente · 0,5 %')
  assert.equal(etiquetaDeduccion({ concepto: 'RETEFUENTE', porcentaje: 3.25 }, conceptos), 'Retención en la fuente · 3,25 %')
  assert.equal(etiquetaDeduccion({ concepto: 'DESCUENTO', porcentaje: null }, conceptos), 'Descuento')
  assert.equal(etiquetaDeduccion({ concepto: 'NUEVO', porcentaje: null }, conceptos), 'NUEVO')
})
caso('total suma con redondeo decimal', () => {
  assert.equal(totalItems([{ concepto: 'A', porcentaje: null, valor: 0.1 }, { concepto: 'B', porcentaje: null, valor: 0.2 }]), 0.3)
})

console.log(`${casos} casos bien`)
