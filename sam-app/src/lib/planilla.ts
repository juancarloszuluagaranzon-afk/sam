import type { Assignment } from '../domain/sam'
import { executionDateKey } from '../services/samApi'
import { isSameCycle } from '../utils/suerteCycle'

/**
 * La regla de área de la PLANILLA, en un solo sitio.
 *
 * 🔴 Vive aquí y no dentro de una pantalla porque **con esta planilla se paga**,
 * y ya pasó una vez: la Planilla y el Resumen tenían cada uno su copia del
 * criterio, dejaron de coincidir y faltaban **89,91 ha de 7 operarios** en la
 * quincena con la que se cobra. Dos copias de una regla de dinero se separan sin
 * que nadie se dé cuenta. Si aquí se cambia algo, cambia para todos los que la
 * usan — que es exactamente lo que se quiere.
 */

/**
 * Área que cuenta de una labor CERRADA.
 *
 * Cerrar sin escribir el área significa "hice lo planificado", no "hice cero".
 * Aplica SOLO a COMPLETADA/PARCIAL; una labor abierta cuenta 0.
 */
export function areaCerrada(a: Assignment): number {
  const ejec = a.executedArea ?? 0
  return ejec > 0 ? ejec : (a.area ?? 0)
}

export type AvanceCerrado = Map<string, { date: string; exec: number }[]>

/**
 * Avance ya cerrado por suerte+labor, para estimar el restante de las EN_PROCESO
 * sin volver a contar lo hecho en días anteriores.
 *
 * ⚠️ Se arma con **todas** las asignaciones, no solo con las de un operario: una
 * misma suerte la avanzan varios entre todos. Filtrarlo por operario haría que su
 * línea mostrara más de lo que la planilla le paga.
 */
export function avanceCerradoPorSuerte(assignments: Assignment[]): AvanceCerrado {
  const m: AvanceCerrado = new Map()
  for (const a of assignments) {
    if (a.status !== 'COMPLETADA' && a.status !== 'PARCIAL') continue
    const k = `${a.suerteCode}|${a.labor.trim().toUpperCase()}`
    const arr = m.get(k) ?? []
    arr.push({ date: executionDateKey(a), exec: areaCerrada(a) })
    m.set(k, arr)
  }
  return m
}

/**
 * Área que aporta una labor al día en que se ejecutó.
 *
 * Para lo cerrado, lo ejecutado. Para lo EN_PROCESO, el **restante estimado** de
 * esa suerte: así una labor que cruza de día no se cuenta dos veces (antes sumaba
 * el área planificada al abrir y 13,3 + 13,3 daba 26,7 por lo mismo).
 */
export function areaDelDia(a: Assignment, cerrado: AvanceCerrado): { area: number; enProceso: boolean } {
  if (a.status === 'EN_PROCESO') {
    const dk = executionDateKey(a)
    const sk = `${a.suerteCode}|${a.labor.trim().toUpperCase()}`
    const ya = (cerrado.get(sk) ?? [])
      .filter((c) => isSameCycle(c.date, dk))
      .reduce((s, c) => s + c.exec, 0)
    return { area: Math.max(0, a.area - ya), enProceso: true }
  }
  return { area: areaCerrada(a), enProceso: false }
}

/** ¿Esta labor entra en la planilla? Solo lo que se está haciendo o ya se hizo. */
export function cuentaEnPlanilla(a: Assignment): boolean {
  return a.status === 'EN_PROCESO' || a.status === 'PARCIAL' || a.status === 'COMPLETADA'
}

const WEEKDAY = ['D', 'L', 'M', 'M', 'J', 'V', 'S']

/** Días de un mes 'YYYY-MM', con su letra de día para el encabezado. */
export function diasDelMes(mes: string, todayKey?: string) {
  const [y, m] = mes.split('-').map(Number)
  const ultimo = new Date(y, m, 0).getDate()
  const out: { key: string; day: number; weekday: string; isToday: boolean }[] = []
  for (let d = 1; d <= ultimo; d++) {
    const key = `${mes}-${String(d).padStart(2, '0')}`
    out.push({ key, day: d, weekday: WEEKDAY[new Date(y, m - 1, d).getDay()], isToday: key === todayKey })
  }
  return out
}
