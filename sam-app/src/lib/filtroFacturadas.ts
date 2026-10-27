/**
 * Filtro «Mostrar» (todas / sin facturar / ya facturadas), orden por número de factura y selector de una
 * factura, para la lista de Facturación (26-oct-2026, pedido de Iván: «poder filtrar y ordenar por las que ya
 * tienen factura asignada»). Son funciones puras: la pantalla les pasa cómo saber el número de factura de una línea.
 *
 * La lista de Facturación NO se mueve al vincular una factura, así que «Mostrar» y «Factura» FIJAN las líneas
 * que cumplían al escogerlos (mismo patrón de `fijasSinTarifa`): una línea recién facturada no desaparece de
 * «Sin facturar» hasta que se vuelva a escoger.
 */
export type Mostrar = 'TODAS' | 'SIN' | 'YA'
export type OrdenLista = 'FECHA' | 'FACTURA'

interface LineaMinima { id: string }

/** Número de factura de una línea (del documento si existe, si no el escrito antes de existir los documentos). */
export type NumeroDe<T> = (a: T) => string | null

/** Ids de las líneas que cumplen «Mostrar»; null = todas (sin filtro). */
export function fijarMostrar<T extends LineaMinima>(lineas: T[], mostrar: Mostrar, facturada: (a: T) => boolean): Set<string> | null {
  if (mostrar === 'TODAS') return null
  return new Set(lineas.filter((a) => facturada(a) === (mostrar === 'YA')).map((a) => a.id))
}

/** Ids de las líneas de UNA factura; null = sin factura escogida. */
export function fijarFactura<T extends LineaMinima>(lineas: T[], numero: string, numeroDe: NumeroDe<T>): Set<string> | null {
  if (!numero) return null
  return new Set(lineas.filter((a) => numeroDe(a) === numero).map((a) => a.id))
}

/** Las facturas presentes en las líneas, con cuántas líneas tiene cada una (para el selector). */
export function opcionesFactura<T>(lineas: T[], numeroDe: NumeroDe<T>): Array<{ numero: string; lineas: number }> {
  const m = new Map<string, number>()
  for (const a of lineas) {
    const n = numeroDe(a)
    if (n) m.set(n, (m.get(n) ?? 0) + 1)
  }
  return [...m].map(([numero, lineas]) => ({ numero, lineas })).sort((x, y) => cmpNumero(x.numero, y.numero))
}

/** Números con letras y cifras («FECE 1173», «FE-99»): por cifras, no letra a letra («99» antes de «1173»). */
export const cmpNumero = (x: string, y: string): number => x.localeCompare(y, 'es', { numeric: true, sensitivity: 'base' })

/**
 * Ordena por número de factura. Las líneas de una misma factura quedan juntas y, dentro de cada una, conservan el
 * orden en que venían (la fecha); las que no tienen factura van al final, también en su orden. No toca el original.
 */
export function ordenarPorFactura<T>(lineas: T[], numeroDe: NumeroDe<T>): T[] {
  const con: Array<{ a: T; n: string; i: number }> = []
  const sin: T[] = []
  lineas.forEach((a, i) => {
    const n = numeroDe(a)
    if (n) con.push({ a, n, i }); else sin.push(a)
  })
  con.sort((x, y) => cmpNumero(x.n, y.n) || x.i - y.i)
  return [...con.map((x) => x.a), ...sin]
}
