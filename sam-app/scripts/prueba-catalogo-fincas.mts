import assert from 'node:assert/strict'
import { agruparCatalogo, costoReferenciaPorHa, resumenCatalogo, rubroDeLabor, sinCosto, totalPorHa } from '../src/lib/catalogoFincas.ts'
import type { LaborPaquete, RubroCosto } from '../src/services/fincasApi.ts'

let casos = 0
function caso(nombre: string, fn: () => void) { fn(); console.log(`✓ ${nombre}`); casos++ }

let seq = 0
function fila(p: Partial<LaborPaquete> & { labor: string }): LaborPaquete {
  return {
    id: `p${++seq}`, unidad: 'ha', cantidadPorHa: 1, costoUnitario: 0, pasadasPlan: 1, costoAparteUnitario: 0,
    ventanaIdeal: null, ventanaNormal: null, aplica: 'AMBOS', orden: 100, activa: true, repetible: false, variedad: null, ...p,
  }
}

// Las 8 filas reales del catálogo (25-oct-2026).
const real: LaborPaquete[] = [
  fila({ labor: 'ROTURACIÓN', costoUnitario: 225000, ventanaIdeal: 16, ventanaNormal: 30, aplica: 'SOCA', orden: 10 }),
  fila({ labor: 'FERTILIZACIÓN', costoUnitario: 160000, ventanaIdeal: 11, ventanaNormal: 31, aplica: 'SOCA', variedad: 'CC 11-595', orden: 20 }),
  fila({ labor: 'FERTILIZACIÓN', costoUnitario: 160000, ventanaIdeal: 20, ventanaNormal: 46, aplica: 'SOCA', variedad: 'CC 01-1940', orden: 20 }),
  fila({ labor: 'FERTILIZACIÓN', costoUnitario: 160000, ventanaIdeal: 7, ventanaNormal: 26, aplica: 'SOCA', variedad: 'CC 05-430', orden: 20 }),
  fila({ labor: 'FERTILIZACIÓN', costoUnitario: 170000, ventanaIdeal: 30, ventanaNormal: 60, aplica: 'PLANTILLA', orden: 20 }),
  fila({ labor: 'FERTILIZACIÓN', costoUnitario: 160000, ventanaIdeal: 30, ventanaNormal: 45, aplica: 'SOCA', orden: 20 }),
  fila({ labor: 'CONTROL DE MALEZAS', costoUnitario: 120000, repetible: true, orden: 30 }),
  fila({ labor: 'RIEGO', costoUnitario: 0, repetible: true, orden: 40 }),
]
const rubros: Record<string, RubroCosto> = { 'ROTURACIÓN': 'maquinaria', 'FERTILIZACIÓN': 'insumos', 'CONTROL DE MALEZAS': 'insumos', 'RIEGO': 'agua' }

caso('total por ha = cantidad × pasadas × (servicio + ppto por ha)', () => {
  assert.equal(totalPorHa(fila({ labor: 'X', costoUnitario: 100, costoAparteUnitario: 50 })), 150)
  assert.equal(totalPorHa(fila({ labor: 'X', costoUnitario: 100, costoAparteUnitario: 50, repetible: true, pasadasPlan: 3 })), 450)
  assert.equal(totalPorHa(fila({ labor: 'X', costoUnitario: 100, costoAparteUnitario: 50, cantidadPorHa: 2 })), 300)
})

caso('las pasadas solo cuentan si la labor se repite', () => {
  // Una fila no repetible con pasadas > 1 (dato sucio) no multiplica: la base lo impide, la pantalla también.
  assert.equal(totalPorHa(fila({ labor: 'X', costoUnitario: 100, pasadasPlan: 4, repetible: false })), 100)
})

caso('datos sucios no dan NaN', () => {
  const sucio = fila({ labor: 'X' }) as unknown as Record<string, unknown>
  sucio.costoUnitario = undefined; sucio.costoAparteUnitario = null; sucio.cantidadPorHa = undefined
  assert.equal(totalPorHa(sucio as unknown as LaborPaquete), 0)
  assert.equal(sinCosto(sucio as unknown as LaborPaquete), true)
  assert.deepEqual(agruparCatalogo(undefined as unknown as LaborPaquete[]), [])
})

caso('el catálogo real se agrupa en 4 labores, en su orden', () => {
  const g = agruparCatalogo(real, rubros)
  assert.deepEqual(g.map((x) => x.labor), ['ROTURACIÓN', 'FERTILIZACIÓN', 'CONTROL DE MALEZAS', 'RIEGO'])
  assert.deepEqual(g.map((x) => x.filas.length), [1, 5, 1, 1])
  assert.deepEqual(g.map((x) => x.rubro), ['maquinaria', 'insumos', 'insumos', 'agua'])
  assert.deepEqual(g.map((x) => x.sinCosto), [0, 0, 0, 1])
})

caso('dentro de fertilización: genéricas primero (soca, plantilla), luego variedades por nombre', () => {
  const f = agruparCatalogo(real, rubros).find((x) => x.labor === 'FERTILIZACIÓN')!
  assert.deepEqual(f.filas.map((x) => `${x.aplica}|${x.variedad ?? '-'}`), [
    'SOCA|-', 'PLANTILLA|-', 'SOCA|CC 01-1940', 'SOCA|CC 05-430', 'SOCA|CC 11-595',
  ])
})

caso('una fila inactiva no cuenta como activa ni como sin costo', () => {
  const l = [...real, fila({ labor: 'RIEGO', activa: false, costoUnitario: 0, orden: 40 })]
  const riego = agruparCatalogo(l, rubros).find((x) => x.labor === 'RIEGO')!
  assert.equal(riego.filas.length, 2)
  assert.equal(riego.activas, 1)
  assert.equal(riego.sinCosto, 1)
})

caso('el rubro se encuentra aunque cambien tildes o mayúsculas', () => {
  assert.equal(rubroDeLabor('Fertilizacion', rubros), 'insumos')
  assert.equal(rubroDeLabor('roturación', rubros), 'maquinaria')
  assert.equal(rubroDeLabor('COSECHA', rubros), null)
})

caso('costo de referencia por ha de un corte de SOCA', () => {
  const r = costoReferenciaPorHa(real, 'SOCA')
  // roturación 225.000 + fertilización genérica soca 160.000 + malezas 120.000 + riego 0
  assert.deepEqual(r, { total: 505000, labores: 4, sinCosto: 1 })
})

caso('costo de referencia por ha de una PLANTILLA no incluye lo que es solo de soca', () => {
  const r = costoReferenciaPorHa(real, 'PLANTILLA')
  // fertilización plantilla 170.000 + malezas 120.000 + riego 0 (la roturación es solo soca)
  assert.deepEqual(r, { total: 290000, labores: 3, sinCosto: 1 })
})

caso('el ppto por ha sube el costo de referencia y quita el aviso de sin costo', () => {
  const l = real.map((x) => (x.labor === 'RIEGO' ? { ...x, costoAparteUnitario: 90000 } : x))
  assert.deepEqual(costoReferenciaPorHa(l, 'SOCA'), { total: 595000, labores: 4, sinCosto: 0 })
})

caso('resumen del catálogo', () => {
  assert.deepEqual(resumenCatalogo(real), { laboresActivas: 4, filasActivas: 8, filasSinCosto: 1, filasSinVentana: 0 })
  const sinVentana = [...real, fila({ labor: 'RESIEMBRA', costoUnitario: 50000 })]
  assert.equal(resumenCatalogo(sinVentana).filasSinVentana, 1)
})

console.log(`\n${casos} de ${casos} casos`)
