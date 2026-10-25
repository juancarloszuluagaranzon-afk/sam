import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { presupuestoFinca, presupuestoLabor } from '../src/lib/fincas.ts'
import type { DatosFincas, LaborCiclo, Movimiento } from '../src/services/fincasApi.ts'

const fixture = JSON.parse(readFileSync('scripts/fixtures/iyoma-datos.json', 'utf8')) as DatosFincas
let casos = 0

function caso(nombre: string, comprobar: () => void) {
  comprobar()
  console.log(`✓ ${nombre}`)
  casos += 1
}

function labor(cambios: Partial<LaborCiclo> = {}): LaborCiclo {
  return {
    id: 'l1', cicloId: 'c1', labor: 'LABOR', unidad: 'ha', cantidadPlan: 10, costoUnitarioPlan: 100,
    pasadasPlan: 1, costoAparteUnitarioPlan: 0, ventanaIdeal: null, ventanaNormal: null,
    estado: 'PROGRAMADA', anuladaMotivo: null, orden: 1, repetible: false, ...cambios,
  }
}

function movimiento(cambios: Partial<Movimiento> = {}): Movimiento {
  return {
    id: 'm1', fincaId: 'f1', tipo: 'GASTO', fecha: '2026-01-01', concepto: 'Gasto', suerteId: 's1',
    laborId: null, reporteId: null, cantidad: 1, unidad: 'ha', valorUnitario: null, valor: 100,
    soporteUrl: null, registradoPor: 'U1', anulado: false, anuladoPor: null, anuladoMotivo: null,
    createdAt: '2026-01-01', ...cambios,
  }
}

function datos(labores: LaborCiclo[], movimientos: Movimiento[] = []): DatosFincas {
  const d = structuredClone(fixture)
  d.fincas = [{ ...d.fincas[0], id: 'f1' }]
  d.suertes = [{ ...d.suertes[0], id: 's1', fincaId: 'f1', activa: true, areaHa: 10 }]
  d.ciclos = [{ ...d.ciclos[0], id: 'c1', suerteId: 's1', estado: 'ABIERTO', fechaCorte: '2026-01-01' }]
  d.labores = labores
  d.movimientos = movimientos
  return d
}

caso('una pasada sin costo aparte conserva el cálculo anterior', () => {
  assert.deepEqual(presupuestoLabor(labor()), { servicio: 1000, aparte: 0, total: 1000 })
})

caso('tres pasadas y costo aparte se multiplican por pasada', () => {
  assert.deepEqual(presupuestoLabor(labor({ repetible: true, pasadasPlan: 3 })), { servicio: 3000, aparte: 0, total: 3000 })
  assert.deepEqual(presupuestoLabor(labor({ repetible: true, pasadasPlan: 3, costoAparteUnitarioPlan: 40 })), { servicio: 3000, aparte: 1200, total: 4200 })
})

caso('varias suertes y fincas no mezclan presupuestos ni gastos', () => {
  const d = datos([labor()])
  d.suertes.push({ ...d.suertes[0], id: 's2', codigo: '002' }, { ...d.suertes[0], id: 's3', fincaId: 'otra', codigo: '003' })
  d.ciclos.push({ ...d.ciclos[0], id: 'c2', suerteId: 's2' }, { ...d.ciclos[0], id: 'c3', suerteId: 's3' })
  d.labores.push(labor({ id: 'l2', cicloId: 'c2', cantidadPlan: 20 }), labor({ id: 'l3', cicloId: 'c3', cantidadPlan: 999 }))
  d.movimientos = [movimiento({ valor: 40 }), movimiento({ id: 'm2', suerteId: 's3', valor: 9000 })]
  assert.equal(presupuestoFinca('f1', d).presupuesto, 3000)
  assert.equal(presupuestoFinca('f1', d).ejecutado, 40)
})

caso('desglosa servicio por reporte y aparte por gasto manual; ignora anulados', () => {
  const p = presupuestoFinca('f1', datos([labor()], [
    movimiento({ valor: 60, reporteId: 'r1' }), movimiento({ id: 'm2', valor: 40 }),
    movimiento({ id: 'm3', valor: 900, anulado: true, reporteId: 'r2' }),
  ]))
  assert.equal(p.ejecutado, 100)
  assert.equal(p.ejecutadoServicio, 60)
  assert.equal(p.ejecutadoAparte, 40)
})

caso('labor anulada no presupone y caché antigua no produce NaN', () => {
  const anulada = labor({ estado: 'ANULADA', cantidadPlan: 1000 })
  const vieja = labor()
  delete (vieja as Partial<LaborCiclo>).pasadasPlan
  delete (vieja as Partial<LaborCiclo>).costoAparteUnitarioPlan
  const p = presupuestoFinca('f1', datos([anulada, vieja]))
  assert.equal(p.presupuesto, 1000)
  assert.equal(Number.isNaN(p.presupuesto), false)
})

caso('IYOMA: presupuesto $396.418.750 y 90 %', () => {
  const d = structuredClone(fixture)
  const planes = [
    ['ROTURACIÓN', 225000, 0, 1, false],
    ['FERTILIZACIÓN', 160000, 2490000, 1, false],
    ['CONTROL DE MALEZAS', 120000, 980000, 3, true],
    ['RIEGO', 0, 125000, 8, true],
  ] as const
  d.labores = d.ciclos.filter(c => c.estado === 'ABIERTO').flatMap((c, ciclo) => {
    const suerte = d.suertes.find(s => s.id === c.suerteId)!
    return planes.map(([nombre, tarifa, aparte, pasadas, repetible], i) => labor({
      id: `iyoma-${ciclo}-${i}`, cicloId: c.id, labor: nombre, cantidadPlan: suerte.areaHa,
      costoUnitarioPlan: tarifa, costoAparteUnitarioPlan: aparte, pasadasPlan: pasadas, repetible,
    }))
  })
  const p = presupuestoFinca(d.fincas[0].id, d)
  assert.equal(p.presupuesto, 396_418_750)
  assert.equal(p.pct, 90)
})

console.log(`Casos aprobados: ${casos}`)
