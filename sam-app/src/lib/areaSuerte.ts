import type { MaestroRow } from '../domain/sam'

/**
 * La fila del maestro que corresponde a una labor.
 *
 * 🔴 La identidad de una suerte es **INGENIO + código de hacienda + suerte**
 * (índice único `ux_maestro_ingenio_hacienda_suerte`). Ni el código ni el nombre
 * de hacienda sirven solos, porque el maestro junta varios ingenios. Medido el
 * 18-sep-2026 sobre 17.584 suertes activas:
 * - código + suerte: **19 choques** (el `1` de Mayagüez, 1214 ABEJONES/PRAGA…;
 *   ver `project_maestro_codigo_compartido`).
 * - nombre + suerte: **473 choques**. Hay TRES «VALPARAISO» con suerte 010 — la
 *   3104 de Riopaila (16,32 ha) y la 1224/1408 de Pichichí (5,22 ha) — y el tope
 *   de área tomó la de Pichichí: no dejó registrar 14,50 ha de DESPEJE en la
 *   3104-010.
 * - ingenio + código + suerte: **0 choques**.
 *
 * Por eso cada labor guarda su `ingenioId` desde el 18-sep-2026 (columna
 * `asignaciones.ingenio_id`, la llena un trigger al crearla). Orden de búsqueda:
 * 1. ingenio + código + suerte (la llave);
 * 2. código + nombre + suerte (para la labor recién creada que todavía no
 *    volvió del servidor, o las 73 sin ingenio) — hoy también sin choques;
 * 3. un solo candidato por nombre o por código, SOLO si todos dicen lo mismo.
 * Si se contradicen, `null`: mejor no saber que tomar la suerte de otro ingenio.
 */
export function filaMaestro(
  maestro: MaestroRow[],
  a: { suerte: string; haciendaCode: string; haciendaName?: string; ingenioId?: string | null },
): MaestroRow | null {
  const norm = (s: string | null | undefined) => String(s ?? '').trim().toUpperCase()
  const suerte = norm(a.suerte)
  const codigo = norm(a.haciendaCode)
  const nombre = norm(a.haciendaName)
  const ingenio = String(a.ingenioId ?? '').trim()
  const mismas = maestro.filter((m) => norm(m.suerte) === suerte)

  if (ingenio) {
    const porIngenio = mismas.find((m) => m.ingenio_id === ingenio && norm(m.haciendaCode) === codigo)
    if (porIngenio) return porIngenio
  }
  if (nombre) {
    const exacta = mismas.find((m) => norm(m.haciendaCode) === codigo && norm(m.haciendaName) === nombre)
    if (exacta) return exacta
  }
  for (const grupo of [
    nombre ? mismas.filter((m) => norm(m.haciendaName) === nombre) : [],
    mismas.filter((m) => norm(m.haciendaCode) === codigo),
  ]) {
    if (grupo.length === 1) return grupo[0]
    if (grupo.length > 1 && new Set(grupo.map((m) => `${m.area}|${m.ingenio_id}`)).size === 1) return grupo[0]
  }
  return null
}

/**
 * Área OFICIAL de la suerte para el tope del área ejecutada (con este número se
 * le paga al operario). `null` = el maestro no la tiene o no se puede saber cuál
 * es: quien llama cae al respaldo (el máximo planificado del ciclo).
 */
export function areaOficialSuerte(
  maestro: MaestroRow[],
  a: { suerte: string; haciendaCode: string; haciendaName?: string; ingenioId?: string | null },
): number | null {
  const fila = filaMaestro(maestro, a)
  return fila && fila.area > 0 ? fila.area : null
}
