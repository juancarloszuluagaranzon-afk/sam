import assert from 'node:assert/strict'
import { buscarPersona, etiquetasCortas, iniciales, pinNuevo, primerNombre, proximoTipo } from '../src/lib/quiosco.ts'
import { excesosDeExtras, minutosExtra, TOPE_EXTRA_DIA_MIN, TOPE_EXTRA_SEMANA_MIN } from '../src/lib/topesExtras.ts'
import { clasificar } from '../src/lib/horasExtra.ts'
import type { Franja, ResumenDia, Sesion } from '../src/lib/horasExtra.ts'

/**
 * Pruebas de la lógica pura del quiosco y de los topes de horas extra.
 *
 * Se corre con `node sam-app/scripts/prueba-taller-quiosco.mts` (Node 24 ejecuta
 * TypeScript directo). No toca la base de datos ni `src/`: solo importa las
 * funciones y las comprueba con fechas fijas en hora de Bogotá.
 */

/** Un instante fijo para todas las pruebas del quiosco: martes 20-oct-2026, 12:00 del día. */
const AHORA = new Date('2026-10-20T12:00:00-05:00')

let aprobados = 0
let fallados = 0

/**
 * Corre un caso y lo reporta. No se detiene en el primer fallo: si el código
 * tiene un error, conviene ver de una todos los casos que se caen.
 */
function caso(nombre: string, comprobar: () => void) {
  try {
    comprobar()
    console.log(`✓ ${nombre}`)
    aprobados += 1
  } catch (e) {
    fallados += 1
    const detalle = e instanceof Error ? e.message : String(e)
    console.log(`✗ ${nombre}`)
    console.log(detalle.split('\n').map((l) => `    ${l}`).join('\n'))
  }
}

/* ─────────────────────── Ayudas para armar los datos ─────────────────────── */

const FRANJAS_EN_CERO: Record<Franja, number> = {
  ORD_DIURNA: 0, ORD_NOCTURNA: 0,
  EXTRA_DIURNA: 0, EXTRA_NOCTURNA: 0,
  FEST_DIURNA: 0, FEST_NOCTURNA: 0,
  FEST_EXTRA_DIURNA: 0, FEST_EXTRA_NOCTURNA: 0,
}

/** Un `ResumenDia` con todas las franjas en 0 salvo las que se indiquen. */
function dia(usuarioId: string, fecha: string, minutos: Partial<Record<Franja, number>> = {}): ResumenDia {
  const franjas = { ...FRANJAS_EN_CERO, ...minutos }
  const totalMinutos = Object.values(franjas).reduce((a, b) => a + b, 0)
  return { usuarioId, dia: fecha, minutos: franjas, totalMinutos, festivo: false }
}

/** Los nombres de una lista de personas, para comparar sin arrastrar las cédulas. */
const nombres = (lista: { nombre: string }[]) => lista.map((p) => p.nombre)

/* ───────────────────────────── El quiosco ────────────────────────────────── */

caso('1. sin última marcación toca ENTRADA y no hay olvido', () => {
  assert.deepEqual(proximoTipo(null, AHORA), { tipo: 'ENTRADA', olvidoSalida: false })
})

caso('2. la última fue SALIDA: la siguiente marcación es ENTRADA', () => {
  assert.deepEqual(
    proximoTipo({ tipo: 'SALIDA', marcadoEn: '2026-10-20T11:00:00-05:00' }, AHORA),
    { tipo: 'ENTRADA', olvidoSalida: false },
  )
})

caso('3. ENTRADA de hace 2 h: toca marcar SALIDA', () => {
  assert.deepEqual(
    proximoTipo({ tipo: 'ENTRADA', marcadoEn: '2026-10-20T10:00:00-05:00' }, AHORA),
    { tipo: 'SALIDA', olvidoSalida: false },
  )
})

caso('4. ENTRADA de hace 19 h: toca ENTRADA y se avisa el olvido de salida', () => {
  assert.deepEqual(
    proximoTipo({ tipo: 'ENTRADA', marcadoEn: '2026-10-19T17:00:00-05:00' }, AHORA),
    { tipo: 'ENTRADA', olvidoSalida: true },
  )
})

caso('5. ENTRADA de hace exactamente 18 h: todavía pide SALIDA (el límite es «más de»)', () => {
  assert.deepEqual(
    proximoTipo({ tipo: 'ENTRADA', marcadoEn: '2026-10-19T18:00:00-05:00' }, AHORA),
    { tipo: 'SALIDA', olvidoSalida: false },
  )
})

caso('6. iniciales: dos palabras, tres palabras, un solo nombre y vacíos', () => {
  assert.equal(iniciales('ANDRÉS RUIZ'), 'AR')
  assert.equal(iniciales('ANDRÉS FELIPE RUIZ'), 'AF')
  assert.equal(iniciales('pedro'), 'PE')
  assert.equal(iniciales(''), '?')
  assert.equal(iniciales('   '), '?')
})

caso('7. primerNombre: tildes y mayúscula inicial; el vacío queda vacío', () => {
  assert.equal(primerNombre('ANDRÉS FELIPE RUIZ'), 'Andrés')
  assert.equal(primerNombre('ÑOÑO PÉREZ'), 'Ñoño')
  assert.equal(primerNombre(''), '')
})

const PERSONAS = [
  { nombre: 'ANDRÉS RUIZ', cedula: '1094555123' },
  { nombre: 'ÁLVARO GÓMEZ', cedula: '31222333' },
  { nombre: 'BEATRIZ ÑÚÑEZ' },
]

caso('8. buscar «andres» encuentra solo a Andrés, sin importar la tilde', () => {
  assert.deepEqual(nombres(buscarPersona(PERSONAS, 'andres')), ['ANDRÉS RUIZ'])
})

caso('9. buscar «1094» encuentra solo a Andrés por su cédula', () => {
  assert.deepEqual(nombres(buscarPersona(PERSONAS, '1094')), ['ANDRÉS RUIZ'])
})

caso('10. búsqueda vacía: las tres personas, ordenadas por nombre', () => {
  assert.deepEqual(nombres(buscarPersona(PERSONAS, '')), ['ÁLVARO GÓMEZ', 'ANDRÉS RUIZ', 'BEATRIZ ÑÚÑEZ'])
})

caso('11. buscar «nunez» encuentra a Beatriz Ñúñez, sin importar la ñ', () => {
  assert.deepEqual(nombres(buscarPersona(PERSONAS, 'nunez')), ['BEATRIZ ÑÚÑEZ'])
})

caso('12. buscar «xyz» no encuentra a nadie', () => {
  assert.deepEqual(buscarPersona(PERSONAS, 'xyz'), [])
})

caso('13. pinNuevo: 500 veces, siempre 4 dígitos y nunca un PIN trivial', () => {
  for (let i = 0; i < 500; i++) {
    const pin = pinNuevo()
    assert.match(pin, /^\d{4}$/, `PIN con formato raro: «${pin}»`)
    assert.notEqual(pin, '0000', 'salió el PIN «0000»')
    assert.equal(/^(\d)\1{3}$/.test(pin), false, `salió un PIN con los cuatro dígitos iguales: «${pin}»`)
  }
})

/* ────────────────────────── Topes de horas extra ─────────────────────────── */

caso('14. minutosExtra suma las cuatro franjas EXTRA y no cuenta las ordinarias', () => {
  const d = dia('u1', '2026-10-20', {
    ORD_DIURNA: 10, ORD_NOCTURNA: 20,
    EXTRA_DIURNA: 30, EXTRA_NOCTURNA: 40,
    FEST_DIURNA: 50, FEST_NOCTURNA: 60,
    FEST_EXTRA_DIURNA: 70, FEST_EXTRA_NOCTURNA: 80,
  })
  // 30 + 40 + 70 + 80 = 220. Si contara las ordinarias daría 360.
  assert.equal(minutosExtra(d), 220)
})

caso('15. 121 min extra es exceso del día; 120 exactos no lo es', () => {
  const conExceso = excesosDeExtras([dia('u1', '2026-10-20', { EXTRA_DIURNA: 121 })])
  assert.equal(conExceso.length, 1)
  assert.deepEqual(conExceso[0], {
    usuarioId: 'u1', tipo: 'DIA', periodo: '2026-10-20', minutosExtra: 121, tope: TOPE_EXTRA_DIA_MIN,
  })

  const sinExceso = excesosDeExtras([dia('u1', '2026-10-20', { EXTRA_DIURNA: 120 })])
  assert.deepEqual(sinExceso, [])
})

caso('16. cinco días de 150 min: cinco excesos DIA y un exceso SEMANA del lunes 2026-10-19', () => {
  const fechas = ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23']
  const excesos = excesosDeExtras(fechas.map((fecha) => dia('u1', fecha, { EXTRA_DIURNA: 150 })))
  const deDia = excesos.filter((e) => e.tipo === 'DIA')
  const deSemana = excesos.filter((e) => e.tipo === 'SEMANA')

  assert.equal(deDia.length, 5)
  assert.deepEqual(deDia.map((e) => e.periodo), fechas)
  assert.equal(deSemana.length, 1)
  assert.equal(deSemana[0].periodo, '2026-10-19')
  assert.equal(deSemana[0].minutosExtra, 750)
  assert.equal(deSemana[0].tope, TOPE_EXTRA_SEMANA_MIN)
})

caso('17. el domingo 2026-10-25 cuenta en la semana del lunes 2026-10-19', () => {
  const excesos = excesosDeExtras([
    dia('u1', '2026-10-19', { EXTRA_DIURNA: 150 }),
    dia('u1', '2026-10-25', { EXTRA_DIURNA: 600 }),
  ])
  const deSemana = excesos.filter((e) => e.tipo === 'SEMANA')

  assert.equal(deSemana.length, 1)
  assert.equal(deSemana[0].periodo, '2026-10-19')
  assert.equal(deSemana[0].minutosExtra, 750)
  assert.equal(excesos.some((e) => e.periodo === '2026-10-26'), false)
})

caso('18. dos personas: ordenado por usuarioId y, a igual periodo, DIA antes que SEMANA', () => {
  const excesos = excesosDeExtras([
    dia('beto', '2026-10-20', { EXTRA_DIURNA: 200 }),
    dia('ana', '2026-10-19', { EXTRA_DIURNA: 800 }),
  ])
  assert.deepEqual(excesos.map((e) => `${e.usuarioId}|${e.tipo}|${e.periodo}`), [
    'ana|DIA|2026-10-19',
    'ana|SEMANA|2026-10-19',
    'beto|DIA|2026-10-20',
  ])
})

caso('19. clasificar: martes de 7:00 a 19:00 con jornada de 8 h → 240 min extra y un exceso DIA', () => {
  const sesion: Sesion = {
    usuarioId: 'u1',
    entrada: '2026-10-20T07:00:00-05:00',
    salida: '2026-10-20T19:00:00-05:00',
    minutos: 720,
  }
  const dias = clasificar([sesion])

  assert.equal(dias.length, 1)
  assert.equal(dias[0].dia, '2026-10-20')
  assert.equal(dias[0].festivo, false)
  assert.equal(dias[0].totalMinutos, 720)
  assert.equal(dias[0].minutos.ORD_DIURNA, 480)
  assert.equal(dias[0].minutos.EXTRA_DIURNA, 240)
  assert.equal(dias[0].minutos.EXTRA_NOCTURNA, 0)

  const excesos = excesosDeExtras(dias)
  const deDia = excesos.filter((e) => e.tipo === 'DIA')
  assert.equal(deDia.length, 1)
  assert.equal(deDia[0].periodo, '2026-10-20')
  assert.equal(deDia[0].minutosExtra, 240)
})

/* ───────────── Etiquetas de la cuadrícula (dos «Luis» no se confunden) ───────────── */

caso('20. etiquetas: nombres distintos → solo el primer nombre', () => {
  assert.deepEqual(etiquetasCortas(['ANDRÉS RUIZ', 'LUIS GÓMEZ', 'BEATRIZ ÑÚÑEZ']), ['Andrés', 'Luis', 'Beatriz'])
})

caso('21. etiquetas: dos «Luis» se distinguen con su segundo nombre o apellido', () => {
  assert.deepEqual(
    etiquetasCortas(['LUIS GÓMEZ', 'LUIS FERNANDO PÉREZ', 'ANDRÉS RUIZ']),
    ['Luis Gómez', 'Luis Fernando', 'Andrés'],
  )
})

caso('22. etiquetas: si hasta los dos primeros se repiten, sale el nombre completo', () => {
  assert.deepEqual(
    etiquetasCortas(['LUIS FERNANDO PÉREZ', 'LUIS FERNANDO GÓMEZ']),
    ['Luis Fernando Pérez', 'Luis Fernando Gómez'],
  )
})

caso('23. etiquetas: una por nombre y en el mismo orden; lista vacía → vacía', () => {
  assert.equal(etiquetasCortas(['A B', 'C D', 'E F']).length, 3)
  assert.deepEqual(etiquetasCortas([]), [])
})

/* ──────────────────────────────── Resumen ───────────────────────────────── */

console.log(`\nCasos aprobados: ${aprobados} de ${aprobados + fallados}`)
if (fallados > 0) {
  console.log(`Casos fallados: ${fallados}`)
  process.exitCode = 1
}
