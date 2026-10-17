import { db } from './db'
import type { CargaFincas } from '../services/fincasApi'

/**
 * La ÚLTIMA carga de Fincas guardada en el celular (16-oct-2026).
 *
 * 🔴 Las fincas quedan donde no hay señal. Antes los datos vivían solo en la
 * memoria de la pantalla: si Julio abría la app en el lote sin cobertura, salía
 * «No se pudieron cargar las fincas» y no podía reportar nada, aunque la cola sin
 * señal (`outboxFincas`) estaba lista para recibir el reporte. Ahora cada carga
 * buena se guarda aquí y, sin señal, la pantalla abre con ella y lo dice.
 *
 * - Es de UN usuario: al salir de la app se borra (`borrarCargasFincas`, App.tsx),
 *   igual que la llave. En un celular compartido el siguiente no ve la plata.
 * - 🔴 Un caché es de una versión VIEJA por definición (CLAUDE.md, regla 2b): se
 *   rellena contra la carga vacía antes de devolverlo, para que una sección que la
 *   versión anterior no guardaba llegue como lista vacía y no como `undefined`.
 * - Va en `db.meta` (no en localStorage): con mapas y maquinaria pesa cientos de KB.
 */

const PREFIJO = 'fincas:carga:'

const VACIA: CargaFincas = {
  rol: '', nombres: {}, accesos: [], fincas: [], suertes: [], ciclos: [], labores: [],
  reportes: [], movimientos: [], paquete: [], poligonos: [], maquinaria: [], duenos: [],
}

export interface CargaGuardada { datos: CargaFincas; guardadaEn: string }

export async function guardarCargaFincas(usuario: string, datos: CargaFincas): Promise<void> {
  try {
    await db.meta.put({ key: PREFIJO + usuario, value: JSON.stringify({ datos, guardadaEn: new Date().toISOString() }) })
  } catch { /* sin espacio o sin IndexedDB: simplemente no habrá copia sin señal */ }
}

export async function leerCargaFincas(usuario: string): Promise<CargaGuardada | null> {
  try {
    const fila = await db.meta.get(PREFIJO + usuario)
    if (!fila) return null
    const x = JSON.parse(fila.value) as { datos?: Partial<CargaFincas>; guardadaEn?: string }
    if (!x?.datos) return null
    const datos = { ...VACIA, ...x.datos } as CargaFincas
    // Cada lista, aunque la versión vieja la haya guardado como null.
    for (const k of Object.keys(VACIA) as (keyof CargaFincas)[]) {
      if (datos[k] == null) (datos as unknown as Record<string, unknown>)[k] = VACIA[k]
    }
    return { datos, guardadaEn: String(x.guardadaEn ?? '') }
  } catch { return null }
}

/** Al salir: ninguna copia de las fincas se queda en el celular. */
export async function borrarCargasFincas(): Promise<void> {
  try { await db.meta.where('key').startsWith(PREFIJO).delete() } catch { /* nada que borrar */ }
}

// ── Rechazos ya atendidos (por usuario, en este celular) ────────────────────
// Un reporte RECHAZADO sale como «por corregir» hasta que se corrige y reenvía
// o la persona dice que no hace falta. Es una comodidad de pantalla: si se
// pierde (otro celular, caché borrado) solo vuelve a salir el aviso.
const ATENDIDOS = 'sam:af-rechazos-atendidos:'

export function leerRechazosAtendidos(usuario: string): Set<string> {
  try { return new Set(JSON.parse(window.localStorage.getItem(ATENDIDOS + usuario) ?? '[]') as string[]) } catch { return new Set() }
}

export function marcarRechazoAtendido(usuario: string, reporteId: string): void {
  try {
    const s = leerRechazosAtendidos(usuario)
    s.add(reporteId)
    window.localStorage.setItem(ATENDIDOS + usuario, JSON.stringify([...s].slice(-200)))
  } catch { /* sin almacenamiento: el aviso vuelve a salir, nada más */ }
}
