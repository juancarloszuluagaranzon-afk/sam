/**
 * Valor de una factura contra la suma de sus líneas (Ola 1 de la reunión con ASM, 26-oct-2026).
 *
 * El problema real: al pegar más fincas a una factura que ya existía, el valor se quedaba con el de la PRIMERA
 * tanda (una factura de 35 millones quedó en 3) y nadie se enteraba. Dos reglas lo resuelven:
 *  1. Si el total nunca se tocó (era «automático»: igual a la suma de sus líneas), al pegar más líneas se SUMA solo.
 *  2. Si alguien escribió el total que dice el PDF (distinto de la suma), se RESPETA y solo se compara: así se ve si
 *     lo que está pegado cuadra con lo que dice la factura. Esa comparación es el primer paso de «que lea la factura».
 *
 * Las tarifas viven en la app (no en la base), por eso las sumas las hace el cliente y aquí no hay red ni pantalla.
 */

export type EstadoCuadre = 'cuadra' | 'faltan' | 'se_pasa' | 'sin_total'

export interface Cuadre {
  /** Total de la factura (el valor del documento). null = no se anotó. */
  total: number | null
  /** Suma de los valores de las líneas pegadas. */
  suma: number
  /** total − suma (positivo = faltan pesos por pegar; negativo = lo pegado se pasa). null si no hay total. */
  diferencia: number | null
  estado: EstadoCuadre
}

/** Pesos de diferencia que se perdonan: los centavos de las tarifas por área y el redondeo de la factura. */
export const TOLERANCIA_CUADRE = 100

const redondear = (n: number) => Math.round(n * 100) / 100

/** ¿Cuadra el total de la factura con la suma de sus líneas? */
export function cuadreFactura(total: number | null | undefined, suma: number): Cuadre {
  const s = redondear(Number.isFinite(suma) ? suma : 0)
  if (total == null || !Number.isFinite(total)) return { total: null, suma: s, diferencia: null, estado: 'sin_total' }
  const t = redondear(total)
  const dif = redondear(t - s)
  const estado: EstadoCuadre = Math.abs(dif) <= TOLERANCIA_CUADRE ? 'cuadra' : dif > 0 ? 'faltan' : 'se_pasa'
  return { total: t, suma: s, diferencia: dif, estado }
}

/**
 * Qué total queda al vincular más líneas a una factura que ya existe.
 * `automatico` = el total era la suma de sus líneas (o no tenía): se suma lo nuevo. Si no, se respeta el que se escribió.
 */
export function totalAlVincular(
  totalActual: number | null | undefined,
  sumaAntes: number,
  sumaNueva: number,
): { total: number; automatico: boolean } {
  const nueva = redondear(sumaNueva)
  if (totalActual == null || !Number.isFinite(totalActual)) return { total: nueva, automatico: true }
  const eraAutomatico = Math.abs(redondear(totalActual) - redondear(sumaAntes)) <= TOLERANCIA_CUADRE
  return eraAutomatico ? { total: nueva, automatico: true } : { total: redondear(totalActual), automatico: false }
}

/** Suma los valores de unas líneas; las que no tienen precio no suman y se cuentan aparte (nunca se inventa un cero). */
export function sumaDeLineas(ids: string[], valorDe: (id: string) => number | null | undefined): { suma: number; sinPrecio: number } {
  let suma = 0
  let sinPrecio = 0
  for (const id of ids) {
    const v = valorDe(id)
    if (v == null || !Number.isFinite(v)) sinPrecio += 1
    else suma += v
  }
  return { suma: redondear(suma), sinPrecio }
}
