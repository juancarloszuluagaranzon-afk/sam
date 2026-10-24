/**
 * Administración de fincas — las cuentas, sin pantallas (se prueban con `npx tsx`).
 *
 * Todo lo que el dueño ve sale de aquí, y de UNA foto de los datos: el Inicio, la
 * finca y la cuenta no pueden contradecirse porque usan las mismas funciones.
 */
import type { Ciclo, DatosFincas, Finca, LaborCiclo, LaborMaquina, Movimiento, ReporteCampo, ReferenciasSector, RubroCosto, SuerteFinca } from '../services/fincasApi'

/**
 * 🔴 La plata está APAGADA «de momento» (23-sep-2026). El cliente pidió: «quita lo
 * de las transferencias, de momento no valoremos nada». Todo lo que son pesos —la
 * cuenta del dueño, el presupuesto, los costos del paquete, el honorario— se
 * esconde con esta sola llave. La base lo sigue guardando: se prende cambiándola a
 * `true`, sin migraciones.
 */
export const VER_PLATA = true

/**
 * 🔴 La UBICACIÓN del reporte está APAGADA «de momento» (16-oct-2026). Iván:
 * «debo permitir que Julio pueda registrar sus labores así no esté en la finca;
 * de momento no le actives la ubicación». Con la llave en `false`: «Reportar
 * labor» no pide el permiso del GPS ni muestra el aviso «Sin ubicación…», «Por
 * aceptar» no marca en rojo los reportes sin ubicación, y los textos del dueño ya
 * no prometen «foto y ubicación». La base nunca la exigió (`af__reportar` solo
 * guarda `lat`/`lng` si llegan). Se prende cambiándola a `true`, sin migraciones.
 * El botón «dónde estoy» del mapa no depende de esto: solo se usa si se toca.
 */
export const PEDIR_UBICACION = false

/**
 * 🔴 La FOTO del reporte es OPCIONAL «de momento» (17-oct-2026). Iván: «de momento
 * quítale la foto obligatoria, después lo volvemos a activar». Son DOS llaves y van
 * juntas: esta (el formulario la pide o no) y la de la base, que es la que manda
 * (`af_config.foto_requerida`, migración 20261017090000). Para volver a exigirla:
 * `true` aquí y `update af_config set valor = 'true' where clave = 'foto_requerida'`.
 * Sin foto, el gasto de un reporte aceptado tiene como soporte el propio reporte
 * (aceptado por otra persona); los textos del dueño ya no prometen «foto».
 */
export const FOTO_OBLIGATORIA = false

/** Qué evidencia lleva cada labor, para los textos del dueño («su foto y su ubicación»). */
export function evidenciaDeLabor(): string {
  const partes: string[] = []
  if (FOTO_OBLIGATORIA) partes.push('su foto')
  if (PEDIR_UBICACION) partes.push('su ubicación')
  return partes.join(' y ')
}

export type NivelOportunidad = 'ideal' | 'normal' | 'tardia'

/** Días entre dos fechas 'YYYY-MM-DD' (b − a). */
export function diasEntre(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00`) - Date.parse(`${a}T12:00:00`)) / 86_400_000)
}

export function cicloAbiertoDe(suerteId: string, ciclos: Ciclo[]): Ciclo | null {
  return ciclos.find((c) => c.suerteId === suerteId && c.estado === 'ABIERTO') ?? null
}

/**
 * Los reportes de la base MÁS los que esperan señal en este celular, contados como
 * POR ACEPTAR (16-oct-2026). Sin esto, lo guardado sin señal no bajaba el «faltan»
 * y la pantalla invitaba a registrarlo otra vez; en riego o malezas el duplicado
 * entraba como otra pasada. Uno que ya llegó a la base (misma id) no se cuenta dos veces.
 */
export function reportesConCola(
  reportes: ReporteCampo[],
  cola: { id: string; laborId: string; cantidad: number; fecha: string; usuario: string; queuedAt: string }[],
): ReporteCampo[] {
  const ya = new Set(reportes.map((r) => r.id))
  return [...reportes, ...cola.filter((p) => !ya.has(p.id)).map((p): ReporteCampo => ({
    id: p.id, laborId: p.laborId, cantidad: p.cantidad, fecha: p.fecha, fotoUrl: '',
    lat: null, lng: null, precisionM: null, nota: null, reportadoPor: p.usuario, estado: 'PENDIENTE',
    revisadoPor: null, revisadoEn: null, motivoRechazo: null, costoUnitario: null, createdAt: p.queuedAt,
  }))]
}

/**
 * Los reportes RECHAZADOS que esta persona todavía tiene que atender (16-oct-2026).
 * Antes un rechazo solo se veía bajando a «Mis últimos reportes», sin aviso ni forma
 * de corregirlo. Sale hasta que lo corrija («Corregir y reenviar») o diga que no
 * hace falta: las dos cosas quedan en `atendidos`. Si la labor ya se cerró o se
 * anuló, o el ciclo se cerró, ya no hay qué corregir.
 */
export function rechazosPorAtender(d: Pick<DatosFincas, 'reportes' | 'labores' | 'ciclos'>, usuario: string, atendidos: Set<string>): ReporteCampo[] {
  return d.reportes
    .filter((r) => r.estado === 'RECHAZADO' && r.reportadoPor === usuario && !atendidos.has(r.id))
    .filter((r) => {
      const l = d.labores.find((x) => x.id === r.laborId)
      if (!l || l.estado === 'ANULADA' || l.estado === 'TERMINADA') return false
      return d.ciclos.some((c) => c.id === l.cicloId && c.estado === 'ABIERTO')
    })
    .sort((a, b) => (b.revisadoEn ?? b.createdAt).localeCompare(a.revisadoEn ?? a.createdAt))
}

/**
 * Lo aceptado y lo que falta aceptar de una labor.
 * Varias pasadas (riego, malezas): `cantidadPlan` es UNA pasada; `restante` es lo
 * que falta de la pasada en curso (al completarla se abre otra entera) y
 * `pasadas` cuántas van aceptadas (1,5 = una y media).
 */
export function avanceLabor(labor: LaborCiclo, reportes: ReporteCampo[]) {
  const propios = reportes.filter((r) => r.laborId === labor.id)
  const aceptado = propios.filter((r) => r.estado === 'ACEPTADO').reduce((s, r) => s + r.cantidad, 0)
  const porAceptar = propios.filter((r) => r.estado === 'PENDIENTE').reduce((s, r) => s + r.cantidad, 0)
  const primeraAceptada = propios.filter((r) => r.estado === 'ACEPTADO').map((r) => r.fecha).sort()[0] ?? null
  const plan = labor.cantidadPlan
  const llevado = aceptado + porAceptar
  const completas = labor.repetible && plan > 0 ? Math.floor((llevado + 0.001) / plan) : 0
  return {
    aceptado, porAceptar, primeraAceptada,
    restante: labor.repetible
      ? (plan > 0 ? Math.round((plan - (llevado - completas * plan)) * 100) / 100 : 0)
      : Math.max(0, plan - aceptado - porAceptar),
    pct: plan > 0 ? Math.min(100, Math.round((aceptado / plan) * 100)) : 0,
    pasadas: labor.repetible && plan > 0 ? Math.round((aceptado / plan) * 10) / 10 : 0,
    pasadaEnCurso: completas + 1,
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
  id: string; cuando: string; tipo: 'reporte' | 'movimiento' | 'maquinaria'
  titulo: string; detalle: string; foto: string | null; estado: string
}

/**
 * La bitácora de la finca: cada labor de maquinaria, cada reporte y cada movimiento,
 * en orden, con su prueba. La maquinaria es la misma que pinta el mapa: si allá sale
 * «5 labores en 30 días», aquí no puede decir «todavía no hay movimientos».
 */
export function bitacoraFinca(
  fincaId: string, d: DatosFincas & { maquinaria?: LaborMaquina[] }, nombre: (id: string) => string,
): EventoBitacora[] {
  const ev: EventoBitacora[] = []
  for (const m of (d.maquinaria ?? []).filter((x) => x.fincaId === fincaId)) {
    ev.push({
      id: `q-${m.id}`, cuando: m.registradoEn || m.fecha, tipo: 'maquinaria',
      titulo: `${nombreLabor(m.labor).toLowerCase()} · suerte ${m.suerteCodigo} · ${fmtCant(m.area)} ha`,
      detalle: ['Maquinaria de AgroServicios Morales', m.equipo, m.operador].filter(Boolean).join(' · '),
      foto: null, estado: m.estado === 'COMPLETADA' ? 'HECHA' : m.estado === 'PARCIAL' ? 'PARCIAL' : 'EN CURSO',
    })
  }
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
  for (const m of (VER_PLATA ? d.movimientos : []).filter((x) => x.fincaId === fincaId && !x.reporteId)) {
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
    ...(VER_PLATA ? [
      '',
      p.presupuesto > 0
        ? `Presupuesto del ciclo: ${fmtPesos(p.ejecutado)} ejecutado de ${fmtPesos(p.presupuesto)} (${p.pct}%)`
        : `Gastado en el ciclo: ${fmtPesos(p.ejecutado)}`,
      `Su cuenta: anticipos ${fmtPesos(c.anticipos)} · gastos ${fmtPesos(c.gastos)}${c.honorarios ? ` · honorarios ${fmtPesos(c.honorarios)}` : ''} · saldo ${fmtPesos(c.saldo)}`,
    ] : []),
  ]
  if (tardias.length) {
    lineas.push('', `Atrasadas: ${tardias.map((f) => `${f.labor.labor.toLowerCase()} suerte ${f.suerte.codigo}`).join(', ')}`)
  }
  const evidencia: string[] = []
  if (FOTO_OBLIGATORIA) evidencia.push('foto')
  if (PEDIR_UBICACION) evidencia.push('ubicación')
  lineas.push('', evidencia.length
    ? `Cada labor tiene ${evidencia.join(', ')} y quién la aceptó. — AgroServicios Morales`
    : 'Cada labor dice quién la aceptó. — AgroServicios Morales')
  return lineas.join('\n')
}

// ── El mapa: qué se ha hecho en cada suerte ───────────────────────────────

/** «FERTILIZACIÓN» y «FERTILIZACION» son la misma labor: sin tildes y en mayúscula. */
export function llaveLabor(nombre: string): string {
  return nombre.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase()
}

export interface HechoSuerte {
  id: string
  suerteCodigo: string
  labor: string
  llave: string
  fecha: string
  cantidad: number
  unidad: string
  /** maquinaria = lo que registra la operación de ASM · campo = reporte con foto del módulo de fincas. */
  fuente: 'maquinaria' | 'campo'
  estado: 'hecha' | 'parcial' | 'en curso' | 'por aceptar'
  detalle: string
  foto: string | null
  /** Cuándo entró al sistema (terminada la maquinaria, aceptado o enviado el reporte). */
  registradoEn: string
}

/**
 * Todo lo hecho en las suertes de una finca, junto: las labores de MAQUINARIA que
 * ASM ya registra en su operación (no se vuelven a digitar) y los reportes de
 * campo del módulo. Lo rechazado no cuenta. Del más reciente al más viejo.
 */
export function hechosDeFinca(
  fincaId: string, d: DatosFincas & { maquinaria: LaborMaquina[] }, nombre: (id: string) => string,
): HechoSuerte[] {
  const out: HechoSuerte[] = []
  for (const m of d.maquinaria.filter((x) => x.fincaId === fincaId)) {
    out.push({
      id: `m-${m.id}`, suerteCodigo: m.suerteCodigo, labor: m.labor, llave: llaveLabor(m.labor),
      fecha: m.fecha, cantidad: m.area, unidad: 'ha', fuente: 'maquinaria',
      estado: m.estado === 'COMPLETADA' ? 'hecha' : m.estado === 'PARCIAL' ? 'parcial' : 'en curso',
      detalle: [m.equipo, m.operador].filter(Boolean).join(' · '), foto: null,
      registradoEn: m.registradoEn,
    })
  }
  for (const r of d.reportes) {
    if (r.estado === 'RECHAZADO') continue
    const { labor, suerte, finca } = contextoReporte(r, d)
    if (finca?.id !== fincaId || !labor || !suerte) continue
    out.push({
      id: `r-${r.id}`, suerteCodigo: suerte.codigo, labor: labor.labor, llave: llaveLabor(labor.labor),
      fecha: r.fecha, cantidad: r.cantidad, unidad: labor.unidad, fuente: 'campo',
      estado: r.estado === 'ACEPTADO' ? 'hecha' : 'por aceptar',
      detalle: `reportó ${nombre(r.reportadoPor)}${r.nota ? ` · ${r.nota}` : ''}`, foto: r.fotoUrl,
      registradoEn: r.revisadoEn ?? r.createdAt,
    })
  }
  return out.sort((a, b) => b.fecha.localeCompare(a.fecha))
}

/** Meses desde el corte (con un decimal). null si no hay corte conocido. */
export function edadMeses(fechaCorte: string | null | undefined, hoy: string): number | null {
  if (!fechaCorte) return null
  return Math.round((diasEntre(fechaCorte, hoy) / 30.4) * 10) / 10
}

/** «FERTILIZACION» → «Fertilización»: así se lee en la leyenda, la ficha y las novedades. */
const TILDES: Record<string, string> = { FERTILIZACION: 'Fertilización', FUMIGACION: 'Fumigación', APLICACION: 'Aplicación' }
export function nombreLabor(n: string): string {
  const s = n.trim().toLowerCase()
  return TILDES[llaveLabor(n)] ?? (s.charAt(0).toUpperCase() + s.slice(1))
}

// ── La «data macro» del dueño (17-oct-2026) ──────────────────────────────────
/**
 * Lo que un dueño de la tierra quiere ver de UNA finca de un vistazo: área, cuántas
 * suertes, qué edad tiene la caña, cada cuánto se corta, el último TCH que reportó el
 * ingenio, si las labores van a tiempo y cómo va su cuenta. Todo sale de la misma foto
 * de datos que usa el resto del módulo: no es una versión preparada.
 */
export interface MacroFinca {
  finca: Finca
  suertes: number
  areaHa: number
  /** Edad de la caña hoy, en meses, ponderada por área (ciclo abierto o dato del ingenio). */
  edadMeses: number | null
  /** La fecha de corte más reciente entre las suertes. */
  ultimoCorte: string | null
  /** Corte a corte, en meses, de los ciclos ya CERRADOS (si no hay, null). */
  cicloMeses: number | null
  /** TCH del último corte según el ingenio, ponderado por área. */
  tch: number | null
  laboresHechas: number
  laboresEnCurso: number
  laboresTardias: number
  porAceptar: number
  /** La cuenta del dueño (anticipos − gastos − honorarios); null con la plata apagada. */
  saldo: number | null
}

export function macroFinca(f: Finca, d: DatosFincas, hoy: string): MacroFinca {
  const suertes = d.suertes.filter((s) => s.fincaId === f.id && s.activa)
  const areaHa = Math.round(suertes.reduce((t, s) => t + s.areaHa, 0) * 100) / 100
  const pond = (valor: (s: SuerteFinca) => number | null) => {
    let num = 0, den = 0
    for (const s of suertes) { const v = valor(s); if (v != null && s.areaHa > 0) { num += v * s.areaHa; den += s.areaHa } }
    return den > 0 ? Math.round((num / den) * 10) / 10 : null
  }
  const corteDe = (s: SuerteFinca) => cicloAbiertoDe(s.id, d.ciclos)?.fechaCorte ?? s.datosIngenio?.fUltCorte ?? null
  const edadMesesF = pond((s) => edadMeses(corteDe(s), hoy))
  const cortes = suertes.map(corteDe).filter((x): x is string => !!x).sort()
  const cerrados = d.ciclos.filter((c) => c.estado === 'CERRADO' && c.fechaCierre && suertes.some((s) => s.id === c.suerteId))
  const cicloMeses = cerrados.length
    ? Math.round((cerrados.reduce((t, c) => t + diasEntre(c.fechaCorte, c.fechaCierre!), 0) / cerrados.length / 30.4) * 10) / 10
    : null
  const abiertos = d.ciclos.filter((c) => c.estado === 'ABIERTO' && suertes.some((s) => s.id === c.suerteId))
  let hechas = 0, enCurso = 0, tardias = 0
  for (const c of abiertos) {
    for (const l of d.labores.filter((x) => x.cicloId === c.id && x.estado !== 'ANULADA')) {
      if (l.estado === 'TERMINADA') hechas++
      else if (l.estado === 'EN_CURSO') enCurso++
      if (oportunidad(l, c, d.reportes, hoy)?.nivel === 'tardia') tardias++
    }
  }
  const laboresIds = new Set(d.labores.filter((l) => abiertos.some((c) => c.id === l.cicloId)).map((l) => l.id))
  return {
    finca: f, suertes: suertes.length, areaHa,
    edadMeses: edadMesesF, ultimoCorte: cortes[cortes.length - 1] ?? null, cicloMeses,
    tch: pond((s) => s.datosIngenio?.tch ?? null),
    laboresHechas: hechas, laboresEnCurso: enCurso, laboresTardias: tardias,
    porAceptar: d.reportes.filter((r) => r.estado === 'PENDIENTE' && laboresIds.has(r.laborId)).length,
    saldo: VER_PLATA ? cuentaFinca(f.id, d.movimientos).saldo : null,
  }
}

/** Todas las fincas del dueño y el total de su negocio. */
export function macroDueno(d: DatosFincas, hoy: string): { fincas: MacroFinca[]; total: { fincas: number; suertes: number; areaHa: number; edadMeses: number | null; laboresTardias: number; porAceptar: number; saldo: number | null } } {
  const fincas = d.fincas.filter((f) => f.activa !== false).map((f) => macroFinca(f, d, hoy))
  const area = fincas.reduce((t, m) => t + m.areaHa, 0)
  const conEdad = fincas.filter((m) => m.edadMeses != null && m.areaHa > 0)
  const edad = conEdad.length ? Math.round((conEdad.reduce((t, m) => t + m.edadMeses! * m.areaHa, 0) / conEdad.reduce((t, m) => t + m.areaHa, 0)) * 10) / 10 : null
  return {
    fincas,
    total: {
      fincas: fincas.length, suertes: fincas.reduce((t, m) => t + m.suertes, 0), areaHa: Math.round(area * 100) / 100,
      edadMeses: edad, laboresTardias: fincas.reduce((t, m) => t + m.laboresTardias, 0),
      porAceptar: fincas.reduce((t, m) => t + m.porAceptar, 0),
      saldo: VER_PLATA ? fincas.reduce((t, m) => t + (m.saldo ?? 0), 0) : null,
    },
  }
}

// ── Indicadores de cosecha y costos del gremio (24-oct-2026) ──────────────
/** Los objetos de costo, en el orden en que se leen (Procaña). */
export const RUBROS: { id: RubroCosto; nombre: string }[] = [
  { id: 'insumos', nombre: 'Insumos' }, { id: 'agua', nombre: 'Agua y riego' },
  { id: 'administracion', nombre: 'Administración' }, { id: 'mano_obra', nombre: 'Mano de obra' },
  { id: 'predial_fondos', nombre: 'Predial y fondos' }, { id: 'semilla', nombre: 'Semilla y resiembra' },
  { id: 'maquinaria', nombre: 'Maquinaria' }, { id: 'otros', nombre: 'Otros' },
]

const redondear = (v: number | null, decimales: number): number | null =>
  v == null || !Number.isFinite(v) ? null : Math.round(v * 10 ** decimales) / 10 ** decimales

/** División segura: denominador 0, null o NaN da null. */
const dividir = (a: number | null, b: number | null): number | null =>
  a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b) || b === 0 ? null : a / b

export interface IndicadoresCosecha {
  areaHa: number
  suertes: number
  toneladas: number
  tch: number
  rendimiento: number | null
  sacarosa: number | null
  tah: number | null
  azucar: number | null
  edadMeses: number | null
  tchm: number | null
  tahm: number | null
  numeroCorte: number | null
}

/**
 * Los indicadores de la ÚLTIMA cosecha que reportó el ingenio, con las suertes
 * activas que traen TCH: TCH, TAH, rendimiento, sacarosa, edad, número de corte.
 * El rendimiento y la sacarosa se ponderan por toneladas; la edad, por área. Si
 * ninguna suerte trae TCH, devuelve null (no se inventa la cosecha).
 */
export function indicadoresCosecha(fincaId: string, d: DatosFincas): IndicadoresCosecha | null {
  const suertes = d.suertes.filter((s) => s.fincaId === fincaId && s.activa && s.areaHa > 0 && s.datosIngenio?.tch != null)
  if (!suertes.length) return null
  const areaHa = suertes.reduce((t, s) => t + s.areaHa, 0)
  const toneladasDe = (s: SuerteFinca): number => {
    const di = s.datosIngenio
    if (!di || di.tch == null) return 0
    return di.toneladas != null ? di.toneladas : di.tch * s.areaHa
  }
  const toneladas = suertes.reduce((t, s) => t + toneladasDe(s), 0)
  const ponderado = (
    valor: (s: SuerteFinca) => number | null,
    peso: (s: SuerteFinca) => number | null,
  ): number | null => {
    let num = 0, den = 0
    for (const s of suertes) {
      const v = valor(s), w = peso(s)
      if (v != null && w != null && w > 0 && Number.isFinite(v) && Number.isFinite(w)) { num += v * w; den += w }
    }
    return den > 0 ? num / den : null
  }
  const tchRaw = ponderado((s) => s.datosIngenio?.tch ?? null, (s) => s.areaHa) ?? 0
  const rendimientoRaw = ponderado((s) => s.datosIngenio?.rendimiento ?? null, toneladasDe)
  const sacarosaRaw = ponderado((s) => s.datosIngenio?.sacarosa ?? null, toneladasDe)
  const edadRaw = ponderado((s) => s.datosIngenio?.edadMeses ?? null, (s) => s.areaHa)
  const corteRaw = ponderado((s) => s.datosIngenio?.numeroCorte ?? null, (s) => s.areaHa)
  const tahRaw = rendimientoRaw != null ? tchRaw * rendimientoRaw / 100 : null
  return {
    areaHa: Math.round(areaHa * 100) / 100,
    suertes: suertes.length,
    toneladas: Math.round(toneladas),
    tch: redondear(tchRaw, 1) ?? 0,
    rendimiento: redondear(rendimientoRaw, 2),
    sacarosa: redondear(sacarosaRaw, 2),
    tah: redondear(tahRaw, 1),
    azucar: rendimientoRaw != null ? Math.round(toneladas * rendimientoRaw / 100) : null,
    edadMeses: redondear(edadRaw, 1),
    tchm: edadRaw != null && edadRaw > 0 ? redondear(tchRaw / edadRaw, 1) : null,
    tahm: tahRaw != null && edadRaw != null && edadRaw > 0 ? redondear(tahRaw / edadRaw, 2) : null,
    numeroCorte: redondear(corteRaw, 1),
  }
}

/**
 * El objeto de costo de un movimiento: el que trae guardado; si no, el honorario
 * es administración; si no, el mapa de la labor (por nombre, sin tildes); si no,
 * «otros». Nunca queda sin rubro.
 */
export function rubroDe(m: Movimiento, labores: LaborCiclo[], mapa: Record<string, RubroCosto>): RubroCosto {
  if (m.rubro) return m.rubro
  if (m.tipo === 'HONORARIO') return 'administracion'
  if (m.laborId) {
    const labor = labores.find((l) => l.id === m.laborId)
    if (labor) {
      const buscada = llaveLabor(labor.labor)
      for (const [k, rubro] of Object.entries(mapa)) if (llaveLabor(k) === buscada) return rubro
    }
  }
  return 'otros'
}

export interface RubroCostoFila {
  id: RubroCosto
  nombre: string
  valor: number
  porHa: number
  /** Kilos de azúcar por tonelada que se van en este rubro (null si falta TCH o precio). */
  kgTc: number | null
  pct: number
}

export interface CostosGremio {
  areaHa: number
  desde: string
  costoTotal: number
  costoHa: number | null
  tchEsperado: number | null
  costoTc: number | null
  kgAzucarTc: number | null
  kgEsReferencia: boolean
  precioKg: number | null
  costoKgAzucar: number | null
  kaTc: number | null
  kgLibres: number | null
  pctCostos: number | null
  ingresoTc: number | null
  puntoEquilibrio: number | null
  leQuedaHa: number | null
  rubros: RubroCostoFila[]
}

/**
 * El costo del CICLO EN CURSO como lo mide el gremio: $/ha, $/t de caña, $/kg de
 * azúcar liquidado, kilos de azúcar por tonelada y punto de equilibrio. Suma los
 * gastos de las labores de los ciclos abiertos, los gastos a mano desde el corte
 * de cada suerte y los honorarios desde el corte más antiguo. Los anticipos no
 * son costo. Si no hay ciclos abiertos, devuelve null.
 */
export function costosGremio(fincaId: string, d: DatosFincas, refs: ReferenciasSector | null): CostosGremio | null {
  const abiertas: { suerte: SuerteFinca; ciclo: Ciclo }[] = []
  for (const s of d.suertes.filter((x) => x.fincaId === fincaId && x.activa)) {
    const c = cicloAbiertoDe(s.id, d.ciclos)
    if (c) abiertas.push({ suerte: s, ciclo: c })
  }
  if (!abiertas.length) return null
  const finca = d.fincas.find((f) => f.id === fincaId)
  const areaHa = abiertas.reduce((t, x) => t + x.suerte.areaHa, 0)
  const desde = abiertas.map((x) => x.ciclo.fechaCorte).sort()[0] ?? ''
  const idsCiclo = new Set(abiertas.map((x) => x.ciclo.id))
  const idsLabor = new Set(d.labores.filter((l) => idsCiclo.has(l.cicloId)).map((l) => l.id))
  const cortePorSuerte = new Map(abiertas.map((x) => [x.suerte.id, x.ciclo.fechaCorte]))

  const esCosto = (m: Movimiento): boolean => {
    if (m.anulado || m.fincaId !== fincaId) return false
    if (m.tipo === 'HONORARIO') return m.fecha >= desde
    if (m.tipo !== 'GASTO') return false // un anticipo nunca es costo
    if (m.laborId && idsLabor.has(m.laborId)) return true
    if (!m.laborId && m.suerteId && cortePorSuerte.has(m.suerteId)) return m.fecha >= (cortePorSuerte.get(m.suerteId) ?? '')
    if (!m.laborId && !m.suerteId) return m.fecha >= desde
    return false
  }
  const gastos = d.movimientos.filter(esCosto)
  const costoTotal = gastos.reduce((s, m) => s + m.valor, 0)

  let numTch = 0, denTch = 0
  for (const x of abiertas) {
    const tch = x.suerte.datosIngenio?.tch
    if (tch != null && tch > 0 && x.suerte.areaHa > 0) { numTch += tch * x.suerte.areaHa; denTch += x.suerte.areaHa }
  }
  const tchEsperadoRaw = denTch > 0 ? numTch / denTch : null

  const kgFinca = finca?.kgAzucarTc
  const kgDeFinca = kgFinca != null && kgFinca > 0 ? kgFinca : null
  const kgRef = refs?.costos?.kgAzucarTc
  const kgDeRef = kgRef != null && kgRef > 0 ? kgRef : null
  const kgAzucarTc = kgDeFinca ?? kgDeRef
  const precioFinca = finca?.precioKgAzucar
  const precioKg = precioFinca != null && precioFinca > 0 ? precioFinca : null

  const costoHaRaw = dividir(costoTotal, areaHa)
  const costoTcRaw = dividir(costoHaRaw, tchEsperadoRaw)
  const kaTcRaw = dividir(costoTcRaw, precioKg)
  const kgLibresRaw = kgAzucarTc != null && kaTcRaw != null ? kgAzucarTc - kaTcRaw : null
  const ingresoTcRaw = kgAzucarTc != null && precioKg != null ? kgAzucarTc * precioKg : null
  const puntoEquilibrioRaw = dividir(costoHaRaw, ingresoTcRaw)
  const pctCostosRaw = dividir(kaTcRaw, kgAzucarTc)

  const acumulado = new Map<RubroCosto, number>()
  for (const m of gastos) {
    const rubro = rubroDe(m, d.labores, refs?.rubroPorLabor ?? {})
    acumulado.set(rubro, (acumulado.get(rubro) ?? 0) + m.valor)
  }
  const rubros: RubroCostoFila[] = [...acumulado.entries()]
    .filter(([, valor]) => valor > 0)
    .map(([id, valor]) => {
      const porHaRaw = dividir(valor, areaHa)
      const kgTcRaw = dividir(dividir(porHaRaw, tchEsperadoRaw), precioKg)
      return {
        id,
        nombre: RUBROS.find((r) => r.id === id)?.nombre ?? 'Otros',
        valor: Math.round(valor),
        porHa: Math.round(porHaRaw ?? 0),
        kgTc: redondear(kgTcRaw, 1),
        pct: Math.round((dividir(valor, costoTotal) ?? 0) * 100),
      }
    })
    .sort((a, b) => b.valor - a.valor)

  return {
    areaHa: Math.round(areaHa * 100) / 100,
    desde,
    costoTotal: Math.round(costoTotal),
    costoHa: redondear(costoHaRaw, 0),
    tchEsperado: redondear(tchEsperadoRaw, 1),
    costoTc: redondear(costoTcRaw, 0),
    kgAzucarTc,
    kgEsReferencia: kgDeFinca == null,
    precioKg,
    costoKgAzucar: redondear(dividir(costoTcRaw, kgAzucarTc), 0),
    kaTc: redondear(kaTcRaw, 1),
    kgLibres: redondear(kgLibresRaw, 1),
    pctCostos: redondear(pctCostosRaw != null ? pctCostosRaw * 100 : null, 0),
    ingresoTc: redondear(ingresoTcRaw, 0),
    puntoEquilibrio: redondear(puntoEquilibrioRaw, 1),
    leQuedaHa: redondear(tchEsperadoRaw != null && ingresoTcRaw != null && costoHaRaw != null ? tchEsperadoRaw * ingresoTcRaw - costoHaRaw : null, 0),
    rubros,
  }
}

/**
 * Diferencia contra la referencia del sector, en % («+2,9 %»), puntos («−0,3 pts»)
 * o absolutos («+0,1»). null si falta algún dato o el denominador es 0. Usa coma
 * decimal y el signo «−» (U+2212) para los negativos.
 */
export function comparar(
  valor: number | null, ref: number | null | undefined, modo: 'pct' | 'pts' | 'abs',
): { texto: string; arriba: boolean } | null {
  // Una referencia en 0 es una referencia que no llegó (la conversión pone 0 si falta): sin comparación.
  if (valor == null || ref == null || !Number.isFinite(valor) || !Number.isFinite(ref) || ref <= 0) return null
  const dif = modo === 'pct' ? ((valor - ref) / ref) * 100 : valor - ref
  if (!Number.isFinite(dif)) return null
  const signo = dif < 0 ? '−' : '+'
  const cifra = Math.abs(dif).toLocaleString('es-CO', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
  return {
    texto: modo === 'pct' ? `${signo}${cifra} %` : modo === 'pts' ? `${signo}${cifra} pts` : `${signo}${cifra}`,
    arriba: dif >= 0,
  }
}

// ── Historia corte a corte (24-oct-2026) ─────────────────────────────────────

/**
 * Una fila por año de cosecha (los ciclos CERRADOS, por el año en que se cortaron)
 * más una fila «en curso» con los ABIERTOS. Cada costo se cuenta también en pesos
 * de hoy con el IPC de `refs.inflacion` (un DATO de la base, no del código): sin
 * eso, el $/ha de 2021 y el de 2025 no se pueden comparar y lo que fue inflación
 * se lee como «la finca salió más cara». Si falta el IPC de algún año, esas cifras
 * van en null y `faltaIpc` lo dice: nunca se completa un año a ojo.
 */
export interface FilaHistoria {
  clave: string; anio: number; etiqueta: string; enCurso: boolean; suertes: number; areaHa: number
  tch: number | null; rendimiento: number | null; sacarosa: number | null; edadMeses: number | null
  toneladas: number | null; costo: number; costoHoy: number | null
  costoHa: number | null; costoHaHoy: number | null; costoT: number | null; costoTHoy: number | null
  costoKg: number | null; costoKgHoy: number | null
}
export interface HistoriaCiclos { filas: FilaHistoria[]; anioBase: number | null; fuenteIpc: string | null; faltaIpc: boolean }
export function factorAPesosDe(anioGasto: number, anioBase: number, ipcAnual: Record<number, number>): number | null {
  let factor = 1
  for (let y = anioGasto + 1; y <= anioBase; y++) {
    const ipc = ipcAnual[y]
    if (!Number.isFinite(ipc)) return null
    factor *= 1 + ipc / 100
  }
  return factor
}
const seguro = (v: unknown) => Number(v) || 0
const divide = (a: number, b: number): number | null => b > 0 ? a / b : null
export function historiaCiclos(fincaId: string, d: DatosFincas, refs: ReferenciasSector | null, hoy: string): HistoriaCiclos | null {
  const finca = d.fincas.find(f => f.id === fincaId)
  const suertes = d.suertes.filter(s => s.fincaId === fincaId && s.activa && seguro(s.areaHa) > 0)
  const areaPorSuerte = new Map(suertes.map(s => [s.id, seguro(s.areaHa)]))
  const idsSuerte = new Set(areaPorSuerte.keys())
  const ciclos = d.ciclos.filter(c => idsSuerte.has(c.suerteId) && (c.estado === 'ABIERTO' || (c.estado === 'CERRADO' && c.fechaCierre)))
  if (!ciclos.length) return null

  // 🔴 Vocabulario del cliente (Iván, 24-oct-2026): un CICLO va de renovación a renovación
  // (destrucción de cepas, arado, surcado, siembra) y es un conjunto de CORTES de ~1 año.
  // Cada fila de `af_ciclos` es un CORTE. Una renovación (PLANTILLA) reinicia el conteo:
  // después de «Soca 5» viene «Plantilla», no «Soca 6».
  const etiquetas = new Map<string, string>()
  for (const suerte of suertes) {
    let numSoca = 0
    const ciclosSuerte = ciclos
      .filter(ciclo => ciclo.suerteId === suerte.id)
      .sort((a, b) => a.fechaCorte.localeCompare(b.fechaCorte))
    for (const ciclo of ciclosSuerte) {
      if (ciclo.tipo === 'PLANTILLA') {
        numSoca = 0
        etiquetas.set(ciclo.id, 'Plantilla')
      } else {
        etiquetas.set(ciclo.id, `Soca ${++numSoca}`)
      }
    }
  }

  // Grupos: cosechas cerradas por año de cierre y una fila final para los cortes abiertos.

  type Grupo = { clave: string; anio: number; enCurso: boolean; ciclos: Ciclo[] }
  const grupos = new Map<string, Grupo>()
  for (const ciclo of ciclos) {
    const enCurso = ciclo.estado === 'ABIERTO'
    const anio = enCurso ? Number(hoy.slice(0, 4)) : Number(ciclo.fechaCierre!.slice(0, 4))
    const clave = enCurso ? 'en-curso' : String(anio)
    if (!grupos.has(clave)) grupos.set(clave, { clave, anio, enCurso, ciclos: [] })
    grupos.get(clave)!.ciclos.push(ciclo)
  }

  const ciclosVivos = (fecha: string) => ciclos.filter(ciclo =>
    ciclo.fechaCorte <= fecha && (ciclo.estado === 'ABIERTO' || fecha < (ciclo.fechaCierre ?? '')))
  const costoPorCiclo = new Map<string, number>()
  const costoHoyPorCiclo = new Map<string, number>()
  const ciclosSinIpc = new Set<string>()
  const inflacion = refs?.inflacion ?? null
  const aniosIpc = inflacion ? Object.keys(inflacion.ipcAnual).map(Number).filter(Number.isFinite) : []
  const anioBase = aniosIpc.length ? Math.max(...aniosIpc) : null
  let faltaIpc = false
  const cicloPorLabor = new Map(d.labores.map(labor => [labor.id, labor.cicloId]))
  const movimientos = d.movimientos.filter(movimiento =>
    movimiento.fincaId === fincaId && !movimiento.anulado &&
    (movimiento.tipo === 'GASTO' || movimiento.tipo === 'HONORARIO'))

  // Cada GASTO va a su ciclo (por labor, o por suerte y fecha). Honorarios y gastos sin suerte
  // ni labor se reparten por área entre los ciclos vivos en esa fecha. Pesos de hoy: cada
  // movimiento se convierte con el IPC acumulado desde su año hasta el año base.
  for (const movimiento of movimientos) {
    const vivosEnFecha = ciclosVivos(movimiento.fecha)
    const idCicloLabor = movimiento.laborId ? cicloPorLabor.get(movimiento.laborId) : undefined
    let destino = idCicloLabor ? ciclos.filter(ciclo => ciclo.id === idCicloLabor) : []
    if (!destino.length && movimiento.suerteId) {
      destino = ciclos.filter(ciclo => ciclo.suerteId === movimiento.suerteId &&
        ciclo.fechaCorte <= movimiento.fecha &&
        (ciclo.estado === 'ABIERTO' || movimiento.fecha < (ciclo.fechaCierre ?? '')))
    }
    const esCompartido = movimiento.tipo === 'HONORARIO' || (!movimiento.suerteId && !movimiento.laborId)
    if (esCompartido) destino = vivosEnFecha
    if (!destino.length) continue

    const monto = seguro(movimiento.valor)
    const areaTotal = esCompartido
      ? destino.reduce((total, ciclo) => total + (areaPorSuerte.get(ciclo.suerteId) ?? 0), 0)
      : 1
    for (const ciclo of destino) {
      const area = areaPorSuerte.get(ciclo.suerteId) ?? 0
      const parte = esCompartido ? monto * area / (areaTotal || 1) : monto
      costoPorCiclo.set(ciclo.id, (costoPorCiclo.get(ciclo.id) ?? 0) + parte)
      if (anioBase === null) continue
      const factor = factorAPesosDe(Number(movimiento.fecha.slice(0, 4)), anioBase, inflacion!.ipcAnual)
      if (factor === null) {
        faltaIpc = true
        ciclosSinIpc.add(ciclo.id)
      } else {
        costoHoyPorCiclo.set(ciclo.id, (costoHoyPorCiclo.get(ciclo.id) ?? 0) + parte * factor)
      }
    }
  }

  const filas = [...grupos.values()]
    .sort((a, b) => a.enCurso ? 1 : b.enCurso ? -1 : a.anio - b.anio)
    .map(grupo => {
      const areaDeCiclo = (ciclo: Ciclo) => areaPorSuerte.get(ciclo.suerteId) ?? 0
      const areaHa = grupo.ciclos.reduce((total, ciclo) => total + areaDeCiclo(ciclo), 0)
      const etiquetasGrupo = [...new Set(grupo.ciclos.map(ciclo => etiquetas.get(ciclo.id) ?? 'Varios cortes'))]
      const etiqueta = etiquetasGrupo.length === 1 ? etiquetasGrupo[0] : 'Varios cortes'
      const promedioPonderado = (campo: 'tch' | 'rendimiento' | 'sacarosa' | 'edadMeses') => {
        let total = 0
        let peso = 0
        for (const ciclo of grupo.ciclos) {
          const valor = seguro(ciclo.datosCosecha?.[campo])
          if (valor <= 0) continue
          total += valor * areaDeCiclo(ciclo)
          peso += areaDeCiclo(ciclo)
        }
        return divide(total, peso)
      }

      let toneladas = 0
      let hayToneladas = false
      let costoConToneladas = 0
      let costoHoyConToneladas = 0
      for (const ciclo of grupo.ciclos) {
        const cosecha = ciclo.datosCosecha
        const toneladasCiclo = cosecha?.toneladas == null
          ? (cosecha?.tch == null ? null : seguro(cosecha.tch) * areaDeCiclo(ciclo))
          : seguro(cosecha.toneladas)
        if (toneladasCiclo === null || toneladasCiclo <= 0) continue
        toneladas += toneladasCiclo
        hayToneladas = true
        costoConToneladas += costoPorCiclo.get(ciclo.id) ?? 0
        costoHoyConToneladas += costoHoyPorCiclo.get(ciclo.id) ?? 0
      }

      const costo = grupo.ciclos.reduce((total, ciclo) => total + (costoPorCiclo.get(ciclo.id) ?? 0), 0)
      const costoHoy = anioBase === null || grupo.enCurso || grupo.ciclos.some(ciclo => ciclosSinIpc.has(ciclo.id))
        ? null
        : grupo.ciclos.reduce((total, ciclo) => total + (costoHoyPorCiclo.get(ciclo.id) ?? 0), 0)
      const toneladasGrupo = grupo.enCurso || !hayToneladas ? null : toneladas
      const costoT = grupo.enCurso || !hayToneladas ? null : divide(costoConToneladas, toneladas)
      const costoTHoy = grupo.enCurso || !hayToneladas || costoHoy === null
        ? null
        : divide(costoHoyConToneladas, toneladas)
      const kgAzucarTc = seguro(finca?.kgAzucarTc) || seguro(refs?.costos?.kgAzucarTc)

      return {
        clave: grupo.clave,
        anio: grupo.anio,
        etiqueta,
        enCurso: grupo.enCurso,
        suertes: grupo.ciclos.length,
        areaHa,
        tch: grupo.enCurso ? null : promedioPonderado('tch'),
        rendimiento: grupo.enCurso ? null : promedioPonderado('rendimiento'),
        sacarosa: grupo.enCurso ? null : promedioPonderado('sacarosa'),
        edadMeses: grupo.enCurso ? null : promedioPonderado('edadMeses'),
        toneladas: toneladasGrupo,
        costo,
        costoHoy,
        costoHa: divide(costo, areaHa),
        costoHaHoy: costoHoy === null || grupo.enCurso ? null : divide(costoHoy, areaHa),
        costoT,
        costoTHoy,
        costoKg: kgAzucarTc > 0 && costoT !== null ? costoT / kgAzucarTc : null,
        costoKgHoy: kgAzucarTc > 0 && costoTHoy !== null ? costoTHoy / kgAzucarTc : null,
      }
    })
  return { filas, anioBase, fuenteIpc: inflacion?.fuente ?? null, faltaIpc }
}
