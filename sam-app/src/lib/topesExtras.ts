import type { ResumenDia } from './horasExtra'

/**
 * Topes legales de horas extra: máximo 2 al día y 12 a la semana (CST art. 22,
 * Ley 50 de 1990; siguen vigentes tras la Ley 2466 de 2025, que solo quitó el
 * permiso previo del Ministerio del Trabajo — Circular 0102 de 2025).
 *
 * 🔴 Avisa, NO recorta: las horas se trabajaron y se pagan. Pasarse del tope es
 * un riesgo para la empresa (multa), no una razón para borrar el dato.
 *
 * Funciones puras, sin base de datos: se prueban con `node scripts/prueba-taller-quiosco.mts`.
 */

export const TOPE_EXTRA_DIA_MIN = 120
export const TOPE_EXTRA_SEMANA_MIN = 720

export interface ExcesoExtras {
  usuarioId: string
  tipo: 'DIA' | 'SEMANA'
  /** DIA: el día `YYYY-MM-DD` (Bogotá). SEMANA: el LUNES de esa semana, `YYYY-MM-DD`. */
  periodo: string
  minutosExtra: number
  tope: number
}

/** Minutos extra de un día: las cuatro franjas EXTRA (ordinarias y festivas, diurnas y nocturnas). */
export function minutosExtra(d: ResumenDia): number {
  return d.minutos.EXTRA_DIURNA + d.minutos.EXTRA_NOCTURNA
    + d.minutos.FEST_EXTRA_DIURNA + d.minutos.FEST_EXTRA_NOCTURNA
}

/**
 * Días con más de `topes.dia` minutos extra y semanas (lunes a domingo, Bogotá)
 * con más de `topes.semana`. Ordenado por usuario, luego por periodo; los días
 * antes que las semanas del mismo usuario.
 */
export function excesosDeExtras(
  dias: ResumenDia[],
  topes: { dia: number; semana: number } = { dia: TOPE_EXTRA_DIA_MIN, semana: TOPE_EXTRA_SEMANA_MIN },
): ExcesoExtras[] {
  const excesos: ExcesoExtras[] = []
  const semanas = new Map<string, { usuarioId: string; periodo: string; minutosExtra: number }>()
  for (const d of dias) {
    const extra = minutosExtra(d)
    if (extra > topes.dia) excesos.push({ usuarioId: d.usuarioId, tipo: 'DIA', periodo: d.dia, minutosExtra: extra, tope: topes.dia })
    const fecha = new Date(d.dia + 'T12:00:00Z')
    const desdeLunes = (fecha.getUTCDay() + 6) % 7
    fecha.setUTCDate(fecha.getUTCDate() - desdeLunes)
    const periodo = fecha.toISOString().slice(0, 10)
    const clave = `${d.usuarioId}|${periodo}`
    const semana = semanas.get(clave) ?? { usuarioId: d.usuarioId, periodo, minutosExtra: 0 }
    semana.minutosExtra += extra
    semanas.set(clave, semana)
  }
  for (const semana of semanas.values()) {
    if (semana.minutosExtra > topes.semana) excesos.push({ ...semana, tipo: 'SEMANA', tope: topes.semana })
  }
  const prioridad = { DIA: 0, SEMANA: 1 }
  return excesos.sort((a, b) => a.usuarioId.localeCompare(b.usuarioId)
    || a.periodo.localeCompare(b.periodo) || prioridad[a.tipo] - prioridad[b.tipo])
}
