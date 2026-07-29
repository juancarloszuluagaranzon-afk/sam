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
 * Unidades que SOLO admiten enteros: no existe medio gancho ni 3.5 tornillos.
 * Se detecta por el nombre de la unidad del insumo. Las de medida (galón,
 * litro, kg, docena…) sí admiten decimales — media docena es válida.
 */
const UNIDADES_ENTERAS = [
  'unidad', 'unidades', 'und', 'un', 'u', 'c/u', 'cu',
  'pieza', 'piezas', 'pza', 'pzas',
  'gancho', 'ganchos', 'tornillo', 'tornillos',
  'arandela', 'arandelas', 'tuerca', 'tuercas',
  'rollo', 'rollos', 'bulto', 'bultos', 'saco', 'sacos',
  'caja', 'cajas', 'par', 'pares', 'juego', 'juegos', 'kit', 'kits',
]

/** ¿La unidad se cuenta de a enteros? (no admite decimales) */
export function esUnidadEntera(unidad?: string | null): boolean {
  const u = String(unidad ?? '').trim().toLowerCase()
  if (!u) return false
  return UNIDADES_ENTERAS.includes(u)
}

/**
 * Formatea una cantidad para la UI, según la unidad del insumo:
 *  · Unidad ENTERA (ganchos, tornillos…) → sin decimales: 760 → "760"
 *  · Unidad de medida (galón, kg, docena…) → hasta 2 decimales sin relleno:
 *    1020.4100000000001 → "1020.41" · 3.5 → "3.5" · 760 → "760"
 * Si un insumo entero tuviera decimales por un dato viejo, se muestran igual
 * (no se oculta información: el redondeo se hace al guardar, no al mostrar).
 */
export function fmtCantidad(n: number | null | undefined, unidad?: string | null): string {
  const v = redondear2(Number(n ?? 0))
  const entero = esUnidadEntera(unidad) && Number.isInteger(v)
  return new Intl.NumberFormat('es-CO', {
    maximumFractionDigits: entero ? 0 : 2,
    useGrouping: false,
  }).format(v)
}

/** Normaliza una cantidad antes de guardarla: entera si la unidad lo exige. */
export function normalizarCantidad(n: number, unidad?: string | null): number {
  return esUnidadEntera(unidad) ? Math.round(Number(n)) : redondear2(Number(n))
}

/** `step` para los <input type="number"> según la unidad. */
export function stepDe(unidad?: string | null): number | 'any' {
  return esUnidadEntera(unidad) ? 1 : 'any'
}
