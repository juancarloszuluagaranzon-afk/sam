import { supabase } from '../lib/supabase'
import type { ConfigHoras, Marcacion } from '../lib/horasExtra'
import { CONFIG_POR_DEFECTO } from '../lib/horasExtra'

/**
 * Entrada y salida de los mecánicos del taller.
 *
 * 🔴 **El cliente solo LEE.** Todo lo que escribe pasa por funciones
 * `security definer` (`taller_marcar`, `taller_anular_marcacion`…). Con un
 * `insert` abierto, cualquiera con el anon_key —que viaja en el bundle— se
 * regalaría una jornada de horas extras. Comprobado: el insert directo a
 * `taller_marcaciones` responde 401.
 *
 * Se lee con `select('*')` por la razón de siempre: la tabla va a crecer
 * mientras el cliente valida el flujo, y una columna nueva sin migrar no puede
 * dejar la pantalla en blanco.
 */

export interface MarcacionFila extends Marcacion {
  registradoEn: string
  metodo: 'HUELLA' | 'PIN' | 'MANUAL'
  credencialId?: string
  lat?: number
  lng?: number
  precisionM?: number
  dentroDelSitio?: boolean | null
  distanciaM?: number
  dispositivo?: string
  nota?: string
  horaCorregida: boolean
  anulada: boolean
  anuladaPor?: string
  motivo?: string
}

function mapFila(r: Record<string, unknown>): MarcacionFila {
  return {
    id: String(r.id),
    usuarioId: String(r.usuario_id),
    tipo: String(r.tipo) === 'SALIDA' ? 'SALIDA' : 'ENTRADA',
    marcadoEn: String(r.marcado_en),
    registradoEn: String(r.registrado_en ?? r.marcado_en),
    metodo: (['HUELLA', 'PIN', 'MANUAL'] as const).find((m) => m === r.metodo) ?? 'HUELLA',
    credencialId: r.credencial_id ? String(r.credencial_id) : undefined,
    lat: r.lat == null ? undefined : Number(r.lat),
    lng: r.lng == null ? undefined : Number(r.lng),
    precisionM: r.precision_m == null ? undefined : Number(r.precision_m),
    dentroDelSitio: r.dentro_del_sitio == null ? null : Boolean(r.dentro_del_sitio),
    distanciaM: r.distancia_m == null ? undefined : Number(r.distancia_m),
    dispositivo: r.dispositivo ? String(r.dispositivo) : undefined,
    nota: r.nota ? String(r.nota) : undefined,
    horaCorregida: Boolean(r.hora_corregida),
    anulada: Boolean(r.anulada),
    anuladaPor: r.anulada_por ? String(r.anulada_por) : undefined,
    motivo: r.motivo ? String(r.motivo) : undefined,
  }
}

export interface Credencial {
  id: string
  usuarioId: string
  apodo?: string
  creadaEn: string
  ultimoUso?: string
}

export interface Sitio {
  id: string
  nombre: string
  lat: number
  lng: number
  radioM: number
}

/* ───────────────────────────── Lecturas ───────────────────────────────── */

export async function loadCredenciales(usuarioId?: string): Promise<Credencial[]> {
  let q = supabase.from('taller_credenciales').select('*').eq('activa', true)
  if (usuarioId) q = q.eq('usuario_id', usuarioId)
  const { data, error } = await q
  if (error || !data) return []
  return data.map((r) => ({
    id: String(r.id),
    usuarioId: String(r.usuario_id),
    apodo: r.apodo_dispositivo ? String(r.apodo_dispositivo) : undefined,
    creadaEn: String(r.creada_en),
    ultimoUso: r.ultimo_uso ? String(r.ultimo_uso) : undefined,
  }))
}

export async function loadMarcaciones(opts: {
  desde?: string
  hasta?: string
  usuarioId?: string
  limit?: number
}): Promise<MarcacionFila[]> {
  let q = supabase
    .from('taller_marcaciones')
    .select('*')
    .eq('anulada', false)
    .order('marcado_en', { ascending: true })
    .limit(opts.limit ?? 5000)
  if (opts.desde) q = q.gte('marcado_en', opts.desde)
  if (opts.hasta) q = q.lte('marcado_en', opts.hasta)
  if (opts.usuarioId) q = q.eq('usuario_id', opts.usuarioId)
  const { data, error } = await q
  if (error || !data) return []
  return data.map(mapFila)
}

/** La última marcación de una persona: dice si está adentro o afuera. */
export async function ultimaMarcacion(usuarioId: string): Promise<MarcacionFila | null> {
  const { data, error } = await supabase
    .from('taller_marcaciones')
    .select('*')
    .eq('usuario_id', usuarioId)
    .eq('anulada', false)
    .order('marcado_en', { ascending: false })
    .limit(1)
  if (error || !data || data.length === 0) return null
  return mapFila(data[0])
}

export async function loadSitios(): Promise<Sitio[]> {
  const { data, error } = await supabase.from('taller_sitios').select('*').eq('activo', true)
  if (error || !data) return []
  return data.map((r) => ({
    id: String(r.id), nombre: String(r.nombre),
    lat: Number(r.lat), lng: Number(r.lng), radioM: Number(r.radio_m ?? 150),
  }))
}

/**
 * La configuración de la jornada.
 *
 * ⚠️ Si la consulta falla se devuelven los valores de ley por defecto en vez
 * de nada: un reporte de horas que no se dibuja porque no cargó una fila de
 * configuración es peor que uno que se dibuja con el valor legal vigente.
 */
export async function loadConfigHoras(): Promise<ConfigHoras> {
  const { data, error } = await supabase.from('taller_config').select('*').limit(1)
  if (error || !data || data.length === 0) return CONFIG_POR_DEFECTO
  const r = data[0]
  return {
    jornadaOrdinariaDiaria: Number(r.jornada_ordinaria_diaria ?? CONFIG_POR_DEFECTO.jornadaOrdinariaDiaria),
    jornadaSemanalMax: Number(r.jornada_semanal_max ?? CONFIG_POR_DEFECTO.jornadaSemanalMax),
    inicioNoche: String(r.inicio_noche ?? CONFIG_POR_DEFECTO.inicioNoche),
    finNoche: String(r.fin_noche ?? CONFIG_POR_DEFECTO.finNoche),
  }
}

/* ───────────────────────────── Escrituras ─────────────────────────────── */

export async function registrarCredencial(input: {
  credencialId: string
  usuarioId: string
  apodo?: string
  llavePublica?: string | null
}): Promise<void> {
  const { error } = await supabase.rpc('taller_registrar_credencial', {
    p_credencial_id: input.credencialId,
    p_usuario_id: input.usuarioId,
    p_apodo: input.apodo ?? null,
    p_llave_publica: input.llavePublica ?? null,
  })
  if (error) throw error
}

export interface RespuestaMarcar {
  ok: boolean
  repetida: boolean
  id: string
  marcadoEn: string
  horaCorregida?: boolean
  dentroDelSitio?: boolean | null
  distanciaM?: number | null
}

/**
 * Marca entrada o salida.
 *
 * 🔴 **El id lo pone el TELÉFONO.** Sin señal la marcación se encola, y al
 * reintentar no puede crear una jornada gemela. La función devuelve
 * `repetida: true` cuando ya existía, en vez de fallar: para quien está en el
 * taller, que el reintento «no haga nada» es exactamente lo correcto.
 *
 * `ocurrioEn` se manda siempre. El servidor la acepta pero la acota: del
 * futuro o de hace más de dos días la reemplaza por la suya y lo marca.
 */
export async function marcar(input: {
  id: string
  usuarioId: string
  tipo: 'ENTRADA' | 'SALIDA'
  ocurrioEn: string
  metodo?: 'HUELLA' | 'PIN' | 'MANUAL'
  credencialId?: string | null
  lat?: number | null
  lng?: number | null
  precisionM?: number | null
  dispositivo?: string | null
  nota?: string | null
}): Promise<RespuestaMarcar> {
  const { data, error } = await supabase.rpc('taller_marcar', {
    p_id: input.id,
    p_usuario_id: input.usuarioId,
    p_tipo: input.tipo,
    p_ocurrio_en: input.ocurrioEn,
    p_metodo: input.metodo ?? 'HUELLA',
    p_credencial_id: input.credencialId ?? null,
    p_lat: input.lat ?? null,
    p_lng: input.lng ?? null,
    p_precision_m: input.precisionM ?? null,
    p_dispositivo: input.dispositivo ?? null,
    p_nota: input.nota ?? null,
  })
  if (error) throw error
  const r = (data ?? {}) as Record<string, unknown>
  return {
    ok: Boolean(r.ok),
    repetida: Boolean(r.repetida),
    id: String(r.id ?? input.id),
    marcadoEn: String(r.marcado_en ?? input.ocurrioEn),
    horaCorregida: Boolean(r.hora_corregida),
    dentroDelSitio: r.dentro_del_sitio == null ? null : Boolean(r.dentro_del_sitio),
    distanciaM: r.distancia_m == null ? null : Number(r.distancia_m),
  }
}

export async function anularMarcacion(id: string, quien: string, motivo: string): Promise<void> {
  const { error } = await supabase.rpc('taller_anular_marcacion', {
    p_id: id, p_quien: quien, p_motivo: motivo,
  })
  if (error) throw error
}

export async function guardarConfigHoras(cfg: ConfigHoras, quien: string): Promise<void> {
  const { error } = await supabase.rpc('taller_guardar_config', {
    p_diaria: cfg.jornadaOrdinariaDiaria,
    p_semanal: cfg.jornadaSemanalMax,
    p_inicio_noche: cfg.inicioNoche,
    p_fin_noche: cfg.finNoche,
    p_quien: quien,
  })
  if (error) throw error
}

/* ─────────────────────── La cola de lo que no subió ───────────────────── */

/**
 * Marcaciones que se hicieron sin señal.
 *
 * 🔴 Cola propia y no la de insumos, a propósito: esa despacha operaciones de
 * inventario y meterle un tipo nuevo obliga a tocar su sincronizador, que hoy
 * mueve stock. Aquí lo que se encola es UNA llamada idempotente con id del
 * teléfono, así que la cola puede ser esto: una lista en el equipo y un
 * reintento. Si algún día hay que unificarlas, el requisito ya está cumplido.
 *
 * ⚠️ Se guarda la HORA EN QUE SE MARCÓ, no la del envío. Es el dato que se
 * paga; perderlo por subir tarde sería el error que todo esto viene a evitar.
 */
const LLAVE_COLA = 'sam:taller:marcaciones-pendientes'

type Pendiente = Parameters<typeof marcar>[0]

function leerCola(): Pendiente[] {
  try {
    const c = window.localStorage.getItem(LLAVE_COLA)
    return c ? (JSON.parse(c) as Pendiente[]) : []
  } catch {
    return []
  }
}

function escribirCola(l: Pendiente[]) {
  try {
    window.localStorage.setItem(LLAVE_COLA, JSON.stringify(l))
  } catch {
    // Sin espacio no hay nada que hacer aquí; la pantalla ya dijo si subió.
  }
}

export function pendientesEnCola(): number {
  return leerCola().length
}

function esFalloDeRed(e: unknown): boolean {
  const m = (e as { message?: string })?.message?.toLowerCase() ?? ''
  return !navigator.onLine || m.includes('fetch') || m.includes('network') || m.includes('load failed')
}

/**
 * Marca, y si no hay señal la guarda para después.
 *
 * Devuelve `enviada` para que la pantalla diga la verdad: «quedó registrada» o
 * «quedó guardada, sube sola cuando haya señal». Decir «listo» en los dos casos
 * es como se pierde la confianza de quien está marcando su jornada.
 */
export async function marcarOEncolar(
  input: Pendiente,
): Promise<{ enviada: boolean; respuesta?: RespuestaMarcar }> {
  if (!navigator.onLine) {
    escribirCola([...leerCola(), input])
    return { enviada: false }
  }
  try {
    const respuesta = await marcar(input)
    return { enviada: true, respuesta }
  } catch (err) {
    if (esFalloDeRed(err)) {
      escribirCola([...leerCola(), input])
      return { enviada: false }
    }
    throw err
  }
}

/** Reintenta lo pendiente. Lo que sube sale de la cola; lo demás se queda. */
export async function sincronizarMarcaciones(): Promise<{ subidas: number; quedan: number }> {
  const cola = leerCola()
  if (cola.length === 0 || !navigator.onLine) return { subidas: 0, quedan: cola.length }
  const quedan: Pendiente[] = []
  let subidas = 0
  for (const p of cola) {
    try {
      await marcar(p)
      subidas++
    } catch (err) {
      // Un rechazo del servidor NO se reintenta para siempre: se descarta y se
      // deja rastro, o la cola se vuelve un bucle que nadie ve.
      if (esFalloDeRed(err)) quedan.push(p)
      else console.warn('[taller] marcación rechazada por el servidor, se descarta', p, err)
    }
  }
  escribirCola(quedan)
  return { subidas, quedan: quedan.length }
}
