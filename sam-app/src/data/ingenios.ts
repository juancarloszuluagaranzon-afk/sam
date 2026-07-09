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
