/**
 * Eficiencia de maquinaria y operarios — horas por día desde el HORÓMETRO (17-oct-2026).
 *
 * Pedido de Cristian (reunión del 15-oct-2026): por máquina y por operario, cuántos
 * DÍAS trabajó en el periodo y cuántas HORAS POR DÍA, contra el mínimo de 7 h (se
 * paga un básico de 8). Y la regla que acordaron: «usar el horómetro directamente»
 * — las horas del día son el horómetro FINAL del día menos el INICIAL del día, no
 * la suma de los tramos de cada labor (dos operarios en turno doble sobre la misma
 * máquina suman 21 h en el día, y eso es lo que la máquina de verdad anduvo).
 *
 * Fuente: `labor_sesiones` (un tramo por cierre de labor, con horómetro inicial y
 * final, operario y máquina). Las labores CANCELADAS se excluyen antes de llegar
 * aquí (`services/consumoApi.loadSesionesRango`).
 *
 * ⚠️ Los horómetros vienen sucios (dedazos, escalas mezcladas `5407`/`54030`):
 * se descartan las lecturas que no cuadran con la magnitud dominante de esa
 * máquina —igual que `equipo_horometro_v` y el informe semanal— y, si el rango
 * del día no cabe en 24 h o no hay dos lecturas buenas, se cae a la SUMA de los
 * tramos de ese día. Lo descartado se cuenta y se muestra: no se esconde.
 *
 * Puro, sin pantallas: se prueba con Node contra datos reales.
 */

export interface SesionMaquina {
  asignacionId: string | null
  equipo: string
  equipoNombre: string
  operador: string
  operadorNombre: string
  /** AAAA-MM-DD (día de Colombia que guardó el cierre). */
  fecha: string
  horometroInicial: number | null
  horometroFinal: number | null
  /** Lo que guardó el cierre: fin − ini de ese tramo. */
  horas: number | null
}

export type Cumplimiento = 'bien' | 'apura' | 'mal'

export interface DiaMaquina {
  fecha: string
  horometroInicial: number | null
  horometroFinal: number | null
  horas: number
  /** De dónde salieron las horas del día. `sin lectura` = hubo tramos pero ningún horómetro útil. */
  fuente: 'horómetro' | 'tramos' | 'sin lectura'
  operadores: { id: string; nombre: string; horas: number }[]
  tramos: number
  descartadas: number
}

export interface FilaMaquina {
  equipo: string
  nombre: string
  diasTrabajados: number
  horas: number
  /** horas ÷ días trabajados: el número que se compara con el mínimo. */
  horasPorDia: number
  /** horas ÷ días del periodo (los que no trabajó cuentan como 0). */
  horasPorDiaCalendario: number
  cumple: Cumplimiento
  diasBajoMinimo: number
  diasSinLectura: number
  descartadas: number
  operadores: string[]
  dias: DiaMaquina[]
}

export interface FilaOperador {
  operador: string
  nombre: string
  diasTrabajados: number
  horas: number
  horasPorDia: number
  cumple: Cumplimiento
  diasBajoMinimo: number
  maquinas: string[]
  dias: { fecha: string; horas: number; maquinas: string[] }[]
}

export interface Eficiencia {
  maquinas: FilaMaquina[]
  operadores: FilaOperador[]
  diasPeriodo: number
  descartadas: number
  /** Promedios de la flota, para el encabezado. */
  flota: { horas: number; horasPorDia: number; diasTrabajados: number; maquinasBajoMinimo: number }
}

/** Mínimo que acordaron: 7 h por día trabajado (se paga un básico de 8). */
export const MIN_HORAS_DIA = 7
/** Un día de máquina no tiene más de 24 h; por encima, el horómetro miente. */
const MAX_HORAS_DIA = 24

const r1 = (n: number) => Math.round(n * 10) / 10

/** Días del periodo (inclusive), sin pasarse de hoy. */
export function diasDelPeriodo(desde: string, hasta: string, hoy: string): number {
  const fin = hasta < hoy ? hasta : hoy
  const d = Math.round((Date.parse(`${fin}T12:00:00`) - Date.parse(`${desde}T12:00:00`)) / 86_400_000) + 1
  return Math.max(0, d)
}

/**
 * Marca las lecturas que no cuadran con las demás de la máquina: el criterio es el
 * ORDEN DE MAGNITUD (un dígito de más o de menos), no la distancia. Gana el grupo con
 * más lecturas. Misma regla que `lib/informeSemanal.ts`.
 */
function magnitudDominante(valores: number[]): number | null {
  const validos = valores.filter((h) => h > 0)
  if (validos.length < 2) return null
  const cuenta = new Map<number, number>()
  for (const h of validos) { const m = Math.floor(Math.log10(h)); cuenta.set(m, (cuenta.get(m) ?? 0) + 1) }
  let dominante: number | null = null, mejor = -1
  cuenta.forEach((n, mag) => { if (n > mejor) { mejor = n; dominante = mag } })
  return dominante
}

export function calificar(horasPorDia: number, minimo: number): Cumplimiento {
  if (horasPorDia >= minimo) return 'bien'
  if (horasPorDia >= minimo - 1) return 'apura'
  return 'mal'
}

/**
 * Horas que cubren unos tramos [ini, fin] de horómetro SIN contar dos veces lo que
 * se traslapa. Es lo justo para un operario: si trabajó antes y después de otro en
 * la misma máquina, su tiempo son SUS tramos, no todo el rango del día (medido:
 * Rodríguez en la CASE 1302 el 2-sep-2026 → 12,8 h de tramos; el rango daba 21).
 */
function horasUnion(intervalos: [number, number][]): number {
  const orden = intervalos.filter(([a, b]) => b > a && b - a < MAX_HORAS_DIA).sort((x, y) => x[0] - y[0])
  let total = 0, ini = -1, fin = -1
  for (const [a, b] of orden) {
    if (a > fin) { if (fin > ini) total += fin - ini; ini = a; fin = b }
    else if (b > fin) fin = b
  }
  if (fin > ini) total += fin - ini
  return r1(total)
}

/**
 * Horas de unos tramos del MISMO día.
 *
 * La MÁQUINA: horómetro final del día − inicial del día (la regla que acordaron),
 * siempre que el rango sea creíble: cabe en 24 h y no se aparta de lo que suman
 * los tramos. Un dedazo dentro de la misma magnitud (`4545` por `4565`) no lo
 * atrapa el filtro de magnitud y abría el rango 20 h de más — medido en julio,
 * la CASE 1304 daba 592 h contra 279 del cierre manual. Por eso, si el rango
 * TRIPLICA (+3 h) la unión de los tramos, manda la unión; y si queda por debajo
 * de la mitad, la limpieza se comió lecturas buenas: también manda la unión.
 *
 * Medido contra el cierre manual de julio-2026 (20 máquinas, `equipo_horas_mes`):
 * 7 de 20 dentro del 10 % y la flota un 17 % POR DEBAJO del cierre. Es
 * estructural, no un error: el cierre resta el horómetro de fin de mes al de
 * inicio y cuenta TODO lo que anduvo la máquina; aquí solo entran los días con
 * labores cerradas (los traslados y lo que anduvo sin labor registrada no son
 * «horas trabajadas» de un operario). Probado también que el tope ×3 casi no
 * mueve el total (sin tope: −17 %; ×1,5: −20 %), solo quita los dedazos gruesos.
 */
function horasDelDia(tramos: SesionMaquina[], esBuena: (h: number | null) => boolean): {
  horas: number; ini: number | null; fin: number | null; fuente: DiaMaquina['fuente']; descartadas: number
} {
  const lecturas: number[] = []
  const intervalos: [number, number][] = []
  let descartadas = 0
  let sumaHoras = 0
  for (const t of tramos) {
    const ini = t.horometroInicial != null && t.horometroInicial > 0 && esBuena(t.horometroInicial) ? t.horometroInicial : null
    const fin = t.horometroFinal != null && t.horometroFinal > 0 && esBuena(t.horometroFinal) ? t.horometroFinal : null
    for (const h of [t.horometroInicial, t.horometroFinal]) if (h != null && h > 0 && !esBuena(h)) descartadas++
    if (ini != null) lecturas.push(ini)
    if (fin != null) lecturas.push(fin)
    if (ini != null && fin != null && fin > ini) intervalos.push([ini, fin])
    else if ((t.horas ?? 0) > 0 && (t.horas ?? 0) < MAX_HORAS_DIA) sumaHoras += t.horas ?? 0
  }
  // Lo que los tramos cubren de verdad (sin traslapes) + los que solo traen horas.
  const union = r1(horasUnion(intervalos) + sumaHoras)
  if (lecturas.length >= 2) {
    const ini = Math.min(...lecturas), fin = Math.max(...lecturas)
    const rango = r1(fin - ini)
    const creible = rango > 0 && rango <= MAX_HORAS_DIA && rango >= union * 0.5 && rango <= union * 3 + 3
    if (creible) return { horas: rango, ini, fin, fuente: 'horómetro', descartadas }
    return { horas: union, ini, fin, fuente: union > 0 ? 'tramos' : 'sin lectura', descartadas }
  }
  return { horas: union, ini: lecturas[0] ?? null, fin: lecturas[0] ?? null, fuente: union > 0 ? 'tramos' : 'sin lectura', descartadas }
}

/** Las horas de UN operario en una máquina ese día: la unión de sus tramos, nunca el rango. */
function horasOperario(tramos: SesionMaquina[], esBuena: (h: number | null) => boolean): number {
  const intervalos: [number, number][] = []
  let suelto = 0
  for (const t of tramos) {
    const ini = t.horometroInicial, fin = t.horometroFinal
    if (ini != null && fin != null && ini > 0 && fin > ini && esBuena(ini) && esBuena(fin)) intervalos.push([ini, fin])
    else if ((t.horas ?? 0) > 0 && (t.horas ?? 0) < MAX_HORAS_DIA) suelto += t.horas ?? 0
  }
  return r1(horasUnion(intervalos) + suelto)
}

export function armarEficiencia(sesiones: SesionMaquina[], opts: { desde: string; hasta: string; hoy: string; minimo?: number }): Eficiencia {
  const minimo = opts.minimo ?? MIN_HORAS_DIA
  const diasPeriodo = diasDelPeriodo(opts.desde, opts.hasta, opts.hoy)
  const enRango = sesiones.filter((s) => s.equipo && s.fecha >= opts.desde && s.fecha <= opts.hasta)

  // Magnitud dominante por máquina, sobre TODO el periodo (más lecturas = mejor voto).
  const porEquipo = new Map<string, SesionMaquina[]>()
  for (const s of enRango) porEquipo.set(s.equipo, [...(porEquipo.get(s.equipo) ?? []), s])
  const dominante = new Map<string, number | null>()
  for (const [eq, ss] of porEquipo) {
    dominante.set(eq, magnitudDominante(ss.flatMap((s) => [s.horometroInicial ?? 0, s.horometroFinal ?? 0])))
  }
  const buena = (eq: string) => (h: number | null) => {
    if (h == null || h <= 0) return false
    const d = dominante.get(eq)
    return d == null || Math.floor(Math.log10(h)) === d
  }

  // ── Por máquina y día ──
  const maquinas: FilaMaquina[] = []
  let descartadasTotal = 0
  for (const [eq, ss] of porEquipo) {
    const porDia = new Map<string, SesionMaquina[]>()
    for (const s of ss) porDia.set(s.fecha, [...(porDia.get(s.fecha) ?? []), s])
    const dias: DiaMaquina[] = []
    for (const [fecha, tramos] of [...porDia.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const d = horasDelDia(tramos, buena(eq))
      // Lo de cada operario ese día en esta máquina (su propio rango o su suma).
      const porOp = new Map<string, SesionMaquina[]>()
      for (const t of tramos) porOp.set(t.operador, [...(porOp.get(t.operador) ?? []), t])
      const operadores = [...porOp.entries()].map(([id, ts]) => ({ id, nombre: ts[0].operadorNombre, horas: horasOperario(ts, buena(eq)) }))
      dias.push({ fecha, horometroInicial: d.ini, horometroFinal: d.fin, horas: d.horas, fuente: d.fuente, operadores, tramos: tramos.length, descartadas: d.descartadas })
      descartadasTotal += d.descartadas
    }
    const horas = r1(dias.reduce((s, d) => s + d.horas, 0))
    const diasTrabajados = dias.length
    const horasPorDia = diasTrabajados ? r1(horas / diasTrabajados) : 0
    maquinas.push({
      equipo: eq, nombre: ss[0].equipoNombre || eq, diasTrabajados, horas, horasPorDia,
      horasPorDiaCalendario: diasPeriodo ? r1(horas / diasPeriodo) : 0,
      cumple: calificar(horasPorDia, minimo),
      diasBajoMinimo: dias.filter((d) => d.horas < minimo).length,
      diasSinLectura: dias.filter((d) => d.fuente === 'sin lectura').length,
      descartadas: dias.reduce((s, d) => s + d.descartadas, 0),
      operadores: [...new Set(ss.map((s) => s.operadorNombre || s.operador))],
      dias,
    })
  }

  // ── Por operario y día (sumando las máquinas que tocó ese día) ──
  const porOperador = new Map<string, { nombre: string; dias: Map<string, { horas: number; maquinas: Set<string> }> }>()
  for (const m of maquinas) {
    for (const d of m.dias) {
      for (const o of d.operadores) {
        const op = porOperador.get(o.id) ?? { nombre: o.nombre || o.id, dias: new Map() }
        const dia = op.dias.get(d.fecha) ?? { horas: 0, maquinas: new Set<string>() }
        dia.horas = r1(dia.horas + o.horas); dia.maquinas.add(m.nombre)
        op.dias.set(d.fecha, dia); porOperador.set(o.id, op)
      }
    }
  }
  const operadores: FilaOperador[] = [...porOperador.entries()].map(([id, op]) => {
    const dias = [...op.dias.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([fecha, x]) => ({ fecha, horas: x.horas, maquinas: [...x.maquinas] }))
    const horas = r1(dias.reduce((s, d) => s + d.horas, 0))
    const horasPorDia = dias.length ? r1(horas / dias.length) : 0
    return {
      operador: id, nombre: op.nombre, diasTrabajados: dias.length, horas, horasPorDia,
      cumple: calificar(horasPorDia, minimo), diasBajoMinimo: dias.filter((d) => d.horas < minimo).length,
      maquinas: [...new Set(dias.flatMap((d) => d.maquinas))], dias,
    }
  })

  // Las peores primero: es lo que hay que mirar.
  maquinas.sort((a, b) => a.horasPorDia - b.horasPorDia || a.nombre.localeCompare(b.nombre, 'es', { numeric: true }))
  operadores.sort((a, b) => a.horasPorDia - b.horasPorDia || a.nombre.localeCompare(b.nombre, 'es'))

  const horasFlota = r1(maquinas.reduce((s, m) => s + m.horas, 0))
  const diasFlota = maquinas.reduce((s, m) => s + m.diasTrabajados, 0)
  return {
    maquinas, operadores, diasPeriodo, descartadas: descartadasTotal,
    flota: {
      horas: horasFlota, diasTrabajados: diasFlota,
      horasPorDia: diasFlota ? r1(horasFlota / diasFlota) : 0,
      maquinasBajoMinimo: maquinas.filter((m) => m.cumple !== 'bien').length,
    },
  }
}
