import assert from 'node:assert/strict'
import { ciclosEnExceso, MARGEN_AREA } from '../src/lib/sobreArea.ts'
import type { Assignment, MaestroRow } from '../src/domain/sam.ts'

let casos = 0
function caso(nombre: string, fn: () => void) { fn(); console.log(`✓ ${nombre}`); casos++ }
const cerca = (a: number, b: number, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b}`)

let seq = 0
function fila(p: Partial<Assignment> & { op: string }): Assignment {
  const { op, ...resto } = p
  return {
    id: `a${String(++seq).padStart(3, '0')}`, suerteCode: 'SE-25A', suerte: '25A', haciendaCode: 'SE', haciendaName: 'SILENCIO', ingenioId: 'san_carlos',
    labor: 'REENCALLE', dateKey: '2026-10-25', status: 'COMPLETADA', area: 0, executedArea: 0, operatorName: op, operatorId: op, finishedAt: null, ...resto,
  } as unknown as Assignment
}
const maestro = [{ haciendaCode: 'SE', haciendaName: 'SILENCIO', suerte: '25A', area: 10.15, ingenio_id: 'san_carlos' }] as MaestroRow[]
const ha = (l: string) => l !== 'ACEQUIAS'
const todo = null

caso('dos operarios que suman justo el área: no hay aviso', () => {
  assert.deepEqual(ciclosEnExceso([fila({ op: 'A', area: 7, executedArea: 7 }), fila({ op: 'B', area: 3.15, executedArea: 3.15 })], maestro, todo, ha), [])
})

caso('el margen es de 0,02 ha: 10,17 pasa, 10,18 avisa', () => {
  assert.equal(MARGEN_AREA, 0.02)
  assert.equal(ciclosEnExceso([fila({ op: 'A', executedArea: 7 }), fila({ op: 'B', executedArea: 3.17 })], maestro, todo, ha).length, 0)
  const r = ciclosEnExceso([fila({ op: 'A', executedArea: 7 }), fila({ op: 'B', executedArea: 3.18 })], maestro, todo, ha)
  assert.equal(r.length, 1); cerca(r[0].exceso, 0.03, 1e-6)
})

caso('tres operarios que se pasan: avisa con cuánto y quiénes', () => {
  const r = ciclosEnExceso([fila({ op: 'A', executedArea: 5 }), fila({ op: 'B', executedArea: 5 }), fila({ op: 'C', executedArea: 4 })], maestro, todo, ha)
  assert.equal(r.length, 1)
  cerca(r[0].areaOficial, 10.15); cerca(r[0].areaPagada, 14); cerca(r[0].exceso, 3.85)
  assert.deepEqual(r[0].filas.map((f) => f.operador), ['A', 'B', 'C'])
})

caso('una cerrada sin área ejecutada se paga con la asignada y también cuenta', () => {
  const r = ciclosEnExceso([fila({ op: 'A', area: 8, executedArea: 0 }), fila({ op: 'B', executedArea: 3 })], maestro, todo, ha)
  assert.equal(r.length, 1); cerca(r[0].areaPagada, 11)
})

caso('pendientes y en proceso no se pagan: no cuentan', () => {
  const r = ciclosEnExceso([fila({ op: 'A', executedArea: 10 }), fila({ op: 'B', status: 'PENDIENTE', area: 10 }), fila({ op: 'C', status: 'EN_PROCESO', executedArea: 5 })], maestro, todo, ha)
  assert.deepEqual(r, [])
})

caso('ciclos separados por más de 21 días no se suman', () => {
  const r = ciclosEnExceso([fila({ op: 'A', executedArea: 10, dateKey: '2026-08-01' }), fila({ op: 'B', executedArea: 10, dateKey: '2026-10-25' })], maestro, todo, ha)
  assert.deepEqual(r, [])
})

caso('el ciclo se encadena: 20 días entre una y otra sigue siendo el mismo', () => {
  const r = ciclosEnExceso([fila({ op: 'A', executedArea: 6, dateKey: '2026-09-01' }), fila({ op: 'B', executedArea: 3, dateKey: '2026-09-20' }), fila({ op: 'C', executedArea: 3, dateKey: '2026-10-09' })], maestro, todo, ha)
  assert.equal(r.length, 1); cerca(r[0].areaPagada, 12)
})

caso('solo avisa los ciclos que tocan el periodo pedido', () => {
  const filas = [fila({ op: 'A', executedArea: 8, dateKey: '2026-10-02' }), fila({ op: 'B', executedArea: 8, dateKey: '2026-10-05' })]
  assert.equal(ciclosEnExceso(filas, maestro, { desde: '2026-10-01', hasta: '2026-10-15' }, ha).length, 1)
  assert.equal(ciclosEnExceso(filas, maestro, { desde: '2026-10-16', hasta: '2026-10-31' }, ha).length, 0)
})

caso('hectómetros y horas no se comparan con el área', () => {
  const r = ciclosEnExceso([fila({ op: 'A', labor: 'ACEQUIAS', executedArea: 50 })], maestro, todo, ha)
  assert.deepEqual(r, [])
})

caso('sin área oficial no hay con qué comparar y no avisa', () => {
  const r = ciclosEnExceso([fila({ op: 'A', executedArea: 50 })], [], todo, ha)
  assert.deepEqual(r, [])
})

caso('el mismo nombre de hacienda y suerte en otro ingenio no se mezcla', () => {
  const dos = [...maestro, { haciendaCode: 'SE', haciendaName: 'SILENCIO', suerte: '25A', area: 5, ingenio_id: 'risaralda' }] as MaestroRow[]
  const r = ciclosEnExceso([fila({ op: 'A', executedArea: 10 }), fila({ op: 'B', executedArea: 4, ingenioId: 'risaralda' })], dos, todo, ha)
  assert.deepEqual(r, [])
})

caso('varios ciclos en exceso salen del mayor exceso al menor', () => {
  const m2 = [...maestro, { haciendaCode: 'SE', haciendaName: 'SILENCIO', suerte: '26C', area: 4, ingenio_id: 'san_carlos' }] as MaestroRow[]
  const r = ciclosEnExceso([
    fila({ op: 'A', executedArea: 12 }),
    fila({ op: 'B', executedArea: 9, suerteCode: 'SE-26C', suerte: '26C' }),
  ], m2, todo, ha)
  assert.deepEqual(r.map((x) => x.suerte), ['26C', '25A'])
})

caso('Resumen y Reporte: solo avisa los ciclos que tocan lo que la pantalla muestra, pero el total cuenta todas las filas', () => {
  const a = fila({ op: 'A', executedArea: 8 }), b = fila({ op: 'B', executedArea: 8 })
  const otra = fila({ op: 'C', executedArea: 20, suerteCode: 'SE-99Z', suerte: '99Z' })
  const m2 = [...maestro, { haciendaCode: 'SE', haciendaName: 'SILENCIO', suerte: '99Z', area: 5, ingenio_id: 'san_carlos' }] as MaestroRow[]
  const todas = [a, b, otra]
  // la pantalla muestra solo la fila de A: el ciclo de la 25A sale con las dos filas (16 ha), el de la 99Z no
  const r = ciclosEnExceso(todas, m2, todo, ha, undefined, new Set([a.id]))
  assert.equal(r.length, 1); assert.equal(r[0].suerte, '25A'); cerca(r[0].areaPagada, 16)
  // la pantalla no muestra ninguna fila de exceso: sin aviso
  assert.deepEqual(ciclosEnExceso(todas, m2, todo, ha, undefined, new Set(['no-existe'])), [])
})

caso('datos vacíos no lanzan', () => {
  assert.deepEqual(ciclosEnExceso(undefined as unknown as Assignment[], maestro, todo, ha), [])
  assert.deepEqual(ciclosEnExceso([], undefined as unknown as MaestroRow[], todo, ha), [])
})

console.log(`\n${casos} de ${casos} casos`)
