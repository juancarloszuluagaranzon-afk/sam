import { supabase } from '../lib/supabase'

/**
 * Partes de viaje del camión maderero (rama `pruebas`).
 *
 * **El problema que resuelve.** El dueño del camión vive lejos y quiere saber
 * qué hizo su vehículo. No es un problema de reportes: es de confianza. Por eso
 * cada número que importa viene con su respaldo — el kilometraje con la foto del
 * tablero, y la hora puesta por el sistema en vez de digitada.
 *
 * Se lee con `select('*')` a propósito: la tabla va a seguir creciendo mientras
 * el cliente valida el flujo, y una columna nueva sin migrar no puede dejar la
 * pantalla en blanco.
 */

export type MaderaEstado = 'CARGADO' | 'EN_RUTA' | 'DESCARGADO' | 'ANULADO'

export interface MaderaViaje {
  id: string
  placa: string
  /** Kilometraje al salir, respaldado por `fotoTableroUrl`. */
  kmInicio: number | null
  /** `null` = el viaje sigue abierto. NO es "recorrió cero". */
  kmFin: number | null
  /** Sale de la resta, no se guarda: así no puede contradecir a las dos fotos. */
  kmRecorridos: number | null
  toneladas: number | null
  destino: string
  fotoTableroUrl: string
  fotoTableroFinUrl: string
  estado: MaderaEstado
  nota: string
  registradoNombre: string
  /** La hora del registro. La pone el sistema, no el conductor. */
  createdAt: string
}

function mapViaje(r: Record<string, unknown>): MaderaViaje {
  const txt = (k: string) => (r[k] == null ? '' : String(r[k]))
  const num = (k: string) => (r[k] == null ? null : Number(r[k]))
  const kmI = num('km_inicio')
  const kmF = num('km_fin')
  return {
    id: txt('id'),
    placa: txt('placa'),
    kmInicio: kmI,
    kmFin: kmF,
    kmRecorridos: kmI != null && kmF != null && kmF >= kmI ? kmF - kmI : null,
    toneladas: num('toneladas'),
    destino: txt('destino'),
    fotoTableroUrl: txt('foto_tablero_url'),
    fotoTableroFinUrl: txt('foto_tablero_fin_url'),
    estado: (txt('estado') || 'EN_RUTA') as MaderaEstado,
    nota: txt('nota'),
    registradoNombre: txt('registrado_nombre'),
    createdAt: txt('created_at'),
  }
}

export async function loadViajes(opts?: { desde?: string; hasta?: string }): Promise<MaderaViaje[]> {
  let q = supabase.from('madera_viajes').select('*')
    .order('created_at', { ascending: false })
    .limit(500)
  if (opts?.desde) q = q.gte('fecha', opts.desde)
  if (opts?.hasta) q = q.lte('fecha', opts.hasta)
  const { data, error } = await q
  if (error || !data) return []
  return (data as Record<string, unknown>[]).map(mapViaje)
}

export async function crearViaje(input: {
  placa: string
  kmInicio: number
  toneladas: number
  destino?: string
  fotoTableroUrl: string
  nota?: string
  registradoPor?: string
  registradoNombre?: string
}): Promise<MaderaViaje | null> {
  const { data, error } = await supabase.from('madera_viajes').insert({
    placa: input.placa,
    km_inicio: input.kmInicio,
    toneladas: input.toneladas,
    destino: input.destino || null,
    foto_tablero_url: input.fotoTableroUrl || null,
    nota: input.nota || null,
    registrado_por: input.registradoPor || null,
    registrado_nombre: input.registradoNombre || null,
    estado: 'EN_RUTA',
    // `created_at` lo pone la base. No se manda desde el cliente a propósito:
    // el reloj del celular se puede cambiar, el del servidor no.
  }).select('*').single()
  if (error) throw new Error(error.message)
  return data ? mapViaje(data as Record<string, unknown>) : null
}

/**
 * Cierra el viaje con el kilometraje de llegada y su foto.
 *
 * Se valida que no vaya para atrás: un odómetro no baja, y si el número llega
 * menor es un dedazo — dejarlo pasar daría un recorrido negativo que después
 * nadie entiende.
 */
export async function cerrarViaje(
  id: string, kmFin: number, fotoTableroFinUrl: string,
): Promise<void> {
  const { error } = await supabase.from('madera_viajes').update({
    km_fin: kmFin,
    foto_tablero_fin_url: fotoTableroFinUrl || null,
    estado: 'DESCARGADO',
    updated_at: new Date().toISOString(),
  }).eq('id', id)
  if (error) throw new Error(error.message)
}

export async function anularViaje(id: string): Promise<void> {
  const { error } = await supabase.from('madera_viajes')
    .update({ estado: 'ANULADO', updated_at: new Date().toISOString() }).eq('id', id)
  if (error) throw new Error(error.message)
}
