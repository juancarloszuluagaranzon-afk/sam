import { supabase } from '../lib/supabase'

/**
 * Consumo por máquina, uniendo el papel y la app.
 *
 * Lee `consumo_unificado_v`, que ya resuelve las tres fuentes (el formato en
 * papel hasta julio, las salidas de bodega, y el tanqueo en bomba que nunca
 * pasó por ninguna bodega). Hacer esa unión aquí en TypeScript era la otra
 * opción, y se desincroniza el día que alguien toque una fuente y olvide las
 * otras.
 */

export interface ConsumoFila {
  fecha: string
  equipoCodigo: string
  operario: string
  responsable: string
  insumo: string
  unidad: string
  cantidad: number
  /** `papel` = el formato manual previo a la app · `app` = registro del sistema. */
  fuente: 'papel' | 'app'
}

/** La referencia oficial 2025, del Excel de maquinaria. */
export interface ReferenciaEquipo {
  equipoCodigo: string
  galHora?: number
  ganchosHora?: number
  horas?: number
}

export async function loadConsumo(opts?: {
  desde?: string; hasta?: string; limit?: number
}): Promise<ConsumoFila[]> {
  let q = supabase
    .from('consumo_unificado_v').select('*')
    .order('fecha', { ascending: false })
    .limit(opts?.limit ?? 20000)
  if (opts?.desde) q = q.gte('fecha', opts.desde)
  if (opts?.hasta) q = q.lte('fecha', opts.hasta)
  const { data, error } = await q
  if (error || !data) return []
  return data.map((r) => ({
    fecha: String(r.fecha ?? ''),
    equipoCodigo: String(r.equipo_codigo ?? ''),
    operario: String(r.operario ?? ''),
    responsable: String(r.responsable ?? ''),
    insumo: String(r.insumo ?? ''),
    unidad: String(r.unidad ?? ''),
    cantidad: Number(r.cantidad ?? 0),
    fuente: (String(r.fuente ?? 'app') === 'papel' ? 'papel' : 'app'),
  }))
}

export async function loadReferencias(anio = 2025): Promise<ReferenciaEquipo[]> {
  const { data, error } = await supabase
    .from('equipo_metas').select('equipo_codigo,gal_hora,ganchos_hora,horas').eq('anio', anio)
  if (error || !data) return []
  return data.map((r) => ({
    equipoCodigo: String(r.equipo_codigo),
    galHora: r.gal_hora == null ? undefined : Number(r.gal_hora),
    ganchosHora: r.ganchos_hora == null ? undefined : Number(r.ganchos_hora),
    horas: r.horas == null ? undefined : Number(r.horas),
  }))
}

/**
 * Horas del CIERRE MENSUAL, que es la fuente buena.
 *
 * Una lectura de horómetro por máquina y mes, no cientos de tramos: un dedazo
 * suelto no la contamina. `equipo_horas_mes` se llena con el cierre que
 * administración ya llevaba en Excel.
 *
 * Devuelve vacío si ese mes no tiene cierre — ahí manda `loadHorasPorEquipo`.
 */
export async function loadHorasDelMes(mes: string): Promise<Map<string, number>> {
  const { data, error } = await supabase
    .from('equipo_horas_mes').select('equipo_codigo,horas').eq('mes', `${mes}-01`)
  if (error || !data) return new Map()
  const m = new Map<string, number>()
  for (const r of data as { equipo_codigo?: string; horas?: number }[]) {
    const h = Number(r.horas ?? 0)
    if (r.equipo_codigo && h > 0) m.set(r.equipo_codigo, h)
  }
  return m
}

/**
 * Horas trabajadas por máquina en el periodo, de las labores cerradas.
 *
 * ⚠️ Se descartan los tramos absurdos (≤0 o ≥24 h en una jornada). Sin ese
 * filtro, los horómetros sucios meten saltos de miles de horas y el galones/hora
 * sale en cualquier cosa: hay 445 sesiones de 2.212 con el dato malo, y una sola
 * basta para arruinar el promedio de la máquina.
 */
export async function loadHorasPorEquipo(desde: string, hasta: string): Promise<Map<string, number>> {
  const { data, error } = await supabase
    .from('labor_sesiones').select('equipo_codigo,horas,fecha')
    .gte('fecha', desde).lte('fecha', hasta)
  if (error || !data) return new Map()
  const m = new Map<string, number>()
  for (const r of data as { equipo_codigo?: string; horas?: number }[]) {
    const h = Number(r.horas ?? 0)
    if (!r.equipo_codigo || !Number.isFinite(h) || h <= 0 || h >= 24) continue
    m.set(r.equipo_codigo, (m.get(r.equipo_codigo) ?? 0) + h)
  }
  return m
}
