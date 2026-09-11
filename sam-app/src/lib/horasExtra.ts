/**
 * De marcaciones a horas: lo que se le entrega a nómina.
 *
 * 🔴 **Este archivo NO calcula plata.** Clasifica minutos trabajados en las
 * franjas que la ley colombiana paga distinto, y ahí para. Poner pesos exige el
 * salario de cada persona y que nómina valide los porcentajes; un número en
 * pesos que nadie validó es peor que no tenerlo, porque se paga.
 *
 * 🔴 **Las horas de la noche y la jornada ordinaria son CONFIGURABLES, no
 * constantes.** La hora en que arranca el recargo nocturno se ha movido por ley
 * más de una vez en los últimos años, y la jornada semanal viene bajando por
 * etapas desde la Ley 2101. Quemar «21:00» y «8 horas» en el código es
 * garantizar que el módulo mienta el día que cambien otra vez, sin que nadie se
 * entere. Los valores por defecto son un punto de partida: **nómina los
 * confirma antes de usar el reporte para pagar.**
 */

/** Las franjas que se pagan distinto. No se suman entre sí. */
export type Franja =
  | 'ORD_DIURNA'
  | 'ORD_NOCTURNA'
  | 'EXTRA_DIURNA'
  | 'EXTRA_NOCTURNA'
  | 'FEST_DIURNA'
  | 'FEST_NOCTURNA'
  | 'FEST_EXTRA_DIURNA'
  | 'FEST_EXTRA_NOCTURNA'

/**
 * Las franjas, con el recargo que les corresponde por ley.
 *
 * ⚠️ El `recargo` es de REFERENCIA, para que quien lea el reporte sepa qué pesa
 * cada columna. El módulo no multiplica nada: la liquidación la hace nómina.
 * Verificado contra la Ley 2466 de 2025 el 10-sep-2026.
 */
export const FRANJAS: { id: Franja; label: string; recargo: string }[] = [
  { id: 'ORD_DIURNA', label: 'Ordinaria diurna', recargo: 'sin recargo' },
  { id: 'ORD_NOCTURNA', label: 'Ordinaria nocturna', recargo: '+35%' },
  { id: 'EXTRA_DIURNA', label: 'Extra diurna', recargo: '+25%' },
  { id: 'EXTRA_NOCTURNA', label: 'Extra nocturna', recargo: '+75%' },
  { id: 'FEST_DIURNA', label: 'Dominical/festivo diurna', recargo: '+90%' },
  { id: 'FEST_NOCTURNA', label: 'Dominical/festivo nocturna', recargo: '+90% y +35%' },
  { id: 'FEST_EXTRA_DIURNA', label: 'Extra dominical/festivo diurna', recargo: '+90% y +25%' },
  { id: 'FEST_EXTRA_NOCTURNA', label: 'Extra dominical/festivo nocturna', recargo: '+90% y +75%' },
]

export interface ConfigHoras {
  /** Horas ordinarias por día; lo que pase de ahí es EXTRA. */
  jornadaOrdinariaDiaria: number
  /** Tope legal de la semana. Solo se informa; no reclasifica. */
  jornadaSemanalMax: number
  /** Hora a la que arranca el recargo nocturno, `HH:mm`. */
  inicioNoche: string
  /** Hora a la que termina, `HH:mm`. Siempre es del día siguiente. */
  finNoche: string
}

/**
 * Lo vigente en Colombia a septiembre de 2026, verificado contra la
 * Ley 2466 de 2025 (reforma laboral) y la Ley 2101 de 2021:
 *
 * · **Nocturno de 7:00 p.m. a 6:00 a.m.** Hasta el 24-dic-2025 arrancaba a las
 *   9:00 p.m.; el artículo 11 de la Ley 2466 lo corrió dos horas. Quien
 *   recuerde «nueve de la noche» está recordando la ley anterior.
 * · **42 horas semanales** desde el 15-jul-2026, último escalón de la
 *   reducción gradual de la Ley 2101.
 * · Dominical y festivo al **90%** desde el 1-jul-2026.
 *
 * La diaria queda en 8 porque el reparto de las 42 horas depende de si el
 * taller trabaja cinco o seis días, y eso lo define la empresa.
 */
export const CONFIG_POR_DEFECTO: ConfigHoras = {
  jornadaOrdinariaDiaria: 8,
  jornadaSemanalMax: 42,
  inicioNoche: '19:00',
  finNoche: '06:00',
}

/* ───────────────────────── Festivos de Colombia ───────────────────────── */

/** Domingo de Pascua del año, por el algoritmo gregoriano anónimo. */
function pascua(anio: number): Date {
  const a = anio % 19
  const b = Math.floor(anio / 100)
  const c = anio % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const mes = Math.floor((h + l - 7 * m + 114) / 31)
  const dia = ((h + l - 7 * m + 114) % 31) + 1
  return new Date(Date.UTC(anio, mes - 1, dia))
}

const clave = (d: Date) => d.toISOString().slice(0, 10)
const sumarDias = (d: Date, n: number) => new Date(d.getTime() + n * 86400000)

/** Ley Emiliani: el festivo que no cae lunes se corre al lunes siguiente. */
function aLunes(d: Date): Date {
  const dow = d.getUTCDay() // 0 = domingo
  return dow === 1 ? d : sumarDias(d, (8 - dow) % 7)
}

/**
 * Los festivos de Colombia de un año, como `yyyy-mm-dd`.
 *
 * ⚠️ Se CALCULAN, no se listan a mano. Una lista escrita para 2026 sirve este
 * año y miente el otro, y nadie vuelve a mirarla — la misma trampa del párrafo
 * con números quemados que hubo que quitar del tablero de insumos.
 */
export function festivosColombia(anio: number): Set<string> {
  const f = new Set<string>()
  // Fijos: no se corren nunca.
  for (const [m, d] of [[1, 1], [5, 1], [7, 20], [8, 7], [12, 8], [12, 25]]) {
    f.add(clave(new Date(Date.UTC(anio, m - 1, d))))
  }
  // Emiliani: se corren al lunes.
  for (const [m, d] of [[1, 6], [3, 19], [6, 29], [8, 15], [10, 12], [11, 1], [11, 11]]) {
    f.add(clave(aLunes(new Date(Date.UTC(anio, m - 1, d)))))
  }
  // Los que cuelgan de la Pascua. Jueves y Viernes Santo NO se corren.
  const p = pascua(anio)
  f.add(clave(sumarDias(p, -3)))
  f.add(clave(sumarDias(p, -2)))
  // Ascensión, Corpus y Sagrado Corazón ya caen lunes con estos desfases.
  for (const n of [43, 64, 71]) f.add(clave(sumarDias(p, n)))
  return f
}

const cacheFestivos = new Map<number, Set<string>>()
export function esFestivo(diaBogota: string): boolean {
  const anio = Number(diaBogota.slice(0, 4))
  if (!cacheFestivos.has(anio)) cacheFestivos.set(anio, festivosColombia(anio))
  return cacheFestivos.get(anio)!.has(diaBogota)
}

/* ─────────────────────────── Reloj de Bogotá ──────────────────────────── */

/**
 * El día y el minuto del día en Bogotá de un instante.
 *
 * 🔴 No se usa el reloj del equipo. Un celular con la zona horaria mal puesta
 * movería la marcación de día —y con ella el dominical y el corte de la
 * jornada— sin que nadie lo note.
 */
const fmtBogota = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Bogota',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hour12: false,
})

export function enBogota(iso: string): { dia: string; minuto: number } {
  const p = fmtBogota.formatToParts(new Date(iso))
  const g = (t: string) => p.find((x) => x.type === t)!.value
  const hora = g('hour') === '24' ? 0 : Number(g('hour'))
  return { dia: `${g('year')}-${g('month')}-${g('day')}`, minuto: hora * 60 + Number(g('minute')) }
}

const aMinutos = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

/* ──────────────────────────── Clasificación ───────────────────────────── */

export interface Marcacion {
  id: string
  usuarioId: string
  tipo: 'ENTRADA' | 'SALIDA'
  /** Instante en que se marcó, en ISO con zona. */
  marcadoEn: string
}

/** Un tramo cerrado de trabajo. */
export interface Sesion {
  usuarioId: string
  entrada: string
  salida: string
  minutos: number
}

export interface ResumenDia {
  usuarioId: string
  dia: string
  minutos: Record<Franja, number>
  totalMinutos: number
  festivo: boolean
}

/**
 * Empareja ENTRADA con la SALIDA siguiente.
 *
 * 🔴 Lo que NO empareja se devuelve aparte, no se adivina. Una entrada sin
 * salida puede ser que se le olvidó marcar o que sigue adentro, y las dos cosas
 * se resuelven hablando con la persona, no inventando una hora de salida. Si el
 * módulo cerrara solo el turno, el reporte saldría cuadrado y falso.
 */
export function emparejar(marcas: Marcacion[]): { sesiones: Sesion[]; sueltas: Marcacion[] } {
  const sesiones: Sesion[] = []
  const sueltas: Marcacion[] = []
  const porUsuario = new Map<string, Marcacion[]>()
  for (const m of marcas) {
    if (!porUsuario.has(m.usuarioId)) porUsuario.set(m.usuarioId, [])
    porUsuario.get(m.usuarioId)!.push(m)
  }
  for (const [usuarioId, lista] of porUsuario) {
    const orden = [...lista].sort((a, b) => a.marcadoEn.localeCompare(b.marcadoEn))
    let abierta: Marcacion | null = null
    for (const m of orden) {
      if (m.tipo === 'ENTRADA') {
        // Dos entradas seguidas: la primera se quedó sin salida.
        if (abierta) sueltas.push(abierta)
        abierta = m
      } else {
        if (!abierta) { sueltas.push(m); continue }
        const ini = new Date(abierta.marcadoEn).getTime()
        const fin = new Date(m.marcadoEn).getTime()
        const minutos = Math.round((fin - ini) / 60000)
        if (minutos > 0) sesiones.push({ usuarioId, entrada: abierta.marcadoEn, salida: m.marcadoEn, minutos })
        abierta = null
      }
    }
    if (abierta) sueltas.push(abierta)
  }
  return { sesiones, sueltas }
}

const vacio = (): Record<Franja, number> =>
  FRANJAS.reduce((a, f) => { a[f.id] = 0; return a }, {} as Record<Franja, number>)

/**
 * Reparte los minutos de cada sesión en las franjas que se pagan distinto.
 *
 * Minuto a minuto a propósito: el turno que cruza la medianoche, el que entra
 * en la noche y sale de día, y el que arranca sábado y termina domingo son el
 * caso NORMAL en un taller, no la excepción. Resolverlos con fórmulas sobre los
 * extremos del tramo es donde se cuelan los errores. Un turno de doce horas son
 * 720 vueltas: no es caro y se puede comprobar a mano.
 *
 * La cuota ordinaria se gasta en orden cronológico y **por día de calendario en
 * Bogotá**: la hora extra es la que pasa de la jornada, y eso solo se sabe
 * mirando lo que ya se llevaba trabajado ese día.
 */
export function clasificar(
  sesiones: Sesion[],
  cfg: ConfigHoras = CONFIG_POR_DEFECTO,
): ResumenDia[] {
  const noche0 = aMinutos(cfg.inicioNoche)
  const noche1 = aMinutos(cfg.finNoche)
  const cuotaDiaria = Math.round(cfg.jornadaOrdinariaDiaria * 60)

  /** Minutos ordinarios ya gastados por (usuario, día). */
  const gastado = new Map<string, number>()
  const dias = new Map<string, ResumenDia>()

  const ordenadas = [...sesiones].sort((a, b) => a.entrada.localeCompare(b.entrada))
  for (const s of ordenadas) {
    const t0 = new Date(s.entrada).getTime()
    for (let i = 0; i < s.minutos; i++) {
      const { dia, minuto } = enBogota(new Date(t0 + i * 60000).toISOString())
      const llave = `${s.usuarioId}|${dia}`
      if (!dias.has(llave)) {
        dias.set(llave, {
          usuarioId: s.usuarioId, dia, minutos: vacio(), totalMinutos: 0,
          festivo: esFestivo(dia) || new Date(`${dia}T12:00:00Z`).getUTCDay() === 0,
        })
      }
      const d = dias.get(llave)!
      // La noche cruza la medianoche: es «>= inicio O < fin», no un rango normal.
      const esNoche = noche0 > noche1 ? (minuto >= noche0 || minuto < noche1) : (minuto >= noche0 && minuto < noche1)
      const ya = gastado.get(llave) ?? 0
      const esExtra = ya >= cuotaDiaria
      if (!esExtra) gastado.set(llave, ya + 1)

      const f: Franja = d.festivo
        ? (esExtra ? (esNoche ? 'FEST_EXTRA_NOCTURNA' : 'FEST_EXTRA_DIURNA') : (esNoche ? 'FEST_NOCTURNA' : 'FEST_DIURNA'))
        : (esExtra ? (esNoche ? 'EXTRA_NOCTURNA' : 'EXTRA_DIURNA') : (esNoche ? 'ORD_NOCTURNA' : 'ORD_DIURNA'))
      d.minutos[f] += 1
      d.totalMinutos += 1
    }
  }
  return [...dias.values()].sort((a, b) => (a.usuarioId + a.dia).localeCompare(b.usuarioId + b.dia))
}

/** Suma varios días en un solo renglón por persona. */
export function totalizar(dias: ResumenDia[]): Map<string, Record<Franja, number> & { total: number }> {
  const m = new Map<string, Record<Franja, number> & { total: number }>()
  for (const d of dias) {
    if (!m.has(d.usuarioId)) m.set(d.usuarioId, { ...vacio(), total: 0 })
    const acc = m.get(d.usuarioId)!
    for (const f of FRANJAS) acc[f.id] += d.minutos[f.id]
    acc.total += d.totalMinutos
  }
  return m
}

/** Minutos a «8:30». Nunca a decimales: nómina cuenta en horas y minutos. */
export function hhmm(minutos: number): string {
  const neg = minutos < 0
  const t = Math.abs(Math.round(minutos))
  return `${neg ? '−' : ''}${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`
}
