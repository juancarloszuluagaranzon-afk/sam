import { useEffect, useMemo, useState } from 'react'
import { useAppData } from '../context/AppDataContext'
import { loadBodegas } from '../services/samApi'
import { agruparDespachos } from '../lib/despachos'
import { fmtCantidad } from '../lib/cantidad'
import { fmtFechaHora } from '../lib/fechas'
import { DetalleDespacho } from './DetalleDespacho'
import type { Bodega, InsumoKardex } from '../domain/sam'

/**
 * La lista de entregas detrás de un dato del tablero, y de ahí la entrega
 * completa.
 *
 * 🔴 **Vive en un componente porque ahora la abren DOS pantallas**: la tarjeta
 * de «Insumos y materiales» dentro de Operación general y la del tablero de
 * insumos. Dos copias de esta lista terminan contando distinto el día que una
 * de las dos se corrija, y este modal es justamente donde el dueño va a
 * comprobar una cifra que le pareció rara.
 *
 * 🔴 **Un despacho es UN hecho, no una fila por insumo.** El kardex guarda una
 * fila por material, así que una entrega de ganchos más combustible saldría
 * duplicada, misma máquina y misma hora. Por eso `agruparDespachos()`, que
 * además mete el TIPO en la llave para que la devolución del operario no se
 * mezcle con la salida.
 */
export function ModalEntregas({
  titulo,
  items,
  onClose,
}: {
  titulo: string
  items: InsumoKardex[]
  onClose: () => void
}) {
  const { insumos, sortedEquipment } = useAppData()
  const [bodegas, setBodegas] = useState<Bodega[]>([])
  const [verDespacho, setVerDespacho] = useState<InsumoKardex | null>(null)

  // El nombre de la bodega es un adorno del pie: si la consulta falla, la
  // lista se dibuja igual sin él.
  useEffect(() => {
    void loadBodegas().then(setBodegas).catch(() => {})
  }, [])

  const insumoNombre = useMemo(() => {
    const m = new Map<string, { nombre: string; unidad: string }>()
    insumos.forEach((i) => m.set(i.id, { nombre: i.nombre, unidad: i.unidad }))
    return m
  }, [insumos])
  /** El código crudo (CASE1301) no es como la gente llama la máquina. */
  const equipoNombre = useMemo(() => {
    const m = new Map<string, string>()
    sortedEquipment.forEach((e) => m.set(e.code, e.name))
    return m
  }, [sortedEquipment])
  const bodegaNombre = useMemo(() => {
    const m = new Map<string, string>()
    bodegas.forEach((b) => m.set(b.id, b.nombre))
    return m
  }, [bodegas])

  const grupos = useMemo(() => agruparDespachos(items), [items])

  return (
    <>
      <div className="modal-overlay open" onClick={onClose}>
        <div className="modal-card dash-modal" onClick={(e) => e.stopPropagation()}>
          <div className="labor-detail-header">
            <div><p className="eyebrow">Insumos entregados</p><h3>{titulo}</h3></div>
            <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Cerrar">&#x2715;</button>
          </div>
          <p className="subtle-copy" style={{ marginTop: 0 }}>
            {grupos.length} entrega{grupos.length === 1 ? '' : 's'}
            {' · '}{items.length} ítem{items.length === 1 ? '' : 's'}
          </p>
          <div className="dash-detalle">
            {/* El catálogo llega por el contexto compartido; sin esperarlo la
                lista muestra el UUID crudo del insumo. */}
            {insumos.length === 0 ? (
              <p className="muted-text">Cargando insumos…</p>
            ) : items.length === 0 ? (
              <p className="muted-text">Nada que mostrar.</p>
            ) : (
              grupos.map((g) => {
                const maq = g.cabeza.equipoCodigo ?? ''
                const bod = g.cabeza.bodegaId ? bodegaNombre.get(g.cabeza.bodegaId) : ''
                return (
                  <button
                    key={g.id}
                    type="button"
                    className="ent-row"
                    onClick={() => setVerDespacho(g.cabeza)}
                    aria-label={`Ver el detalle de la entrega a ${equipoNombre.get(maq) ?? maq}`}
                  >
                    <div className="ent-row__cab">
                      <strong>🚜 {equipoNombre.get(maq) ?? maq}</strong>
                      <span className="ent-row__hora">{fmtFechaHora(g.cuando)}</span>
                    </div>
                    <ul className="ent-row__items">
                      {g.movs.map((m) => {
                        const info = insumoNombre.get(m.insumoId)
                        return (
                          <li key={m.id}>
                            {/* Cada insumo con SU unidad: no se suman entre sí. */}
                            <span className="sol-card__qty">
                              {fmtCantidad(m.cantidad, info?.unidad)} {info?.unidad ?? ''}
                            </span>
                            <span className="ent-row__ins">{info?.nombre ?? m.insumoId}</span>
                          </li>
                        )
                      })}
                    </ul>
                    <span className="ent-row__pie">
                      {g.cabeza.motivo ?? 'Entrega'}{bod ? ` · ${bod}` : ''}
                      <span className="ent-row__ver" aria-hidden>ver detalle ›</span>
                    </span>
                  </button>
                )
              })
            )}
          </div>
        </div>
      </div>

      {/* La entrega completa: el mismo detalle que en Reportes, para que no
          haya dos versiones de la misma verdad. Va después del listado, así se
          pinta encima y al cerrarlo se vuelve a la lista. */}
      {verDespacho && (
        <DetalleDespacho mov={verDespacho} onClose={() => setVerDespacho(null)} />
      )}
    </>
  )
}

export default ModalEntregas
