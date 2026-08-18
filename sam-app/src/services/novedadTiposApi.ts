import { supabase } from '../lib/supabase'

/**
 * Los códigos que se pueden marcar en la Planilla (V, T, NP, D…).
 *
 * Vivían escritos en `samApi.ts` y agregar uno obligaba a tocar el repo. Ahora
 * los crea administración desde la app.
 *
 * ⚠️ Los `delSistema` NO se borran: hay 385 registros históricos apuntando a
 * ellos y la planilla de meses pasados quedaría con celdas mudas. Se pueden
 * desactivar —dejan de ofrecerse como botón— pero el histórico sigue leyéndose.
 */

export interface NovedadTipoCat {
  codigo: string
  nombre: string
  color: string
  orden: number
  activo: boolean
  delSistema: boolean
}

function mapTipo(r: Record<string, unknown>): NovedadTipoCat {
  return {
    codigo: String(r.codigo ?? ''),
    nombre: String(r.nombre ?? ''),
    color: String(r.color ?? '#4a5040'),
    orden: Number(r.orden ?? 100),
    activo: r.activo !== false,
    delSistema: r.del_sistema === true,
  }
}

/** TODOS, incluidos los inactivos: el histórico necesita poder nombrarlos. */
export async function loadNovedadTipos(): Promise<NovedadTipoCat[]> {
  const { data, error } = await supabase
    .from('novedad_tipos').select('*').order('orden').order('codigo')
  if (error || !data) return []
  return data.map((r) => mapTipo(r as Record<string, unknown>))
}

export async function crearNovedadTipo(input: {
  codigo: string
  nombre: string
  color: string
  orden: number
}): Promise<void> {
  // MAYÚSCULA y sin espacios: es lo que se pinta en una celda de 30 px.
  const codigo = input.codigo.trim().toUpperCase().replace(/\s+/g, '')
  if (!codigo) throw new Error('El código no puede quedar vacío.')
  if (codigo.length > 3) throw new Error('El código debe ser de 1 a 3 letras: es lo que cabe en la celda.')
  if (!input.nombre.trim()) throw new Error('Ponle un nombre para que se entienda qué significa.')

  const { error } = await supabase.from('novedad_tipos').insert({
    codigo, nombre: input.nombre.trim(), color: input.color, orden: input.orden,
  })
  if (error) {
    if (/duplicate|unique|primary/i.test(error.message)) {
      throw new Error(`Ya existe el código ${codigo}.`)
    }
    throw new Error(error.message || 'No se pudo crear')
  }
}

export async function actualizarNovedadTipo(
  codigo: string,
  cambios: Partial<Pick<NovedadTipoCat, 'nombre' | 'color' | 'orden' | 'activo'>>,
): Promise<void> {
  const { error } = await supabase.from('novedad_tipos').update({
    ...(cambios.nombre !== undefined ? { nombre: cambios.nombre.trim() } : {}),
    ...(cambios.color !== undefined ? { color: cambios.color } : {}),
    ...(cambios.orden !== undefined ? { orden: cambios.orden } : {}),
    ...(cambios.activo !== undefined ? { activo: cambios.activo } : {}),
  }).eq('codigo', codigo)
  if (error) throw new Error(error.message || 'No se pudo guardar')
}

/**
 * Solo se puede borrar si NADIE lo usó nunca.
 *
 * Borrar un código con historia deja las celdas de meses pasados sin forma de
 * saber qué significaban. Cuando ya se usó, la salida es desactivarlo: deja de
 * ofrecerse como botón y el histórico se sigue leyendo.
 */
export async function eliminarNovedadTipo(codigo: string): Promise<void> {
  const { count } = await supabase
    .from('operario_novedades')
    .select('id', { count: 'exact', head: true })
    .eq('tipo', codigo)

  if ((count ?? 0) > 0) {
    throw new Error(
      `No se puede borrar: ${count} día(s) ya están marcados con ${codigo}. ` +
      'Desactívalo para que deje de aparecer como botón; lo ya registrado se conserva.',
    )
  }

  const { error } = await supabase.from('novedad_tipos').delete().eq('codigo', codigo)
  if (error) throw new Error(error.message || 'No se pudo eliminar')
}

/** Cuántos días hay marcados con cada código. Para poder decidir con datos. */
export async function usoDeNovedades(): Promise<Map<string, number>> {
  const { data, error } = await supabase.from('operario_novedades').select('tipo')
  if (error || !data) return new Map()
  const m = new Map<string, number>()
  for (const r of data as { tipo?: string }[]) {
    if (r.tipo) m.set(r.tipo, (m.get(r.tipo) ?? 0) + 1)
  }
  return m
}
