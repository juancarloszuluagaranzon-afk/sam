import { supabase } from '../lib/supabase'
import type {
  Chequeo, ChequeoItem, ChequeoLista, ChequeoRespuesta, ChequeoResultado,
} from '../domain/sam'

/**
 * Chequeo diario del operario.
 *
 * El catálogo (listas e ítems) sale del Excel de maquinaria del cliente. Lo que
 * el operario diligencia cada día vive en `chequeos` + `chequeo_respuestas`.
 *
 * Va en su propio archivo y no en `samApi.ts` porque ese ya pasa de 3.000 líneas
 * y este módulo no comparte nada con él salvo el cliente de Supabase.
 */

// ── Catálogo ────────────────────────────────────────────────────────────────

export async function loadChequeoListas(): Promise<ChequeoLista[]> {
  const { data, error } = await supabase
    .from('chequeo_listas').select('*').eq('activa', true).order('codigo')
  if (error || !data) return []
  return data.map((r) => ({
    id: Number(r.id),
    codigo: String(r.codigo),
    nombre: String(r.nombre ?? ''),
    modelo: r.modelo ? String(r.modelo) : undefined,
    activa: r.activa !== false,
  }))
}

export async function loadChequeoItems(listaId: number): Promise<ChequeoItem[]> {
  const { data, error } = await supabase
    .from('chequeo_items').select('*')
    .eq('lista_id', listaId).eq('activo', true)
    .order('vuelta').order('orden')
  if (error || !data) return []
  return data.map((r) => ({
    id: Number(r.id),
    listaId: Number(r.lista_id),
    vuelta: Number(r.vuelta ?? 1),
    orden: Number(r.orden ?? 0),
    texto: String(r.texto ?? ''),
    tipo: (String(r.tipo ?? 'ESTADO') as ChequeoItem['tipo']),
    critico: r.critico === true,
    unidad: r.unidad ? String(r.unidad) : undefined,
  }))
}

/**
 * Qué lista de chequeo le toca a una máquina.
 *
 * `null` es una respuesta válida y significa "a esta máquina no se le pide
 * chequeo": la FIAT es de oficios varios del taller y TRC-1 es de pruebas.
 * Pedirles chequeo diario sería inventar treinta tareas al día que nadie va a
 * hacer, y el primer chequeo inventado le quita credibilidad a todos los demás.
 */
export async function listaDeEquipo(equipoCodigo: string): Promise<number | null> {
  const { data, error } = await supabase
    .from('equipos').select('chequeo_lista_id').eq('codigo', equipoCodigo).maybeSingle()
  if (error || !data) return null
  const id = (data as { chequeo_lista_id: unknown }).chequeo_lista_id
  return id == null ? null : Number(id)
}

/**
 * Baraja los ítems DENTRO de cada vuelta, distinto cada día y cada máquina.
 *
 * Es la medida más barata contra el "todo bien" sin mirar, y la única que no
 * castiga al que sí revisa: si el orden cambia, la memoria muscular deja de
 * servir y toca leer. La semilla es fecha+máquina, así que el orden es el mismo
 * si la app se recarga a mitad del chequeo — no se puede reordenar a punta de
 * cerrar y abrir.
 */
export function ordenarDelDia(items: ChequeoItem[], equipoCodigo: string, fecha: string): ChequeoItem[] {
  let semilla = 0
  const clave = `${fecha}|${equipoCodigo}`
  for (let i = 0; i < clave.length; i++) semilla = (semilla * 31 + clave.charCodeAt(i)) >>> 0

  // Congruencial simple: no necesita ser criptográfico, solo estable y barato.
  const siguiente = () => {
    semilla = (semilla * 1664525 + 1013904223) >>> 0
    return semilla / 0x100000000
  }

  const porVuelta = new Map<number, ChequeoItem[]>()
  for (const it of items) {
    const lista = porVuelta.get(it.vuelta) ?? []
    lista.push(it)
    porVuelta.set(it.vuelta, lista)
  }

  const salida: ChequeoItem[] = []
  for (const vuelta of [...porVuelta.keys()].sort((a, b) => a - b)) {
    const de = [...(porVuelta.get(vuelta) ?? [])]
    // Fisher-Yates con la semilla del día.
    for (let i = de.length - 1; i > 0; i--) {
      const j = Math.floor(siguiente() * (i + 1))
      ;[de[i], de[j]] = [de[j], de[i]]
    }
    salida.push(...de)
  }
  return salida
}

// ── El chequeo del día ──────────────────────────────────────────────────────

function mapChequeo(row: Record<string, unknown>): Chequeo {
  const crudas = (row.respuestas ?? []) as Record<string, unknown>[]
  return {
    id: String(row.id),
    equipoCodigo: String(row.equipo_codigo ?? ''),
    listaId: Number(row.lista_id ?? 0),
    operarioId: String(row.operario_id ?? ''),
    operarioNombre: row.operario_nombre ? String(row.operario_nombre) : undefined,
    fecha: String(row.fecha ?? ''),
    horometro: row.horometro == null ? undefined : Number(row.horometro),
    iniciadoEn: row.iniciado_en ? String(row.iniciado_en) : undefined,
    finalizadoEn: row.finalizado_en ? String(row.finalizado_en) : undefined,
    duracionSeg: row.duracion_seg == null ? undefined : Number(row.duracion_seg),
    sospechoso: row.sospechoso === true,
    resultado: row.resultado ? (String(row.resultado) as ChequeoResultado) : undefined,
    nota: row.nota ? String(row.nota) : undefined,
    respuestas: crudas.map((r) => ({
      itemId: Number(r.item_id),
      itemTexto: String(r.item_texto ?? ''),
      valor: r.valor ? (String(r.valor) as ChequeoRespuesta['valor']) : undefined,
      severidad: r.severidad ? (String(r.severidad) as ChequeoRespuesta['severidad']) : undefined,
      medida: r.medida == null ? undefined : Number(r.medida),
      nota: r.nota ? String(r.nota) : undefined,
      fotoUrl: r.foto_url ? String(r.foto_url) : undefined,
      respondidoEn: r.respondido_en ? String(r.respondido_en) : undefined,
    })),
  }
}

/** ¿Ya se hizo el chequeo de esta máquina hoy? */
export async function chequeoDelDia(equipoCodigo: string, fecha: string): Promise<Chequeo | null> {
  const { data, error } = await supabase
    .from('chequeos')
    .select('*,respuestas:chequeo_respuestas(*)')
    .eq('equipo_codigo', equipoCodigo).eq('fecha', fecha)
    .maybeSingle()
  if (error || !data) return null
  return mapChequeo(data as Record<string, unknown>)
}

export async function loadChequeos(opts?: {
  desde?: string; hasta?: string; equipoCodigo?: string; limit?: number
}): Promise<Chequeo[]> {
  let q = supabase
    .from('chequeos').select('*,respuestas:chequeo_respuestas(*)')
    .order('fecha', { ascending: false }).limit(opts?.limit ?? 200)
  if (opts?.desde) q = q.gte('fecha', opts.desde)
  if (opts?.hasta) q = q.lte('fecha', opts.hasta)
  if (opts?.equipoCodigo) q = q.eq('equipo_codigo', opts.equipoCodigo)
  const { data, error } = await q
  if (error || !data) return []
  return data.map((r) => mapChequeo(r as Record<string, unknown>))
}

/**
 * Guarda el chequeo completo.
 *
 * El `id` viene del cliente, así que reintentar desde la cola offline no
 * duplica: el `upsert` por `(equipo_codigo, fecha)` deja un solo chequeo por
 * máquina y día, y las respuestas se reemplazan enteras. Sin esto, el operario
 * que guarda sin señal y sincroniza dos veces terminaba con dos chequeos.
 */
export async function guardarChequeo(c: Chequeo): Promise<void> {
  const { error } = await supabase.from('chequeos').upsert({
    id: c.id,
    equipo_codigo: c.equipoCodigo,
    lista_id: c.listaId,
    operario_id: c.operarioId,
    operario_nombre: c.operarioNombre ?? null,
    fecha: c.fecha,
    horometro: c.horometro ?? null,
    iniciado_en: c.iniciadoEn ?? null,
    finalizado_en: c.finalizadoEn ?? null,
    duracion_seg: c.duracionSeg ?? null,
    sospechoso: c.sospechoso,
    resultado: c.resultado ?? null,
    nota: c.nota ?? null,
  }, { onConflict: 'equipo_codigo,fecha' })
  if (error) throw new Error(error.message || 'No se pudo guardar el chequeo')

  // Se reemplazan enteras: es un solo hecho, no una acumulación.
  await supabase.from('chequeo_respuestas').delete().eq('chequeo_id', c.id)

  const filas = c.respuestas
    .filter((r) => r.valor != null || r.medida != null || r.nota)
    .map((r) => ({
      chequeo_id: c.id,
      item_id: r.itemId,
      item_texto: r.itemTexto,
      valor: r.valor ?? null,
      severidad: r.severidad ?? null,
      medida: r.medida ?? null,
      nota: r.nota ?? null,
      foto_url: r.fotoUrl ?? null,
      respondido_en: r.respondidoEn ?? null,
    }))
  if (filas.length) {
    const { error: e2 } = await supabase.from('chequeo_respuestas').insert(filas)
    if (e2) throw new Error(e2.message || 'No se pudieron guardar las respuestas')
  }
}

/**
 * La última lectura de horómetro que la app considera buena.
 *
 * Es contra lo que se valida lo que teclea el operario. Aquí está la causa raíz
 * de los datos sucios: la mayoría de las lecturas malas son las HORAS DEL DÍA
 * escritas en la casilla del horómetro (un `9` en una máquina que anda por
 * 3.534), y una PUMA que se teclea sin el punto decimal. Avisar en el momento,
 * con la última lectura al lado, es lo único que lo corta en el origen.
 */
export async function ultimoHorometro(equipoCodigo: string): Promise<number | null> {
  const { data, error } = await supabase
    .from('equipo_horometro_v').select('horometro').eq('codigo', equipoCodigo).maybeSingle()
  if (error || !data) return null
  const h = Number((data as { horometro: unknown }).horometro)
  return Number.isFinite(h) && h > 0 ? h : null
}
