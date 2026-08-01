import type { InsumoKardex } from '../domain/sam'

/**
 * Agrupa movimientos de kardex por DESPACHO.
 *
 * El kardex guarda una fila por insumo, así que una entrega de ganchos y
 * combustible aparece como dos renglones repetidos —misma máquina, misma hora,
 * mismo operario— y en un celular eso duplica la lista sin agregar nada. Lo que
 * pasó fue UNA entrega con dos cosas adentro.
 *
 * La llave es la `referencia` (el id de la entrega). Cuando no hay referencia
 * —un ajuste, una entrada suelta— cada movimiento queda solo, que es lo
 * correcto: ahí sí es un hecho por su cuenta.
 *
 * ⚠️ El TIPO entra en la llave a propósito. La devolución que hace el operario
 * comparte la referencia con la salida original, pero es otro hecho y en otro
 * momento: mezclarlas escondería que hubo una devolución.
 */
export interface GrupoDespacho {
  /** Llave estable para el `key` de React. */
  id: string
  /** Movimientos del despacho, en el orden en que se registraron. */
  movs: InsumoKardex[]
  /** El primero: de él salen máquina, hora, quién y el motivo. */
  cabeza: InsumoKardex
  /** Fecha del despacho (la del primer movimiento). */
  cuando: string
  devuelto: boolean
}

export function agruparDespachos(movs: InsumoKardex[]): GrupoDespacho[] {
  const grupos = new Map<string, InsumoKardex[]>()
  for (const m of movs) {
    const llave = m.referencia ? `${m.referencia}|${m.tipo}` : `solo|${m.id}`
    const g = grupos.get(llave)
    if (g) g.push(m)
    else grupos.set(llave, [m])
  }

  return Array.from(grupos.entries())
    .map(([id, ms]) => {
      const ordenados = [...ms].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      const cabeza = ordenados[0]
      return {
        id,
        movs: ordenados,
        cabeza,
        cuando: cabeza.createdAt,
        devuelto: cabeza.tipo === 'ENTRADA',
      }
    })
    .sort((a, b) => b.cuando.localeCompare(a.cuando))
}
