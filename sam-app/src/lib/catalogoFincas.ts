import type { LaborPaquete, RubroCosto } from '../services/fincasApi'

/**
 * Cálculos del CATÁLOGO de labores de Fincas (la plantilla con la que nace cada corte).
 * Una sola fórmula para toda la pantalla, igual que `presupuestoLabor` lo es para el corte:
 *   total por unidad base = cantidad por ha × pasadas × (servicio + ppto por ha)
 * Las columnas de la base se llaman `costo_unitario` (servicio) y `costo_aparte_unitario`
 * (ppto por ha); aquí solo cambia lo que ve la gente.
 */

const n = (v: unknown): number => {
  const x = Number(v)
  return Number.isFinite(x) ? x : 0
}

/** Servicio + ppto por ha de UNA fila, ya multiplicado por cantidad por ha y pasadas. */
export function totalPorHa(p: Pick<LaborPaquete, 'cantidadPorHa' | 'pasadasPlan' | 'costoUnitario' | 'costoAparteUnitario' | 'repetible'>): number {
  const cantidad = n(p.cantidadPorHa) || 1
  const pasadas = p.repetible ? Math.max(1, n(p.pasadasPlan)) : 1
  return cantidad * pasadas * (n(p.costoUnitario) + n(p.costoAparteUnitario))
}

/** Una fila sin ningún costo no suma al presupuesto: la pantalla la marca en rojo. */
export const sinCosto = (p: Pick<LaborPaquete, 'costoUnitario' | 'costoAparteUnitario'>): boolean =>
  n(p.costoUnitario) + n(p.costoAparteUnitario) <= 0

const sinTildes = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase()

export interface GrupoCatalogo {
  labor: string
  /** Rubro del gremio (insumos, agua, maquinaria…) según `af_config`; null si no está mapeado. */
  rubro: RubroCosto | null
  /** Las filas del catálogo de esta labor: genéricas y por variedad, en el orden del catálogo. */
  filas: LaborPaquete[]
  activas: number
  /** Filas ACTIVAS sin ningún costo cargado. */
  sinCosto: number
  orden: number
}

/** Busca el rubro de una labor aunque la tilde o las mayúsculas no coincidan con la clave guardada. */
export function rubroDeLabor(labor: string, rubroPorLabor: Record<string, RubroCosto>): RubroCosto | null {
  if (rubroPorLabor[labor]) return rubroPorLabor[labor]
  const clave = sinTildes(labor)
  for (const [k, v] of Object.entries(rubroPorLabor)) if (sinTildes(k) === clave) return v
  return null
}

/** Agrupa el catálogo por labor, en el orden en que el cliente lo ordenó. Nunca lanza con datos incompletos. */
export function agruparCatalogo(paquete: LaborPaquete[], rubroPorLabor: Record<string, RubroCosto> = {}): GrupoCatalogo[] {
  const grupos = new Map<string, GrupoCatalogo>()
  for (const p of paquete ?? []) {
    if (!p || !p.labor) continue
    const clave = sinTildes(p.labor)
    let g = grupos.get(clave)
    if (!g) {
      g = { labor: p.labor, rubro: rubroDeLabor(p.labor, rubroPorLabor), filas: [], activas: 0, sinCosto: 0, orden: n(p.orden) }
      grupos.set(clave, g)
    }
    g.filas.push(p)
    g.orden = Math.min(g.orden, n(p.orden))
    if (p.activa) {
      g.activas++
      if (sinCosto(p)) g.sinCosto++
    }
  }
  const lista = [...grupos.values()]
  for (const g of lista) {
    // Dentro de la labor: la genérica primero, luego las de variedad por nombre; soca antes que plantilla.
    g.filas.sort((a, b) =>
      Number(!!a.variedad) - Number(!!b.variedad) ||
      (a.aplica === b.aplica ? 0 : a.aplica === 'SOCA' ? -1 : b.aplica === 'SOCA' ? 1 : a.aplica === 'AMBOS' ? -1 : 1) ||
      (a.variedad ?? '').localeCompare(b.variedad ?? '') ||
      n(a.orden) - n(b.orden))
  }
  return lista.sort((a, b) => a.orden - b.orden || a.labor.localeCompare(b.labor))
}

/**
 * Costo de referencia por hectárea de un corte nuevo: por cada labor, la fila genérica (sin variedad)
 * que aplica a ese tipo de corte; si solo hay filas de variedad, la primera. Es una guía para el
 * administrador, no un presupuesto: el de cada suerte sale de su variedad y su área.
 */
export function costoReferenciaPorHa(paquete: LaborPaquete[], tipo: 'SOCA' | 'PLANTILLA'): { total: number; labores: number; sinCosto: number } {
  const porLabor = new Map<string, LaborPaquete>()
  const puntaje = (p: LaborPaquete) => (p.variedad ? 0 : 2) + (p.aplica === tipo ? 1 : 0)
  for (const p of paquete ?? []) {
    if (!p?.activa || !p.labor) continue
    if (p.aplica !== 'AMBOS' && p.aplica !== tipo) continue
    const clave = sinTildes(p.labor)
    const actual = porLabor.get(clave)
    if (!actual || puntaje(p) > puntaje(actual)) porLabor.set(clave, p)
  }
  let total = 0
  let sin = 0
  for (const p of porLabor.values()) {
    total += totalPorHa(p)
    if (sinCosto(p)) sin++
  }
  return { total, labores: porLabor.size, sinCosto: sin }
}

export interface ResumenCatalogo {
  laboresActivas: number
  filasActivas: number
  filasSinCosto: number
  filasSinVentana: number
}

export function resumenCatalogo(paquete: LaborPaquete[]): ResumenCatalogo {
  const activas = (paquete ?? []).filter((p) => p?.activa)
  return {
    laboresActivas: new Set(activas.map((p) => sinTildes(p.labor))).size,
    filasActivas: activas.length,
    filasSinCosto: activas.filter(sinCosto).length,
    // Las repetibles (riego, malezas) no llevan ventana a propósito: no cuentan como faltante.
    filasSinVentana: activas.filter((p) => !p.repetible && (p.ventanaIdeal == null || p.ventanaNormal == null)).length,
  }
}
