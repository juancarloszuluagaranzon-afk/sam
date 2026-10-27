import assert from 'node:assert/strict'
import {
  aNumeroCarga,
  analizarFilas,
  buscarParecidas,
  mapearColumnas,
  normalizarTexto,
  resolverFamilia,
} from '../src/lib/cargaPiezas.ts'
import type { FamiliaCarga, FilaPieza } from '../src/lib/cargaPiezas.ts'
import type { Insumo } from '../src/domain/sam.ts'

/**
 * Pruebas de la lógica pura de la carga de piezas del taller desde Excel (26-oct-2026).
 *
 * Se corren desde `sam-app/` con:
 *
 *   node scripts/prueba-carga-piezas.mts
 *
 * No tocan la base de datos, ni la red, ni ningún archivo de `src/`: solo importan las
 * funciones puras de `src/lib/cargaPiezas.ts`. `leerArchivoPiezas`, `descargarPlantillaPiezas`
 * y `descargarNoPasaron` NO se prueban aquí porque necesitan un archivo del navegador o
 * descargan un Excel; lo que sí se puede comprobar sin pantalla es el análisis de las filas.
 */

let casos = 0
let fallados = 0

/**
 * Corre un caso y lo reporta. No se detiene en el primer fallo: si el código
 * tiene un error, conviene ver de una todos los casos que se caen.
 */
async function caso(nombre: string, fn: () => void | Promise<void>) {
  try {
    await fn()
    console.log(`✓ ${nombre}`)
    casos += 1
  } catch (e) {
    fallados += 1
    const detalle = e instanceof Error ? e.message : String(e)
    console.log(`✗ ${nombre}`)
    console.log(detalle.split('\n').map((l) => `    ${l}`).join('\n'))
  }
}

/* ─────────────────────────── Ayudas de las pruebas ─────────────────────────── */

/** Una pieza que ya existe en el taller, con lo mínimo que miran las funciones. Activa salvo que se diga. */
function ins(datos: {
  id: string
  nombre: string
  codigo?: string
  numeroParte?: string
  referencia?: string
  ubicacion?: string
  activo?: boolean
}): Insumo {
  return {
    id: datos.id,
    nombre: datos.nombre,
    categoria: 'MATERIAL',
    unidad: 'unidad',
    stock: 0,
    stockMinimo: 0,
    frecuente: false,
    activo: datos.activo ?? true,
    codigo: datos.codigo,
    numeroParte: datos.numeroParte,
    referencia: datos.referencia,
    ubicacion: datos.ubicacion,
  } as Insumo
}

/** Una fila cruda del Excel: lo obligatorio en blanco salvo que el caso lo llene. */
function fila(datos: Partial<FilaPieza> & { fila: number }): FilaPieza {
  return { nombre: '', ubicacion: '', cantidad: '', ...datos }
}

/** Un `nuevoId` que cuenta sus llamadas, para probar que no se gastan ids en lo que no se guarda. */
function contadorIds() {
  let llamadas = 0
  return { nuevoId: () => `id-${++llamadas}`, llamadas: () => llamadas }
}

/** Las familias de ejemplo que se usan en los casos. */
const FAMILIAS: FamiliaCarga[] = [
  { codigo: 'ROD', nombre: 'Rodamientos y retenedores' },
  { codigo: 'FIL', nombre: 'Filtros' },
  { codigo: 'HID', nombre: 'Hidráulico y mangueras' },
]

/** Lo que ya existe en el taller para probar las parecidas y las repetidas. */
const EXISTENTES: Insumo[] = [
  ins({
    id: 'ex-rod',
    nombre: 'RODAMIENTO 30206',
    codigo: 'ROD-0005',
    numeroParte: '30206-2RS',
    ubicacion: 'ESTANTE A-1',
  }),
  ins({
    id: 'ex-filtro',
    nombre: 'FILTRO DE ACEITE MOTOR',
    codigo: 'FIL-0003',
    referencia: 'ABC-123',
    ubicacion: 'ESTANTE B-2',
  }),
]

/* ───────────────────────────── normalizarTexto ───────────────────────────── */

await caso('1. normalizarTexto: los signos se vuelven espacio y todo pasa a mayúscula', () => {
  assert.equal(normalizarTexto('Rodamiento 30206-2RS'), 'RODAMIENTO 30206 2RS')
  // El «°» también es un signo: así el encabezado «N° de parte» se puede comparar.
  assert.equal(normalizarTexto('N° de parte'), 'N DE PARTE')
  // Los números se conservan tal cual.
  assert.equal(normalizarTexto('6206'), '6206')
})

await caso('2. normalizarTexto: colapsa los espacios de adentro y recorta los de los extremos', () => {
  assert.equal(normalizarTexto('   filtro    de   aceite  '), 'FILTRO DE ACEITE')
  assert.equal(normalizarTexto('filtro\tde\naceite'), 'FILTRO DE ACEITE')
})

await caso('3. normalizarTexto: quita las tildes', () => {
  assert.equal(normalizarTexto('Mínimo'), 'MINIMO')
  assert.equal(normalizarTexto('Hidráulico y mangueras'), 'HIDRAULICO Y MANGUERAS')
  assert.equal(normalizarTexto('Compresión'), 'COMPRESION')
})

await caso('4. normalizarTexto: la Ñ queda como N (lo que deja NFD), sin romper', () => {
  // NFD separa la tilde de la Ñ y el paso que quita las marcas se la lleva: queda N.
  assert.equal(normalizarTexto('Ñ'), 'N')
  assert.equal(normalizarTexto('Muñón'), 'MUNON')
  // Efecto buscado: «MUÑON» y «MUNON» se comparan iguales en vez de parecer dos piezas distintas.
  assert.equal(normalizarTexto('MUÑON'), normalizarTexto('MUNON'))
})

await caso('5. normalizarTexto: null, undefined y la cadena vacía dan cadena vacía', () => {
  assert.equal(normalizarTexto(null), '')
  assert.equal(normalizarTexto(undefined), '')
  assert.equal(normalizarTexto(''), '')
})

await caso('6. normalizarTexto: lo que es solo signos o solo espacios queda en cadena vacía', () => {
  for (const texto of ['---', '/-*+', '()[]{}', '¿?!¡', '#%&', '°', '   ']) {
    assert.equal(normalizarTexto(texto), '', `«${texto}»`)
  }
})

/* ────────────────────────────── aNumeroCarga ─────────────────────────────── */

await caso('7. aNumeroCarga: enteros y decimales con coma o con punto', () => {
  assert.equal(aNumeroCarga('14'), 14)
  assert.equal(aNumeroCarga('14,5'), 14.5)
  assert.equal(aNumeroCarga('14.5'), 14.5)
  assert.equal(aNumeroCarga('0,5'), 0.5)
  assert.equal(aNumeroCarga('0.5'), 0.5)
  assert.equal(aNumeroCarga('  7 '), 7)
})

await caso('8. aNumeroCarga: el punto de miles se entiende como miles (1.200 = mil doscientos)', () => {
  assert.equal(aNumeroCarga('1.200'), 1200)
  assert.equal(aNumeroCarga('1.200,5'), 1200.5)
  assert.equal(aNumeroCarga('12.345.678'), 12345678)
})

await caso('9. aNumeroCarga: null cuando no es un número (vacío, letras, dos comas, dos puntos, signos dobles)', () => {
  for (const texto of ['', '   ', 'abc', '1,2,3', '--3', '1.5.5', '12a', ',', '.', '1,', ',5']) {
    assert.equal(aNumeroCarga(texto), null, `«${texto}»`)
  }
})

await caso('10. aNumeroCarga: el negativo se convierte y quien llama decide si lo rechaza', () => {
  assert.equal(aNumeroCarga('-3'), -3)
  assert.equal(aNumeroCarga('-3,5'), -3.5)
  assert.equal(aNumeroCarga('-1.200'), -1200)
})

await caso('11. aNumeroCarga: nunca devuelve NaN ni Infinity', () => {
  const entradas = ['0', '-0', '999999999999999999999999', '9'.repeat(400), '1e999', 'NaN', 'Infinity', '-Infinity', '0x10', '1_000']
  for (const texto of entradas) {
    const n = aNumeroCarga(texto)
    assert.ok(n === null || Number.isFinite(n), `«${texto.slice(0, 20)}» dio ${n}`)
  }
  // 400 nueves dan Infinity al convertirlos: la función los descarta en vez de guardarlos.
  assert.equal(aNumeroCarga('9'.repeat(400)), null)
})

/* ───────────────────────────── mapearColumnas ────────────────────────────── */

await caso('12. mapearColumnas: los 8 encabezados exactos de la plantilla se encuentran todos', () => {
  const r = mapearColumnas(['Nombre', 'Estante', 'Cantidad', 'Familia', 'Marca', 'N° de parte', 'Referencia', 'Mínimo'])
  assert.deepEqual(r.faltan, [])
  assert.deepEqual(r.indice, {
    nombre: 0,
    ubicacion: 1,
    cantidad: 2,
    familia: 3,
    marca: 4,
    numeroParte: 5,
    referencia: 6,
    stockMinimo: 7,
  })
})

await caso('13. mapearColumnas: reconoce los sinónimos (DESCRIPCIÓN, UBICACIÓN, EXISTENCIA, CATEGORÍA…)', () => {
  const r = mapearColumnas([
    'Descripción',
    'Ubicación',
    'Existencia',
    'Categoría',
    'Marca',
    'Numero de parte',
    'Ref',
    'Stock mínimo',
  ])
  assert.deepEqual(r.faltan, [])
  assert.deepEqual(r.indice, {
    nombre: 0,
    ubicacion: 1,
    cantidad: 2,
    familia: 3,
    marca: 4,
    numeroParte: 5,
    referencia: 6,
    stockMinimo: 7,
  })
})

await caso('14. mapearColumnas: «Numero/Número de parte» sí, «Núm. de parte» no (no es uno de los sinónimos)', () => {
  assert.equal(mapearColumnas(['Nombre', 'Estante', 'Cantidad', 'Numero de parte']).indice.numeroParte, 3)
  assert.equal(mapearColumnas(['Nombre', 'Estante', 'Cantidad', 'Número de parte']).indice.numeroParte, 3)

  const abreviado = mapearColumnas(['Nombre', 'Estante', 'Cantidad', 'Núm. de parte'])
  assert.equal(abreviado.indice.numeroParte, undefined)
  // No es obligatorio, así que la carga sigue: la pieza solo queda sin N° de parte.
  assert.deepEqual(abreviado.faltan, [])
})

await caso('15. mapearColumnas: mayúsculas, minúsculas y tildes mezcladas no cambian el resultado', () => {
  const r = mapearColumnas([
    'nOmBrE',
    'eStAnTe',
    'CANTIDAD',
    'FAMILIA',
    'mArCa',
    'NÚMERO DE PARTE',
    'referencia',
    'MÍNIMO',
  ])
  assert.deepEqual(r.faltan, [])
  assert.deepEqual(r.indice, {
    nombre: 0,
    ubicacion: 1,
    cantidad: 2,
    familia: 3,
    marca: 4,
    numeroParte: 5,
    referencia: 6,
    stockMinimo: 7,
  })
})

await caso('16. mapearColumnas: sin Estante ni Cantidad, faltan = [estante, cantidad] en ese orden', () => {
  const r = mapearColumnas(['Nombre', 'Marca'])
  assert.deepEqual(r.faltan, ['estante', 'cantidad'])
  assert.equal(r.indice.nombre, 0)
  assert.equal(r.indice.marca, 1)
  assert.equal(r.indice.ubicacion, undefined)
  assert.equal(r.indice.cantidad, undefined)
})

await caso('17. mapearColumnas: sin ningún encabezado faltan los tres obligatorios, en orden', () => {
  assert.deepEqual(mapearColumnas([]).faltan, ['nombre', 'estante', 'cantidad'])
  assert.deepEqual(mapearColumnas([]).indice, {})
})

await caso('18. mapearColumnas: dos columnas del mismo campo → gana la primera', () => {
  const r = mapearColumnas(['Nombre', 'Descripción', 'Estante', 'Ubicación', 'Cantidad', 'Existencia'])
  assert.equal(r.indice.nombre, 0)
  assert.equal(r.indice.ubicacion, 2)
  assert.equal(r.indice.cantidad, 4)
})

await caso('19. mapearColumnas: una columna desconocida no corre los índices de las demás', () => {
  const r = mapearColumnas(['', 'Nombre', 'Color', 'Estante', 'Cantidad'])
  assert.deepEqual(r.faltan, [])
  assert.equal(r.indice.nombre, 1)
  assert.equal(r.indice.ubicacion, 3)
  assert.equal(r.indice.cantidad, 4)
  assert.equal(r.indice.marca, undefined)
})

/* ───────────────────────────── resolverFamilia ───────────────────────────── */

await caso('20. resolverFamilia: acepta el código en mayúscula o minúscula', () => {
  assert.equal(resolverFamilia('ROD', FAMILIAS), 'ROD')
  assert.equal(resolverFamilia('rod', FAMILIAS), 'ROD')
  assert.equal(resolverFamilia('  fil  ', FAMILIAS), 'FIL')
})

await caso('21. resolverFamilia: acepta el nombre completo, con o sin tildes', () => {
  assert.equal(resolverFamilia('Rodamientos y retenedores', FAMILIAS), 'ROD')
  assert.equal(resolverFamilia('Filtros', FAMILIAS), 'FIL')
  assert.equal(resolverFamilia('HIDRÁULICO Y MANGUERAS', FAMILIAS), 'HID')
})

await caso('22. resolverFamilia: acepta la primera palabra en singular o plural', () => {
  assert.equal(resolverFamilia('Rodamiento', FAMILIAS), 'ROD')
  assert.equal(resolverFamilia('Rodamientos', FAMILIAS), 'ROD')
  assert.equal(resolverFamilia('Filtro', FAMILIAS), 'FIL')
  assert.equal(resolverFamilia('Hidráulico', FAMILIAS), 'HID')
})

await caso('23. resolverFamilia: lo que no existe (o viene vacío) da null; sin lista también', () => {
  assert.equal(resolverFamilia('XYZ', FAMILIAS), null)
  assert.equal(resolverFamilia('', FAMILIAS), null)
  assert.equal(resolverFamilia('   ', FAMILIAS), null)
  assert.equal(resolverFamilia('Rodamiento', []), null)
})

/* ───────────────────────────── buscarParecidas ───────────────────────────── */

await caso('24. buscarParecidas: mismo N° de parte escrito con espacios o guiones', () => {
  const rod = ins({ id: 'ex-1', nombre: 'RODAMIENTO 30206', numeroParte: '30206-2RS' })
  for (const parte of ['30206-2RS', '30206 2RS', '302062RS', '30206 - 2rs']) {
    const r = buscarParecidas('PIEZA SIN RELACIÓN', parte, [rod])
    assert.deepEqual(r.map((x) => x.id), ['ex-1'], `con «${parte}»`)
  }
})

await caso('25. buscarParecidas: el N° de parte también se compara contra el CÓDIGO y la REFERENCIA', () => {
  const porCodigo = ins({ id: 'ex-codigo', nombre: 'FILTRO DE ACEITE', codigo: 'FIL-0003' })
  assert.deepEqual(buscarParecidas('OTRA COSA', 'FIL0003', [porCodigo]).map((x) => x.id), ['ex-codigo'])
  assert.deepEqual(buscarParecidas('OTRA COSA', 'fil 0003', [porCodigo]).map((x) => x.id), ['ex-codigo'])

  const porReferencia = ins({ id: 'ex-ref', nombre: 'MANGUERA', referencia: 'ABC-123' })
  assert.deepEqual(buscarParecidas('OTRA COSA', 'abc123', [porReferencia]).map((x) => x.id), ['ex-ref'])
})

await caso('26. buscarParecidas: un N° de parte vacío no coincide con una existente sin N° de parte', () => {
  const sinParte = ins({ id: 'ex-sin', nombre: 'ALGO DISTINTO' })
  assert.deepEqual(buscarParecidas('OTRA COSA', '', [sinParte]), [])
})

await caso('27. buscarParecidas: el mismo N° de parte va antes que el mismo nombre', () => {
  const porNombre = ins({ id: 'ex-nombre', nombre: 'FILTRO DE ACEITE' })
  const porParte = ins({ id: 'ex-parte', nombre: 'OTRA PIEZA', numeroParte: 'X-100' })
  const r = buscarParecidas('FILTRO DE ACEITE', 'X100', [porNombre, porParte])
  assert.deepEqual(r.map((x) => x.id), ['ex-parte', 'ex-nombre'])
})

await caso('28. buscarParecidas: el mismo nombre con otra mayúscula o con tilde', () => {
  const existente = ins({ id: 'ex-2', nombre: 'Filtro de Aceite', ubicacion: 'A-1' })
  assert.deepEqual(buscarParecidas('FILTRO DE ACEITE', '', [existente]).map((x) => x.id), ['ex-2'])
  assert.deepEqual(buscarParecidas('filtro de aceíte', '', [existente]).map((x) => x.id), ['ex-2'])
  // Con una sola palabra también cuenta si el nombre es EXACTAMENTE el mismo.
  assert.deepEqual(buscarParecidas('rodamiento', '', [ins({ id: 'ex-3', nombre: 'RODAMIENTO' })]).map((x) => x.id), ['ex-3'])
})

await caso('29. buscarParecidas: nombre corto contenido en el largo con 2+ palabras, en los dos sentidos', () => {
  const largoNombre = ins({ id: 'ex-4', nombre: 'FILTRO DE ACEITE MOTOR' })
  assert.deepEqual(buscarParecidas('FILTRO ACEITE', '', [largoNombre]).map((x) => x.id), ['ex-4'])
  assert.deepEqual(buscarParecidas('Filtro Motor', '', [largoNombre]).map((x) => x.id), ['ex-4'])

  const cortoNombre = ins({ id: 'ex-5', nombre: 'FILTRO ACEITE' })
  assert.deepEqual(buscarParecidas('FILTRO DE ACEITE MOTOR', '', [cortoNombre]).map((x) => x.id), ['ex-5'])
})

await caso('30. buscarParecidas: una sola palabra no alcanza para decir que se parece', () => {
  assert.deepEqual(buscarParecidas('RODAMIENTO', '', [ins({ id: 'ex-6', nombre: 'RODAMIENTO DE RUEDA 30206' })]), [])
  assert.deepEqual(buscarParecidas('FILTRO', '', [ins({ id: 'ex-7', nombre: 'FILTRO DE ACEITE' })]), [])
})

await caso('31. buscarParecidas: ignora las piezas inactivas', () => {
  const inactiva = ins({ id: 'ex-8', nombre: 'FILTRO DE ACEITE', activo: false })
  assert.deepEqual(buscarParecidas('FILTRO DE ACEITE', '', [inactiva]), [])
})

await caso('32. buscarParecidas: respeta el máximo (3 por defecto)', () => {
  const muchas = Array.from({ length: 5 }, (_, i) => ins({ id: `ex-m${i}`, nombre: 'FILTRO DE ACEITE' }))
  assert.equal(buscarParecidas('FILTRO DE ACEITE', '', muchas).length, 3)
  assert.equal(buscarParecidas('FILTRO DE ACEITE', '', muchas, 2).length, 2)
  assert.equal(buscarParecidas('FILTRO DE ACEITE', '', muchas, 10).length, 5)
  assert.deepEqual(buscarParecidas('FILTRO DE ACEITE', '', muchas, 0), [])
})

await caso('33. buscarParecidas: no repite la misma pieza aunque venga varias veces en la lista', () => {
  const repetida = ins({ id: 'ex-9', nombre: 'FILTRO DE ACEITE' })
  const r = buscarParecidas('FILTRO DE ACEITE', '', [repetida, repetida, repetida])
  assert.deepEqual(r.map((x) => x.id), ['ex-9'])
})

await caso('34. buscarParecidas: sin ninguna coincidencia devuelve una lista vacía', () => {
  const existentes = [ins({ id: 'ex-10', nombre: 'FILTRO DE ACEITE MOTOR' })]
  assert.deepEqual(buscarParecidas('MANGUERA HIDRAULICA', '', existentes), [])
})

/* ─────────────────────────────── analizarFilas ───────────────────────────── */

await caso('35. analizarFilas: una fila válida sale LISTA con la pieza en mayúscula, la cantidad convertida y un id de nuevoId', () => {
  const { nuevoId, llamadas } = contadorIds()
  const entrada = fila({
    fila: 2,
    nombre: '  manguera hidráulica ',
    ubicacion: ' estante b-2 ',
    cantidad: '14',
    familia: 'rod',
    marca: 'skf',
    numeroParte: '6206-2rs',
    referencia: ' r-9 ',
    stockMinimo: '2',
  })
  const analisis = analizarFilas([entrada], [], nuevoId)
  assert.equal(analisis.filas.length, 1)
  const f = analisis.filas[0]
  assert.equal(f.fila, 2)
  assert.equal(f.estado, 'lista')
  assert.equal(f.motivo, undefined)
  assert.equal(f.parecidaA, undefined)
  assert.equal(llamadas(), 1)
  assert.deepEqual(f.pieza, {
    id: 'id-1',
    // La tilde se conserva al GUARDAR; solo se quita para COMPARAR nombres.
    nombre: 'MANGUERA HIDRÁULICA',
    ubicacion: 'ESTANTE B-2',
    cantidad: 14,
    // Sin lista de familias, el texto de la familia pasa tal cual en mayúscula.
    familia: 'ROD',
    marca: 'SKF',
    numeroParte: '6206-2RS',
    referencia: 'R-9',
    stockMinimo: 2,
  })
  assert.equal(analisis.listas, 1)
  assert.equal(analisis.parecidas, 0)
  assert.equal(analisis.errores, 0)
})

await caso('36. analizarFilas: la coma decimal se convierte en el número correcto', () => {
  const a = analizarFilas([fila({ fila: 2, nombre: 'MANGUERA', ubicacion: 'A-1', cantidad: ' 14,5 ' })], [], contadorIds().nuevoId)
  assert.equal(a.filas[0].estado, 'lista')
  assert.equal(typeof a.filas[0].pieza?.cantidad, 'number')
  assert.equal(a.filas[0].pieza?.cantidad, 14.5)
})

await caso('37. analizarFilas: los motivos de error son los exactos, sin inventar datos', () => {
  const { nuevoId, llamadas } = contadorIds()
  const filas = [
    fila({ fila: 2, nombre: '', ubicacion: 'A-1', cantidad: '1' }),
    fila({ fila: 3, nombre: 'PIEZA', ubicacion: '', cantidad: '1' }),
    fila({ fila: 4, nombre: 'PIEZA', ubicacion: 'A-1', cantidad: '' }),
    fila({ fila: 5, nombre: 'PIEZA', ubicacion: 'A-1', cantidad: 'abc' }),
    fila({ fila: 6, nombre: 'PIEZA', ubicacion: 'A-1', cantidad: '-3' }),
    fila({ fila: 7, nombre: 'PIEZA', ubicacion: 'A-1', cantidad: '1', stockMinimo: 'abc' }),
    fila({ fila: 8, nombre: 'PIEZA', ubicacion: 'A-1', cantidad: '1', stockMinimo: '-1' }),
  ]
  const a = analizarFilas(filas, [], nuevoId)
  assert.deepEqual(a.filas.map((f) => f.motivo), [
    'Falta el nombre',
    'Falta el estante',
    'Falta la cantidad',
    'La cantidad no es un número',
    'La cantidad no es un número',
    'El mínimo no es un número',
    'El mínimo no es un número',
  ])
  assert.equal(a.errores, 7)
  assert.equal(a.listas, 0)
  assert.equal(a.parecidas, 0)
  assert.ok(a.filas.every((f) => f.estado === 'error' && !f.pieza), 'una fila con error no puede llevar pieza')
  assert.equal(llamadas(), 0, 'un error no debe gastar un id')
})

await caso('38. analizarFilas: manda el primer problema en orden (nombre → estante → cantidad → mínimo)', () => {
  const filas = [
    // Solo la marca: hay contenido, pero lo primero que falta es el nombre.
    fila({ fila: 2, nombre: '', ubicacion: '', cantidad: '', marca: 'SKF' }),
    // Falta el estante aunque la cantidad tampoco sirva.
    fila({ fila: 3, nombre: 'PIEZA', ubicacion: '', cantidad: 'abc' }),
    // Falta la cantidad aunque el mínimo tampoco sirva.
    fila({ fila: 4, nombre: 'PIEZA', ubicacion: 'A', cantidad: '', stockMinimo: 'abc' }),
    // La cantidad manda sobre el mínimo.
    fila({ fila: 5, nombre: 'PIEZA', ubicacion: 'A', cantidad: 'abc', stockMinimo: 'abc' }),
  ]
  const a = analizarFilas(filas, [], contadorIds().nuevoId)
  assert.deepEqual(a.filas.map((f) => f.motivo), [
    'Falta el nombre',
    'Falta el estante',
    'Falta la cantidad',
    'La cantidad no es un número',
  ])
})

await caso('39. analizarFilas: una fila totalmente vacía se ignora y no cuenta', () => {
  const { nuevoId, llamadas } = contadorIds()
  const filas = [
    fila({ fila: 2 }),
    fila({ fila: 3, nombre: '   ', ubicacion: '\t', cantidad: '  ' }),
    fila({ fila: 4, nombre: 'PIEZA UNO', ubicacion: 'A-1', cantidad: '1' }),
  ]
  const a = analizarFilas(filas, [], nuevoId)
  assert.equal(a.filas.length, 1)
  assert.equal(a.filas[0].fila, 4)
  assert.equal(a.listas + a.parecidas + a.errores, 1)
  assert.equal(llamadas(), 1)
})

await caso('40. analizarFilas: parecida a una existente por el mismo N° de parte', () => {
  const filas = [
    fila({ fila: 2, nombre: 'PIEZA COMPLETAMENTE DISTINTA', ubicacion: 'Z-9', cantidad: '1', numeroParte: '30206 2rs' }),
  ]
  const a = analizarFilas(filas, EXISTENTES, contadorIds().nuevoId)
  assert.equal(a.filas[0].estado, 'parecida')
  assert.equal(a.filas[0].motivo, 'Ya existe ROD-0005 con el mismo N° de parte')
  assert.deepEqual(a.filas[0].parecidaA, {
    id: 'ex-rod',
    nombre: 'RODAMIENTO 30206',
    codigo: 'ROD-0005',
    ubicacion: 'ESTANTE A-1',
  })
  assert.equal(a.filas[0].pieza, undefined)
  assert.equal(a.parecidas, 1)
  assert.equal(a.listas, 0)
})

await caso('41. analizarFilas: parecida a una existente por el mismo nombre', () => {
  const filas = [fila({ fila: 2, nombre: 'rodamiento 30206', ubicacion: 'A-9', cantidad: '1' })]
  const a = analizarFilas(filas, EXISTENTES, contadorIds().nuevoId)
  assert.equal(a.filas[0].estado, 'parecida')
  assert.equal(a.filas[0].motivo, 'Ya existe ROD-0005 con el mismo nombre')
  assert.equal(a.filas[0].parecidaA?.id, 'ex-rod')
  assert.equal(a.filas[0].pieza, undefined)
})

await caso('42. analizarFilas: parecida por nombre parecido y el motivo dice por qué', () => {
  const filas = [fila({ fila: 2, nombre: 'FILTRO ACEITE', ubicacion: 'A-9', cantidad: '1' })]
  const a = analizarFilas(filas, EXISTENTES, contadorIds().nuevoId)
  assert.equal(a.filas[0].estado, 'parecida')
  assert.equal(a.filas[0].motivo, 'Ya existe FIL-0003 (nombre parecido: FILTRO DE ACEITE MOTOR)')
  assert.equal(a.filas[0].parecidaA?.id, 'ex-filtro')
  assert.equal(a.filas[0].pieza, undefined)
})

await caso('43. analizarFilas: la repetida dentro del archivo se marca con la fila y no se crea', () => {
  const filas = [
    fila({ fila: 2, nombre: 'manguera hidraulica', ubicacion: 'A-1', cantidad: '1' }),
    fila({ fila: 5, nombre: 'Manguera Hidráulica', ubicacion: 'A-2', cantidad: '2' }),
  ]
  const a = analizarFilas(filas, [], contadorIds().nuevoId)
  assert.equal(a.filas[0].estado, 'lista')
  assert.equal(a.filas[1].estado, 'parecida')
  assert.equal(a.filas[1].motivo, 'Repetida: igual a la fila 2')
  assert.deepEqual(a.filas[1].parecidaA, { nombre: 'MANGUERA HIDRAULICA', filaArchivo: 2 })
  assert.equal(a.filas[1].parecidaA?.id, undefined)
  assert.equal(a.filas[1].pieza, undefined)
  assert.equal(a.listas, 1)
  assert.equal(a.parecidas, 1)
})

await caso('44. analizarFilas: también es repetida la que trae el mismo N° de parte con otro nombre', () => {
  const filas = [
    fila({ fila: 2, nombre: 'PIEZA ALFA', ubicacion: 'A', cantidad: '1', numeroParte: 'X-77' }),
    fila({ fila: 3, nombre: 'PIEZA BETA', ubicacion: 'B', cantidad: '2', numeroParte: 'X77' }),
  ]
  const a = analizarFilas(filas, [], contadorIds().nuevoId)
  assert.equal(a.filas[1].estado, 'parecida')
  assert.equal(a.filas[1].motivo, 'Repetida: igual a la fila 2')
  assert.deepEqual(a.filas[1].parecidaA, { nombre: 'PIEZA ALFA', filaArchivo: 2 })
  assert.equal(a.filas[1].pieza, undefined)
})

await caso('45. analizarFilas: contadores que suman, orden del archivo y ids solo para las listas', () => {
  const { nuevoId, llamadas } = contadorIds()
  const filas = [
    fila({ fila: 2, nombre: 'BUJIA NUEVA', ubicacion: 'A-1', cantidad: '1' }),
    fila({ fila: 3 }), // vacía: no cuenta
    fila({ fila: 4, nombre: 'BUJIA NUEVA', ubicacion: 'A-2', cantidad: '2' }),
    fila({ fila: 5, nombre: 'SIN ESTANTE', ubicacion: '', cantidad: '1' }),
    fila({ fila: 6, nombre: 'RODAMIENTO 30206', ubicacion: 'C-1', cantidad: '3' }),
    fila({ fila: 7, nombre: 'EMPAQUE NUEVO', ubicacion: 'D-1', cantidad: '4' }),
  ]
  const a = analizarFilas(filas, EXISTENTES, nuevoId)
  assert.equal(a.listas, 2)
  assert.equal(a.parecidas, 2)
  assert.equal(a.errores, 1)
  assert.equal(a.listas + a.parecidas + a.errores, 5) // 6 filas escritas, 1 vacía
  assert.deepEqual(a.filas.map((f) => f.fila), [2, 4, 5, 6, 7])
  assert.deepEqual(a.filas.map((f) => f.estado), ['lista', 'parecida', 'error', 'parecida', 'lista'])
  assert.equal(llamadas(), 2)
  assert.deepEqual(a.filas.filter((f) => f.pieza).map((f) => f.pieza!.id), ['id-1', 'id-2'])
})

await caso('46. analizarFilas: la fila original se conserva intacta (misma referencia y mismos textos)', () => {
  const entrada = fila({ fila: 2, nombre: '  filtro nuevo ', ubicacion: ' a-1 ', cantidad: ' 3 ' })
  const a = analizarFilas([entrada], [], contadorIds().nuevoId)
  assert.equal(a.filas[0].original, entrada)
  assert.deepEqual(a.filas[0].original, { fila: 2, nombre: '  filtro nuevo ', ubicacion: ' a-1 ', cantidad: ' 3 ' })
  assert.equal(entrada.nombre, '  filtro nuevo ')
  assert.equal(entrada.cantidad, ' 3 ')
  assert.equal(a.filas[0].pieza?.nombre, 'FILTRO NUEVO')
  assert.equal(a.filas[0].pieza?.cantidad, 3)
})

await caso('47. analizarFilas: con lista de familias, una familia que no existe es ERROR con los códigos válidos', () => {
  const filas = [fila({ fila: 2, nombre: 'PIEZA', ubicacion: 'A', cantidad: '1', familia: 'XYZ' })]
  const a = analizarFilas(filas, [], contadorIds().nuevoId, FAMILIAS)
  assert.equal(a.filas[0].estado, 'error')
  assert.equal(a.filas[0].motivo, 'La familia «XYZ» no existe. Usa: ROD, FIL, HID')
  assert.equal(a.filas[0].pieza, undefined)
  assert.equal(a.errores, 1)
})

await caso('48. analizarFilas: la familia válida se guarda como código; si viene vacía, no lleva familia', () => {
  const filas = [
    fila({ fila: 2, nombre: 'PIEZA UNO', ubicacion: 'A', cantidad: '1', familia: 'Filtros' }),
    fila({ fila: 3, nombre: 'PIEZA DOS', ubicacion: 'A', cantidad: '1', familia: 'rod' }),
    fila({ fila: 4, nombre: 'PIEZA TRES', ubicacion: 'A', cantidad: '1', familia: 'Hidráulico' }),
    fila({ fila: 5, nombre: 'PIEZA CUATRO', ubicacion: 'A', cantidad: '1' }),
  ]
  const a = analizarFilas(filas, [], contadorIds().nuevoId, FAMILIAS)
  assert.equal(a.listas, 4)
  assert.deepEqual(a.filas.map((f) => f.pieza?.familia), ['FIL', 'ROD', 'HID', undefined])
})

await caso('49. analizarFilas: sin lista de familias el texto de la familia pasa en mayúscula', () => {
  const conFamilias = analizarFilas(
    [fila({ fila: 2, nombre: 'PIEZA', ubicacion: 'A', cantidad: '1', familia: ' rod ' })],
    [],
    contadorIds().nuevoId,
  )
  assert.equal(conFamilias.filas[0].pieza?.familia, 'ROD')

  // Una lista VACÍA se comporta igual que no tener lista: no valida y deja el texto.
  const conListaVacia = analizarFilas(
    [fila({ fila: 2, nombre: 'PIEZA', ubicacion: 'A', cantidad: '1', familia: 'lo que sea' })],
    [],
    contadorIds().nuevoId,
    [],
  )
  assert.equal(conListaVacia.filas[0].pieza?.familia, 'LO QUE SEA')
})

/* ─────────────────────────────── Rendimiento ─────────────────────────────── */

await caso('50. rendimiento: 600 filas contra 1.000 piezas existentes en menos de 3 segundos', () => {
  const existentes = Array.from({ length: 1000 }, (_, i) =>
    ins({
      id: `ex-${i}`,
      nombre: `REPUESTO EXISTENTE ${i}`,
      codigo: `REP-${String(i).padStart(4, '0')}`,
      numeroParte: `NP-${i}`,
    }),
  )
  const filas = Array.from({ length: 600 }, (_, i) =>
    fila({ fila: i + 2, nombre: `PIEZA NUEVA ${i}`, ubicacion: `ESTANTE ${i % 40}`, cantidad: '1' }),
  )
  const inicio = performance.now()
  const a = analizarFilas(filas, existentes, contadorIds().nuevoId)
  const ms = performance.now() - inicio
  console.log(`    (600 filas contra 1.000 existentes: ${ms.toFixed(0)} ms)`)
  assert.equal(a.listas, 600, 'ninguna fila nueva debería quedar como parecida')
  assert.equal(a.parecidas + a.errores, 0)
  assert.ok(ms < 3000, `tardó ${ms.toFixed(0)} ms (tope: 3.000 ms)`)
})

console.log(`\n${casos} casos bien`)
if (fallados > 0) {
  console.log(`${fallados} casos fallados`)
  process.exitCode = 1
}
