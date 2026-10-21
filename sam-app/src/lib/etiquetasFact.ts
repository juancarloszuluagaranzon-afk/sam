/**
 * Las ETIQUETAS de Facturación que viven dentro de `asignaciones.observaciones`
 * (20-oct-2026): `[PRECIO_MANUAL:85000]`, `[TARIFA:<uuid>]` y `[CLIENTE:SAN_CARLOS]`.
 *
 * 🔴 Las pone y las quita SOLO Facturación (`setPrecioManualBulk`,
 * `setTarifaManualBulk`, `setClienteFacturaBulk`). Cualquier otra pantalla que
 * guarde observaciones (editar la labor, cerrar una parcial, la cola sin señal)
 * pasa por `updateAssignment`, que vuelve a pegar las que hay EN LA BASE: antes un
 * operario que cerraba su parcial, o un supervisor con la copia vieja, borraba sin
 * saberlo el precio o el cliente que había puesto administración.
 *
 * En pantalla no se muestran (son técnicas): `sinEtiquetasFact`.
 */
export const ETIQUETA_FACT = /\s*\[(?:PRECIO_MANUAL:\d+(?:\.\d+)?|TARIFA:[a-f0-9-]{36}|CLIENTE:[A-Z_]+)\]/gi

/** Las observaciones como las escribió la persona, sin las etiquetas de Facturación. */
export function sinEtiquetasFact(notas: string | null | undefined): string {
  return String(notas ?? '').replace(ETIQUETA_FACT, '').trim()
}

/** Solo las etiquetas de Facturación que trae un texto (sin espacios sobrantes). */
export function etiquetasFact(notas: string | null | undefined): string[] {
  return (String(notas ?? '').match(ETIQUETA_FACT) ?? []).map((t) => t.trim())
}

/** El texto de la persona + las etiquetas que deben conservarse. */
export function unirEtiquetasFact(texto: string | null | undefined, etiquetas: string[]): string {
  return [sinEtiquetasFact(texto), ...etiquetas].filter(Boolean).join(' ')
}
