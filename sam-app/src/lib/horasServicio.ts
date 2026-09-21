/**
 * Las horas de un servicio de máquina por horas (OFICIOS VARIOS).
 *
 * El formulario que pidió el cliente (19-sep-2026): hora de inicio, horómetro
 * inicial, administrador encargado, hora final, horómetro final. De ahí salen
 * DOS medidas del mismo servicio, y se guardan las dos:
 *
 * - **por horómetro** — lo que trabajó la máquina (final − inicial);
 * - **por reloj** — lo que duró el servicio (hora final − hora de inicio).
 *
 * 🔴 La que CUENTA (la que va a `executedArea` y a la planilla) es la del
 * horómetro: «hora máquina» es lo que se cobra en un servicio de máquina. La del
 * reloj es el control, y el **respaldo cuando el horómetro no sirve** — y no
 * sirve más seguido de lo que parece: lecturas en 0, al revés, con un dígito de
 * más, o un horómetro dañado (la VALTRA 9902 pasó semanas así). Sin respaldo, un
 * servicio prestado quedaría en cero horas; con él, queda con las horas de reloj
 * y MARCADO, para que administración lo revise. Nunca se bloquea el cierre.
 *
 * ⚠️ Si el cliente decide que manda el reloj, se cambia `FUENTE_PRINCIPAL` y
 * nada más: las dos medidas ya están guardadas en cada servicio.
 *
 * Función pura: se prueba en Node contra datos reales.
 */

export type FuenteHoras = 'HOROMETRO' | 'RELOJ'

export const FUENTE_PRINCIPAL: FuenteHoras = 'HOROMETRO'

/** Un servicio no dura más de un día: es el mismo tope del aviso del horómetro. */
const MAX_HORAS = 24

export interface HorasServicio {
  /** Las horas que cuentan. `null` = no hay de dónde sacarlas. */
  horas: number | null
  fuente: FuenteHoras | null
  porHorometro: number | null
  porReloj: number | null
  /** Por qué no se usó el horómetro, en palabras de la pantalla. */
  problemaHorometro: string | null
  /** Las dos medidas se separan mucho: máquina parada buena parte del servicio, o una lectura mala. */
  seSeparan: boolean
}

const r2 = (n: number) => Math.round(n * 100) / 100

export function horasDeServicio(s: {
  horometroInicial?: number | null
  horometroFinal?: number | null
  startedAt?: string | null
  finishedAt?: string | null
}): HorasServicio {
  const hi = Number(s.horometroInicial) || 0
  const hf = Number(s.horometroFinal) || 0

  let porHorometro: number | null = null
  let problemaHorometro: string | null = null
  if (hi <= 0 || hf <= 0) problemaHorometro = 'falta una lectura del horómetro (o está en cero)'
  else if (hf < hi) problemaHorometro = 'el horómetro final es menor que el inicial'
  else if (hf - hi > MAX_HORAS) problemaHorometro = `el horómetro da ${r2(hf - hi)} h: más de un día`
  else if (hf === hi) problemaHorometro = 'el horómetro no avanzó'
  else porHorometro = r2(hf - hi)

  let porReloj: number | null = null
  const ini = s.startedAt ? new Date(s.startedAt).getTime() : NaN
  const fin = s.finishedAt ? new Date(s.finishedAt).getTime() : NaN
  if (!isNaN(ini) && !isNaN(fin) && fin > ini) {
    const h = (fin - ini) / 3_600_000
    if (h <= MAX_HORAS) porReloj = r2(h)
  }

  const principal = FUENTE_PRINCIPAL === 'HOROMETRO' ? porHorometro : porReloj
  const respaldo = FUENTE_PRINCIPAL === 'HOROMETRO' ? porReloj : porHorometro
  const horas = principal ?? respaldo
  const fuente: FuenteHoras | null = horas == null ? null
    : principal != null ? FUENTE_PRINCIPAL
      : FUENTE_PRINCIPAL === 'HOROMETRO' ? 'RELOJ' : 'HOROMETRO'

  const seSeparan = porHorometro != null && porReloj != null
    && Math.abs(porHorometro - porReloj) > Math.max(1, porReloj * 0.35)

  return { horas, fuente, porHorometro, porReloj, problemaHorometro, seSeparan }
}

/** «7,5 h» con coma, como el resto de la app. */
export function fmtHoras(h: number | null | undefined): string {
  if (h == null) return '—'
  return `${h.toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} h`
}
