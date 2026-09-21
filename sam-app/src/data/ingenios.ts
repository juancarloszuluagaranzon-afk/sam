// Ingenios/compradores. La gestión REAL vive en la tabla `ingenios` (BD) y se
// edita desde Catálogos → Ingenios; el contexto los carga y los inyecta aquí en
// runtime. Esta semilla es el FALLBACK cuando la BD no cargó (offline / primer
// arranque) para que los dropdowns nunca queden vacíos.

export interface IngenioSeed {
  id: string
  nombre: string
}

export const INGENIOS: IngenioSeed[] = [
  { id: 'risaralda', nombre: 'Ingenio Risaralda' },
  { id: 'pichichi', nombre: 'Ingenio Pichichi' },
  { id: 'mayaguez', nombre: 'Ingenio Mayagüez' },
  { id: 'san_carlos', nombre: 'Ingenio San Carlos' },
  { id: 'riopaila', nombre: 'Ingenio Riopaila' },
  { id: 'trapiche_lucerna', nombre: 'Trapiche Lucerna' },
]

const SEED_NAMES: Record<string, string> = Object.fromEntries(
  INGENIOS.map((i) => [i.id, i.nombre]),
)

// Registro de nombres inyectado por el contexto tras cargar la tabla `ingenios`.
// Permite que getIngenioName (función pura de samApi) muestre el nombre de un
// ingenio creado por el usuario sin tener que pasar el catálogo por parámetro.
let runtimeNames: Record<string, string> = {}
export function setIngenioNamesRuntime(list: { id: string; nombre: string }[]) {
  runtimeNames = Object.fromEntries(list.map((i) => [i.id, i.nombre]))
}
export function ingenioNombre(id: string): string {
  return runtimeNames[id] ?? SEED_NAMES[id] ?? id
}

/**
 * Prefijo corto del ingenio para el ID visible de una suerte.
 *
 * 🔴 Existe porque el código de hacienda NO es único entre ingenios: **971 códigos
 * se repiten** (21-sep-2026) — la 1001 es PICHICHI en Pichichí y ALICIA en
 * Carmelita. Por dentro la llave ya es ingenio + código + suerte (`filaMaestro`),
 * pero en pantalla y en el Excel «1001-010» se leía igual para las dos. El cliente
 * pidió «un id diferenciador por suerte».
 *
 * Fijos para los que existen (estables: salen en Excel que la gente archiva). Un
 * ingenio nuevo toma las tres primeras letras de su id sin «ingenio_»/«trapiche_».
 */
const PREFIJOS: Record<string, string> = {
  risaralda: 'RIS',
  pichichi: 'PIC',
  mayaguez: 'MAY',
  san_carlos: 'SCA',
  riopaila: 'RIO',
  trapiche_lucerna: 'LUC',
  ingenio_carmelita: 'CAR',
  proveedor: 'PRO',
}
export function prefijoIngenio(id?: string | null): string {
  if (!id) return '??'
  if (PREFIJOS[id]) return PREFIJOS[id]
  const base = id.replace(/^(ingenio|trapiche)_/, '').replace(/[^a-z0-9]/gi, '')
  return (base.slice(0, 3) || '??').toUpperCase()
}

/** ID visible de una suerte: `PIC-1001-010`. «??» = no se sabe de qué ingenio es. */
export function idSuerte(ingenioId: string | null | undefined, haciendaCode: string, suerte: string): string {
  return `${prefijoIngenio(ingenioId)}-${String(haciendaCode).trim()}-${String(suerte).trim()}`
}

// Slug estable a partir del nombre (para el id del ingenio, que amarra el
// maestro). 'Trapiche Lucerna' → 'trapiche_lucerna'.
export function slugIngenio(nombre: string): string {
  return nombre
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}
