import assert from 'node:assert/strict'
import { cuadreFactura, sumaDeLineas, totalAlVincular, TOLERANCIA_CUADRE } from '../src/lib/valorFactura.ts'
import { compararEquipos, moverElemento, ordenarPorOrdenEquipos, posicionEquipo, registrarOrdenEquipos } from '../src/lib/ordenEquipos.ts'
import { categoriaDeRol, contarPorCategoria } from '../src/lib/categoriasUsuario.ts'
import { consumoInsumoPorMaquina } from '../src/lib/insumoPorMaquina.ts'
import { consumoTanqueATanque, type Tanqueo } from '../src/lib/consumoHora.ts'
import type { InsumoKardex } from '../src/domain/sam.ts'

let casos = 0
function caso(nombre: string, fn: () => void) { fn(); console.log(`✓ ${nombre}`); casos++ }

// ── Valor de la factura ──────────────────────────────────────────────────────
caso('cuadreFactura: cuadra, faltan, se pasa y sin total', () => {
  assert.equal(cuadreFactura(35_000_000, 35_000_000).estado, 'cuadra')
  const f = cuadreFactura(35_000_000, 34_800_000)
  assert.equal(f.estado, 'faltan'); assert.equal(f.diferencia, 200_000)
  const p = cuadreFactura(35_000_000, 35_400_000)
  assert.equal(p.estado, 'se_pasa'); assert.equal(p.diferencia, -400_000)
  const s = cuadreFactura(null, 1000)
  assert.equal(s.estado, 'sin_total'); assert.equal(s.diferencia, null)
  assert.equal(cuadreFactura(undefined, 0).estado, 'sin_total')
})
caso('cuadreFactura: la tolerancia perdona centavos pero no pesos de verdad', () => {
  assert.equal(cuadreFactura(1_000_000, 1_000_000 - TOLERANCIA_CUADRE).estado, 'cuadra')
  assert.equal(cuadreFactura(1_000_000, 1_000_000 + TOLERANCIA_CUADRE).estado, 'cuadra')
  assert.equal(cuadreFactura(1_000_000, 1_000_000 - TOLERANCIA_CUADRE - 1).estado, 'faltan')
  assert.equal(cuadreFactura(1_000_000, 1_000_000 + TOLERANCIA_CUADRE + 1).estado, 'se_pasa')
})
caso('cuadreFactura: no revienta con basura (NaN, Infinity)', () => {
  assert.equal(cuadreFactura(NaN, 5).estado, 'sin_total')
  assert.equal(cuadreFactura(100, NaN).suma, 0)
  assert.equal(cuadreFactura(Infinity, 5).estado, 'sin_total')
})
caso('totalAlVincular: el caso real de la reunión (3 millones que debían ser 35)', () => {
  // La factura nació con la 1.ª finca: total = suma = 3.100.000 (automático). Se pegan más fincas.
  const r = totalAlVincular(3_100_000, 3_100_000, 35_000_000)
  assert.equal(r.automatico, true); assert.equal(r.total, 35_000_000)
})
caso('totalAlVincular: si alguien escribió el total del PDF, se respeta', () => {
  const r = totalAlVincular(35_000_000, 3_100_000, 20_000_000)
  assert.equal(r.automatico, false); assert.equal(r.total, 35_000_000)
})
caso('totalAlVincular: sin total previo toma la suma nueva; el redondeo de centavos sigue siendo automático', () => {
  assert.deepEqual(totalAlVincular(null, 0, 500_000), { total: 500_000, automatico: true })
  assert.equal(totalAlVincular(649_250.4, 649_250, 1_000_000).automatico, true)
})
caso('sumaDeLineas: las líneas sin precio no suman y se cuentan aparte (nunca un cero inventado)', () => {
  const v = new Map<string, number | null>([['a', 1000], ['b', null], ['c', 250.555]])
  const r = sumaDeLineas(['a', 'b', 'c', 'z'], (id) => v.get(id))
  assert.equal(r.sinPrecio, 2); assert.equal(r.suma, 1250.56)
  assert.deepEqual(sumaDeLineas([], () => 1), { suma: 0, sinPrecio: 0 })
})

// ── Orden de máquinas ────────────────────────────────────────────────────────
caso('compararEquipos: por posición; sin posición al final, por código numérico', () => {
  registrarOrdenEquipos([{ code: 'CASE 1303', orden: 1 }, { code: 'CASE 1302', orden: 2 }, { code: 'PUMA 2301', orden: null }, { code: 'PUMA 2302' }])
  const lista = ['PUMA 2302', 'CASE 1302', 'PUMA 2301', 'CASE 1303', 'AAA 10', 'AAA 2']
  assert.deepEqual([...lista].sort(compararEquipos), ['CASE 1303', 'CASE 1302', 'AAA 2', 'AAA 10', 'PUMA 2301', 'PUMA 2302'])
  assert.equal(posicionEquipo('case 1303'), 1)
  assert.equal(posicionEquipo('NO EXISTE'), Infinity)
})
caso('registrarOrdenEquipos reemplaza lo anterior', () => {
  registrarOrdenEquipos([{ code: 'X', orden: 5 }])
  assert.equal(posicionEquipo('CASE 1303'), Infinity); assert.equal(posicionEquipo('X'), 5)
  registrarOrdenEquipos([])
  assert.equal(posicionEquipo('X'), Infinity)
})
caso('ordenarPorOrdenEquipos no toca la lista original', () => {
  registrarOrdenEquipos([{ code: 'B', orden: 1 }, { code: 'A', orden: 2 }])
  const orig = [{ c: 'A' }, { c: 'B' }]
  assert.deepEqual(ordenarPorOrdenEquipos(orig, (x) => x.c).map((x) => x.c), ['B', 'A'])
  assert.deepEqual(orig.map((x) => x.c), ['A', 'B'])
})
caso('moverElemento: sube, baja, bordes y fuera de rango', () => {
  assert.deepEqual(moverElemento(['a', 'b', 'c', 'd'], 2, 0), ['c', 'a', 'b', 'd'])
  assert.deepEqual(moverElemento(['a', 'b', 'c', 'd'], 0, 3), ['b', 'c', 'd', 'a'])
  assert.deepEqual(moverElemento(['a', 'b'], 1, 1), ['a', 'b'])
  assert.deepEqual(moverElemento(['a', 'b'], 5, 0), ['a', 'b'])
  assert.deepEqual(moverElemento(['a', 'b'], 0, -1), ['a', 'b'])
  assert.deepEqual(moverElemento([], 0, 0), [])
})

// ── Categorías de usuario ────────────────────────────────────────────────────
caso('categoriaDeRol: los 13 roles caen en un grupo y un rol desconocido no desaparece', () => {
  const esperado: Record<string, string> = {
    operador: 'OPERATIVOS', supervisor: 'OPERATIVOS', supervisor_insumos: 'OPERATIVOS', conductor: 'OPERATIVOS', conductor_madera: 'OPERATIVOS',
    analista_insumos: 'OPERATIVOS', taller: 'OPERATIVOS', quiosco_taller: 'OPERATIVOS', dueno_finca: 'DUENOS', propietario: 'PROPIETARIOS',
    owner: 'ADMIN', administracion: 'ADMIN', soporte: 'SOPORTE',
  }
  for (const [rol, cat] of Object.entries(esperado)) assert.equal(categoriaDeRol(rol), cat, rol)
  assert.equal(categoriaDeRol('rol_nuevo'), 'OPERATIVOS'); assert.equal(categoriaDeRol(null), 'OPERATIVOS'); assert.equal(categoriaDeRol(undefined), 'OPERATIVOS')
})
caso('contarPorCategoria: los grupos suman el total (50 usuarios del 26-oct-2026)', () => {
  const rep = (role: string, n: number) => Array.from({ length: n }, () => ({ role }))
  const us = [...rep('operador', 28), ...rep('supervisor', 3), ...rep('supervisor_insumos', 2), ...rep('analista_insumos', 1), ...rep('conductor', 4),
    ...rep('conductor_madera', 1), ...rep('taller', 1), ...rep('dueno_finca', 1), ...rep('propietario', 1), ...rep('administracion', 4), ...rep('owner', 2), ...rep('soporte', 2)]
  const c = contarPorCategoria(us)
  assert.deepEqual(c, { TODOS: 50, OPERATIVOS: 40, DUENOS: 1, PROPIETARIOS: 1, ADMIN: 6, SOPORTE: 2 })
  assert.equal(c.OPERATIVOS + c.DUENOS + c.PROPIETARIOS + c.ADMIN + c.SOPORTE, c.TODOS)
  assert.equal(contarPorCategoria([]).TODOS, 0)
})

// ── Otros insumos por máquina ────────────────────────────────────────────────
const k = (o: Partial<InsumoKardex>): InsumoKardex => ({ id: 'k', insumoId: 'ROD', tipo: 'SALIDA', cantidad: 1, saldo: 0, createdAt: '2026-10-10T10:00:00-05:00', equipoCodigo: 'CASE 1302', referencia: 'r1', ...o }) as InsumoKardex
caso('consumoInsumoPorMaquina: salidas menos devoluciones, entregas por referencia y última fecha', () => {
  registrarOrdenEquipos([])
  const r = consumoInsumoPorMaquina([
    k({ id: '1', cantidad: 4, referencia: 'r1' }),
    k({ id: '2', cantidad: 2, referencia: 'r1', createdAt: '2026-10-10T10:00:01-05:00' }),   // mismo despacho (otra fila de kardex)
    k({ id: '3', cantidad: 3, referencia: 'r2', createdAt: '2026-10-18T07:00:00-05:00' }),
    k({ id: '4', tipo: 'ENTRADA', cantidad: 1, referencia: 'r3', createdAt: '2026-10-19T07:00:00-05:00' }),
    k({ id: '5', insumoId: 'OTRO', cantidad: 99 }),
    k({ id: '6', equipoCodigo: undefined, cantidad: 99 }),
    k({ id: '7', tipo: 'AJUSTE', cantidad: 99 }),
    k({ id: '8', equipoCodigo: 'PUMA 2301', cantidad: 2, referencia: 'r9' }),
  ], 'ROD')
  assert.deepEqual(r.map((f) => f.maquina), ['CASE 1302', 'PUMA 2301'])
  assert.equal(r[0].cantidad, 8); assert.equal(r[0].entregas, 2); assert.equal(r[0].ultima, '2026-10-18T07:00:00-05:00')
  assert.equal(r[1].cantidad, 2)
})
caso('consumoInsumoPorMaquina: la devolución nunca deja la cantidad negativa y sin movimientos da lista vacía', () => {
  const r = consumoInsumoPorMaquina([k({ tipo: 'SALIDA', cantidad: 1 }), k({ id: '2', tipo: 'ENTRADA', cantidad: 5, referencia: 'x' })], 'ROD')
  assert.equal(r.every((f) => f.cantidad >= 0), true)
  assert.deepEqual(consumoInsumoPorMaquina([], 'ROD'), [])
})
caso('consumoInsumoPorMaquina sigue el orden de las máquinas del usuario', () => {
  registrarOrdenEquipos([{ code: 'PUMA 2301', orden: 1 }, { code: 'CASE 1302', orden: 2 }])
  const r = consumoInsumoPorMaquina([k({ id: '1' }), k({ id: '2', equipoCodigo: 'PUMA 2301', referencia: 'r2' })], 'ROD')
  assert.deepEqual(r.map((f) => f.maquina), ['PUMA 2301', 'CASE 1302'])
  registrarOrdenEquipos([])
})

// ── Tanque que no quedó lleno ────────────────────────────────────────────────
const tq = (cuando: string, horometro: number | null, galones: number, lleno?: boolean | null): Tanqueo =>
  ({ maquina: 'CASE 1302', cuando, horometro, galones, fuente: 'Tanqueo', detalle: '', lleno })
caso('tanque a tanque: sin parciales, como siempre (85 gal en 17 h = 5 gal/h)', () => {
  const m = consumoTanqueATanque([tq('2026-10-16T06:00:00-05:00', 5407, 80), tq('2026-10-18T06:00:00-05:00', 5424, 85)], 7)
  const c = m.get('CASE 1302')!
  assert.equal(c.gastado, 85); assert.equal(c.horas, 17); assert.equal(c.galPorHora, 5)
})
caso('tanque a tanque: un parcial NO corta la cuenta, sus galones pasan al siguiente lleno (la propuesta de la reunión)', () => {
  const m = consumoTanqueATanque([
    tq('2026-10-16T06:00:00-05:00', 5407, 85, true),
    tq('2026-10-17T06:00:00-05:00', 5416, 40, false),
    tq('2026-10-18T06:00:00-05:00', 5424, 52, true),
  ], 7)
  const c = m.get('CASE 1302')!
  assert.equal(c.gastado, 92); assert.equal(c.horas, 17); assert.equal(c.galPorHora, 5.41)
  const parcial = c.tramos.find((t) => t.lleno === false)!
  assert.match(parcial.nota ?? '', /no quedó lleno/)
  assert.equal(parcial.horasDesdeAnterior, null)
  assert.equal(c.final?.horometro, 5424)
})
caso('tanque a tanque: sin el parcial el promedio salía distorsionado (el error que vio Cristian)', () => {
  const con = consumoTanqueATanque([tq('2026-10-16T06:00:00-05:00', 5407, 85), tq('2026-10-17T06:00:00-05:00', 5416, 40), tq('2026-10-18T06:00:00-05:00', 5424, 52)], 7).get('CASE 1302')!
  const sin = consumoTanqueATanque([tq('2026-10-16T06:00:00-05:00', 5407, 85, true), tq('2026-10-17T06:00:00-05:00', 5416, 40, false), tq('2026-10-18T06:00:00-05:00', 5424, 52, true)], 7).get('CASE 1302')!
  // Los dos miden el mismo tramo lleno→lleno (el parcial pasa al siguiente); la diferencia está en el tramo parcial por separado:
  assert.equal(con.gastado, sin.gastado)
  assert.equal(con.tramos.find((t) => t.galones === 40)!.horasDesdeAnterior, 9)   // antes el parcial se medía solo: 40 gal en 9 h = 4,4 gal/h
  assert.equal(sin.tramos.find((t) => t.galones === 40)!.horasDesdeAnterior, null) // ahora ya no se mide por su cuenta
})
caso('tanque a tanque: «no quedó lleno» en el ÚLTIMO tanqueo no se mide todavía; null y ausente se tratan como lleno', () => {
  const a = consumoTanqueATanque([tq('2026-10-16T06:00:00-05:00', 5407, 85, true), tq('2026-10-18T06:00:00-05:00', 5424, 52, false)], 7).get('CASE 1302')!
  assert.equal(a.gastado, null)
  assert.match(a.problema ?? '', /lleno|un solo tanqueo|ninguno antes/)
  const b = consumoTanqueATanque([tq('2026-10-16T06:00:00-05:00', 5407, 80, null), tq('2026-10-18T06:00:00-05:00', 5424, 85, undefined)], 7).get('CASE 1302')!
  assert.equal(b.gastado, 85); assert.equal(b.galPorHora, 5)
})
caso('tanque a tanque: todos parciales → mensaje claro, no un número inventado', () => {
  const c = consumoTanqueATanque([tq('2026-10-16T06:00:00-05:00', 5407, 80, false), tq('2026-10-18T06:00:00-05:00', 5424, 85, false)], 7).get('CASE 1302')!
  assert.equal(c.gastado, null); assert.equal(c.galPorHora, null)
  assert.match(c.problema ?? '', /ningún tanqueo lleno/)
})
caso('tanque a tanque: el parcial del periodo anterior no sirve de punto de partida', () => {
  const previos = [tq('2026-09-28T06:00:00-05:00', 5300, 70, true), tq('2026-09-30T06:00:00-05:00', 5390, 30, false)]
  const c = consumoTanqueATanque([tq('2026-10-03T06:00:00-05:00', 5407, 85, true)], 7, previos).get('CASE 1302')!
  assert.equal(c.inicial?.horometro, 5300)
  assert.equal(c.horas, 107)
})

console.log(`\n${casos} casos bien`)
