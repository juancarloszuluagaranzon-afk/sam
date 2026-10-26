import assert from 'node:assert/strict'
import { ayerDe, cumpleLabor, cumplePeriodo, filtrosIniciales, hayFiltroLabor, opcionesFiltros, textoPeriodo } from '../src/lib/filtrosPeriodoLabor.ts'
import type { Assignment } from '../src/domain/sam.ts'

let casos = 0
function caso(nombre: string, fn: () => void) { fn(); console.log(`✓ ${nombre}`); casos++ }

const HOY = '2026-10-26'
const base = (p: Parameters<typeof filtrosIniciales>[0], extra: Record<string, string> = {}) => ({ ...filtrosIniciales(p, HOY), ...extra })
const a = (o: Partial<Assignment>): Assignment => ({ id: 'x', haciendaCode: 'SE', haciendaName: 'SILENCIO', suerte: '25A', operatorId: 'U1', operatorName: 'ANA', ...o }) as Assignment
const ing = (x: Assignment) => (x as unknown as { ing?: string }).ing ?? null

caso('TODO no limita fechas', () => assert.equal(cumplePeriodo('2020-01-01', base('TODO'), HOY), true))

caso('HOY y AYER (incluso con cambio de mes y de año)', () => {
  assert.equal(cumplePeriodo('2026-10-26', base('HOY'), HOY), true)
  assert.equal(cumplePeriodo('2026-10-25', base('HOY'), HOY), false)
  assert.equal(cumplePeriodo('2026-10-25', base('AYER'), HOY), true)
  assert.equal(ayerDe('2026-11-01'), '2026-10-31')
  assert.equal(ayerDe('2027-01-01'), '2026-12-31')
  assert.equal(ayerDe('2026-03-01'), '2026-02-28')
})

caso('quincenas y mes del mes escogido', () => {
  const p = base('PRIMERA', { mes: '2026-08' }), s = base('SEGUNDA', { mes: '2026-08' }), m = base('MES', { mes: '2026-08' })
  assert.equal(cumplePeriodo('2026-08-15', p, HOY), true)
  assert.equal(cumplePeriodo('2026-08-16', p, HOY), false)
  assert.equal(cumplePeriodo('2026-08-16', s, HOY), true)
  assert.equal(cumplePeriodo('2026-08-31', s, HOY), true)
  assert.equal(cumplePeriodo('2026-09-01', s, HOY), false)
  assert.equal(cumplePeriodo('2026-08-01', m, HOY) && cumplePeriodo('2026-08-31', m, HOY), true)
  assert.equal(cumplePeriodo('2026-07-31', m, HOY), false)
})

caso('personalizado: desde y hasta incluyen los extremos; vacíos no limitan', () => {
  const f = base('CUSTOM', { desde: '2026-08-10', hasta: '2026-08-20' })
  assert.equal(cumplePeriodo('2026-08-10', f, HOY), true)
  assert.equal(cumplePeriodo('2026-08-20', f, HOY), true)
  assert.equal(cumplePeriodo('2026-08-09', f, HOY), false)
  assert.equal(cumplePeriodo('2026-08-21', f, HOY), false)
  assert.equal(cumplePeriodo('2020-01-01', base('CUSTOM'), HOY), true)
})

caso('labor: hacienda, suerte, operador e ingenio', () => {
  const x = { ...a({}), ing: 'san_carlos' } as unknown as Assignment
  assert.equal(cumpleLabor(x, base('TODO'), ing), true)
  assert.equal(cumpleLabor(x, base('TODO', { haciendaCode: 'SE' }), ing), true)
  assert.equal(cumpleLabor(x, base('TODO', { haciendaCode: 'OTRA' }), ing), false)
  assert.equal(cumpleLabor(x, base('TODO', { suerte: '26C' }), ing), false)
  assert.equal(cumpleLabor(x, base('TODO', { operatorId: 'U2' }), ing), false)
  assert.equal(cumpleLabor(x, base('TODO', { ingenioId: 'san_carlos' }), ing), true)
  assert.equal(cumpleLabor(x, base('TODO', { ingenioId: 'risaralda' }), ing), false)
  assert.equal(hayFiltroLabor(base('TODO')), false)
  assert.equal(hayFiltroLabor(base('TODO', { suerte: '25A' })), true)
})

caso('opciones: hacienda según ingenio, suerte y operador según hacienda, sin repetidos y ordenados', () => {
  const l = [
    { ...a({ haciendaCode: 'SE', haciendaName: 'SILENCIO', suerte: '10' }), ing: 'san_carlos' },
    { ...a({ haciendaCode: 'SE', haciendaName: 'SILENCIO', suerte: '9', operatorId: 'U2', operatorName: 'BEN' }), ing: 'san_carlos' },
    { ...a({ haciendaCode: 'SE', haciendaName: 'SILENCIO', suerte: '9' }), ing: 'san_carlos' },
    { ...a({ haciendaCode: 'LL', haciendaName: 'LLANOS', suerte: '1', operatorId: 'U3', operatorName: 'CAR' }), ing: 'risaralda' },
  ] as unknown as Assignment[]
  const todo = opcionesFiltros(l, { ingenioId: '', haciendaCode: '' }, ing)
  assert.deepEqual(todo.haciendas.map((h) => h.code), ['LL', 'SE'])
  assert.deepEqual(todo.suertes, ['1', '9', '10'])
  const sc = opcionesFiltros(l, { ingenioId: 'san_carlos', haciendaCode: '' }, ing)
  assert.deepEqual(sc.haciendas.map((h) => h.code), ['SE'])
  assert.deepEqual(sc.operadores.map((o) => o.id), ['U1', 'U2'])
  const ll = opcionesFiltros(l, { ingenioId: '', haciendaCode: 'LL' }, ing)
  assert.deepEqual(ll.suertes, ['1']); assert.deepEqual(ll.operadores.map((o) => o.id), ['U3'])
})

caso('texto del período', () => {
  assert.equal(textoPeriodo(base('TODO'), 'Agosto de 2026'), 'en todo el realizado')
  assert.equal(textoPeriodo(base('PRIMERA'), 'Agosto de 2026'), 'en agosto de 2026 (1ra quincena)')
  assert.equal(textoPeriodo(base('MES'), 'Agosto de 2026'), 'en agosto de 2026')
  assert.equal(textoPeriodo(base('CUSTOM', { desde: '2026-08-01' }), ''), 'del 2026-08-01 al hoy')
})

console.log(`\n${casos} de ${casos} casos`)
