import type { Insumo } from '../domain/sam'

/**
 * Carga de piezas del taller desde Excel y detección de piezas PARECIDAS (26-oct-2026).
 *
 * Por qué existe: el almacén tiene más de 500 piezas y las van a cargar varias personas. Sin revisar antes
 * de guardar, la misma pieza entra dos o tres veces con el nombre escrito distinto («RODAMIENTO 30206»,
 * «RODAMIENTO DE RUEDA 30206 »). Todo el análisis es puro (sin red ni pantalla) para poder probarlo con Node.
 *
 * Reglas fijas:
 *  - Lo que se digita va en MAYÚSCULA (la regla de la casa) y sin espacios sobrantes.
 *  - Solo son OBLIGATORIOS nombre, estante y cantidad. Todo lo demás es opcional.
 *  - Una fila PARECIDA a una pieza que ya existe, o repetida dentro del mismo archivo, NO se crea: se
 *    marca y se deja afuera (la persona decide). Una fila con ERROR tampoco se crea.
 *  - Nunca se inventa un dato: un número que no se entiende es un error, no un cero.
 */

/** Una fila cruda del Excel: todo en texto, tal como la escribió la persona. `fila` es el número de fila del archivo. */
export interface FilaPieza {
  fila: number
  nombre: string
  ubicacion: string
  cantidad: string
  familia?: string
  marca?: string
  numeroParte?: string
  referencia?: string
  stockMinimo?: string
}

/** La pieza ya limpia y con su uuid (el mismo `NuevaPieza` de `piezasApi` sin la bodega ni quién la carga). */
export interface PiezaCarga {
  id: string
  nombre: string
  ubicacion: string
  cantidad: number
  familia?: string
  marca?: string
  numeroParte?: string
  referencia?: string
  stockMinimo?: number
}

export type EstadoFila = 'lista' | 'parecida' | 'error'

export interface FilaAnalizada {
  fila: number
  estado: EstadoFila
  /** Frase corta en español para mostrar: «Falta el estante», «Ya existe ROD-0005 con el mismo N° de parte». */
  motivo?: string
  /** Solo en `lista`: la pieza lista para guardar. */
  pieza?: PiezaCarga
  /** Solo en `parecida`: a qué pieza existente (o a qué fila anterior del archivo) se parece. */
  parecidaA?: { id?: string; nombre: string; codigo?: string; ubicacion?: string; filaArchivo?: number }
  /** La fila tal como vino, para poder bajar «las que no pasaron» a un Excel corregible. */
  original: FilaPieza
}

export interface Analisis {
  filas: FilaAnalizada[]
  listas: number
  parecidas: number
  errores: number
}

/**
 * Texto comparable: MAYÚSCULA, sin tildes, signos convertidos en espacio y espacios colapsados.
 * «Rodamiento 30206-2RS» → «RODAMIENTO 30206 2RS». Devuelve '' si no queda nada.
 */
export function normalizarTexto(s: string | null | undefined): string {
  return String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLocaleUpperCase('es-CO')
    .replace(/[^\p{L}\p{N}]/gu, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * Número tecleado a mano → número. Acepta «14», «14,5», «14.5» y miles con punto «1.200» (o «1.200,5»).
 * Devuelve null si no es un número (vacío, letras, negativo no se acepta aquí: lo decide quien llama).
 */
export function aNumeroCarga(s: string): number | null {
  const texto = String(s ?? '').replace(/[\s\u00a0]/g, '')
  if (!texto) return null
  let normal = texto
  if (texto.includes(',') && texto.includes('.')) {
    if (!/^-?\d{1,3}(\.\d{3})+,\d+$/.test(texto)) return null
    normal = texto.replace(/\./g, '').replace(',', '.')
  } else if (texto.includes(',')) {
    if (!/^-?\d+,\d+$/.test(texto)) return null
    normal = texto.replace(',', '.')
  } else if (texto.includes('.')) {
    if (/^-?\d{1,3}(\.\d{3})+$/.test(texto)) normal = texto.replace(/\./g, '')
    else if (!/^-?\d+\.\d+$/.test(texto)) return null
  } else if (!/^-?\d+$/.test(texto)) return null
  const numero = Number(normal)
  return Number.isFinite(numero) ? numero : null
}

/** Campos que se reconocen en el encabezado del Excel. */
export type CampoCarga = 'nombre' | 'ubicacion' | 'cantidad' | 'familia' | 'marca' | 'numeroParte' | 'referencia' | 'stockMinimo'

/**
 * Qué columna del Excel es cada campo, leyendo los encabezados con `normalizarTexto` y sinónimos:
 * nombre ← NOMBRE | DESCRIPCION | PIEZA | REPUESTO; ubicacion ← ESTANTE | UBICACION | LUGAR;
 * cantidad ← CANTIDAD | EXISTENCIA | STOCK | CANT; familia ← FAMILIA | CATEGORIA;
 * marca ← MARCA; numeroParte ← N DE PARTE | NUMERO DE PARTE | NO DE PARTE | PARTE | N PARTE;
 * referencia ← REFERENCIA | REF; stockMinimo ← MINIMO | STOCK MINIMO | MIN.
 * `indice` solo trae los campos encontrados (posición en el arreglo de encabezados); `faltan` lista, en español y
 * en orden, los OBLIGATORIOS que no aparecen («nombre», «estante», «cantidad»).
 */
export function mapearColumnas(encabezados: string[]): { indice: Partial<Record<CampoCarga, number>>; faltan: string[] } {
  const sinonimos: Record<CampoCarga, string[]> = {
    nombre: ['NOMBRE', 'DESCRIPCION', 'PIEZA', 'REPUESTO'], ubicacion: ['ESTANTE', 'UBICACION', 'LUGAR'],
    cantidad: ['CANTIDAD', 'EXISTENCIA', 'STOCK', 'CANT'], familia: ['FAMILIA', 'CATEGORIA'], marca: ['MARCA'],
    numeroParte: ['N DE PARTE', 'NUMERO DE PARTE', 'NO DE PARTE', 'PARTE', 'N PARTE'], referencia: ['REFERENCIA', 'REF'],
    stockMinimo: ['MINIMO', 'STOCK MINIMO', 'MIN'],
  }
  const indice: Partial<Record<CampoCarga, number>> = {}
  encabezados.forEach((h, i) => {
    const normal = normalizarTexto(h)
    for (const campo of Object.keys(sinonimos) as CampoCarga[]) {
      if (indice[campo] === undefined && sinonimos[campo].includes(normal)) indice[campo] = i
    }
  })
  const faltan = (['nombre', 'ubicacion', 'cantidad'] as CampoCarga[]).filter((c) => indice[c] === undefined)
    .map((c) => c === 'ubicacion' ? 'estante' : c)
  return { indice, faltan }
}

/**
 * Piezas existentes parecidas a lo que se está escribiendo, la más parecida primero, hasta `max` (3 por defecto).
 * Es lo que alimenta el aviso «Ya hay piezas parecidas» del alta rápida y la revisión de la carga masiva.
 * Parecida si CUALQUIERA de estas es cierta (todas sobre `normalizarTexto`):
 *  1. mismo N° de parte (sin espacios) que el N° de parte, el código o la referencia de la existente (solo si no está vacío);
 *  2. el mismo nombre;
 *  3. el nombre más corto tiene 2 o más palabras de 2+ caracteres y TODAS están en el más largo
 *     («FILTRO ACEITE» ~ «FILTRO DE ACEITE MOTOR»; una sola palabra («RODAMIENTO») NO alcanza).
 * Orden: por N° de parte, luego por nombre igual, luego por contención. Solo se consideran piezas activas.
 */
type InsumoIndexado = { insumo: Insumo; nombre: string; parte: string; codigos: string[] }
export function indexarExistentes(existentes: Insumo[]): InsumoIndexado[] {
  return existentes.filter((e) => e.activo !== false).map((insumo) => ({
    insumo, nombre: normalizarTexto(insumo.nombre),
    parte: normalizarTexto(insumo.numeroParte).replace(/\s/g, ''),
    codigos: [insumo.codigo, insumo.referencia].map((x) => normalizarTexto(x).replace(/\s/g, '')).filter(Boolean),
  }))
}

function buscarEnIndice(nombre: string, numeroParte: string, indexados: InsumoIndexado[], max: number): Insumo[] {
  const n = normalizarTexto(nombre)
  const np = normalizarTexto(numeroParte).replace(/\s/g, '')
  const palabras = n.split(' ').filter((p) => p.length >= 2)
  const candidatas = indexados.map((x) => {
    const e = x.insumo
    const parte = !!np && (x.parte === np || x.codigos.includes(np))
    const en = x.nombre
    const igual = !!n && en === n
    const ep = en.split(' ').filter((p) => p.length >= 2)
    const corto = palabras.length <= ep.length ? palabras : ep
    const largo = palabras.length <= ep.length ? ep : palabras
    const contenido = corto.length >= 2 && corto.every((p) => largo.includes(p))
    return { e, rango: parte ? 0 : igual ? 1 : contenido ? 2 : 9 }
  }).filter((x) => x.rango < 9)
    .sort((a, b) => a.rango - b.rango)
  const vistos = new Set<string>()
  return candidatas.filter(({ e }) => !vistos.has(e.id) && !!vistos.add(e.id)).slice(0, max).map(({ e }) => e)
}

export function buscarParecidas(nombre: string, numeroParte: string, existentes: Insumo[], max = 3): Insumo[] {
  return buscarEnIndice(nombre, numeroParte, indexarExistentes(existentes), max)
}

/**
 * Analiza las filas del Excel contra lo que ya existe. Por cada fila, en este orden:
 *  - ERROR si falta el nombre («Falta el nombre»), el estante («Falta el estante») o la cantidad («Falta la cantidad»),
 *    si la cantidad no es un número o es negativa («La cantidad no es un número»), o si el mínimo viene escrito y no es número.
 *  - PARECIDA si se parece a una existente (`buscarParecidas`, motivo «Ya existe CODIGO o NOMBRE …» diciendo por qué)
 *    o a una fila LISTA anterior del mismo archivo (motivo «Repetida: igual a la fila N»).
 *  - LISTA en los demás casos, con la pieza limpia (MAYÚSCULA, número ya convertido) y un id de `nuevoId()`.
 * Las filas completamente vacías (todo en blanco) se ignoran y no cuentan. Conserva el orden del archivo.
 */
export interface FamiliaCarga { codigo: string; nombre: string }

/**
 * A qué familia se refiere el texto de la columna «Familia»: el código («ROD»), el nombre completo («Rodamientos y
 * retenedores») o su primera palabra en singular o plural («Rodamiento»). null = no existe. Sin lista de familias no
 * se valida nada (se deja el texto como vino).
 */
export function resolverFamilia(texto: string, familias: FamiliaCarga[]): string | null {
  const t = normalizarTexto(texto)
  if (!t) return null
  const clave = (s: string) => normalizarTexto(s).split(' ')[0].replace(/S$/, '')
  const f = familias.find((x) => x.codigo.toUpperCase() === t.replace(/ /g, ''))
    ?? familias.find((x) => normalizarTexto(x.nombre) === t)
    ?? familias.find((x) => clave(x.nombre) === clave(t))
  return f ? f.codigo.toUpperCase() : null
}

export function analizarFilas(filas: FilaPieza[], existentes: Insumo[], nuevoId: () => string, familias?: FamiliaCarga[]): Analisis {
  const salida: FilaAnalizada[] = []
  const anteriores: { fila: number; pieza: PiezaCarga }[] = []
  const indiceExistentes = indexarExistentes(existentes)
  for (const original of filas) {
    if (![original.nombre, original.ubicacion, original.cantidad, original.familia, original.marca, original.numeroParte, original.referencia, original.stockMinimo].some((x) => String(x ?? '').trim())) continue
    const nombre = String(original.nombre ?? '').trim().toLocaleUpperCase('es-CO')
    const ubicacion = String(original.ubicacion ?? '').trim().toLocaleUpperCase('es-CO')
    const cantidad = aNumeroCarga(original.cantidad)
    let motivo: string | undefined
    if (!nombre) motivo = 'Falta el nombre'
    else if (!ubicacion) motivo = 'Falta el estante'
    else if (!String(original.cantidad ?? '').trim()) motivo = 'Falta la cantidad'
    else if (cantidad === null || cantidad < 0) motivo = 'La cantidad no es un número'
    const minimoEscrito = !!String(original.stockMinimo ?? '').trim()
    const stockMinimo = minimoEscrito ? aNumeroCarga(original.stockMinimo!) : null
    if (!motivo && minimoEscrito && (stockMinimo === null || stockMinimo < 0)) motivo = 'El mínimo no es un número'
    // Con la lista de familias, una familia que no existe es un ERROR (no se inventa un código «RODAMIENTO-0001»).
    let familiaResuelta: string | undefined
    const familiaEscrita = String(original.familia ?? '').trim()
    if (!motivo && familiaEscrita && familias && familias.length) {
      const codigo = resolverFamilia(familiaEscrita, familias)
      if (codigo) familiaResuelta = codigo
      else motivo = `La familia «${familiaEscrita}» no existe. Usa: ${familias.map((f) => f.codigo).join(', ')}`
    }
    if (motivo) { salida.push({ fila: original.fila, estado: 'error', motivo, original }); continue }
    const numeroParte = String(original.numeroParte ?? '').trim().toLocaleUpperCase('es-CO')
    const similar = buscarEnIndice(nombre, numeroParte, indiceExistentes, 1)[0]
    if (similar) {
      const mismoParte = !!normalizarTexto(numeroParte) && [similar.numeroParte, similar.codigo, similar.referencia].some((v) => normalizarTexto(v).replace(/\s/g, '') === normalizarTexto(numeroParte).replace(/\s/g, ''))
      const mismoNombre = normalizarTexto(similar.nombre) === normalizarTexto(nombre)
      const motivoSimilar = mismoParte ? 'con el mismo N° de parte' : mismoNombre ? 'con el mismo nombre' : `(nombre parecido: ${similar.nombre})`
      salida.push({ fila: original.fila, estado: 'parecida', motivo: `Ya existe ${similar.codigo || similar.nombre} ${motivoSimilar}`, parecidaA: { id: similar.id, nombre: similar.nombre, codigo: similar.codigo, ubicacion: similar.ubicacion }, original }); continue
    }
    const repetida = anteriores.find(({ pieza }) => normalizarTexto(pieza.nombre) === normalizarTexto(nombre) || (!!numeroParte && normalizarTexto(pieza.numeroParte).replace(/\s/g, '') === normalizarTexto(numeroParte).replace(/\s/g, '')))
    if (repetida) { salida.push({ fila: original.fila, estado: 'parecida', motivo: `Repetida: igual a la fila ${repetida.fila}`, parecidaA: { nombre: repetida.pieza.nombre, filaArchivo: repetida.fila }, original }); continue }
    const opcional = (v?: string) => String(v ?? '').trim().toLocaleUpperCase('es-CO') || undefined
    const pieza: PiezaCarga = { id: nuevoId(), nombre, ubicacion, cantidad: cantidad!, familia: familiaResuelta ?? (familias && familias.length ? undefined : opcional(original.familia)), marca: opcional(original.marca), numeroParte: opcional(original.numeroParte), referencia: opcional(original.referencia), stockMinimo: minimoEscrito ? stockMinimo! : undefined }
    salida.push({ fila: original.fila, estado: 'lista', pieza, original }); anteriores.push({ fila: original.fila, pieza })
  }
  return { filas: salida, listas: salida.filter((f) => f.estado === 'lista').length, parecidas: salida.filter((f) => f.estado === 'parecida').length, errores: salida.filter((f) => f.estado === 'error').length }
}

/**
 * Lee el primer libro de un archivo .xlsx/.xls/.csv (con `import('xlsx')` dinámico, como `FacturacionTab`) y arma
 * las `FilaPieza` con `mapearColumnas` sobre la primera fila con datos. Celdas vacías → ''. `fila` = número real de
 * la fila en el Excel (la 1 es el encabezado). Si faltan columnas obligatorias NO lanza: devuelve `faltan` y las filas
 * vacías. Si el archivo no se puede leer lanza un Error en español («No se pudo leer el archivo. ¿Es un Excel?»).
 */
export async function leerArchivoPiezas(file: File): Promise<{ filas: FilaPieza[]; faltan: string[] }> {
  try {
    const XLSX = await import('xlsx')
    const libro = XLSX.read(await file.arrayBuffer(), { type: 'array' })
    const hoja = libro.Sheets[libro.SheetNames[0]]
    // 🔴 `raw: true`: con `raw: false` SheetJS devuelve el número YA FORMATEADO a la inglesa, y una celda de 1200 con
    // formato de miles llega como «1,200», que aquí se leería como 1,2 (un dato mal guardado sin avisar). Un número de
    // verdad se pasa con COMA decimal («14,5», «1,234»): nunca cae en la regla del punto de miles, que es solo para
    // texto tecleado («1.234» escrito a mano = mil doscientos treinta y cuatro).
    const matriz = XLSX.utils.sheet_to_json(hoja, { header: 1, raw: true, defval: '' }) as unknown[][]
    const texto = (x: unknown) => (typeof x === 'number' ? String(x).replace('.', ',') : String(x ?? '').trim())
    const filaEnc = matriz.findIndex((r) => r.some((x) => texto(x)))
    if (filaEnc < 0) return { filas: [], faltan: ['nombre', 'estante', 'cantidad'] }
    const encabezados = matriz[filaEnc].map((x) => texto(x))
    const { indice, faltan } = mapearColumnas(encabezados)
    if (faltan.length) return { filas: [], faltan }
    const valor = (r: unknown[], campo: CampoCarga) => texto(r[indice[campo]!])
    const filas = matriz.slice(filaEnc + 1).map((r, i) => ({ fila: filaEnc + i + 2, nombre: valor(r, 'nombre'), ubicacion: valor(r, 'ubicacion'), cantidad: valor(r, 'cantidad'), familia: indice.familia === undefined ? undefined : valor(r, 'familia'), marca: indice.marca === undefined ? undefined : valor(r, 'marca'), numeroParte: indice.numeroParte === undefined ? undefined : valor(r, 'numeroParte'), referencia: indice.referencia === undefined ? undefined : valor(r, 'referencia'), stockMinimo: indice.stockMinimo === undefined ? undefined : valor(r, 'stockMinimo') }))
    return { filas, faltan }
  } catch { throw new Error('No se pudo leer el archivo. ¿Es un Excel?') }
}

/** Baja al equipo la plantilla `plantilla-piezas-taller.xlsx`: encabezados exactos y 2 filas de ejemplo (que digan EJEMPLO). */
export async function descargarPlantillaPiezas(familias: FamiliaCarga[] = []): Promise<void> {
  const XLSX = await import('xlsx')
  const wb = XLSX.utils.book_new()
  const hoja = XLSX.utils.aoa_to_sheet([['Nombre', 'Estante', 'Cantidad', 'Familia', 'Marca', 'N° de parte', 'Referencia', 'Mínimo'], ['EJEMPLO RODAMIENTO 6206 (borra esta fila)', 'ESTANTE A-1', '2', 'ROD', 'SKF', '6206-2RS', '', '0'], ['EJEMPLO FILTRO DE ACEITE (borra esta fila)', 'ESTANTE B-2', '5', 'FIL', 'BOSCH', '', 'ABC-123', '1']])
  XLSX.utils.book_append_sheet(wb, hoja, 'Piezas')
  // Segunda hoja de consulta: los códigos de familia válidos (la columna «Familia» acepta el código o el nombre).
  if (familias.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Código de familia', 'Nombre'], ...familias.map((f) => [f.codigo, f.nombre])]), 'Familias')
  XLSX.writeFile(wb, 'plantilla-piezas-taller.xlsx')
}

/**
 * Baja `piezas-que-no-pasaron.xlsx`: las filas `parecida` y `error` con sus datos originales y una columna final
 * «Motivo», para que la persona las corrija en el Excel y las vuelva a subir.
 */
export async function descargarNoPasaron(analisis: Analisis): Promise<void> {
  const XLSX = await import('xlsx')
  const wb = XLSX.utils.book_new()
  const columnas: (keyof FilaPieza)[] = ['nombre', 'ubicacion', 'cantidad', 'familia', 'marca', 'numeroParte', 'referencia', 'stockMinimo']
  const encabezados = ['Nombre', 'Estante', 'Cantidad', 'Familia', 'Marca', 'N° de parte', 'Referencia', 'Mínimo', 'Motivo']
  const filas = analisis.filas.filter((f) => f.estado !== 'lista').map((f) => [...columnas.map((c) => f.original[c] ?? ''), f.motivo ?? ''])
  const hoja = XLSX.utils.aoa_to_sheet([encabezados, ...filas])
  XLSX.utils.book_append_sheet(wb, hoja, 'No pasaron')
  XLSX.writeFile(wb, 'piezas-que-no-pasaron.xlsx')
}
