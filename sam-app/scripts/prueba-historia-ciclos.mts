import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { historiaCiclos, factorAPesosDe } from '../src/lib/fincas.ts'
import type { DatosFincas, ReferenciasSector } from '../src/services/fincasApi.ts'

const fixture = JSON.parse(readFileSync('scripts/fixtures/iyoma-datos.json', 'utf8')) as
  DatosFincas & { referencias: ReferenciasSector }
let casos = 0

function caso(nombre: string, comprobar: () => void) {
  comprobar()
  console.log(`✓ ${nombre}`)
  casos += 1
}

function copiaFixture() {
  return structuredClone(fixture)
}

function historia(d: DatosFincas, refs: ReferenciasSector | null = fixture.referencias) {
  return historiaCiclos(d.fincas[0].id, d, refs, '2026-10-24')!
}

caso('caso manual: grupos, etiquetas y costos exactos', () => {
  const d = copiaFixture()
  d.suertes = [
    { ...d.suertes[0], id: 's1', areaHa: 10 },
    { ...d.suertes[0], id: 's2', codigo: '020', areaHa: 20 },
  ]
  d.ciclos = [
    { ...d.ciclos[0], id: 'c1', suerteId: 's1', tipo: 'PLANTILLA', fechaCorte: '2020-01-01', fechaCierre: '2021-01-01', estado: 'CERRADO', datosCosecha: { tch: 100, toneladas: 1000, rendimiento: 10, sacarosa: 12, edadMeses: 12 } },
    { ...d.ciclos[0], id: 'c2', suerteId: 's2', tipo: 'PLANTILLA', fechaCorte: '2020-01-01', fechaCierre: '2021-01-02', estado: 'CERRADO', datosCosecha: { tch: 120, toneladas: 2400, rendimiento: 11, sacarosa: 13, edadMeses: 12 } },
    { ...d.ciclos[0], id: 'c3', suerteId: 's1', tipo: 'SOCA', fechaCorte: '2021-01-01', fechaCierre: '2022-01-01', estado: 'CERRADO', datosCosecha: { tch: 80, toneladas: 800, rendimiento: 9, sacarosa: 11, edadMeses: 12 } },
    { ...d.ciclos[0], id: 'c4', suerteId: 's2', tipo: 'SOCA', fechaCorte: '2021-01-02', fechaCierre: '2022-01-02', estado: 'CERRADO', datosCosecha: { tch: 90, toneladas: 1800, rendimiento: 10, sacarosa: 12, edadMeses: 12 } },
  ]
  d.labores = []
  d.movimientos = [
    { ...d.movimientos[0], id: 'm1', fincaId: d.fincas[0].id, suerteId: 's1', fecha: '2020-04-01', valor: 1000000 },
    { ...d.movimientos[0], id: 'm2', fincaId: d.fincas[0].id, suerteId: 's2', fecha: '2020-04-01', valor: 3000000 },
    { ...d.movimientos[0], id: 'm3', fincaId: d.fincas[0].id, suerteId: 's1', fecha: '2021-04-01', valor: 2000000 },
    { ...d.movimientos[0], id: 'm4', fincaId: d.fincas[0].id, suerteId: 's2', fecha: '2021-04-01', valor: 4000000 },
  ]
  const refs = { ...fixture.referencias, costos: { ...fixture.referencias.costos!, kgAzucarTc: 50 }, inflacion: { fuente: 'test', ipcAnual: { 2021: 0, 2022: 0 } } }
  const h = historiaCiclos(d.fincas[0].id, d, refs, '2026-10-24')!
  assert.equal(h.filas.length, 2)
  assert.equal(h.filas[0].etiqueta, 'Plantilla')
  assert.equal(h.filas[0].tch, (100 * 10 + 120 * 20) / 30)
  assert.equal(h.filas[0].costoHa, 4000000 / 30)
  assert.equal(h.filas[0].costoT, 4000000 / 3400)
  assert.equal(h.filas[0].costoKg, (4000000 / 3400) / 58)
  assert.equal(h.filas[1].etiqueta, 'Soca 1')
  assert.equal(h.filas[1].costoHa, 6000000 / 30)
  assert.equal(h.filas[1].costoT, 6000000 / 2600)
  assert.equal(h.filas[1].costoKg, (6000000 / 2600) / 58)
})

caso('una renovación (nueva plantilla) reinicia el conteo de cortes', () => {
  // Concepto del cliente: el ciclo va de renovación a renovación; cada fila es un corte.
  const d = copiaFixture()
  d.suertes = [{ ...d.suertes[0], id: 's1', areaHa: 10 }]
  const corte = (id: string, tipo: 'PLANTILLA' | 'SOCA', desde: string, hasta: string) =>
    ({ ...d.ciclos[0], id, suerteId: 's1', tipo, fechaCorte: desde, fechaCierre: hasta, estado: 'CERRADO' as const, datosCosecha: { tch: 100, toneladas: 1000 } })
  d.ciclos = [
    corte('p1', 'PLANTILLA', '2019-01-01', '2020-02-01'),
    corte('s1a', 'SOCA', '2020-02-01', '2021-02-01'),
    corte('s2a', 'SOCA', '2021-02-01', '2022-02-01'),
    corte('p2', 'PLANTILLA', '2022-03-01', '2023-04-01'),
    corte('s1b', 'SOCA', '2023-04-01', '2024-04-01'),
  ]
  d.labores = []
  d.movimientos = []
  const h = historia(d)
  assert.deepEqual(h.filas.map(f => f.etiqueta), ['Plantilla', 'Soca 1', 'Soca 2', 'Plantilla', 'Soca 1'])
})

caso('IPC compuesto exacto e incompleto', () => {
  assert.equal(factorAPesosDe(2022, 2025, { 2023: 9.28, 2024: 5.2, 2025: 5.1 }), 1.0928 * 1.052 * 1.051)
  assert.equal(factorAPesosDe(2022, 2025, { 2023: 9.28, 2025: 5.1 }), null)
  const d = copiaFixture()
  const refs = { ...fixture.referencias, inflacion: { fuente: 'incompleto', ipcAnual: { 2025: 5.1 } } }
  const h = historia(d, refs)
  assert.equal(h.faltaIpc, true)
})

caso('sin inflación, las columnas de hoy y el año base son null', () => {
  const refs = { ...fixture.referencias, inflacion: null }
  const h = historia(copiaFixture(), refs)
  assert.equal(h.anioBase, null)
  for (const fila of h.filas) {
    assert.equal(fila.costoHoy, null)
    assert.equal(fila.costoHaHoy, null)
    assert.equal(fila.costoTHoy, null)
    assert.equal(fila.costoKgHoy, null)
  }
})

caso('costos compartidos se reparten entre ciclos vivos por área', () => {
  const d = copiaFixture()
  const ciclos = d.ciclos.filter(c => c.estado === 'CERRADO').slice(0, 2)
  d.suertes = d.suertes.filter(s => ciclos.some(c => c.suerteId === s.id))
  const primero = { ...ciclos[0], fechaCorte: '2021-01-01', fechaCierre: '2022-01-01' }
  const segundo = { ...ciclos[1], fechaCorte: '2021-01-01', fechaCierre: '2023-01-01' }
  d.ciclos = [primero, segundo]
  d.labores = []
  d.movimientos = [{ ...d.movimientos[0], fincaId: d.fincas[0].id, tipo: 'HONORARIO', suerteId: null, laborId: null, fecha: '2021-06-01', valor: 900000 }, { ...d.movimientos[0], id: 'shared', fincaId: d.fincas[0].id, tipo: 'GASTO', suerteId: null, laborId: null, fecha: '2021-06-01', valor: 300000 }]
  const h = historia(d)
  const areaPrimero = d.suertes.find(s => s.id === primero.suerteId)!.areaHa
  const areaSegundo = d.suertes.find(s => s.id === segundo.suerteId)!.areaHa
  assert.equal(h.filas.find(f => f.anio === 2022)!.costo, 1200000 * areaPrimero / (areaPrimero + areaSegundo))
  assert.equal(h.filas.find(f => f.anio === 2023)!.costo, 1200000 * areaSegundo / (areaPrimero + areaSegundo))
})

caso('anticipos y movimientos anulados no son costo', () => {
  const d = copiaFixture()
  const c = d.ciclos.find(x => x.estado === 'CERRADO')!
  d.movimientos = [
    { ...d.movimientos[0], fincaId: d.fincas[0].id, suerteId: c.suerteId, fecha: c.fechaCorte, tipo: 'ANTICIPO', valor: 999999999 },
    { ...d.movimientos[0], id: 'anulado', fincaId: d.fincas[0].id, suerteId: c.suerteId, fecha: c.fechaCorte, anulado: true, valor: 999999999 },
  ]
  assert.equal(historia(d).filas.find(f => f.anio === Number(c.fechaCierre!.slice(0, 4)))!.costo, 0)
})

caso('movimientos de otra finca no contaminan la historia', () => {
  const d = copiaFixture()
  const c = d.ciclos.find(x => x.estado === 'CERRADO')!
  d.movimientos.push(
    { ...d.movimientos[0], id: 'otra-finca-gasto', fincaId: 'otra', suerteId: null, tipo: 'GASTO', valor: 500000000 },
    { ...d.movimientos[0], id: 'otro-honorario', fincaId: 'otra', suerteId: null, tipo: 'HONORARIO', valor: 500000000 },
  )
  const antes = historia(d).filas.find(f => f.anio === Number(c.fechaCierre!.slice(0, 4)))!.costo
  d.movimientos = d.movimientos.filter(m => m.fincaId !== 'otra')
  assert.equal(historia(d).filas.find(f => f.anio === Number(c.fechaCierre!.slice(0, 4)))!.costo, antes)
})

caso('ciclo sin cosecha conserva su costo y no infla el costo por tonelada', () => {
  const d = copiaFixture()
  const agrupados = d.ciclos.filter(c => c.estado === 'CERRADO' && c.fechaCierre?.startsWith('2021'))
  const cicloSinDatos = agrupados[0]
  const cosechado = agrupados[1]
  d.ciclos = [cicloSinDatos, cosechado]
  d.suertes = d.suertes.filter(s => s.id === cicloSinDatos.suerteId || s.id === cosechado.suerteId)
  cicloSinDatos.datosCosecha = null
  const costoCosechado = 1000000
  d.movimientos = [
    { ...d.movimientos[0], id: 'cosechado', fincaId: d.fincas[0].id, suerteId: cosechado.suerteId, fecha: cosechado.fechaCorte, valor: costoCosechado },
    { ...d.movimientos[0], id: 'sin-cosecha', fincaId: d.fincas[0].id, suerteId: cicloSinDatos.suerteId, fecha: cicloSinDatos.fechaCorte, valor: 9000000 },
  ]
  const f = historia(d).filas.find(x => x.anio === 2021)!
  assert.equal(f.tch, cosechado.datosCosecha!.tch)
  assert.equal(f.costo, 10000000)
  assert.equal(f.costoT, costoCosechado / cosechado.datosCosecha!.toneladas)
  const soloSinCosecha = structuredClone(d)
  soloSinCosecha.ciclos = [cicloSinDatos]
  soloSinCosecha.movimientos = soloSinCosecha.movimientos.filter(m => m.suerteId === cicloSinDatos.suerteId)
  const filaSinCosecha = historia(soloSinCosecha).filas[0]
  assert.equal(filaSinCosecha.tch, null)
  assert.equal(filaSinCosecha.costoT, null)
  assert.ok(filaSinCosecha.costo > 0)
})

caso('fixture IYOMA: seis filas, fechas y precios 2026 mayores', () => {
  const h = historia(fixture)
  assert.equal(h.filas.length, 6)
  assert.deepEqual(h.filas.filter(f => !f.enCurso).map(f => f.anio), [2021, 2022, 2023, 2024, 2025])
  assert.equal(h.filas.at(-1)?.clave, 'en-curso')
  for (const suerte of fixture.suertes) {
    const ciclos = fixture.ciclos.filter(c => c.suerteId === suerte.id).sort((a, b) => a.fechaCorte.localeCompare(b.fechaCorte))
    const ultimoCorte = ciclos.filter(c => c.estado === 'CERRADO').at(-1)!.fechaCierre!
    assert.ok(ultimoCorte >= '2025-08-01' && ultimoCorte <= '2025-12-31', `${suerte.codigo}: ${ultimoCorte}`)
    for (let i = 0; i < ciclos.length - 1; i += 1) {
      const inicio = Date.parse(`${ciclos[i].fechaCorte}T00:00:00Z`)
      const cierre = Date.parse(`${ciclos[i].fechaCierre}T00:00:00Z`)
      const meses = (cierre - inicio) / 86400000 / 30.4375
      assert.ok(i === 0 ? meses >= 13 && meses < 14 : meses >= 12.3 && meses < 13.3, `${suerte.codigo} ciclo ${i}: ${meses}`)
    }
  }
  const precioInsumo2026 = fixture.movimientos.find(m => m.tipo === 'GASTO' && m.rubro === 'insumos' && m.fecha.startsWith('2026'))!
  assert.ok(precioInsumo2026.valorUnitario > 2400000, 'insumo 2026 debe superar el valor real base de 2025')
  // La mano de obra del ciclo abierto se paga en tres partes (una por pasada de malezas), cada
  // una al salario de SU año: si alguna cae en 2026, el total por hectárea supera el real de 2025.
  for (const suerte of fixture.suertes) {
    const abierto = fixture.ciclos.find(c => c.suerteId === suerte.id && c.estado === 'ABIERTO')!
    const manoObra = fixture.movimientos
      .filter(m => m.tipo === 'GASTO' && m.rubro === 'mano_obra' && m.suerteId === suerte.id && m.fecha >= abierto.fechaCorte)
    assert.ok(manoObra.some(m => m.fecha.startsWith('2026')), `${suerte.codigo}: el ciclo abierto tiene mano de obra en 2026`)
    const porHa = manoObra.reduce((total, m) => total + m.valor, 0) / suerte.areaHa
    assert.ok(porHa > 2100000, `${suerte.codigo}: mano de obra del ciclo abierto debe superar el valor real base de 2025`)
  }
  console.log('  año | corte | nominal | hoy')
  for (const f of h.filas) console.log(`  ${f.clave} | ${f.etiqueta} | ${Math.round(f.costo)} | ${f.costoHoy === null ? 'null' : Math.round(f.costoHoy)}`)
})

caso('costos reales recuperados dentro de ±3 %', () => {
  const h = historia(fixture)
  for (const fila of h.filas.filter(f => !f.enCurso)) {
    const ciclos = fixture.ciclos.filter(c => c.estado === 'CERRADO' && c.fechaCierre?.startsWith(String(fila.anio)))
    let costoRealEsperado = 0
    let convertido = 0
    for (const ciclo of ciclos) {
      const suerte = fixture.suertes.find(s => s.id === ciclo.suerteId)!
      const plantilla = ciclo.tipo === 'PLANTILLA'
      const realPorHa = 2400000 + 1600000 + 700000 + 400000 + 300000 + 200000 +
        (plantilla ? 2800000 + 2400000 + 600000 : 0) - (fila.anio === 2022 ? 2400000 : 0)
      costoRealEsperado += realPorHa * suerte.areaHa
      for (const m of fixture.movimientos.filter(x => x.tipo === 'GASTO' && x.suerteId === ciclo.suerteId && x.fecha >= ciclo.fechaCorte && x.fecha < ciclo.fechaCierre! && x.rubro !== 'mano_obra' && !(x.rubro === 'insumos' && fila.anio === 2022))) {
        const factor = factorAPesosDe(Number(m.fecha.slice(0, 4)), 2025, fixture.referencias.inflacion!.ipcAnual)!
        convertido += m.valor * factor
      }
    }
    // El ruido independiente es ±7 % por movimiento y cada cosecha acumula decenas de movimientos.
    assert.ok(Math.abs(convertido - costoRealEsperado) <= costoRealEsperado * 0.03, `${fila.anio}: ${convertido} vs ${costoRealEsperado}`)
  }
})

caso('saldo final de caja positivo y menor a $30 M', () => {
  const caja = fixture.movimientos.reduce((saldo, m) => saldo + (m.tipo === 'ANTICIPO' ? m.valor : m.tipo === 'GASTO' || m.tipo === 'HONORARIO' ? -m.valor : 0), 0)
  assert.ok(caja > 0 && caja < 30000000, `saldo: ${caja}`)
  console.log(`  saldo: $${caja.toLocaleString('es-CO')}`)
})

console.log(`Casos aprobados: ${casos}`)
