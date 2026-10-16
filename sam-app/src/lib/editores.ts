/**
 * Quién puede EDITAR o ELIMINAR labores ya registradas.
 *
 * 2-oct-2026 — pedido de Iván: «solo Carlos David puede editar los registros».
 * Quedó demasiado amplio: les quitó la edición a los supervisores SIEMPRE.
 *
 * 16-oct-2026 — la regla buena: «los supervisores sí pueden editar las labores
 * hasta antes de que las aprueben; ya después de aprobadas no». Aplica igual a
 * las programadas (ASIGNADA) y a las tomadas en campo (LIBRE).
 *
 *   - Carlos David (EDITORES_LABORES): edita y elimina siempre.
 *   - Supervisor: edita mientras la labor NO esté aprobada. Eliminar, no.
 *   - Los demás (propietario, otros de administración): no editan.
 *
 * Es por USUARIO, no por rol: hay otros usuarios de administración (Torre de
 * control, Contratación, Francisco Tascón) y el propietario, y ninguno edita.
 * Para sumar a alguien, agregar su id aquí.
 *
 * Lo demás sigue igual para cada rol: programar, iniciar, cerrar, aprobar o
 * rechazar, cancelar una programada y facturar. Y los hectómetros y las horas
 * siguen siendo solo de administración (editAssignment + trigger en la base).
 */
export const EDITORES_LABORES: readonly string[] = [
  'U005', // CARLOS DAVID RODRIGUEZ (administración)
]

/** Carlos David: edita y ELIMINA cualquier labor, aprobada o no. */
export function puedeEditarLabores(session: { id?: string } | null | undefined): boolean {
  return !!session?.id && EDITORES_LABORES.includes(session.id)
}

/**
 * ¿Ya la aprobaron? 🔴 Mirar SOLO `approval` miente: las programadas y las
 * tomadas en campo NACEN con `approval = 'APROBADA'` (no hay nada que aprobar
 * todavía) y el cierre (`finishAssignment`) la pasa a PENDIENTE. La aprobación
 * de verdad es la que llega DESPUÉS de cerrar: estado PARCIAL/COMPLETADA y
 * `approval = 'APROBADA'`. Sin mirar el estado, el supervisor no podría corregir
 * ni una programada que todavía nadie ha empezado.
 */
export function laborAprobada(a: { status: string; approval?: string | null }): boolean {
  return a.approval === 'APROBADA' && (a.status === 'COMPLETADA' || a.status === 'PARCIAL')
}

/** ¿Puede esta persona EDITAR esta labor? (no eliminar: eso es `puedeEditarLabores`) */
export function puedeEditarEstaLabor(
  session: { id?: string; role?: string } | null | undefined,
  a: { status: string; approval?: string | null },
): boolean {
  if (puedeEditarLabores(session)) return true
  return session?.role === 'supervisor' && !laborAprobada(a)
}
