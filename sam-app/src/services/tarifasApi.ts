import { supabase } from '../lib/supabase'

/**
 * Tarifas: cuánto se le cobra a cada cliente por hectárea de cada labor.
 *
 * ⚠️ La regla que sostiene todo: **cambiar un precio NO es editar la fila**. Se
 * cierra la vigencia que estaba y se abre una nueva. Editar el precio de una
 * vigencia pasada reescribiría facturas ya emitidas — una labor de julio
 * empezaría a valer lo de octubre.
 */

export interface Tarifa {
  id: string
  /** `undefined` = tarifa GENERAL: aplica a quien no tenga una propia. */
  terceroId?: string
  terceroNombre?: string
  laborNombre: string
  precioHa: number
  vigenteDesde: string
  /** `undefined` = sigue vigente hoy. */
  vigenteHasta?: string
  nota?: string
  creadoPor?: string
}

function mapTarifa(r: Record<string, unknown>): Tarifa {
  const t = r.tercero as { nombre?: unknown } | null
  return {
    id: String(r.id),
    terceroId: r.tercero_id ? String(r.tercero_id) : undefined,
    terceroNombre: t?.nombre ? String(t.nombre) : undefined,
    laborNombre: String(r.labor_nombre ?? ''),
    precioHa: Number(r.precio_ha ?? 0),
    vigenteDesde: String(r.vigente_desde ?? ''),
    vigenteHasta: r.vigente_hasta ? String(r.vigente_hasta) : undefined,
    nota: r.nota ? String(r.nota) : undefined,
    creadoPor: r.creado_por ? String(r.creado_por) : undefined,
  }
}

export async function loadTarifas(): Promise<Tarifa[]> {
  const { data, error } = await supabase
    .from('tarifas')
    .select('*,tercero:terceros(nombre)')
    .order('labor_nombre')
    .order('vigente_desde', { ascending: false })
  if (error || !data) return []
  return data.map((r) => mapTarifa(r as Record<string, unknown>))
}

export async function crearTarifa(input: {
  terceroId?: string
  laborNombre: string
  precioHa: number
  vigenteDesde: string
  nota?: string
  creadoPor?: string
}): Promise<void> {
  const { error } = await supabase.from('tarifas').insert({
    tercero_id: input.terceroId ?? null,
    labor_nombre: input.laborNombre.trim().toUpperCase(),
    precio_ha: input.precioHa,
    vigente_desde: input.vigenteDesde,
    nota: input.nota?.trim() || null,
    creado_por: input.creadoPor ?? null,
  })
  if (error) {
    // El índice único es por (cliente, labor, fecha de inicio).
    if (/duplicate|unique/i.test(error.message)) {
      throw new Error('Ya hay una tarifa para ese cliente, esa labor y esa fecha de inicio.')
    }
    throw new Error(error.message || 'No se pudo crear la tarifa')
  }
}

/**
 * Cambiar el precio: cierra la vigencia actual el día ANTES y abre una nueva.
 *
 * Los dos pasos van juntos a propósito. Si solo se cerrara la vieja, quedaría un
 * hueco sin tarifa y las labores de ese día no se podrían facturar; si solo se
 * abriera la nueva, habría dos vigentes y ganaría la más reciente por accidente
 * en vez de por decisión.
 */
export async function cambiarPrecio(input: {
  tarifaActualId: string
  nuevoPrecio: number
  desde: string
  nota?: string
  creadoPor?: string
}): Promise<void> {
  const { data: actual, error: eLeer } = await supabase
    .from('tarifas').select('*').eq('id', input.tarifaActualId).maybeSingle()
  if (eLeer || !actual) throw new Error('No se encontró la tarifa que se va a cambiar')

  const a = actual as Record<string, unknown>
  if (String(a.vigente_desde) >= input.desde) {
    throw new Error('La fecha del precio nuevo tiene que ser posterior al inicio del actual.')
  }

  const vispera = new Date(`${input.desde}T00:00:00`)
  vispera.setDate(vispera.getDate() - 1)
  const hasta = vispera.toISOString().slice(0, 10)

  const { error: eCerrar } = await supabase
    .from('tarifas').update({ vigente_hasta: hasta }).eq('id', input.tarifaActualId)
  if (eCerrar) throw new Error(eCerrar.message || 'No se pudo cerrar la tarifa anterior')

  try {
    await crearTarifa({
      terceroId: a.tercero_id ? String(a.tercero_id) : undefined,
      laborNombre: String(a.labor_nombre),
      precioHa: input.nuevoPrecio,
      vigenteDesde: input.desde,
      nota: input.nota,
      creadoPor: input.creadoPor,
    })
  } catch (err) {
    // Si la nueva falla, reabrir la anterior: un hueco sin tarifa deja labores
    // sin poder facturarse y nadie se entera hasta que alguien arma la factura.
    await supabase.from('tarifas')
      .update({ vigente_hasta: a.vigente_hasta ?? null }).eq('id', input.tarifaActualId)
    throw err
  }
}

export async function eliminarTarifa(id: string): Promise<void> {
  const { error } = await supabase.from('tarifas').delete().eq('id', id)
  if (error) throw new Error(error.message || 'No se pudo eliminar la tarifa')
}

/**
 * El precio que aplica a una labor en una fecha, resuelto por la BD.
 *
 * Se llama a la función del servidor y no se replica el criterio aquí: si la
 * regla vive en dos sitios, tarde o temprano la pantalla y la factura muestran
 * números distintos.
 */
export async function precioDe(
  terceroId: string | null, labor: string, fecha: string,
): Promise<number | null> {
  const { data, error } = await supabase.rpc('tarifa_de', {
    p_tercero: terceroId, p_labor: labor, p_fecha: fecha,
  })
  if (error || data == null) return null
  return Number(data)
}
