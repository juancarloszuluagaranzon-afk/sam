import assert from 'node:assert/strict'
import { cmpNumero, fijarFactura, fijarMostrar, opcionesFactura, ordenarPorFactura } from '../src/lib/filtroFacturadas.ts'

let casos = 0
function caso(nombre: string, fn: () => void) { fn(); console.log(`✓ ${nombre}`); casos++ }

interface L { id: string; fac: string | null }
const l = (id: string, fac: string | null): L => ({ id, fac })
const numeroDe = (a: L) => a.fac
const facturada = (a: L) => !!a.fac
const lineas = [l('1', null), l('2', 'FECE 1173'), l('3', 'FECE 99'), l('4', 'FECE 1173'), l('5', null), l('6', 'FECE 1200')]

caso('Mostrar «todas» no filtra', () => assert.equal(fijarMostrar(lineas, 'TODAS', facturada), null))

caso('Mostrar «ya facturadas» y «sin facturar» reparten sin cruzarse', () => {
  const ya = fijarMostrar(lineas, 'YA', facturada)!, sin = fijarMostrar(lineas, 'SIN', facturada)!
  assert.deepEqual([...ya].sort(), ['2', '3', '4', '6'])
  assert.deepEqual([...sin].sort(), ['1', '5'])
  assert.equal(ya.size + sin.size, lineas.length)
})

caso('lo fijado no cambia si una línea se factura después', () => {
  const sin = fijarMostrar(lineas, 'SIN', facturada)!
  const despues = lineas.map((a) => (a.id === '1' ? l('1', 'FECE 1300') : a))
  assert.equal(sin.has('1'), true)
  assert.equal(despues.filter((a) => sin.has(a.id)).length, 2)
})

caso('fijarFactura trae las líneas de esa factura', () => {
  assert.deepEqual([...fijarFactura(lineas, 'FECE 1173', numeroDe)!].sort(), ['2', '4'])
  assert.equal(fijarFactura(lineas, '', numeroDe), null)
  assert.equal(fijarFactura(lineas, 'NO EXISTE', numeroDe)!.size, 0)
})

caso('opcionesFactura cuenta líneas y ordena por cifras', () => {
  assert.deepEqual(opcionesFactura(lineas, numeroDe), [
    { numero: 'FECE 99', lineas: 1 }, { numero: 'FECE 1173', lineas: 2 }, { numero: 'FECE 1200', lineas: 1 },
  ])
})

caso('cmpNumero compara por cifras', () => {
  assert.ok(cmpNumero('FECE 99', 'FECE 1173') < 0)
  assert.ok(cmpNumero('FE-2', 'FE-10') < 0)
})

caso('ordenarPorFactura junta cada factura, deja las sin factura al final y conserva el orden interno', () => {
  const o = ordenarPorFactura(lineas, numeroDe)
  assert.deepEqual(o.map((a) => a.id), ['3', '2', '4', '6', '1', '5'])
})

caso('ordenarPorFactura no modifica la lista original y aguanta lista vacía', () => {
  const copia = [...lineas]
  ordenarPorFactura(lineas, numeroDe)
  assert.deepEqual(lineas, copia)
  assert.deepEqual(ordenarPorFactura([], numeroDe), [])
})

console.log(`\n${casos} casos bien`)
