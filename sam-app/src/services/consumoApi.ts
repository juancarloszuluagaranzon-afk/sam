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
 * Devuelve vacío si ese mes no tiene cierre — ahí manda `loadHorasPorRangoMes`.
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
 * Horas del mes por máquina a partir del **horómetro inicial y final del mes**.
 *
 * Es el mismo criterio con el que administración hace el cierre a mano: lo que
 * marcaba la máquina al empezar el mes contra lo que marca al terminarlo. Cuenta
 * TODAS las horas que rodó, no solo las que quedaron dentro de una labor
 * cerrada, que es lo que suma el método viejo.
 *
 * 🔴 **Un horómetro solo SUBE, y ahí está la limpieza.** No basta con tomar el
 * máximo y el mínimo del mes: una sola lectura mala arruina el mes entero
 * (medido — CASE1002 daba 54.999 h en julio contra 172 reales). Se recorren las
 * lecturas en orden y se acepta una solo si **sube** respecto a la última buena
 * y el avance cabe en el tiempo transcurrido (24 h por día). La que no cumple se
 * descarta y la serie sigue con la última buena.
 *
 * ⚠️ **Si la serie se desploma, manda la suma.** En 4 de 20 máquinas las
 * lecturas vienen tan sucias que la limpieza rechaza casi todo y el rango queda
 * en 2 horas para un mes de 298. La señal de que eso pasó es que el rango
 * quedaría por debajo de la mitad de lo que suman los tramos — y el rango de un
 * mes NUNCA puede ser menor que los tramos que van dentro de él.
 *
 * Medido contra el cierre manual de julio (20 máquinas, el único mes que lo
 * tiene): error medio **24% contra 30%** del método viejo, **13 de 20 máquinas
 * dentro del 10%** contra 9, y varias exactas (CASE1301 380=380, CASE902
 * 263=263). El total del mes queda en +3%.
 */
export async function loadHorasPorRangoMes(desde: string, hasta: string): Promise<{
  horas: Map<string, number>
  /** Qué máquinas tuvieron que caer a la suma porque su serie se desplomó. */
  cayeronASuma: string[]
}> {
  const { data, error } = await supabase
    .from('labor_sesiones')
    .select('equipo_codigo,fecha,horometro_inicial,horometro_final,horas')
    .gte('fecha', desde).lte('fecha', hasta)
    .order('fecha', { ascending: true })
  if (error || !data) return { horas: new Map(), cayeronASuma: [] }

  type Lect = { fecha: string; h: number }
  const porEquipo = new Map<string, { lecturas: Lect[]; suma: number }>()

  for (const r of data as {
    equipo_codigo?: string; fecha?: string
    horometro_inicial?: number; horometro_final?: number; horas?: number
  }[]) {
    const eq = r.equipo_codigo
    const fecha = r.fecha
    if (!eq || !fecha) continue
    const e = porEquipo.get(eq) ?? { lecturas: [], suma: 0 }
    for (const v of [r.horometro_inicial, r.horometro_final]) {
      const h = Number(v)
      // Un 0 no es una lectura: es la casilla que quedó sin llenar.
      if (Number.isFinite(h) && h > 0) e.lecturas.push({ fecha, h })
    }
    const hs = Number(r.horas)
    if (Number.isFinite(hs) && hs > 0 && hs < 24) e.suma += hs
    porEquipo.set(eq, e)
  }

  const horas = new Map<string, number>()
  const cayeronASuma: string[] = []

  for (const [eq, { lecturas, suma }] of porEquipo) {
    // Por fecha y, dentro del mismo día, de menor a mayor: el horómetro sube.
    lecturas.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.h - b.h)

    let prev: Lect | null = null
    let primera: number | null = null
    let ultima: number | null = null
    for (const l of lecturas) {
      if (prev == null) { prev = l; primera = l.h; ultima = l.h; continue }
      const dias = Math.max(1, Math.round(
        (Date.parse(l.fecha) - Date.parse(prev.fecha)) / 86400000))
      // 24 h por día transcurrido: es el mismo tope de `MAX_HORAS_ENTRE_LECTURAS`.
      if (l.h >= prev.h && l.h - prev.h <= dias * 24) { prev = l; ultima = l.h }
    }

    const rango = primera != null && ultima != null
      ? Math.round((ultima - primera) * 100) / 100
      : 0
    // El rango de un mes no puede quedar por debajo de la mitad de lo que suman
    // sus propios tramos: si pasó, la limpieza se comió las lecturas buenas.
    if (rango >= suma * 0.5 && rango > 0) {
      horas.set(eq, rango)
    } else if (suma > 0) {
      horas.set(eq, Math.round(suma * 100) / 100)
      cayeronASuma.push(eq)
    }
  }

  return { horas, cayeronASuma }
}

