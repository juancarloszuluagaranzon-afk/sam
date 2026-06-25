// Agrupacion por "ciclo de trabajo" de una suerte+labor.
//
// PROBLEMA QUE RESUELVE
// --------------------
// Antes, el avance conjunto de varios operarios sobre la MISMA suerte+labor
// se agrupaba exigiendo el MISMO `dateKey` exacto (mismo dia de creacion del
// registro). Eso funciona para labores PROGRAMADAS (el supervisor las asigna
// el mismo dia), pero ROMPE las labores TOMADAS EN CAMPO: dos operarios que
// toman la misma suerte en dias distintos quedaban en `dateKey` distintos, no
// se veian entre si, y la labor NUNCA cerraba aunque entre ambos cubrieran el
// area total.
//
//   Caso real: LA ESPERANZA - 04U (18.86 ha). Julio hizo 9.66 y Rolando 9.20
//   (= 18.86 exacto). Como tomaron la suerte en dias distintos, cada uno veia
//   solo su parte ("Falta 9.20" / "Falta 9.66") y la labor seguia activa para
//   ambos.
//
// SOLUCION
// --------
// En lugar de exigir el mismo dia exacto, consideramos parte del MISMO CICLO
// a los registros de la misma suerte+labor cuyas fechas esten dentro de una
// VENTANA tolerante. Una colaboracion real entre operarios ocurre en dias
// (a lo sumo un par de semanas con clima/equipos). Un re-laboreo de la misma
// suerte meses despues queda FUERA de la ventana y sigue siendo un ciclo
// distinto — preservando la separacion historica que motivo el filtro original.

import type { Assignment } from '../domain/sam'

export const CYCLE_WINDOW_DAYS = 21

function normalizeText(value: string) {
  return value.trim().toUpperCase()
}

/**
 * Devuelve, si existe, una asignacion REUTILIZABLE para esa suerte+labor: una
 * linea PENDIENTE, nunca iniciada, sin avance y no liberada. Incluye las que la
 * regla de 72h oculto de Activas (siguen PENDIENTE en la base). Cuando un
 * operario la toma en campo o el supervisor la reasigna, se REUSA esta misma
 * fila (cambiando operario/fecha) en vez de crear una linea programada
 * duplicada — asi una suerte nunca queda programada dos o tres veces.
 *
 * NO toca COMPLETADA / PARCIAL / EN_PROCESO: una labor ya trabajada o cerrada
 * es "otra situacion" (re-laboreo) y conserva su propia linea e historico.
 */
export function findReusableAssignment(
  assignments: Assignment[],
  suerteCode: string,
  labor: string,
  excludeIds?: Set<string>,
): Assignment | undefined {
  return assignments.find(
    (a) =>
      a.suerteCode === suerteCode &&
      normalizeText(a.labor) === normalizeText(labor) &&
      a.status === 'PENDIENTE' &&
      !a.startedAt &&
      (a.executedArea ?? 0) === 0 &&
      !a.liberada &&
      !(excludeIds?.has(a.id) ?? false),
  )
}

const MS_PER_DAY = 86_400_000

/**
 * Dias calendario (absolutos) entre dos `dateKey` con formato 'YYYY-MM-DD'.
 * Retorna Infinity si alguna clave esta vacia o malformada, de modo que
 * `isSameCycle` los trate como ciclos distintos (comportamiento seguro).
 */
export function daysBetweenKeys(a: string, b: string): number {
  if (!a || !b) return Infinity
  const pa = a.split('-').map(Number)
  const pb = b.split('-').map(Number)
  if (pa.length !== 3 || pb.length !== 3 || pa.some(isNaN) || pb.some(isNaN)) {
    return Infinity
  }
  const da = Date.UTC(pa[0], pa[1] - 1, pa[2])
  const db = Date.UTC(pb[0], pb[1] - 1, pb[2])
  return Math.abs(da - db) / MS_PER_DAY
}

/**
 * True si dos registros (por su `dateKey`) pertenecen al mismo ciclo de
 * trabajo, es decir, sus fechas estan dentro de `CYCLE_WINDOW_DAYS`.
 * Reemplaza al antiguo `a.dateKey === b.dateKey`.
 */
export function isSameCycle(a: string, b: string): boolean {
  return daysBetweenKeys(a, b) <= CYCLE_WINDOW_DAYS
}
