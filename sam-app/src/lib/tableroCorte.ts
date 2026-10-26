import type { Ciclo, DatosFincas, LaborCiclo, Movimiento, SuerteFinca } from '../services/fincasApi'
import { avanceLabor, cicloAbiertoDe, diasEntre, nombreLabor, oportunidad } from './fincas.ts'
import { sumarDias } from './planCorte.ts'

/**
 * Tablero del corte (26-oct-2026): presupuesto, plan a la fecha, ejecutado, valor ganado, curva S
 * y alertas de una finca. Todo se CALCULA de lo que ya hay (labores, reportes, gastos); no guarda nada.
 *
 * Vocabulario (control de costos, método del valor ganado):
 *  - Presupuesto (BAC): cantidad × pasadas × (servicio + ppto por ha) de las labores no anuladas.
 *  - Plan a la fecha (PV): cuánto del presupuesto debería llevarse a hoy. Cada labor se reparte en línea
 *    recta desde el corte hasta su fecha ideal; las que se repiten (riego, malezas) o no traen ventana,
 *    a lo largo de HORIZONTE_DIAS.
 *  - Ejecutado (AC): los gastos de la finca (el MISMO conjunto que `presupuestoFinca`).
 *  - Valor ganado (EV): presupuesto de cada labor × su avance físico (lo aceptado ÷ lo presupuestado).
 *  - Variación de costo = EV − AC (positivo = se gastó menos de lo que valía lo avanzado).
 *  - CPI = EV ÷ AC · SPI = EV ÷ PV · Proyección al cierre (EAC) = AC + (BAC − EV) ÷ CPI.
 */

/** Duración que se le supone al corte para repartir lo que se repite, en días. */
export const HORIZONTE_DIAS = 365
/** Semáforo propuesto de los índices; es un criterio nuestro, no un estándar. */
export const UMBRAL_OK = 0.95
export const UMBRAL_OJO = 0.9

export type Semaforo = 'ok' | 'ojo' | 'mal' | 'neutro'
export function semaforoIndice(x: number | null): Semaforo {
  if (x == null || !Number.isFinite(x)) return 'neutro'
  return x >= UMBRAL_OK ? 'ok' : x >= UMBRAL_OJO ? 'ojo' : 'mal'
}

export interface AlertaTablero {
  nivel: 'mal' | 'ojo' | 'ok'
  texto: string
  /** Solo la administración la ve (habla de cómo se registra, no de la finca). */
  soloAdmin?: boolean
}

export interface FilaLaborTablero {
  clave: string
  labor: string
  presupuesto: number
  planAFecha: number
  /** 0 a 1: lo aceptado sobre lo presupuestado. */
  avance: number
  valorGanado: number
  /** Gastos ligados a esta labor (los demás gastos de la finca no se pueden atribuir). */
  ejecutadoLigado: number
  estado: 'terminada' | 'en_curso' | 'sin_iniciar' | 'atrasada'
}

export interface PuntoCurva { fecha: string; plan: number; real: number | null }

export interface TableroCorte {
  hay: boolean
  hectareas: number
  suertes: number
  presupuesto: number
  presupuestoPorHa: number | null
  planAFecha: number
  ejecutado: number
  valorGanado: number
  variacionCosto: number
  spi: number | null
  cpi: number | null
  proyeccion: number | null
  curva: PuntoCurva[]
  hoy: string
  /** Último día de la curva (el corte más nuevo + horizonte). */
  fin: string
  labores: FilaLaborTablero[]
  alertas: AlertaTablero[]
  gastosSinLabor: { n: number; valor: number; pct: number | null }
  /** Porcentaje del tiempo del corte ya transcurrido, ponderado por área (0 a 100). */
  tiempoTranscurrido: number
}

const n = (v: unknown): number => {
  const x = Number(v)
  return Number.isFinite(x) ? x : 0
}
const sinTildes = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase()
const fmtM = (v: number): string => `$${(Math.round(v / 1e5) / 10).toLocaleString('es-CO', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} M`

const presupuestoDe = (l: LaborCiclo): number =>
  n(l.cantidadPlan) * Math.max(1, n(l.pasadasPlan)) * (n(l.costoUnitarioPlan) + n(l.costoAparteUnitarioPlan))

/** Días en que se reparte el presupuesto de una labor: hasta su fecha ideal, o el horizonte si se repite o no tiene ventana. */
export const duracionPlan = (l: Pick<LaborCiclo, 'repetible' | 'ventanaIdeal'>): number =>
  !l.repetible && l.ventanaIdeal != null && l.ventanaIdeal > 0 ? l.ventanaIdeal : HORIZONTE_DIAS

/** Fracción del presupuesto de una labor que ya debería estar gastada, `dias` después del corte. */
export const fraccionPlan = (l: Pick<LaborCiclo, 'repetible' | 'ventanaIdeal'>, dias: number): number =>
  Math.max(0, Math.min(1, dias / duracionPlan(l)))

/** Avance físico de una labor: lo aceptado sobre todas sus pasadas. Una labor cerrada vale 1. */
function avanceFisico(l: LaborCiclo, aceptado: number): number {
  if (l.estado === 'TERMINADA') return 1
  const total = n(l.cantidadPlan) * Math.max(1, n(l.pasadasPlan))
  return total > 0 ? Math.max(0, Math.min(1, aceptado / total)) : 0
}

const VACIO: TableroCorte = {
  hay: false, hectareas: 0, suertes: 0, presupuesto: 0, presupuestoPorHa: null, planAFecha: 0, ejecutado: 0, valorGanado: 0,
  variacionCosto: 0, spi: null, cpi: null, proyeccion: null, curva: [], hoy: '', fin: '', labores: [], alertas: [],
  gastosSinLabor: { n: 0, valor: 0, pct: null }, tiempoTranscurrido: 0,
}

export function tableroCorte(fincaId: string, d: DatosFincas, hoy: string): TableroCorte {
  const suertes = (d?.suertes ?? []).filter((s) => s.fincaId === fincaId && s.activa)
  const pares: { s: SuerteFinca; c: Ciclo }[] = []
  for (const s of suertes) { const c = cicloAbiertoDe(s.id, d.ciclos ?? []); if (c) pares.push({ s, c }) }
  if (pares.length === 0) return { ...VACIO, hoy }

  const idsCiclo = new Set(pares.map((p) => p.c.id))
  const labores = (d.labores ?? []).filter((l) => idsCiclo.has(l.cicloId) && l.estado !== 'ANULADA')
  const cicloDe = new Map(pares.map((p) => [p.c.id, p]))
  const idsLabor = new Set(labores.map((l) => l.id))
  const corteDeSuerte = new Map(pares.map((p) => [p.s.id, p.c.fechaCorte]))

  // Ejecutado: el mismo conjunto de gastos que usa `presupuestoFinca`.
  const gastos: Movimiento[] = (d.movimientos ?? []).filter((m) => !m.anulado && m.fincaId === fincaId && m.tipo === 'GASTO' && (
    (m.laborId && idsLabor.has(m.laborId)) ||
    (!m.laborId && m.suerteId && corteDeSuerte.has(m.suerteId) && m.fecha >= (corteDeSuerte.get(m.suerteId) ?? '9999'))
  ))
  const ejecutado = gastos.reduce((t, m) => t + n(m.valor), 0)

  // Por labor (se juntan las suertes que comparten labor y unidad)
  const grupos = new Map<string, FilaLaborTablero & { _pend: boolean; _ven: number; _norm: boolean; _rez: boolean; _orden: number }>()
  let presupuesto = 0
  let valorGanado = 0
  const hectareas = pares.reduce((t, p) => t + n(p.s.areaHa), 0)
  const tiempo = hectareas > 0
    ? pares.reduce((t, p) => t + n(p.s.areaHa) * Math.max(0, Math.min(1, diasEntre(p.c.fechaCorte, hoy) / HORIZONTE_DIAS)), 0) / hectareas * 100
    : 0
  // Las ventanas vencidas se juntan por labor: «Roturación, suertes A1 y B2» y no una alerta por suerte.
  const ventanas = new Map<string, { nivel: 'mal' | 'ojo'; labor: string; suertes: string[]; max: number }>()
  const acumularVentana = (nivel: 'mal' | 'ojo', labor: string, suerte: string, ddc: number) => {
    const k = `${nivel}|${sinTildes(labor)}`
    const v = ventanas.get(k) ?? { nivel, labor, suertes: [], max: 0 }
    v.suertes.push(suerte); v.max = Math.max(v.max, ddc)
    ventanas.set(k, v)
  }

  for (const l of labores) {
    const par = cicloDe.get(l.cicloId)!
    const t = presupuestoDe(l)
    const av = avanceLabor(l, d.reportes ?? [])
    const frac = avanceFisico(l, av.aceptado)
    const dias = diasEntre(par.c.fechaCorte, hoy)
    const pv = t * fraccionPlan(l, dias)
    const ligado = gastos.filter((m) => m.laborId === l.id).reduce((s, m) => s + n(m.valor), 0)
    const clave = `${sinTildes(l.labor)}|${l.unidad}`
    let g = grupos.get(clave)
    if (!g) {
      g = { clave, labor: l.labor, presupuesto: 0, planAFecha: 0, avance: 0, valorGanado: 0, ejecutadoLigado: 0, estado: 'sin_iniciar', _pend: false, _ven: 0, _norm: false, _rez: false, _orden: n(l.orden) }
      grupos.set(clave, g)
    }
    g._orden = Math.min(g._orden, n(l.orden))
    g.presupuesto += t
    g.planAFecha += pv
    g.valorGanado += t * frac
    g.ejecutadoLigado += ligado
    presupuesto += t
    valorGanado += t * frac
    if (frac < 1) g._pend = true

    const op = oportunidad(l, par.c, d.reportes ?? [], hoy)
    if (op && op.nivel === 'tardia' && !op.hecha) {
      g._ven++
      acumularVentana('mal', l.labor, par.s.codigo, op.ddc)
    } else if (op && op.nivel === 'normal' && !op.hecha) {
      g._norm = true
      acumularVentana('ojo', l.labor, par.s.codigo, op.ddc)
    }
    if (l.repetible && l.estado !== 'TERMINADA' && frac < 1 && dias > 0 && frac < Math.min(1, dias / HORIZONTE_DIAS) - 0.1) g._rez = true
  }

  const alertasVentana: { nivel: 'mal' | 'ojo'; texto: string }[] = [...ventanas.values()].map((v) => {
    const donde = v.suertes.length === 1 ? `suerte ${v.suertes[0]}` : `suertes ${v.suertes.slice(0, -1).join(', ')} y ${v.suertes[v.suertes.length - 1]}`
    return {
      nivel: v.nivel,
      texto: v.nivel === 'mal'
        ? `${nombreLabor(v.labor)}, ${donde}: ya pasó su ventana (van ${v.max} días del corte) y sigue sin hacerse.`
        : `${nombreLabor(v.labor)}, ${donde}: ya no está en su fecha ideal (van ${v.max} días del corte).`,
    }
  })

  const filas: FilaLaborTablero[] = [...grupos.values()].map((g) => {
    const avance = g.presupuesto > 0 ? g.valorGanado / g.presupuesto : 0
    const estado: FilaLaborTablero['estado'] =
      g._ven > 0 || g._rez ? 'atrasada' : !g._pend ? 'terminada' : avance > 0 || g.planAFecha > 0 ? 'en_curso' : 'sin_iniciar'
    return { fila: { clave: g.clave, labor: g.labor, presupuesto: g.presupuesto, planAFecha: g.planAFecha, avance, valorGanado: g.valorGanado, ejecutadoLigado: g.ejecutadoLigado, estado }, orden: g._orden }
  }).sort((a, b) => a.orden - b.orden || a.fila.labor.localeCompare(b.fila.labor, 'es')).map((x) => x.fila)

  const planAFecha = filas.reduce((t, f) => t + f.planAFecha, 0)
  const cpi = ejecutado > 0 ? valorGanado / ejecutado : null
  const spi = planAFecha > 0 ? valorGanado / planAFecha : null
  const proyeccion = cpi != null && cpi > 0 && valorGanado > 0 ? ejecutado + (presupuesto - valorGanado) / cpi : null

  // Curva S: cada 14 días desde el primer corte hasta el último + horizonte, más el día de hoy.
  const cortes = pares.map((p) => p.c.fechaCorte).sort()
  const inicio = cortes[0]
  const fin = sumarDias(cortes[cortes.length - 1], HORIZONTE_DIAS)
  const gastosOrdenados = [...gastos].sort((a, b) => a.fecha.localeCompare(b.fecha))
  const planEn = (fecha: string): number => labores.reduce((t, l) => {
    const par = cicloDe.get(l.cicloId)!
    return t + presupuestoDe(l) * fraccionPlan(l, diasEntre(par.c.fechaCorte, fecha))
  }, 0)
  const realHasta = (fecha: string): number => gastosOrdenados.reduce((t, m) => (m.fecha <= fecha ? t + n(m.valor) : t), 0)
  const fechas: string[] = []
  for (let f = inicio; f <= fin; f = sumarDias(f, 14)) fechas.push(f)
  if (!fechas.includes(fin)) fechas.push(fin)
  if (hoy >= inicio && hoy <= fin && !fechas.includes(hoy)) fechas.push(hoy)
  fechas.sort()
  const curva: PuntoCurva[] = fechas.map((f) => ({ fecha: f, plan: planEn(f), real: f <= hoy ? realHasta(f) : null }))

  // Gastos que no se ligaron a ninguna labor
  const sinLabor = gastos.filter((m) => !m.laborId)
  const valorSinLabor = sinLabor.reduce((t, m) => t + n(m.valor), 0)
  const gastosSinLabor = { n: sinLabor.length, valor: valorSinLabor, pct: ejecutado > 0 ? valorSinLabor / ejecutado : null }

  // Alertas: lo urgente primero
  const alertas: AlertaTablero[] = []
  if (presupuesto > 0 && ejecutado > presupuesto) alertas.push({ nivel: 'mal', texto: `Lo ejecutado (${fmtM(ejecutado)}) ya pasó el presupuesto (${fmtM(presupuesto)}).` })
  const sCpi = semaforoIndice(cpi)
  if (sCpi === 'mal' || sCpi === 'ojo') alertas.push({ nivel: sCpi, texto: `Se está gastando más de lo que vale lo avanzado (CPI ${cpi!.toFixed(2).replace('.', ',')}).` })
  const sSpi = semaforoIndice(spi)
  if (sSpi === 'mal' || sSpi === 'ojo') alertas.push({ nivel: sSpi, texto: `El avance va por debajo del plan a la fecha (SPI ${spi!.toFixed(2).replace('.', ',')}).` })
  alertas.push(...alertasVentana)
  for (const g of grupos.values()) {
    if (!g._rez) continue
    const avance = g.presupuesto > 0 ? g.valorGanado / g.presupuesto : 0
    alertas.push({ nivel: 'ojo', texto: `${nombreLabor(g.labor)} va al ${Math.round(avance * 100)} % de sus pasadas y ya pasó el ${Math.round(tiempo)} % del tiempo del corte.` })
  }
  if (gastosSinLabor.n > 0 && gastosSinLabor.pct != null && gastosSinLabor.pct > 0.25) {
    alertas.push({
      nivel: 'ojo', soloAdmin: true,
      texto: `${gastosSinLabor.n} gastos por ${fmtM(valorSinLabor)} (${Math.round(gastosSinLabor.pct * 100)} % de lo ejecutado) no están ligados a una labor: el costo por labor no se puede medir.`,
    })
  }
  const hayVentanas = labores.some((l) => !l.repetible && l.ventanaIdeal != null)
  if (hayVentanas && alertasVentana.length === 0) alertas.push({ nivel: 'ok', texto: 'Ninguna labor está fuera de su ventana de tiempo.' })
  const orden = { mal: 0, ojo: 1, ok: 2 } as const
  alertas.sort((a, b) => orden[a.nivel] - orden[b.nivel])

  return {
    hay: true, hectareas, suertes: pares.length, presupuesto,
    presupuestoPorHa: hectareas > 0 ? presupuesto / hectareas : null,
    planAFecha, ejecutado, valorGanado, variacionCosto: valorGanado - ejecutado, spi, cpi, proyeccion,
    curva, hoy, fin, labores: filas, alertas, gastosSinLabor, tiempoTranscurrido: tiempo,
  }
}
