/**
 * Accesos de la barra inferior, elegidos por el propio usuario.
 *
 * Cada quien decide qué 4 secciones quiere a la mano; el resto vive en "Más".
 * Se guarda POR USUARIO en el equipo (localStorage): el dueño puede tener una
 * configuración en su celular y otra en el computador, y el soporte que
 * impersona no le pisa la suya.
 */

/** Secciones que se pueden fijar en la barra (id = SupervisorTab). */
export interface NavOpcion {
  id: string
  label: string
  icon: string
  desc: string
}

/** Catálogo de lo que el dueño/administración puede poner en la barra. */
export const NAV_OPCIONES: NavOpcion[] = [
  { id: 'inicio', label: 'Inicio', icon: '◉', desc: 'Tablero con todos los indicadores' },
  { id: 'labores', label: 'Labores', icon: '✓', desc: 'Las labores del día' },
  { id: 'realizadas', label: 'Realizadas', icon: '☑', desc: 'Labores ejecutadas' },
  { id: 'equipos', label: 'Máquinas', icon: '▣', desc: 'Estado de los equipos' },
  { id: 'insumosresumen', label: 'Insumos', icon: '🛢️', desc: 'Entregas por supervisor' },
  { id: 'aprobaciones', label: 'A facturar', icon: '✔', desc: 'Pendientes de aprobar' },
  { id: 'avales', label: 'Avales', icon: '✅', desc: 'Tanqueos por aprobar' },
  { id: 'asignar', label: 'Asignar', icon: '＋', desc: 'Programar una labor' },
  { id: 'resumen', label: 'Resumen', icon: '⌂', desc: 'Indicadores generales' },
  { id: 'reporte', label: 'Reporte', icon: '⬦', desc: 'Historial con filtros' },
  { id: 'planilla', label: 'Planilla', icon: '▦', desc: 'Ha por operario y día' },
  { id: 'tablero', label: 'Tablero', icon: '◫', desc: 'Programación por suerte' },
  { id: 'mapa', label: 'Mapa', icon: '🗺️', desc: 'Plano · sin señal' },
  { id: 'flota', label: 'Flota', icon: '🚙', desc: 'Servicios de escolta' },
]

/** Cuántos accesos caben cómodamente antes del botón "Más". */
export const MAX_NAV = 4

/** Lo que ve un dueño que nunca ha configurado nada. */
export const NAV_DEFECTO = ['inicio', 'labores', 'realizadas', 'insumosresumen']

const KEY = 'sam:nav-barra'

function claveDe(userId: string): string {
  return `${KEY}:${userId}`
}

/** Accesos elegidos por el usuario (o el default si nunca configuró). */
export function leerNav(userId: string): string[] {
  try {
    const raw = localStorage.getItem(claveDe(userId))
    if (!raw) return [...NAV_DEFECTO]
    const arr = JSON.parse(raw) as unknown
    if (!Array.isArray(arr)) return [...NAV_DEFECTO]
    const validos = arr.filter((x): x is string => typeof x === 'string' && NAV_OPCIONES.some((o) => o.id === x))
    return validos.length ? validos.slice(0, MAX_NAV) : [...NAV_DEFECTO]
  } catch {
    return [...NAV_DEFECTO]
  }
}

export function guardarNav(userId: string, ids: string[]): void {
  try {
    localStorage.setItem(claveDe(userId), JSON.stringify(ids.slice(0, MAX_NAV)))
  } catch {
    /* almacenamiento lleno o bloqueado: se queda con el default */
  }
}

export function restaurarNav(userId: string): void {
  try { localStorage.removeItem(claveDe(userId)) } catch { /* ignore */ }
}
