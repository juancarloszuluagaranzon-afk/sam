/**
 * Quién puede EDITAR o ELIMINAR labores ya registradas (2-oct-2026).
 *
 * Pedido de Iván: «solo Carlos David puede editar los registros; los
 * supervisores no, ni las programadas ni las tomadas en campo». Antes podían
 * supervisor, owner y administración.
 *
 * Es por USUARIO, no por rol: hay otros usuarios de administración (Torre de
 * control, Contratación, Francisco Tascón) y el propietario, y ninguno edita.
 * Para sumar a alguien, agregar su id aquí.
 *
 * Lo demás sigue igual para cada rol: programar, iniciar, cerrar, aprobar o
 * rechazar, cancelar una programada y facturar.
 */
export const EDITORES_LABORES: readonly string[] = [
  'U005', // CARLOS DAVID RODRIGUEZ (administración)
]

export function puedeEditarLabores(session: { id?: string } | null | undefined): boolean {
  return !!session?.id && EDITORES_LABORES.includes(session.id)
}
