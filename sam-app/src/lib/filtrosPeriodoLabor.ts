import type { Assignment } from '../domain/sam'

/**
 * Los mismos filtros del Reporte (período, mes, fechas, ingenio, hacienda, suerte y operador), compartidos por
 * Facturación y Cartera (26-oct-2026, pedido de Iván: «lo mismo en facturación y cartera»). Son funciones puras:
 * la pantalla les pasa lo que necesitan (la fecha de hoy, cómo saber el ingenio de una labor).
 *
 * El período se mide sobre la fecha de EJECUCIÓN de la labor (como el Reporte). En Cartera se mide sobre la
 * fecha de la factura. 'TODO' es «todo el realizado»: sin límite de fechas.
 */
export type PeriodoFiltro = 'TODO' | 'HOY' | 'AYER' | 'PRIMERA' | 'SEGUNDA' | 'MES' | 'CUSTOM'

export interface FiltrosLabor {
  period: PeriodoFiltro
  /** YYYY-MM al que aplican PRIMERA, SEGUNDA y MES. */
  mes: string
  desde: string
  hasta: string
  ingenioId: string
  haciendaCode: string
  suerte: string
  operatorId: string
}

export function filtrosIniciales(period: PeriodoFiltro, todayKey: string): FiltrosLabor {
  return { period, mes: todayKey.slice(0, 7), desde: '', hasta: '', ingenioId: '', haciendaCode: '', suerte: '', operatorId: '' }
}

/** Ayer, sobre la fecha de Bogotá (maneja el cambio de mes y de año). */
export function ayerDe(todayKey: string): string {
  const [y, m, d] = todayKey.split('-').map(Number)
  const f = new Date(Date.UTC(y, m - 1, d - 1))
  return `${f.getUTCFullYear()}-${String(f.getUTCMonth() + 1).padStart(2, '0')}-${String(f.getUTCDate()).padStart(2, '0')}`
}

/** ¿La fecha (YYYY-MM-DD) cae dentro del período escogido? */
export function cumplePeriodo(dia: string, f: FiltrosLabor, todayKey: string): boolean {
  switch (f.period) {
    case 'TODO': return true
    case 'HOY': return dia === todayKey
    case 'AYER': return dia === ayerDe(todayKey)
    case 'CUSTOM':
      if (f.desde && dia < f.desde) return false
      if (f.hasta && dia > f.hasta) return false
      return true
    default: {
      const mes = f.mes || todayKey.slice(0, 7)
      if (!dia.startsWith(mes)) return false
      const d = Number(dia.slice(8, 10))
      if (f.period === 'PRIMERA') return d >= 1 && d <= 15
      if (f.period === 'SEGUNDA') return d >= 16
      return true
    }
  }
}

/** ¿La labor cumple ingenio, hacienda, suerte y operador? (vacío = todos) */
export function cumpleLabor(
  a: Pick<Assignment, 'haciendaCode' | 'suerte' | 'operatorId'>,
  f: FiltrosLabor,
  ingenioDe: (a: Assignment) => string | null,
): boolean {
  if (f.haciendaCode && a.haciendaCode !== f.haciendaCode) return false
  if (f.suerte && a.suerte !== f.suerte) return false
  if (f.operatorId && a.operatorId !== f.operatorId) return false
  if (f.ingenioId && ingenioDe(a as Assignment) !== f.ingenioId) return false
  return true
}

/** ¿Hay algún filtro de labor puesto (aparte del período)? */
export const hayFiltroLabor = (f: FiltrosLabor): boolean => !!(f.ingenioId || f.haciendaCode || f.suerte || f.operatorId)

export interface OpcionesFiltros {
  haciendas: Array<{ code: string; name: string }>
  suertes: string[]
  operadores: Array<{ id: string; name: string }>
}

/** Las listas de los selectores, acotadas por lo ya escogido (hacienda según ingenio, suerte según hacienda). */
export function opcionesFiltros(
  asignaciones: Assignment[],
  f: Pick<FiltrosLabor, 'ingenioId' | 'haciendaCode'>,
  ingenioDe: (a: Assignment) => string | null,
): OpcionesFiltros {
  const haciendas = new Map<string, string>()
  const suertes = new Set<string>()
  const operadores = new Map<string, string>()
  for (const a of asignaciones) {
    if (f.ingenioId && ingenioDe(a) !== f.ingenioId) continue
    if (a.haciendaCode && !haciendas.has(a.haciendaCode)) haciendas.set(a.haciendaCode, a.haciendaName ?? a.haciendaCode)
    if (f.haciendaCode && a.haciendaCode !== f.haciendaCode) continue
    if (a.suerte) suertes.add(a.suerte)
    if (a.operatorId && !operadores.has(a.operatorId)) operadores.set(a.operatorId, a.operatorName || a.operatorId)
  }
  return {
    haciendas: [...haciendas].map(([code, name]) => ({ code, name })).sort((x, y) => x.name.localeCompare(y.name)),
    suertes: [...suertes].sort((x, y) => x.localeCompare(y, undefined, { numeric: true })),
    operadores: [...operadores].map(([id, name]) => ({ id, name })).sort((x, y) => x.name.localeCompare(y.name)),
  }
}

/** Texto corto del período para títulos y nombres de archivo («en agosto de 2026 (1ra quincena)»). */
export function textoPeriodo(f: FiltrosLabor, etiquetaMes: string): string {
  switch (f.period) {
    case 'TODO': return 'en todo el realizado'
    case 'HOY': return 'hoy'
    case 'AYER': return 'ayer'
    case 'CUSTOM': return `del ${f.desde || 'inicio'} al ${f.hasta || 'hoy'}`
    case 'PRIMERA': return `en ${etiquetaMes.toLowerCase()} (1ra quincena)`
    case 'SEGUNDA': return `en ${etiquetaMes.toLowerCase()} (2da quincena)`
    default: return `en ${etiquetaMes.toLowerCase()}`
  }
}
