import assert from 'node:assert/strict'
import { duracionPlan, fraccionPlan, semaforoIndice, tableroCorte } from '../src/lib/tableroCorte.ts'
import { diasEntre, presupuestoFinca } from '../src/lib/fincas.ts'
import type { Ciclo, DatosFincas, LaborCiclo, Movimiento, ReporteCampo, SuerteFinca } from '../src/services/fincasApi.ts'

let casos = 0
function caso(nombre: string, fn: () => void) { fn(); console.log(`✓ ${nombre}`); casos++ }
const cerca = (a: number | null, b: number, tol = 1) => { assert.notEqual(a, null); assert.ok(Math.abs(a! - b) <= tol, `${a} != ${b} ±${tol}`) }

const HOY = '2026-10-26'
const FINCA = 'f1'
// IYOMA PRUEBAS, como está en la base (25-oct-2026)
const SU: [string, number, string, number][] = [
  ['010', 14.68, '2025-12-16', 20], ['020', 11.47, '2025-11-18', 7], ['030', 9.06, '2025-11-14', 11], ['040', 13.34, '2025-11-08', 20], ['050', 6.7, '2025-11-11', 7],
]
const LABS: { labor: string; serv: number; ppto: number; pas: number; rep: boolean; ideal: number | null }[] = [
  { labor: 'ROTURACIÓN', serv: 225000, ppto: 0, pas: 1, rep: false, ideal: 16 },
  { labor: 'FERTILIZACIÓN', serv: 160000, ppto: 2490000, pas: 1, rep: false, ideal: -1 }, // -1 = el de la suerte
  { labor: 'CONTROL DE MALEZAS', serv: 120000, ppto: 980000, pas: 3, rep: true, ideal: null },
  { labor: 'RIEGO', serv: 0, ppto: 125000, pas: 8, rep: true, ideal: null },
]

function armar(opts: { avanceRiego?: number; gastoSinLabor?: number; ideal?: Record<string, number | null>; hecho?: boolean } = {}): DatosFincas {
  const avRiego = opts.avanceRiego ?? 0.75
  const suertes: SuerteFinca[] = [], ciclos: Ciclo[] = [], labores: LaborCiclo[] = [], reportes: ReporteCampo[] = [], movimientos: Movimiento[] = []
  for (const [cod, area, corte, idealFert] of SU) {
    suertes.push({ id: `s${cod}`, fincaId: FINCA, codigo: cod, areaHa: area, variedad: null, activa: true, datosIngenio: null } as SuerteFinca)
    ciclos.push({ id: `c${cod}`, suerteId: `s${cod}`, fechaCorte: corte, tipo: 'SOCA', estado: 'ABIERTO', fechaCierre: null, datosCosecha: null } as Ciclo)
    LABS.forEach((l, i) => {
      const id = `l${cod}-${i}`
      const ideal = l.ideal === -1 ? idealFert : l.ideal
      const ventana = opts.ideal && l.labor in opts.ideal ? opts.ideal[l.labor] : ideal
      labores.push({
        id, cicloId: `c${cod}`, labor: l.labor, unidad: 'ha', cantidadPlan: area, costoUnitarioPlan: l.serv, pasadasPlan: l.pas,
        costoAparteUnitarioPlan: l.ppto, ventanaIdeal: ventana, ventanaNormal: ventana == null ? null : ventana + 20,
        estado: 'EN_CURSO', anuladaMotivo: null, orden: i * 10, repetible: l.rep,
      } as LaborCiclo)
      const frac = l.labor === 'RIEGO' ? avRiego : (opts.hecho === false && i < 2 ? 0 : 1)
      reportes.push({ id: `r${cod}-${i}`, laborId: id, cantidad: area * l.pas * frac, fecha: '2026-03-01', estado: 'ACEPTADO' } as ReporteCampo)
    })
    movimientos.push({ id: `ml${cod}`, fincaId: FINCA, tipo: 'GASTO', fecha: '2026-01-15', concepto: 'servicio', suerteId: `s${cod}`, laborId: `l${cod}-0`, reporteId: null, valor: 225000 * area, anulado: false } as Movimiento)
    movimientos.push({ id: `ms${cod}`, fincaId: FINCA, tipo: 'GASTO', fecha: '2026-05-20', concepto: 'insumos', suerteId: `s${cod}`, laborId: null, reporteId: null, valor: opts.gastoSinLabor ?? 60_000_000, anulado: false } as Movimiento)
  }
  return { fincas: [{ id: FINCA, nombre: 'IYOMA PRUEBAS' }], suertes, ciclos, labores, reportes, movimientos, paquete: [] } as unknown as DatosFincas
}

caso('sin corte abierto no hay tablero', () => {
  const d = armar(); d.ciclos = d.ciclos.map((c) => ({ ...c, estado: 'CERRADO' as const }))
  assert.equal(tableroCorte(FINCA, d, HOY).hay, false)
  assert.equal(tableroCorte('otra', armar(), HOY).hay, false)
})

caso('presupuesto: 7.175.000 por ha × 55,25 ha', () => {
  const t = tableroCorte(FINCA, armar(), HOY)
  cerca(t.hectareas, 55.25, 0.001)
  cerca(t.presupuesto, 396_418_750, 1)
  cerca(t.presupuestoPorHa, 7_175_000, 1)
})

caso('valor ganado: todo lo hecho vale su presupuesto y el riego al 75 %', () => {
  const t = tableroCorte(FINCA, armar(), HOY)
  cerca(t.valorGanado, 55.25 * (225000 + 2650000 + 3300000 + 0.75 * 1000000), 2)
})

caso('ejecutado es el mismo número que `presupuestoFinca`', () => {
  const d = armar()
  const t = tableroCorte(FINCA, d, HOY)
  assert.equal(t.ejecutado, presupuestoFinca(FINCA, d).ejecutado)
  cerca(t.ejecutado, 225000 * 55.25 + 5 * 60_000_000, 1)
})

caso('plan a la fecha: lo de una vez ya está completo y lo repetible va a 365 días', () => {
  const t = tableroCorte(FINCA, armar(), HOY)
  const esperado = SU.reduce((s, [, area, corte]) => s + area * (225000 + 2650000 + 4300000 * Math.min(1, diasEntre(corte, HOY) / 365)), 0)
  cerca(t.planAFecha, esperado, 2)
})

caso('índices y proyección al cierre', () => {
  const t = tableroCorte(FINCA, armar(), HOY)
  cerca(t.cpi, t.valorGanado / t.ejecutado, 1e-9)
  cerca(t.spi, t.valorGanado / t.planAFecha, 1e-9)
  cerca(t.variacionCosto, t.valorGanado - t.ejecutado, 1)
  cerca(t.proyeccion, t.ejecutado + (t.presupuesto - t.valorGanado) / t.cpi!, 1)
})

caso('curva S: parte de cero, termina en el presupuesto y lo real corta en hoy', () => {
  const t = tableroCorte(FINCA, armar(), HOY)
  assert.equal(t.curva[0].fecha, '2025-11-08')
  assert.equal(t.curva[0].plan, 0)
  cerca(t.curva[t.curva.length - 1].plan, t.presupuesto, 1)
  const hoyP = t.curva.find((p) => p.fecha === HOY)!
  assert.ok(hoyP); cerca(hoyP.real, t.ejecutado, 1)
  assert.ok(t.curva.filter((p) => p.fecha > HOY).every((p) => p.real === null))
  assert.ok(t.curva.every((p, i) => i === 0 || p.plan >= t.curva[i - 1].plan - 1e-6))
  const reales = t.curva.filter((p) => p.real !== null).map((p) => p.real!)
  assert.ok(reales.every((v, i) => i === 0 || v >= reales[i - 1] - 1e-6))
  assert.equal(t.fin, '2026-12-16')
})

caso('alerta de riego atrasado y de gastos sin labor', () => {
  const t = tableroCorte(FINCA, armar(), HOY)
  assert.ok(t.alertas.some((a) => a.nivel === 'ojo' && /^Riego va al 75 %/.test(a.texto)), JSON.stringify(t.alertas))
  const sinLabor = t.alertas.find((a) => a.soloAdmin)!
  assert.ok(sinLabor && /5 gastos por/.test(sinLabor.texto))
  assert.equal(t.gastosSinLabor.n, 5)
  cerca(t.gastosSinLabor.valor, 300_000_000, 1)
  assert.ok(t.alertas.some((a) => a.nivel === 'ok' && /ventana/.test(a.texto)))
})

caso('sin gastos grandes sin labor no se alerta de eso', () => {
  const t = tableroCorte(FINCA, armar({ gastoSinLabor: 1000 }), HOY)
  assert.equal(t.alertas.some((a) => a.soloAdmin), false)
})

caso('por labor: se juntan las suertes y el riego queda en curso/atrasado', () => {
  const t = tableroCorte(FINCA, armar(), HOY)
  assert.deepEqual(t.labores.map((l) => l.labor), ['ROTURACIÓN', 'FERTILIZACIÓN', 'CONTROL DE MALEZAS', 'RIEGO'])
  const riego = t.labores.find((l) => l.labor === 'RIEGO')!
  cerca(riego.avance, 0.75, 1e-9)
  assert.equal(riego.estado, 'atrasada')
  assert.equal(t.labores.find((l) => l.labor === 'ROTURACIÓN')!.estado, 'terminada')
  cerca(t.labores.find((l) => l.labor === 'ROTURACIÓN')!.ejecutadoLigado, 225000 * 55.25, 1)
  cerca(t.labores.reduce((s, l) => s + l.presupuesto, 0), t.presupuesto, 1)
})

caso('una labor con la ventana vencida y sin hacer da alerta roja', () => {
  const d = armar({ hecho: false })
  d.reportes = d.reportes.filter((r) => !/^r\d+-[01]$/.test(r.id)) // roturación y fertilización sin ningún reporte
  const t = tableroCorte(FINCA, d, HOY)
  const rojas = t.alertas.filter((a) => a.nivel === 'mal')
  // roturación y fertilización sin hacer en las 5 suertes: una alerta por labor, con todas sus suertes
  const vencidas = rojas.filter((a) => /ya pasó su ventana/.test(a.texto))
  assert.equal(vencidas.length, 2, JSON.stringify(rojas))
  assert.ok(vencidas.every((a) => /suertes 010, 020, 030, 040 y 050/.test(a.texto)), JSON.stringify(vencidas))
  // y como lo no avanzado no vale nada, el avance queda por debajo del plan
  assert.ok(rojas.some((a) => /SPI/.test(a.texto)))
  assert.equal(t.alertas[0].nivel, 'mal')
  assert.equal(t.labores.find((l) => l.labor === 'ROTURACIÓN')!.estado, 'atrasada')
})

caso('labores anuladas no cuentan', () => {
  const d = armar()
  d.labores = d.labores.map((l) => (l.labor === 'RIEGO' ? { ...l, estado: 'ANULADA' as const, anuladaMotivo: 'x' } : l))
  const t = tableroCorte(FINCA, d, HOY)
  cerca(t.presupuesto, 55.25 * (225000 + 2650000 + 3300000), 1)
  assert.equal(t.labores.some((l) => l.labor === 'RIEGO'), false)
})

caso('gastar más que el presupuesto da alerta roja', () => {
  const t = tableroCorte(FINCA, armar({ gastoSinLabor: 90_000_000 }), HOY)
  assert.equal(t.alertas[0].nivel, 'mal')
  assert.match(t.alertas[0].texto, /ya pasó el presupuesto/)
  assert.equal(semaforoIndice(t.cpi), 'mal')
})

caso('semáforo de los índices', () => {
  assert.deepEqual([1.2, 0.95, 0.949, 0.9, 0.89, null, NaN].map(semaforoIndice), ['ok', 'ok', 'ojo', 'ojo', 'mal', 'neutro', 'neutro'])
})

caso('duración del plan: hasta la fecha ideal, o 365 días si se repite o no hay ventana', () => {
  assert.equal(duracionPlan({ repetible: false, ventanaIdeal: 16 }), 16)
  assert.equal(duracionPlan({ repetible: true, ventanaIdeal: 16 }), 365)
  assert.equal(duracionPlan({ repetible: false, ventanaIdeal: null }), 365)
  assert.equal(fraccionPlan({ repetible: false, ventanaIdeal: 20 }, 10), 0.5)
  assert.equal(fraccionPlan({ repetible: false, ventanaIdeal: 20 }, 99), 1)
  assert.equal(fraccionPlan({ repetible: false, ventanaIdeal: 20 }, -5), 0)
})

caso('datos vacíos o sucios no lanzan', () => {
  assert.equal(tableroCorte(FINCA, undefined as unknown as DatosFincas, HOY).hay, false)
  const d = armar(); d.reportes = undefined as unknown as ReporteCampo[]; d.movimientos = undefined as unknown as Movimiento[]
  const t = tableroCorte(FINCA, d, HOY)
  assert.equal(t.ejecutado, 0); assert.equal(t.cpi, null); assert.equal(t.proyeccion, null)
})

console.log(`\n${casos} de ${casos} casos`)
