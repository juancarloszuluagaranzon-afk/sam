import type { Assignment, MaestroRow } from '../domain/sam'
import { areaOficialSuerte } from './areaSuerte.ts'
import { areaPagada } from './progresoSuerte.ts'
import { diaKey } from './fechas.ts'
import { daysBetweenKeys, CYCLE_WINDOW_DAYS } from '../utils/suerteCycle.ts'

/**
 * Aviso ANTES DE PAGAR (26-oct-2026): ciclos de una suerte y labor cuyo total pagado pasa del área oficial.
 *
 * Es la última capa del «candado de área» (regla de Iván: por ninguna razón se paga más del área de la suerte,
 * así sean dos o tres operarios). La base ya rechaza el exceso al guardar y las pantallas lo topan; esto revisa
 * lo YA registrado, por si algo se coló o si el área oficial cambió después (el maestro se recarga seguido: un
 * «exceso» puede ser un área corregida y no un pago doble, y por eso se muestra para REVISAR, no se bloquea).
 *
 * Un ciclo = las filas de la misma hacienda, suerte y labor encadenadas con menos de 21 días entre una y otra,
 * la misma ventana que usan las pantallas y la base. Lo pagado de cada fila = su área ejecutada y, si no la trae,
 * la asignada (la misma regla de la planilla). Las labores que no son hectáreas no se comparan con el área.
 */

export const MARGEN_AREA = 0.02

export interface FilaDeCiclo { id: string; operador: string; area: number; fecha: string }
export interface CicloEnExceso {
  clave: string
  haciendaName: string
  suerte: string
  labor: string
  areaOficial: number
  areaPagada: number
  exceso: number
  desde: string
  hasta: string
  filas: FilaDeCiclo[]
}

const norm = (s: string | null | undefined): string => String(s ?? '').trim().toUpperCase()
const fechaDe = (a: Assignment): string => (a.finishedAt ? diaKey(a.finishedAt) : a.dateKey)

export function ciclosEnExceso(
  asignaciones: Assignment[],
  maestro: MaestroRow[],
  rango: { desde: string; hasta: string } | null,
  esHectareas: (labor: string) => boolean,
  margen: number = MARGEN_AREA,
  soloConFilas?: Set<string>,
): CicloEnExceso[] {
  const grupos = new Map<string, Assignment[]>()
  for (const a of asignaciones ?? []) {
    if ((a.status !== 'COMPLETADA' && a.status !== 'PARCIAL') || areaPagada(a) <= 0 || !esHectareas(a.labor)) continue
    const k = `${a.ingenioId ?? ''}|${norm(a.haciendaName)}|${norm(a.suerteCode)}|${norm(a.labor)}`
    const g = grupos.get(k)
    if (g) g.push(a); else grupos.set(k, [a])
  }

  // El maestro tiene ~21.000 filas: se indexa UNA vez por suerte. Buscar el área de cada ciclo recorriéndolo
  // entero era lo que volvía lenta la planilla.
  const porSuerte = new Map<string, MaestroRow[]>()
  for (const m of maestro ?? []) {
    const k = norm(m.suerte)
    const g = porSuerte.get(k)
    if (g) g.push(m); else porSuerte.set(k, [m])
  }

  const salida: CicloEnExceso[] = []
  for (const [clave, filas] of grupos) {
    const ordenadas = [...filas].sort((x, y) => fechaDe(x).localeCompare(fechaDe(y)) || x.id.localeCompare(y.id))
    const ciclos: Assignment[][] = []
    for (const a of ordenadas) {
      const actual = ciclos[ciclos.length - 1]
      const ultima = actual?.[actual.length - 1]
      if (actual && ultima && daysBetweenKeys(fechaDe(ultima), fechaDe(a)) <= CYCLE_WINDOW_DAYS) actual.push(a)
      else ciclos.push([a])
    }
    for (const ciclo of ciclos) {
      if (rango && !ciclo.some((a) => fechaDe(a) >= rango.desde && fechaDe(a) <= rango.hasta)) continue
      // Resumen y Reporte ya filtran por su cuenta (periodo, estado, operario…): se muestran solo los ciclos que
      // tocan alguna de las filas que la pantalla está mostrando, pero el total del ciclo cuenta TODAS las filas.
      if (soloConFilas && !ciclo.some((a) => soloConFilas.has(a.id))) continue
      const oficial = areaOficialSuerte(porSuerte.get(norm(ciclo[0].suerte)) ?? [], ciclo[0])
      if (oficial == null) continue // sin área oficial no hay con qué comparar
      const pagada = ciclo.reduce((s, a) => s + areaPagada(a), 0)
      if (pagada <= oficial + margen + 1e-9) continue // el 1e-9 absorbe el ruido de los decimales flotantes
      const desde = fechaDe(ciclo[0]), hasta = fechaDe(ciclo[ciclo.length - 1])
      salida.push({
        clave: `${clave}|${desde}`,
        haciendaName: ciclo[0].haciendaName ?? '',
        suerte: ciclo[0].suerte,
        labor: ciclo[0].labor,
        areaOficial: oficial,
        areaPagada: pagada,
        exceso: pagada - oficial,
        desde, hasta,
        filas: ciclo.map((a) => ({ id: a.id, operador: (a.operatorName || a.operatorId || '').trim(), area: areaPagada(a), fecha: fechaDe(a) })),
      })
    }
  }
  return salida.sort((a, b) => b.exceso - a.exceso)
}
