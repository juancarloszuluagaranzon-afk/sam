import { useEffect, useState } from 'react'
import { supabase } from './supabase'

/**
 * MODALIDAD de la labor (2-oct-2026, migración 20261002090000). Para facturar,
 * la labor sola no alcanza: el precio cambia según la modalidad —despeje 0x0,
 * 2x1 mecanizada o 4x1 quemada; acequias de 1, 2 o 3 pases…
 *
 * Las listas viven en `catalogos_valores` con tipo `MODALIDAD:<LABOR>` y se
 * editan en Más → Listas, sin publicar. Una labor SIN lista no pide modalidad.
 * La escoge el OPERARIO al cerrar la labor (es quien ve el encalle real); el
 * supervisor la sugiere al asignar y la completa al aprobar si faltara; lo ya
 * registrado se completa en lote desde Facturación.
 *
 * 🔴 Regla del cliente (2-oct-2026): TODO viene SUGERIDO en 2X1, y las ACEQUIAS en
 * 2 PASES. Se puede cambiar, pero nunca arranca vacía.
 */
const PREFIJO = 'MODALIDAD:'
/** Copia local: sin señal el supervisor sigue viendo las modalidades. */
const ESPEJO = 'sam:modalidades'

/** Labor (en mayúscula) → sus modalidades, en orden. */
export type MapaModalidades = Record<string, string[]>

/**
 * Labores viejas del catálogo que YA traen la modalidad en el nombre: para
 * facturar cuentan como la labor base con esa modalidad, sin tener que tocarlas.
 */
const IMPLICITA: Record<string, { base: string; modalidad: string }> = {
  'DESPEJE 0 X 0': { base: 'DESPEJE', modalidad: '0X0' },
  'REENCALLE V': { base: 'REENCALLE', modalidad: 'VERDE' },
}

const llave = (labor: string) => labor.trim().toUpperCase()

/** El tipo de lista de una labor en `catalogos_valores`. */
export const tipoModalidad = (labor: string) => `${PREFIJO}${llave(labor)}`

/** Las modalidades que se pueden escoger para esta labor ([] = no pide). */
export function modalidadesDe(mapa: MapaModalidades, labor: string): string[] {
  return mapa[llave(labor)] ?? []
}

/** La que viene puesta de entrada: la 2X1 (o 2X1 MECANIZADA); en acequias, 2 PASES; en oficios varios, POR HORA. */
export function modalidadSugerida(mapa: MapaModalidades, labor: string): string | null {
  const lista = modalidadesDe(mapa, labor)
  return lista.find((m) => m.toUpperCase().startsWith('2X1'))
    ?? lista.find((m) => m.toUpperCase() === '2 PASES')
    // Oficios varios: la app los registra por horas (horómetro).
    ?? lista.find((m) => m.toUpperCase() === 'POR HORA')
    ?? null
}

/**
 * ACEQUIAS: el hectómetro pagado obliga al contratista a asegurar DOS pases; desde
 * el TERCERO cada pase cuenta como ADICIONAL. Devuelve cuántos pases adicionales
 * tiene la labor (0 si no es acequia o tiene 1 o 2 pases).
 */
export function pasesAdicionales(a: { labor: string; modalidad?: string | null }): number {
  if (laborFacturable(a.labor) !== 'ACEQUIAS') return 0
  const n = Number((modalidadEfectiva(a) ?? '').match(/^(\d+)\s*PASE/i)?.[1] ?? 0)
  return n > 2 ? n - 2 : 0
}

/** ¿A esta labor le falta escoger modalidad? (tiene lista y no tiene ninguna) */
export function faltaModalidad(mapa: MapaModalidades, a: { labor: string; modalidad?: string | null }): boolean {
  return !modalidadEfectiva(a) && modalidadesDe(mapa, a.labor).length > 0
}

/** La modalidad con la que se factura: la escogida o la que trae el nombre. */
export function modalidadEfectiva(a: { labor: string; modalidad?: string | null }): string | null {
  return a.modalidad?.trim() || IMPLICITA[llave(a.labor)]?.modalidad || null
}

/** La labor con la que se factura (DESPEJE 0 X 0 → DESPEJE). */
export function laborFacturable(labor: string): string {
  return IMPLICITA[llave(labor)]?.base ?? llave(labor)
}

function leerEspejo(): MapaModalidades {
  try {
    const crudo = JSON.parse(localStorage.getItem(ESPEJO) ?? '{}') as unknown
    return crudo && typeof crudo === 'object' ? (crudo as MapaModalidades) : {}
  } catch {
    return {}
  }
}

let pedido: Promise<MapaModalidades | null> | null = null

async function cargar(): Promise<MapaModalidades | null> {
  const { data, error } = await supabase
    .from('catalogos_valores')
    .select('tipo,valor,orden')
    .like('tipo', `${PREFIJO}%`)
    .eq('activo', true)
    .order('orden')
    .order('valor')
  if (error || !data) return null
  const mapa: MapaModalidades = {}
  for (const r of data as { tipo: string; valor: string }[]) {
    const labor = r.tipo.slice(PREFIJO.length)
    ;(mapa[labor] ??= []).push(r.valor)
  }
  try { localStorage.setItem(ESPEJO, JSON.stringify(mapa)) } catch { /* sin espacio: queda la de memoria */ }
  return mapa
}

/** Las modalidades por labor: arranca con la copia local y se refresca del servidor. */
export function useModalidades(): MapaModalidades {
  const [mapa, setMapa] = useState<MapaModalidades>(leerEspejo)
  useEffect(() => {
    let vivo = true
    pedido ??= cargar().finally(() => { setTimeout(() => { pedido = null }, 60_000) })
    void pedido.then((m) => { if (vivo && m) setMapa(m) })
    return () => { vivo = false }
  }, [])
  return mapa
}
