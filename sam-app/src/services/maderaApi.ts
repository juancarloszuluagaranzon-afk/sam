import { supabase } from '../lib/supabase'

/**
 * Viajes de trozas — API del módulo de transporte de madera (rama `pruebas`).
 *
 * Se lee con `select('*')` a propósito: la tabla va a seguir creciendo mientras
 * el cliente valida el flujo, y una columna nueva sin migrar no puede dejar la
 * pantalla en blanco.
 */

export type MaderaEstado = 'CARGADO' | 'EN_RUTA' | 'DESCARGADO' | 'ANULADO'
export type MaderaConfig = 'C2' | 'C3' | 'C3S3'

export interface MaderaViaje {
  id: string
  fecha: string
  predio: string
  destino: string
  placa: string
  config: MaderaConfig
  conductorNombre: string
  especie: string
  volumenM3: number
  pesoTon: number
  /** `null` = todavía no lo pesaron en destino. NO es cero. */
  volumenRecibidoM3: number | null
  docTipo: string
  docNumero: string
  docVence: string
  estado: MaderaEstado
  fotoUrl: string
  nota: string
  registradoNombre: string
  createdAt: string
}

/**
 * Peso bruto máximo por configuración — Resolución 4100 de 2004.
 *
 * Con madera verde (~1 t/m³) el camión se llena por PESO antes que por volumen,
 * así que este es el límite que de verdad manda. Pasarse cuesta $1.266.100,
 * inmovilización, y el transbordo del excedente por cuenta del transportador.
 */
export const PESO_MAXIMO: Record<MaderaConfig, number> = {
  C2: 16,
  C3: 28,
  C3S3: 52,
}

export const CONFIG_LABEL: Record<MaderaConfig, string> = {
  C2: 'C2 · sencillo (2 ejes)',
  C3: 'C3 · doble troque (3 ejes)',
  C3S3: 'C3S3 · tractomula',
}

/** Días que le quedan al documento. Negativo = ya venció. */
export function diasParaVencer(docVence: string, hoy = new Date()): number | null {
  if (!docVence) return null
  const [y, m, d] = docVence.split('-').map(Number)
  if (!y || !m || !d) return null
  const vence = new Date(y, m - 1, d)
  const base = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate())
  return Math.round((vence.getTime() - base.getTime()) / 86400000)
}

function mapViaje(r: Record<string, unknown>): MaderaViaje {
  const rec = (k: string) => (r[k] == null ? '' : String(r[k]))
  const num = (k: string) => Number(r[k] ?? 0)
  return {
    id: rec('id'),
    fecha: rec('fecha'),
    predio: rec('predio'),
    destino: rec('destino'),
    placa: rec('placa'),
    config: (rec('config') || 'C3') as MaderaConfig,
    conductorNombre: rec('conductor_nombre'),
    especie: rec('especie'),
    volumenM3: num('volumen_m3'),
    pesoTon: num('peso_ton'),
    // El null se conserva: "sin pesar" y "pesó cero" son cosas distintas.
    volumenRecibidoM3: r['volumen_recibido_m3'] == null ? null : Number(r['volumen_recibido_m3']),
    docTipo: rec('doc_tipo') || 'SUNL',
    docNumero: rec('doc_numero'),
    docVence: rec('doc_vence'),
    estado: (rec('estado') || 'CARGADO') as MaderaEstado,
    fotoUrl: rec('foto_url'),
    nota: rec('nota'),
    registradoNombre: rec('registrado_nombre'),
    createdAt: rec('created_at'),
  }
}

export async function loadViajes(opts?: { desde?: string; hasta?: string }): Promise<MaderaViaje[]> {
  let q = supabase.from('madera_viajes').select('*')
    .order('fecha', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(500)
  if (opts?.desde) q = q.gte('fecha', opts.desde)
  if (opts?.hasta) q = q.lte('fecha', opts.hasta)
  const { data, error } = await q
  if (error || !data) return []
  return (data as Record<string, unknown>[]).map(mapViaje)
}

export async function crearViaje(input: {
  fecha: string; predio: string; destino: string; placa: string; config: MaderaConfig
  conductorNombre: string; especie: string; volumenM3: number; pesoTon: number
  docTipo: string; docNumero: string; docVence: string
  fotoUrl?: string; nota?: string; registradoPor?: string; registradoNombre?: string
}): Promise<MaderaViaje | null> {
  const { data, error } = await supabase.from('madera_viajes').insert({
    fecha: input.fecha,
    predio: input.predio || null,
    destino: input.destino || null,
    placa: input.placa || null,
    config: input.config,
    conductor_nombre: input.conductorNombre || null,
    especie: input.especie || null,
    volumen_m3: input.volumenM3 || null,
    peso_ton: input.pesoTon || null,
    doc_tipo: input.docTipo || null,
    doc_numero: input.docNumero || null,
    doc_vence: input.docVence || null,
    foto_url: input.fotoUrl || null,
    nota: input.nota || null,
    registrado_por: input.registradoPor || null,
    registrado_nombre: input.registradoNombre || null,
    estado: 'CARGADO',
  }).select('*').single()
  if (error) throw new Error(error.message)
  return data ? mapViaje(data as Record<string, unknown>) : null
}

export async function cambiarEstado(id: string, estado: MaderaEstado): Promise<void> {
  const { error } = await supabase.from('madera_viajes')
    .update({ estado, updated_at: new Date().toISOString() }).eq('id', id)
  if (error) throw new Error(error.message)
}

/**
 * Cierra el viaje con lo que de verdad recibió el comprador.
 *
 * Se guarda aparte de `volumen_m3` — no se pisa— porque la DIFERENCIA entre lo
 * despachado y lo recibido es el dato que interesa: es donde aparecen las
 * mermas, los errores de cubicación y lo que se cae en el camino.
 */
export async function registrarRecibido(id: string, volumenRecibidoM3: number): Promise<void> {
  const { error } = await supabase.from('madera_viajes').update({
    volumen_recibido_m3: volumenRecibidoM3,
    estado: 'DESCARGADO',
    updated_at: new Date().toISOString(),
  }).eq('id', id)
  if (error) throw new Error(error.message)
}
