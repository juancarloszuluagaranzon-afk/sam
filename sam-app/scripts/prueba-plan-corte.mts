import assert from 'node:assert/strict'
import { ajustesParaRpc, copiarCostos, cronograma, lineasDesdeCatalogo, normVariedad, sumarDias, totalesPlan, totalLinea, validarLinea, variedadCoincide } from '../src/lib/planCorte.ts'
import type { LaborPaquete } from '../src/services/fincasApi.ts'

let casos = 0
function caso(nombre: string, fn: () => void) { fn(); console.log(`✓ ${nombre}`); casos++ }

let seq = 0
function fila(p: Partial<LaborPaquete> & { labor: string }): LaborPaquete {
  return {
    id: `p${++seq}`, unidad: 'ha', cantidadPorHa: 1, costoUnitario: 0, pasadasPlan: 1, costoAparteUnitario: 0,
    ventanaIdeal: null, ventanaNormal: null, aplica: 'AMBOS', orden: 100, activa: true, repetible: false, variedad: null, ...p,
  }
}
// Las 8 filas reales del catálogo (25-oct-2026)
const catalogo: LaborPaquete[] = [
  fila({ labor: 'ROTURACIÓN', costoUnitario: 225000, ventanaIdeal: 16, ventanaNormal: 30, aplica: 'SOCA', orden: 10 }),
  fila({ labor: 'FERTILIZACIÓN', costoUnitario: 160000, ventanaIdeal: 11, ventanaNormal: 31, aplica: 'SOCA', variedad: 'CC 11-595', orden: 20 }),
  fila({ labor: 'FERTILIZACIÓN', costoUnitario: 160000, ventanaIdeal: 20, ventanaNormal: 46, aplica: 'SOCA', variedad: 'CC 01-1940', orden: 20 }),
  fila({ labor: 'FERTILIZACIÓN', costoUnitario: 160000, ventanaIdeal: 7, ventanaNormal: 26, aplica: 'SOCA', variedad: 'CC 05-430', orden: 20 }),
  fila({ labor: 'FERTILIZACIÓN', costoUnitario: 170000, ventanaIdeal: 30, ventanaNormal: 60, aplica: 'PLANTILLA', orden: 20 }),
  fila({ labor: 'FERTILIZACIÓN', costoUnitario: 160000, ventanaIdeal: 30, ventanaNormal: 45, aplica: 'SOCA', orden: 20 }),
  fila({ labor: 'CONTROL DE MALEZAS', costoUnitario: 120000, repetible: true, orden: 30 }),
  fila({ labor: 'RIEGO', costoUnitario: 0, repetible: true, orden: 40 }),
]

caso('la variedad se compara como la base (solo letras y números)', () => {
  assert.equal(normVariedad('CC 01-1940'), 'CC011940')
  assert.equal(variedadCoincide('CC 01-1940', 'cc 01 1940'), true)
  assert.equal(variedadCoincide('CC 01-1940', 'CC 05-430'), false)
  assert.equal(variedadCoincide(null, null), true)        // fila genérica: sirve a todas
  assert.equal(variedadCoincide('CC 01-1940', null), false) // fila de variedad: la suerte debe tener la suya
  assert.equal(variedadCoincide('CC 01-1940', 'AB'), false) // muy corta para decidir
})

caso('corte de SOCA de la CC 01-1940: la fila de su variedad le gana a la genérica', () => {
  const l = lineasDesdeCatalogo(catalogo, 'SOCA', 10, 'CC 01-1940')
  assert.deepEqual(l.map((x) => x.labor), ['ROTURACIÓN', 'FERTILIZACIÓN', 'CONTROL DE MALEZAS', 'RIEGO'])
  const f = l.find((x) => x.labor === 'FERTILIZACIÓN')!
  assert.deepEqual([f.ventanaIdeal, f.ventanaNormal, f.variedadFila], [20, 46, 'CC 01-1940'])
})

caso('otras variedades toman su propia ventana', () => {
  const f = (v: string) => lineasDesdeCatalogo(catalogo, 'SOCA', 10, v).find((x) => x.labor === 'FERTILIZACIÓN')!
  assert.deepEqual([f('CC 05-430').ventanaIdeal, f('CC 05-430').ventanaNormal], [7, 26])
  assert.deepEqual([f('CC 11-595').ventanaIdeal, f('CC 11-595').ventanaNormal], [11, 31])
})

caso('sin variedad en la suerte: la fila genérica de soca', () => {
  const f = lineasDesdeCatalogo(catalogo, 'SOCA', 10, null).find((x) => x.labor === 'FERTILIZACIÓN')!
  assert.deepEqual([f.ventanaIdeal, f.ventanaNormal, f.variedadFila], [30, 45, null])
})

caso('corte de PLANTILLA: sin roturación y con la fertilización de plantilla', () => {
  const l = lineasDesdeCatalogo(catalogo, 'PLANTILLA', 10, 'CC 01-1940')
  assert.deepEqual(l.map((x) => x.labor), ['FERTILIZACIÓN', 'CONTROL DE MALEZAS', 'RIEGO'])
  assert.deepEqual([l[0].ventanaIdeal, l[0].ventanaNormal, l[0].servicio], [30, 60, 170000])
})

caso('una fila inactiva no entra al plan', () => {
  const c = catalogo.map((p) => (p.labor === 'ROTURACIÓN' ? { ...p, activa: false } : p))
  assert.equal(lineasDesdeCatalogo(c, 'SOCA', 10, null).some((x) => x.labor === 'ROTURACIÓN'), false)
})

caso('la cantidad es el área × cantidad por ha, redondeada a 2 decimales', () => {
  const c = [fila({ labor: 'SIEMBRA', cantidadPorHa: 2.5, costoUnitario: 1000 })]
  assert.equal(lineasDesdeCatalogo(c, 'SOCA', 4.1, null)[0].cantidad, 10.25)
  assert.equal(lineasDesdeCatalogo(catalogo, 'SOCA', 12.345, null)[0].cantidad, 12.35)
})

caso('totales: (servicio + ppto) × pasadas × cantidad, y por hectárea', () => {
  const l = lineasDesdeCatalogo(catalogo, 'SOCA', 10, 'CC 01-1940').map((x) =>
    x.labor === 'FERTILIZACIÓN' ? { ...x, ppto: 850000 }
    : x.labor === 'CONTROL DE MALEZAS' ? { ...x, ppto: 60000, pasadas: 3 }
    : x.labor === 'RIEGO' ? { ...x, servicio: 10000, ppto: 5000, pasadas: 4 } : x)
  // roturación 10×225.000 = 2.250.000 · fertilización 10×1.010.000 = 10.100.000
  // malezas 10×3×180.000 = 5.400.000 · riego 10×4×15.000 = 600.000
  const t = totalesPlan(l, 10)
  assert.deepEqual(t, { servicio: 2250000 + 1600000 + 3600000 + 400000, ppto: 8500000 + 1800000 + 200000, total: 18350000, porHa: 1835000, sinCosto: 0 })
  assert.equal(totalLinea(l[1]), 10100000)
})

caso('las líneas sin ningún costo se cuentan para avisar', () => {
  const t = totalesPlan(lineasDesdeCatalogo(catalogo, 'SOCA', 10, null), 10)
  assert.equal(t.sinCosto, 1) // el riego
  assert.equal(totalesPlan([], 0).porHa, null)
})

caso('copiar el corte anterior trae costos y pasadas, no cambia las ventanas', () => {
  const base = lineasDesdeCatalogo(catalogo, 'SOCA', 10, 'CC 01-1940')
  const origen = [
    { labor: 'ROTURACIÓN', unidad: 'ha', estado: 'TERMINADA', costoUnitarioPlan: 250000, costoAparteUnitarioPlan: 40000, pasadasPlan: 1 },
    { labor: 'fertilizacion', unidad: 'ha', estado: 'PROGRAMADA', costoUnitarioPlan: 170000, costoAparteUnitarioPlan: 900000, pasadasPlan: 1 },
    { labor: 'RIEGO', unidad: 'ha', estado: 'PROGRAMADA', costoUnitarioPlan: 12000, costoAparteUnitarioPlan: 8000, pasadasPlan: 5 },
    { labor: 'CONTROL DE MALEZAS', unidad: 'ha', estado: 'ANULADA', costoUnitarioPlan: 999, costoAparteUnitarioPlan: 999, pasadasPlan: 9 },
  ]
  const r = copiarCostos(base, origen)
  assert.equal(r.copiadas, 3)
  assert.deepEqual(r.sinOrigen, ['CONTROL DE MALEZAS']) // la anulada del origen no cuenta
  const rot = r.lineas.find((x) => x.labor === 'ROTURACIÓN')!
  assert.deepEqual([rot.servicio, rot.ppto], [250000, 40000])
  const fert = r.lineas.find((x) => x.labor === 'FERTILIZACIÓN')!
  assert.deepEqual([fert.servicio, fert.ppto, fert.ventanaIdeal], [170000, 900000, 20])
  assert.equal(r.lineas.find((x) => x.labor === 'RIEGO')!.pasadas, 5)
})

caso('copiar no vuelve repetible una labor que no se repite', () => {
  const base = lineasDesdeCatalogo(catalogo, 'SOCA', 10, null)
  const r = copiarCostos(base, [{ labor: 'ROTURACIÓN', unidad: 'ha', estado: 'PROGRAMADA', costoUnitarioPlan: 1, costoAparteUnitarioPlan: 0, pasadasPlan: 4 }])
  assert.equal(r.lineas.find((x) => x.labor === 'ROTURACIÓN')!.pasadas, 1)
})

caso('cronograma: fechas ideal y normal desde el corte (DDC), con ventana primero', () => {
  assert.equal(sumarDias('2026-09-01', 20), '2026-09-21')
  assert.equal(sumarDias('2026-12-20', 20), '2027-01-09')
  const c = cronograma(lineasDesdeCatalogo(catalogo, 'SOCA', 10, 'CC 01-1940'), '2026-09-01')
  assert.deepEqual(c.map((h) => h.linea.labor), ['ROTURACIÓN', 'FERTILIZACIÓN', 'CONTROL DE MALEZAS', 'RIEGO'])
  assert.deepEqual([c[0].ideal, c[0].normal], ['2026-09-17', '2026-10-01'])
  assert.deepEqual([c[1].ideal, c[1].normal], ['2026-09-21', '2026-10-17'])
  assert.deepEqual([c[2].ideal, c[3].normal], [null, null])
})

caso('el cronograma ordena por la fecha ideal aunque el orden del catálogo sea otro', () => {
  const c = cronograma(lineasDesdeCatalogo(catalogo, 'SOCA', 10, 'CC 05-430'), '2026-09-01')
  // fertilización de la 05-430 es ideal a los 7 días: va antes que la roturación (16)
  assert.deepEqual(c.slice(0, 2).map((h) => h.linea.labor), ['FERTILIZACIÓN', 'ROTURACIÓN'])
})

caso('validación de una línea', () => {
  const l = lineasDesdeCatalogo(catalogo, 'SOCA', 10, null)[0]
  assert.equal(validarLinea(l), null)
  assert.match(validarLinea({ ...l, servicio: -1 })!, /cero o más/)
  assert.match(validarLinea({ ...l, servicio: NaN })!, /cero o más/)
  assert.match(validarLinea({ ...l, pasadas: 0 })!, /al menos una pasada/)
  assert.match(validarLinea({ ...l, pasadas: 3 })!, /no se repite/)
  assert.equal(validarLinea({ ...l, repetible: true, pasadas: 3 }), null)
})

caso('lo que se manda a la base: costos limpios y pasadas coherentes', () => {
  const l = lineasDesdeCatalogo(catalogo, 'SOCA', 10, null)
  const a = ajustesParaRpc(l.map((x) => (x.labor === 'RIEGO' ? { ...x, servicio: 10000, ppto: 5000, pasadas: 4 } : { ...x, pasadas: 7 })))
  assert.deepEqual(a.find((x) => x.labor === 'RIEGO'), { labor: 'RIEGO', unidad: 'ha', costo: 10000, costo_aparte: 5000, pasadas: 4 })
  assert.equal(a.find((x) => x.labor === 'ROTURACIÓN')!.pasadas, 1) // no repetible: siempre 1
  assert.equal(a.length, 4)
})

caso('datos sucios no dan NaN ni lanzan', () => {
  assert.deepEqual(lineasDesdeCatalogo(undefined as unknown as LaborPaquete[], 'SOCA', 10, null), [])
  assert.deepEqual(totalesPlan(undefined as unknown as [], 5), { servicio: 0, ppto: 0, total: 0, porHa: 0, sinCosto: 0 })
  assert.deepEqual(copiarCostos([], undefined as unknown as []).lineas, [])
})

console.log(`\n${casos} de ${casos} casos`)
