import type { LaborCiclo, LaborPaquete, TipoCiclo } from '../services/fincasApi'

/**
 * Plan y presupuesto de un corte nuevo, ANTES de activarlo (25-oct-2026).
 * Replica en el celular lo que hace `af__abrir_ciclo` en la base —qué labores entran, con qué
 * cantidad y ventana—, para que el administrador vea y ajuste el presupuesto antes de que
 * exista. La base sigue siendo la que manda: al activar, `af_abrir_ciclo_plan` abre el corte
 * y aplica los ajustes en una sola transacción, y recalcula la cantidad con el área exacta.
 *
 * Total de una línea = cantidad × pasadas × (servicio + ppto por ha). Las columnas de la base
 * se llaman `costo_unitario_plan` (servicio) y `costo_aparte_unitario_plan` (ppto por ha).
 */

export interface LineaPlan {
  /** labor|unidad|aplica de la fila del catálogo: identifica la línea sin depender de su posición. */
  clave: string
  labor: string
  unidad: string
  repetible: boolean
  /** Una pasada: área de la suerte × cantidad por ha. Es una estimación de pantalla; la base la recalcula exacta. */
  cantidad: number
  servicio: number
  ppto: number
  pasadas: number
  ventanaIdeal: number | null
  ventanaNormal: number | null
  orden: number
  /** Variedad de la fila del catálogo de la que salió (null = genérica). */
  variedadFila: string | null
}

const n = (v: unknown): number => {
  const x = Number(v)
  return Number.isFinite(x) ? x : 0
}
const sinTildes = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase()
const redondear2 = (v: number): number => Math.round((v + Number.EPSILON) * 100) / 100

/** Igual que `af_norm_variedad` de la base: solo letras y números, en mayúscula. */
export const normVariedad = (s: string | null | undefined): string => (s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')

/** Igual que `af_variedad_coincide`: una fila sin variedad sirve a todas; con variedad, debe parecerse a la de la suerte. */
export function variedadCoincide(filaVariedad: string | null | undefined, suerteVariedad: string | null | undefined): boolean {
  if (filaVariedad == null || filaVariedad === '') return true
  const s = normVariedad(suerteVariedad)
  if (s.length < 3) return false
  const f = normVariedad(filaVariedad)
  return f.includes(s) || s.includes(f)
}

/**
 * Las labores con las que nacería el corte: activas, que aplican al tipo de corte y a la variedad
 * de la suerte; si una labor tiene fila por variedad, esa le gana a la genérica (como `af__abrir_ciclo`).
 */
export function lineasDesdeCatalogo(
  paquete: LaborPaquete[], tipo: TipoCiclo, areaHa: number, variedadSuerte: string | null | undefined,
): LineaPlan[] {
  const elegidas = new Map<string, LaborPaquete>()
  for (const p of paquete ?? []) {
    if (!p?.activa || !p.labor) continue
    if (p.aplica !== 'AMBOS' && p.aplica !== tipo) continue
    if (!variedadCoincide(p.variedad, variedadSuerte)) continue
    const clave = `${sinTildes(p.labor)}|${p.unidad}|${p.aplica}`
    const actual = elegidas.get(clave)
    const gana = !actual || (!!p.variedad && !actual.variedad) || (!!p.variedad === !!actual.variedad && n(p.orden) < n(actual.orden))
    if (gana) elegidas.set(clave, p)
  }
  return [...elegidas.entries()].map(([clave, p]) => ({
    clave,
    labor: p.labor,
    unidad: p.unidad,
    repetible: !!p.repetible,
    cantidad: redondear2(n(areaHa) * (n(p.cantidadPorHa) || 1)),
    servicio: n(p.costoUnitario),
    ppto: n(p.costoAparteUnitario),
    pasadas: p.repetible ? Math.max(1, n(p.pasadasPlan) || 1) : 1,
    ventanaIdeal: p.ventanaIdeal ?? null,
    ventanaNormal: p.ventanaNormal ?? null,
    orden: n(p.orden),
    variedadFila: p.variedad ?? null,
  })).sort((a, b) => a.orden - b.orden || a.labor.localeCompare(b.labor))
}

/** Total de una línea del plan. */
export const totalLinea = (l: Pick<LineaPlan, 'cantidad' | 'pasadas' | 'servicio' | 'ppto'>): number =>
  n(l.cantidad) * Math.max(1, n(l.pasadas)) * (n(l.servicio) + n(l.ppto))

export interface TotalesPlan { servicio: number; ppto: number; total: number; porHa: number | null; sinCosto: number }

export function totalesPlan(lineas: LineaPlan[], areaHa: number): TotalesPlan {
  let servicio = 0
  let ppto = 0
  let sinCosto = 0
  for (const l of lineas ?? []) {
    const veces = n(l.cantidad) * Math.max(1, n(l.pasadas))
    servicio += veces * n(l.servicio)
    ppto += veces * n(l.ppto)
    if (n(l.servicio) + n(l.ppto) <= 0) sinCosto++
  }
  const total = servicio + ppto
  return { servicio, ppto, total, porHa: n(areaHa) > 0 ? total / n(areaHa) : null, sinCosto }
}

export interface CostoOrigen {
  labor: string; unidad: string; estado: string
  costoUnitarioPlan: number; costoAparteUnitarioPlan: number; pasadasPlan: number
}

/**
 * «Copiar el corte anterior» (o el de otra suerte): trae SOLO los costos y las pasadas de las labores
 * que coinciden por nombre y unidad. Las labores que no existían en el origen se quedan con el catálogo
 * y se devuelven en `sinOrigen`, para avisarlo. Las anuladas del origen no cuentan.
 */
export function copiarCostos(lineas: LineaPlan[], origen: Array<CostoOrigen | LaborCiclo>): {
  lineas: LineaPlan[]; copiadas: number; sinOrigen: string[]
} {
  const porClave = new Map<string, CostoOrigen | LaborCiclo>()
  for (const o of origen ?? []) {
    if (!o || o.estado === 'ANULADA') continue
    const k = `${sinTildes(o.labor)}|${o.unidad}`
    if (!porClave.has(k)) porClave.set(k, o)
  }
  let copiadas = 0
  const sinOrigen: string[] = []
  const nuevas = (lineas ?? []).map((l) => {
    const o = porClave.get(`${sinTildes(l.labor)}|${l.unidad}`)
    if (!o) { sinOrigen.push(l.labor); return l }
    copiadas++
    return {
      ...l,
      servicio: n(o.costoUnitarioPlan),
      ppto: n(o.costoAparteUnitarioPlan),
      pasadas: l.repetible ? Math.max(1, n(o.pasadasPlan) || 1) : 1,
    }
  })
  return { lineas: nuevas, copiadas, sinOrigen }
}

/** Suma `dias` a una fecha AAAA-MM-DD (al mediodía, para no cruzar el día por el huso). */
export function sumarDias(fecha: string, dias: number): string {
  return new Date(Date.parse(`${fecha}T12:00:00Z`) + dias * 86_400_000).toISOString().slice(0, 10)
}

export interface HitoCronograma { linea: LineaPlan; ideal: string | null; normal: string | null }

/**
 * Cronograma del corte: cada labor con su fecha ideal y su fecha límite normal (DDC = días después del corte).
 * Primero las que tienen ventana, por fecha ideal; al final las que no (riego, malezas), que se repiten.
 */
export function cronograma(lineas: LineaPlan[], fechaCorte: string): HitoCronograma[] {
  const hitos = (lineas ?? []).map((l) => ({
    linea: l,
    ideal: l.ventanaIdeal != null ? sumarDias(fechaCorte, l.ventanaIdeal) : null,
    normal: l.ventanaNormal != null ? sumarDias(fechaCorte, l.ventanaNormal) : null,
  }))
  return hitos.sort((a, b) => {
    if (a.ideal && b.ideal) return a.ideal.localeCompare(b.ideal) || a.linea.orden - b.linea.orden
    if (a.ideal) return -1
    if (b.ideal) return 1
    return a.linea.orden - b.linea.orden
  })
}

/** Lo que revisa el asistente antes de dejar activar: null = bien; texto = qué corregir. */
export function validarLinea(l: LineaPlan): string | null {
  if (!Number.isFinite(l.servicio) || !Number.isFinite(l.ppto) || l.servicio < 0 || l.ppto < 0) return `${l.labor}: los costos deben ser cero o más.`
  if (!Number.isInteger(l.pasadas) || l.pasadas < 1) return `${l.labor}: necesita al menos una pasada.`
  if (!l.repetible && l.pasadas > 1) return `${l.labor}: no se repite, solo lleva una pasada.`
  return null
}

export interface AjusteRpc { labor: string; unidad: string; costo: number; costo_aparte: number; pasadas: number }

/** La lista que recibe `af_abrir_ciclo_plan`: una entrada por línea, con los números ya limpios. */
export function ajustesParaRpc(lineas: LineaPlan[]): AjusteRpc[] {
  return (lineas ?? []).map((l) => ({
    labor: l.labor, unidad: l.unidad, costo: n(l.servicio), costo_aparte: n(l.ppto),
    pasadas: l.repetible ? Math.max(1, Math.round(n(l.pasadas)) || 1) : 1,
  }))
}
