/**
 * Cantidades de insumos (galones, unidades, kg…): SIEMPRE con 2 decimales.
 *
 * Por qué: sumar/restar decimales en punto flotante produce basura
 * (1020.41 - 0 → 1020.4100000000001). Se corrige en los dos frentes:
 *  · `redondear2` al CALCULAR saldos (la raíz — evita que la basura se guarde).
 *  · `fmtCantidad` al MOSTRAR (por si ya hay datos viejos con cola de decimales).
 */

/** Redondea a 2 decimales devolviendo un número limpio. */
export function redondear2(n: number): number {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100
}

/**
 * Formatea una cantidad para la UI: máximo 2 decimales y sin ceros de relleno.
 * 1020.4100000000001 → "1020.41" · 760 → "760" · 3.5 → "3.5"
 */
export function fmtCantidad(n: number | null | undefined): string {
  const v = redondear2(Number(n ?? 0))
  return new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2, useGrouping: false }).format(v)
}
