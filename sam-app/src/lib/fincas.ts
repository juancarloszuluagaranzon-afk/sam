/**
 * Administración de fincas — las cuentas, sin pantallas (se prueban con `npx tsx`).
 *
 * Todo lo que el dueño ve sale de aquí, y de UNA foto de los datos: el Inicio, la
 * finca y la cuenta no pueden contradecirse porque usan las mismas funciones.
 */
import type { Ciclo, DatosFincas, Finca, LaborCiclo, Movimiento, ReporteCampo } from '../services/fincasApi'

export type NivelOportunidad = 'ideal' | 'normal' | 'tardia'

/** Días entre dos fechas 'YYYY-MM-DD' (b − a). */
export function diasEntre(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00`) - Date.parse(`${a}T12:00:00`)) / 86_400_000)
}

export function cicloAbiertoDe(suerteId: string, ciclos: Ciclo[]): Ciclo | null {
  return ciclos.find((c) => c.suerteId === suerteId && c.estado === 'ABIERTO') ?? null
}

/** Lo aceptado y lo que falta aceptar de una labor. */
export function avanceLabor(labor: LaborCiclo, reportes: ReporteCampo[]) {
  const propios = reportes.filter((r) => r.laborId === labor.id)
  const aceptado = propios.filter((r) => r.estado === 'ACEPTADO').reduce((s, r) => s + r.cantidad, 0)
  const porAceptar = propios.filter((r) => r.estado === 'PENDIENTE').reduce((s, r) => s + r.cantidad, 0)
  const primeraAceptada = propios.filter((r) => r.estado === 'ACEPTADO').map((r) => r.fecha).sort()[0] ?? null
  return {
    aceptado, porAceptar, primeraAceptada,
    restante: Math.max(0, labor.cantidadPlan - aceptado - porAceptar),
    pct: labor.cantidadPlan > 0 ? Math.min(100, Math.round((aceptado / labor.cantidadPlan) * 100)) : 0,
  }
}

function nivel(ddc: number, ideal: number, normal: number): NivelOportunidad {
  return ddc <= ideal ? 'ideal' : ddc <= normal ? 'normal' : 'tardia'
}

/**
 * ¿A tiempo? Se CALCULA, no se guarda: si alguien corrige una fecha, se recalifica.
 * - Hecha (tiene algo aceptado): con el día en que arrancó (primer reporte aceptado).
 * - Sin hacer: con HOY — «tardía» quiere decir que ya se pasó la ventana y sigue sin hacerse.
 * - Sin ventana en el paquete: no se inventa (null).
 */
export function oportunidad(labor: LaborCiclo, ciclo: Ciclo, reportes: ReporteCampo[], hoy: string):
  { nivel: NivelOportunidad; ddc: number; hecha: boolean } | null {
  if (labor.estado === 'ANULADA' || labor.ventanaIdeal == null || labor.ventanaNormal == null) return null
  const { primeraAceptada } = avanceLabor(labor, reportes)
  const dia = primeraAceptada ?? hoy
  const ddc = diasEntre(ciclo.fechaCorte, dia)
  return { nivel: nivel(ddc, labor.ventanaIdeal, labor.ventanaNormal), ddc, hecha: primeraAceptada != null }
}

const vivos = (m: Movimiento[]) => m.filter((x) => !x.anulado)

/** La cuenta del dueño: lo que giró, lo que se gastó con soporte, el honorario y el saldo. */
export function cuentaFinca(fincaId: string, movimientos: Movimiento[]) {
  const mios = vivos(movimientos).filter((m) => m.fincaId === fincaId)
  const suma = (t: Movimiento['tipo']) => mios.filter((m) => m.tipo === t).reduce((s, m) => s + m.valor, 0)
  const anticipos = suma('ANTICIPO')
  const gastos = suma('GASTO')
  const honorarios = suma('HONORARIO')
  return { anticipos, gastos, honorarios, saldo: anticipos - gastos - honorarios }
}

/**
 * Presupuesto contra ejecutado de los ciclos ABIERTOS de una finca.
 * Ejecutado = gastos (no anulados) de sus labores, más los gastos a mano de esas
 * suertes desde su corte. Nunca se mezcla con anticipos ni honorarios.
 */
export function presupuestoFinca(fincaId: string, d: DatosFincas) {
  const suertes = d.suertes.filter((s) => s.fincaId === fincaId && s.activa)
  const ciclos = suertes.map((s) => cicloAbiertoDe(s.id, d.ciclos)).filter((c): c is Ciclo => !!c)
  const idsCiclo = new Set(ciclos.map((c) => c.id))
  const labores = d.labores.filter((l) => idsCiclo.has(l.cicloId) && l.estado !== 'ANULADA')
  const idsLabor = new Set(labores.map((l) => l.id))
  const cortePorSuerte = new Map(ciclos.map((c) => [c.suerteId, c.fechaCorte]))
  const presupuesto = labores.reduce((s, l) => s + l.cantidadPlan * l.costoUnitarioPlan, 0)
  const ejecutado = vivos(d.movimientos).filter((m) => m.fincaId === fincaId && m.tipo === 'GASTO' && (
    (m.laborId && idsLabor.has(m.laborId)) ||
    (!m.laborId && m.suerteId && cortePorSuerte.has(m.suerteId) && m.fecha >= (cortePorSuerte.get(m.suerteId) ?? '9999'))
  )).reduce((s, m) => s + m.valor, 0)
  const sinCosto = labores.filter((l) => l.costoUnitarioPlan <= 0).length
  return {
    presupuesto, ejecutado, sinCosto, ciclos: ciclos.length, labores: labores.length,
    pct: presupuesto > 0 ? Math.round((ejecutado / presupuesto) * 100) : null,
    hectareas: suertes.reduce((s, x) => s + x.areaHa, 0),
  }
}

/** Una fila por labor de los ciclos abiertos, con todo lo que la pantalla necesita. */
export function laboresDeFinca(fincaId: string, d: DatosFincas, hoy: string) {
  const suertes = d.suertes.filter((s) => s.fincaId === fincaId && s.activa)
  const filas = []
  for (const s of suertes) {
    const c = cicloAbiertoDe(s.id, d.ciclos)
    if (!c) continue
    for (const l of d.labores.filter((x) => x.cicloId === c.id)) {
      filas.push({ suerte: s, ciclo: c, labor: l, avance: avanceLabor(l, d.reportes), oport: oportunidad(l, c, d.reportes, hoy) })
    }
  }
  return filas.sort((a, b) => a.suerte.codigo.localeCompare(b.suerte.codigo, 'es', { numeric: true }) || a.labor.orden - b.labor.orden)
}

/** La finca a la que pertenece un reporte (para la bandeja de «por aceptar»). */
export function contextoReporte(r: ReporteCampo, d: DatosFincas) {
  const labor = d.labores.find((l) => l.id === r.laborId)
  const ciclo = labor ? d.ciclos.find((c) => c.id === labor.cicloId) : undefined
  const suerte = ciclo ? d.suertes.find((s) => s.id === ciclo.suerteId) : undefined
  const finca = suerte ? d.fincas.find((f) => f.id === suerte.fincaId) : undefined
  return { labor, ciclo, suerte, finca }
}

export interface EventoBitacora {
  id: string; cuando: string; tipo: 'reporte' | 'movimiento'
  titulo: string; detalle: string; foto: string | null; estado: string
}

/** La bitácora de la finca: cada reporte y cada movimiento, en orden, con su prueba. */
export function bitacoraFinca(fincaId: string, d: DatosFincas, nombre: (id: string) => string): EventoBitacora[] {
  const ev: EventoBitacora[] = []
  for (const r of d.reportes) {
    const { labor, suerte, finca } = contextoReporte(r, d)
    if (finca?.id !== fincaId || !labor || !suerte) continue
    ev.push({
      id: `r-${r.id}`, cuando: r.revisadoEn ?? r.createdAt, tipo: 'reporte',
      titulo: `${labor.labor.toLowerCase()} · suerte ${suerte.codigo} · ${fmtCant(r.cantidad)} ${labor.unidad}`,
      detalle: r.estado === 'PENDIENTE' ? `Reportó ${nombre(r.reportadoPor)} · por aceptar`
        : r.estado === 'ACEPTADO' ? `Reportó ${nombre(r.reportadoPor)} · aceptó ${nombre(r.revisadoPor ?? '')}`
        : `Rechazado por ${nombre(r.revisadoPor ?? '')}: ${r.motivoRechazo ?? ''}`,
      foto: r.fotoUrl, estado: r.estado,
    })
  }
  for (const m of d.movimientos.filter((x) => x.fincaId === fincaId && !x.reporteId)) {
    ev.push({
      id: `m-${m.id}`, cuando: m.createdAt, tipo: 'movimiento',
      titulo: `${m.tipo === 'ANTICIPO' ? 'Anticipo' : m.tipo === 'HONORARIO' ? 'Honorario' : 'Gasto'} · ${fmtPesos(m.valor)}`,
      detalle: `${m.concepto}${m.anulado ? ` · ANULADO: ${m.anuladoMotivo ?? ''}` : ''} · ${nombre(m.registradoPor)}`,
      foto: m.soporteUrl, estado: m.anulado ? 'ANULADO' : m.tipo,
    })
  }
  return ev.sort((a, b) => b.cuando.localeCompare(a.cuando))
}

// ── Formatos ──────────────────────────────────────────────────────────────
export function fmtPesos(n: number): string {
  return `$${Math.round(n).toLocaleString('es-CO')}`
}
/** $38,4 M para las tarjetas; el valor exacto va en el detalle. */
export function fmtPesosCorto(n: number): string {
  const a = Math.abs(n)
  const signo = n < 0 ? '−' : ''
  if (a >= 1_000_000) return `${signo}$${(a / 1_000_000).toLocaleString('es-CO', { maximumFractionDigits: 1 })} M`
  if (a >= 1_000) return `${signo}$${Math.round(a / 1_000).toLocaleString('es-CO')} mil`
  return `${signo}$${Math.round(a).toLocaleString('es-CO')}`
}
export function fmtCant(n: number): string {
  return n.toLocaleString('es-CO', { maximumFractionDigits: 2 })
}

/**
 * Resumen para mandarle al dueño por WhatsApp. Texto plano, corto, con las mismas
 * cifras de la pantalla — el dueño que no abre la app se entera igual.
 */
export function resumenParaDueno(finca: Finca, d: DatosFincas, hoy: string, nombre: (id: string) => string): string {
  const p = presupuestoFinca(finca.id, d)
  const c = cuentaFinca(finca.id, d.movimientos)
  const filas = laboresDeFinca(finca.id, d, hoy)
  const hace7 = new Date(Date.parse(`${hoy}T12:00:00`) - 7 * 86_400_000).toISOString().slice(0, 10)
  // «Aceptadas en la semana» = por el día en que se ACEPTARON, que es cuando el dueño
  // se entera; cada línea dice además el día en que se hizo en campo.
  const semana = d.reportes.filter((r) => r.estado === 'ACEPTADO' && (r.revisadoEn ?? r.createdAt).slice(0, 10) >= hace7 && contextoReporte(r, d).finca?.id === finca.id)
  const tardias = filas.filter((f) => f.oport?.nivel === 'tardia' && !f.oport.hecha && f.labor.estado !== 'TERMINADA')
  const lineas = [
    `*${finca.nombre}* — resumen al ${hoy.split('-').reverse().join('/')}`,
    '',
    `Labores aceptadas en los últimos 7 días: ${semana.length}`,
    ...semana.slice(0, 6).map((r) => {
      const { labor, suerte } = contextoReporte(r, d)
      return `• ${labor?.labor.toLowerCase()} suerte ${suerte?.codigo}: ${fmtCant(r.cantidad)} ${labor?.unidad} (hecha el ${r.fecha.slice(8, 10)}/${r.fecha.slice(5, 7)}, ${nombre(r.reportadoPor)})`
    }),
    '',
    p.presupuesto > 0
      ? `Presupuesto del ciclo: ${fmtPesos(p.ejecutado)} ejecutado de ${fmtPesos(p.presupuesto)} (${p.pct}%)`
      : `Gastado en el ciclo: ${fmtPesos(p.ejecutado)}`,
    `Su cuenta: anticipos ${fmtPesos(c.anticipos)} · gastos ${fmtPesos(c.gastos)}${c.honorarios ? ` · honorarios ${fmtPesos(c.honorarios)}` : ''} · saldo ${fmtPesos(c.saldo)}`,
  ]
  if (tardias.length) {
    lineas.push('', `Atrasadas: ${tardias.map((f) => `${f.labor.labor.toLowerCase()} suerte ${f.suerte.codigo}`).join(', ')}`)
  }
  lineas.push('', 'Cada labor tiene foto, ubicación y quién la aceptó. — AgroServicios Morales')
  return lineas.join('\n')
}
