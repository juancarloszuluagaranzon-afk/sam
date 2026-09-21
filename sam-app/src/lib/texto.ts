/**
 * Texto que se digita en los formularios.
 *
 * Todo va en MAYÚSCULA. No es capricho: los mismos datos los escriben cinco
 * personas distintas desde el celular —"campoalegre", "CampoAlegre",
 * "CAMPOALEGRE"— y después nadie cuadra un reporte porque son tres valores
 * diferentes para la misma cosa. Uniformar al digitar es más barato que
 * limpiar después.
 */

/** A mayúscula respetando tildes y la ñ. */
export function aMayus(v: string): string {
  return v.toLocaleUpperCase('es-CO')
}

/**
 * Placa: mayúscula y sin espacios ni guiones.
 *
 * En campo escriben "abc 123", "ABC-123" y "abc123" para el mismo carro. Se
 * normaliza a `ABC123` para que la sugerencia guardada coincida la próxima vez.
 */
export function normalizarPlaca(v: string): string {
  return aMayus(v).replace(/[^A-Z0-9ÑÁÉÍÓÚ]/g, '')
}

/**
 * La unidad en la que se mide una labor, para mostrarla al lado del número.
 *
 * Tres unidades, y NO se suman entre sí:
 * - **ha** — hectáreas: casi todo el trabajo.
 * - **hm** — hectómetros (100 m lineales): las ACEQUIAS. Cavar una acequia es
 *   longitud, y "3 hectáreas de acequia" no significa nada.
 * - **h** — horas: el servicio de máquina por horas (OFICIOS VARIOS, 19-sep-2026).
 *   En esas labores `area`/`executedArea` guardan HORAS y no tienen nada que ver
 *   con el área de la suerte.
 *
 * 🔴 Se resuelve por el NOMBRE de la labor porque es lo único que viaja en todas
 * las pantallas (`asignaciones` guarda `labor_nombre` como texto suelto). Pero la
 * unidad ya no está quemada aquí: **sale del catálogo** (`labores_catalogo.unidad`)
 * vía `registrarUnidades()`, que llama `AppDataContext` cada vez que el catálogo
 * carga. Se espeja en el equipo para que al abrir sin señal —o antes de que el
 * catálogo llegue— la unidad ya sea la correcta. La lista fija de abajo es solo
 * el respaldo del primer arranque.
 */
export type UnidadLabor = 'ha' | 'hm' | 'h'

const UNIDADES_POR_DEFECTO: Record<string, UnidadLabor> = { ACEQUIAS: 'hm', 'OFICIOS VARIOS': 'h' }
const LLAVE_UNIDADES = 'sam:labores:unidades'

function leerEspejo(): Record<string, UnidadLabor> {
  try {
    if (typeof localStorage === 'undefined') return {}
    const c = localStorage.getItem(LLAVE_UNIDADES)
    return c ? (JSON.parse(c) as Record<string, UnidadLabor>) : {}
  } catch {
    return {}
  }
}

let unidadesDelCatalogo: Record<string, UnidadLabor> = leerEspejo()

const llaveLabor = (nombre?: string | null) => String(nombre ?? '').trim().toUpperCase()

/** Lo llama el contexto al cargar el catálogo de labores. */
export function registrarUnidades(labores: { nombre: string; unidad?: string | null }[]): void {
  if (labores.length === 0) return
  const m: Record<string, UnidadLabor> = {}
  for (const l of labores) {
    const u = String(l.unidad ?? 'ha').toLowerCase()
    m[llaveLabor(l.nombre)] = u === 'hm' ? 'hm' : u === 'h' ? 'h' : 'ha'
  }
  unidadesDelCatalogo = m
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(LLAVE_UNIDADES, JSON.stringify(m))
  } catch {
    // Sin espacio en el equipo: queda en memoria, que es lo que importa ahora.
  }
}

export function unidadDeLabor(laborNombre?: string | null): UnidadLabor {
  const n = llaveLabor(laborNombre)
  return unidadesDelCatalogo[n] ?? UNIDADES_POR_DEFECTO[n] ?? 'ha'
}

/** ¿Esta labor es un servicio por horas? */
export function esPorHoras(laborNombre?: string | null): boolean {
  return unidadDeLabor(laborNombre) === 'h'
}

/** El nombre largo de la unidad, para etiquetas de formulario: «Hectáreas», «Hectómetros», «Horas». */
export function nombreUnidad(laborNombre?: string | null): string {
  const u = unidadDeLabor(laborNombre)
  return u === 'hm' ? 'Hectómetros' : u === 'h' ? 'Horas' : 'Hectáreas'
}

/**
 * Un area con su unidad: "9.32 ha", "15.00 hm".
 *
 * 🔴 Vive aqui porque habia **cuatro copias** de esta funcion en el proyecto y
 * solo una sabia de hectometros: el Reporte mostraba "9.32 ha" en una fila de
 * ACEQUIAS. Una funcion de formato duplicada se arregla en un sitio y sigue
 * mintiendo en los otros tres.
 *
 * Recibe el nombre de la labor porque es lo unico que viaja en todas las
 * pantallas — `asignaciones` guarda `labor_nombre` como texto suelto.
 */
export function formatArea(value: number, laborNombre?: string | null): string {
  return `${value.toFixed(2)} ${unidadDeLabor(laborNombre)}`
}
