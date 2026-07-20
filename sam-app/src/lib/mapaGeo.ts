/**
 * Geometría y persistencia de las herramientas del visor de mapas — portadas
 * del proyecto original FieldMaps (medir distancia/área, marcadores,
 * mediciones guardadas). Sin dependencias nuevas: distancia por haversine y
 * área geodésica por exceso esférico (precisión sobrada a escala de suertes).
 *
 * Marcadores y mediciones se guardan EN EL EQUIPO (localStorage): funcionan
 * 100% offline y son personales ("solo tú los ves"), igual que en el original.
 */

/** Coordenada [lon, lat] en WGS84 (mismo orden que el original). */
export type LngLat = [number, number]

const R = 6371008.8 // radio medio terrestre (m)
const M2_PER_HA = 10_000

function toRad(d: number): number { return (d * Math.PI) / 180 }

/** Distancia haversine entre dos puntos, en metros. */
function haversineM(a: LngLat, b: LngLat): number {
  const dLat = toRad(b[1] - a[1])
  const dLon = toRad(b[0] - a[0])
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

/** Longitud (m) de una polilínea abierta. Requiere ≥ 2 vértices. */
export function lineLengthM(coords: LngLat[]): number {
  if (coords.length < 2) return 0
  let total = 0
  for (let i = 1; i < coords.length; i++) total += haversineM(coords[i - 1], coords[i])
  return total
}

/** Perímetro (m) del polígono cerrado definido por sus vértices. */
export function polygonPerimeterM(ring: LngLat[]): number {
  if (ring.length < 2) return 0
  return lineLengthM([...ring, ring[0]])
}

/**
 * Área geodésica (hectáreas) de un polígono [lon,lat] por exceso esférico
 * (misma fórmula que usa turf/area). Requiere ≥ 3 vértices; 0 si no.
 */
export function polygonAreaHa(ring: LngLat[]): number {
  if (ring.length < 3) return 0
  let sum = 0
  const n = ring.length
  for (let i = 0; i < n; i++) {
    const p1 = ring[i]
    const p2 = ring[(i + 1) % n]
    sum += (toRad(p2[0]) - toRad(p1[0])) * (2 + Math.sin(toRad(p1[1])) + Math.sin(toRad(p2[1])))
  }
  return Math.abs((sum * R * R) / 2) / M2_PER_HA
}

/** Formatea un área en hectáreas (es-CO, 3 decimales): `3.428` → `"3,428 ha"`. */
export function formatHectareas(ha: number, decimales = 3): string {
  return `${new Intl.NumberFormat('es-CO', { minimumFractionDigits: decimales, maximumFractionDigits: decimales }).format(ha)} ha`
}

/** Formatea una distancia en metros (es-CO): `1234.5` → `"1.235 m"`. */
export function formatMetros(metros: number, decimales = 0): string {
  if (metros >= 10_000) {
    return `${new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 }).format(metros / 1000)} km`
  }
  return `${new Intl.NumberFormat('es-CO', { minimumFractionDigits: decimales, maximumFractionDigits: decimales }).format(metros)} m`
}

/**
 * Error relativo (%) entre un área medida y el área oficial de la suerte
 * (criterio del original: aceptable < 5 %).
 */
export function errorRelativoPct(medida: number, oficial: number): number {
  if (oficial === 0) return Number.NaN
  return (Math.abs(medida - oficial) / oficial) * 100
}

/* ── Marcadores (paleta idéntica al original) ── */

export const MARCADOR_COLORS = [
  '#ef4444', // rojo
  '#f59e0b', // ámbar
  '#22c55e', // verde
  '#3b82f6', // azul
  '#a855f7', // morado
  '#ec4899', // rosa
] as const

export interface Marcador {
  id: string
  nombre: string
  nota: string
  color: string
  lat: number
  lon: number
  creado: string
}

export interface Medicion {
  id: string
  nombre: string
  tipo: 'area' | 'distancia'
  valor: number // ha o m según tipo
  vertices: LngLat[]
  creado: string
}

const KEY_MARCADORES = 'sam-mapa-marcadores'
const KEY_MEDICIONES = 'sam-mapa-mediciones'

function leer<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key)
    const val = raw ? (JSON.parse(raw) as T[]) : []
    return Array.isArray(val) ? val : []
  } catch { return [] }
}

function escribir<T>(key: string, items: T[]): void {
  try { localStorage.setItem(key, JSON.stringify(items)) } catch { /* lleno: ignorar */ }
}

function nuevoId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function leerMarcadores(): Marcador[] { return leer<Marcador>(KEY_MARCADORES) }

export function crearMarcador(input: { nombre: string; nota: string; color: string; lat: number; lon: number }): Marcador {
  const m: Marcador = { id: nuevoId(), creado: new Date().toISOString(), ...input }
  escribir(KEY_MARCADORES, [...leerMarcadores(), m])
  return m
}

export function borrarMarcador(id: string): void {
  escribir(KEY_MARCADORES, leerMarcadores().filter((m) => m.id !== id))
}

export function leerMediciones(): Medicion[] { return leer<Medicion>(KEY_MEDICIONES) }

export function crearMedicion(input: { nombre: string; tipo: 'area' | 'distancia'; valor: number; vertices: LngLat[] }): Medicion {
  const m: Medicion = { id: nuevoId(), creado: new Date().toISOString(), ...input }
  escribir(KEY_MEDICIONES, [...leerMediciones(), m])
  return m
}

export function borrarMedicion(id: string): void {
  escribir(KEY_MEDICIONES, leerMediciones().filter((m) => m.id !== id))
}
