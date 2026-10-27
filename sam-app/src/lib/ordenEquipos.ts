/**
 * Orden de las máquinas que mandan los informes (Ola 1 de la reunión con ASM, 26-oct-2026).
 *
 * La posición la decide el usuario (`equipos.orden`: 1, 2, 3…). Una máquina SIN posición (recién llegada) va al final,
 * por código, hasta que alguien la suba donde corresponda. Las pantallas que listan máquinas usan `compararEquipos`
 * en vez de ordenar por código o por consumo cada una por su lado; el registro de abajo lo llena `loadEquipment*`.
 */

let posiciones = new Map<string, number>()

const norm = (c: string) => String(c ?? '').trim().toUpperCase()

/** Guarda la posición de cada máquina (las que no traen `orden` quedan sin posición). Reemplaza lo anterior. */
export function registrarOrdenEquipos(lista: Array<{ code: string; orden?: number | null }>): void {
  const m = new Map<string, number>()
  for (const e of lista) if (e.orden != null && Number.isFinite(Number(e.orden))) m.set(norm(e.code), Number(e.orden))
  posiciones = m
}

/** Posición de una máquina; `Infinity` si no tiene (va al final). */
export function posicionEquipo(code: string): number {
  return posiciones.get(norm(code)) ?? Infinity
}

/** Comparador por posición; sin posición al final; a igualdad, por código «numérico» (CASE 2 antes que CASE 10). */
export function compararEquipos(a: string, b: string): number {
  const pa = posicionEquipo(a)
  const pb = posicionEquipo(b)
  if (pa !== pb) return pa < pb ? -1 : 1
  return String(a).localeCompare(String(b), 'es', { numeric: true, sensitivity: 'base' })
}

/** Copia ordenada de una lista según el orden de las máquinas. `codigoDe` dice cuál es el código de cada elemento. */
export function ordenarPorOrdenEquipos<T>(lista: T[], codigoDe: (x: T) => string): T[] {
  return [...lista].sort((x, y) => compararEquipos(codigoDe(x), codigoDe(y)))
}

/** Mueve un elemento de `desde` a `hacia` (para las flechas ↑ ↓ y el arrastre). No cambia la lista original; fuera de rango = igual. */
export function moverElemento<T>(lista: T[], desde: number, hacia: number): T[] {
  const sale = [...lista]
  if (desde < 0 || desde >= sale.length || hacia < 0 || hacia >= sale.length || desde === hacia) return sale
  const [x] = sale.splice(desde, 1)
  sale.splice(hacia, 0, x)
  return sale
}
