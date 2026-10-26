import type { Assignment } from '../domain/sam'
import { isSameCycle } from '../utils/suerteCycle.ts'

/**
 * Avance «a nivel de suerte + labor» de una asignación, en su CICLO ACTUAL (26-oct-2026).
 *
 * Varios operarios que trabajan la misma suerte y labor en el mismo ciclo comparten un mismo «restante»:
 * lo que hizo el compañero consume el área de la suerte. Con restante 0 la tarjeta sale de «Activas».
 *
 * 🔴 El TOTAL de la suerte es su ÁREA OFICIAL del maestro (la misma que usa el supervisor al programar, el
 * tope al cerrar y el candado de la base). Antes era «la mayor área asignada del ciclo»: funcionaba solo si
 * la primera fila llevaba la suerte entera. Cuando se anotó primero un pedazo (7 de 10,15 ha) y se programó
 * el resto (3,15), el máximo daba 7, el restante daba 0 y a Jon Arana le desapareció la labor (26-oct-2026).
 * El máximo del ciclo queda solo como respaldo para una suerte que todavía no está en el maestro.
 *
 * Lo ejecutado cuenta como lo cuenta la planilla: una cerrada (COMPLETADA/PARCIAL) vale su área ejecutada
 * y, si no la trae, su área asignada. El EN_PROCESO de OTRO operario no cuenta (área «en vuelo»).
 */
const normalizeText = (v: string): string => v.trim().toUpperCase()

/** Lo que se paga de una fila cerrada: el ejecutado y, si no hay, el asignado. */
export const areaPagada = (a: Pick<Assignment, 'status' | 'executedArea' | 'area'>): number => {
  const ejecutado = a.executedArea ?? 0
  return a.status === 'COMPLETADA' || a.status === 'PARCIAL' ? (ejecutado > 0 ? ejecutado : a.area ?? 0) : ejecutado
}

export function progresoSuerte(assignment: Assignment, todas: Assignment[], areaOficial: number | null) {
  const mismoCiclo = (a: Assignment) =>
    a.suerteCode === assignment.suerteCode &&
    normalizeText(a.labor) === normalizeText(assignment.labor) &&
    isSameCycle(a.dateKey, assignment.dateKey)

  const cerradas = todas.filter(
    (a) => mismoCiclo(a) && (a.status === 'COMPLETADA' || a.status === 'PARCIAL' || (a.status === 'EN_PROCESO' && a.id === assignment.id)),
  )
  const executedTotal = cerradas.reduce((sum, a) => sum + areaPagada(a), 0)
  const ownExecuted = assignment.executedArea ?? 0
  const sharedExecuted = Math.max(0, executedTotal - ownExecuted)

  const mayorAsignada = Math.max(
    assignment.area,
    ...todas.filter((a) => mismoCiclo(a) && a.status !== 'CANCELADA').map((a) => a.area),
  )
  const suerteTotalArea = areaOficial != null && areaOficial > 0 ? areaOficial : mayorAsignada
  const remaining = Math.max(0, suerteTotalArea - executedTotal)
  return {
    executedTotal,
    sharedExecuted,
    ownExecuted,
    remaining,
    suerteTotalArea,
    hasProgress: executedTotal > 0,
    hasSharedProgress: sharedExecuted > 0,
  }
}
