/**
 * Formato de fechas de la operación.
 *
 * Regla: **un registro de entrega siempre lleva la hora**. Con la hora se mide
 * el tiempo de respuesta al operario y se reconstruye la ruta del supervisor
 * durante el día; sin ella solo se sabe "fue el martes", que no sirve para nada.
 *
 * La zona va fija en Colombia a propósito: si alguien abre el app con el reloj
 * del equipo en otra zona, las horas de las entregas seguirían siendo las de
 * campo y no las de su computador.
 */

const TZ = 'America/Bogota'

/**
 * "29 jul 14:14" — el formato por defecto de cualquier registro.
 *
 * En 24 horas y sin el "de" que mete es-CO ("29 de jul, 02:14 p. m."): estas
 * horas se leen en lista, una debajo de otra, para seguir una ruta. Compacto
 * gana, y a las 2 de la tarde nadie tiene que pensar si era a. m. o p. m.
 */
export function fmtFechaHora(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const p = new Intl.DateTimeFormat('es-CO', {
    timeZone: TZ,
    day: '2-digit', month: 'short',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d)
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? ''
  return `${g('day')} ${g('month').replace('.', '')} ${g('hour')}:${g('minute')}`
}

/** Con año, para listados que cruzan meses (reportes, exportables). */
export function fmtFechaHoraLarga(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleString('es-CO', {
    timeZone: TZ,
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  })
}

/** Solo la hora — para ver la secuencia del día sin repetir la fecha. */
export function fmtHora(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('es-CO', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
}

/** Solo el día, cuando la hora ya se muestra aparte. */
export function fmtDia(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleDateString('es-CO', { timeZone: TZ, day: '2-digit', month: 'short' })
}

/** Clave YYYY-MM-DD en hora de Colombia, para agrupar por día. */
export function diaKey(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-CA', { timeZone: TZ })
}

/**
 * Lapso legible entre dos instantes: "18 min", "2 h 05", "3 d 4 h".
 * Es el tiempo de respuesta: cuánto se demoró la entrega desde que la pidieron.
 */
export function fmtLapso(desde?: string | null, hasta?: string | null): string {
  if (!desde || !hasta) return ''
  const a = new Date(desde).getTime()
  const b = new Date(hasta).getTime()
  if (isNaN(a) || isNaN(b) || b < a) return ''
  const min = Math.round((b - a) / 60000)
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h < 24) return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, '0')}`
  const d = Math.floor(h / 24)
  return `${d} d ${h % 24} h`
}

/** Minutos entre dos instantes (null si falta alguno), para promediar. */
export function minutosEntre(desde?: string | null, hasta?: string | null): number | null {
  if (!desde || !hasta) return null
  const a = new Date(desde).getTime()
  const b = new Date(hasta).getTime()
  if (isNaN(a) || isNaN(b) || b < a) return null
  return Math.round((b - a) / 60000)
}
