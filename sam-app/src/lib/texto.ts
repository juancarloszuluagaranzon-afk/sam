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
