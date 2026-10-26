import assert from 'node:assert/strict'
import { areaPagada, progresoSuerte } from '../src/lib/progresoSuerte.ts'
import type { Assignment } from '../src/domain/sam.ts'

let casos = 0
function caso(nombre: string, fn: () => void) { fn(); console.log(`✓ ${nombre}`); casos++ }
const cerca = (a: number, b: number, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b}`)

let seq = 0
function fila(p: Partial<Assignment> & { operador: string }): Assignment {
  const { operador, ...resto } = p
  return {
    id: `a${++seq}`, suerteCode: 'SE-25A', labor: 'REENCALLE', dateKey: '2026-10-26', status: 'PENDIENTE',
    area: 0, executedArea: 0, operatorId: operador, ...resto,
  } as unknown as Assignment
}

// El caso real de Jon Arana (26-oct-2026): suerte de 10,15 ha, Edier anotó 7 y se programó el resto.
const edier = () => fila({ operador: 'U035', status: 'COMPLETADA', area: 7, executedArea: 7, dateKey: '2026-10-25' })

caso('Jon: con el área oficial le quedan 3,15 ha y la tarjeta se ve', () => {
  const e = edier(), jon = fila({ operador: 'U018', area: 3.15 })
  const p = progresoSuerte(jon, [e, jon], 10.15)
  cerca(p.remaining, 3.15); cerca(p.executedTotal, 7); assert.equal(p.hasSharedProgress, true)
})

caso('Jon: con 10,15 asignadas (el arreglo de hoy) también le quedan 3,15', () => {
  const e = edier(), jon = fila({ operador: 'U018', area: 10.15 })
  cerca(progresoSuerte(jon, [e, jon], 10.15).remaining, 3.15)
  cerca(progresoSuerte(jon, [e, jon], null).remaining, 3.15) // y sin maestro también (máximo del ciclo)
})

caso('el error de antes: sin área oficial y con 3,15 asignadas daba 0 (queda solo como respaldo)', () => {
  const e = edier(), jon = fila({ operador: 'U018', area: 3.15 })
  cerca(progresoSuerte(jon, [e, jon], null).remaining, 0)
})

caso('si otros ya cerraron toda la suerte, la tarjeta pendiente queda en 0', () => {
  const a = fila({ operador: 'U1', status: 'COMPLETADA', area: 10.15, executedArea: 10.15 })
  const b = fila({ operador: 'U2', area: 3.15 })
  cerca(progresoSuerte(b, [a, b], 10.15).remaining, 0)
})

caso('dos o tres operarios: cada uno consume lo que hizo el otro', () => {
  const a = fila({ operador: 'U1', status: 'COMPLETADA', area: 4, executedArea: 4 })
  const b = fila({ operador: 'U2', status: 'PARCIAL', area: 4, executedArea: 4 })
  const c = fila({ operador: 'U3', area: 2.15 })
  const p = progresoSuerte(c, [a, b, c], 10.15)
  cerca(p.remaining, 2.15); cerca(p.sharedExecuted, 8)
})

caso('lo ejecutado de otro operario EN_PROCESO no cierra la tarjeta de un tercero', () => {
  const a = fila({ operador: 'U1', status: 'EN_PROCESO', area: 10.15, executedArea: 6 })
  const b = fila({ operador: 'U2', area: 10.15 })
  cerca(progresoSuerte(b, [a, b], 10.15).remaining, 10.15)
  cerca(progresoSuerte(a, [a, b], 10.15).remaining, 4.15) // la propia sí cuenta su avance
})

caso('un re-laboreo meses después es otro ciclo: no consume el área del nuevo', () => {
  const viejo = fila({ operador: 'U1', status: 'COMPLETADA', area: 10.15, executedArea: 10.15, dateKey: '2026-07-01' })
  const nuevo = fila({ operador: 'U2', area: 10.15, dateKey: '2026-10-26' })
  cerca(progresoSuerte(nuevo, [viejo, nuevo], 10.15).remaining, 10.15)
})

caso('otra suerte u otra labor no cuentan', () => {
  const otra = fila({ operador: 'U1', status: 'COMPLETADA', area: 10.15, executedArea: 10.15, suerteCode: 'SE-26C' })
  const otraLabor = fila({ operador: 'U1', status: 'COMPLETADA', area: 10.15, executedArea: 10.15, labor: 'DESPEJE' })
  const mia = fila({ operador: 'U2', area: 10.15 })
  cerca(progresoSuerte(mia, [otra, otraLabor, mia], 10.15).remaining, 10.15)
})

caso('una cerrada sin área ejecutada se cuenta con su área asignada, como la planilla', () => {
  const a = fila({ operador: 'U1', status: 'COMPLETADA', area: 6, executedArea: 0 })
  assert.equal(areaPagada(a), 6)
  const b = fila({ operador: 'U2', area: 10.15 })
  cerca(progresoSuerte(b, [a, b], 10.15).remaining, 4.15)
  assert.equal(areaPagada(fila({ operador: 'U', status: 'PENDIENTE', area: 6, executedArea: 0 })), 0)
})

caso('lo hecho de más nunca da un restante negativo', () => {
  const a = fila({ operador: 'U1', status: 'COMPLETADA', area: 12, executedArea: 12 })
  const b = fila({ operador: 'U2', area: 3 })
  assert.equal(progresoSuerte(b, [a, b], 10.15).remaining, 0)
})

caso('sin área oficial el respaldo es la mayor asignada y las canceladas no cuentan', () => {
  const grande = fila({ operador: 'U1', status: 'CANCELADA', area: 50 })
  const a = fila({ operador: 'U2', status: 'COMPLETADA', area: 8, executedArea: 8 })
  const b = fila({ operador: 'U3', area: 3 })
  const p = progresoSuerte(b, [grande, a, b], null)
  cerca(p.suerteTotalArea, 8); cerca(p.remaining, 0)
  cerca(progresoSuerte(b, [grande, a, b], 0).suerteTotalArea, 8) // área 0 = sin dato
})

caso('el nombre de la labor no distingue mayúsculas ni espacios', () => {
  const a = fila({ operador: 'U1', status: 'COMPLETADA', area: 7, executedArea: 7, labor: ' reencalle ' })
  const b = fila({ operador: 'U2', area: 3.15 })
  cerca(progresoSuerte(b, [a, b], 10.15).remaining, 3.15)
})

console.log(`\n${casos} de ${casos} casos`)
