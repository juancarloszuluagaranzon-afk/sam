import { useCallback, useEffect, useState } from 'react'
import { db } from '../lib/db'
import { useAppData } from '../context/AppDataContext'
import { OP_LABEL, type InsumoOpKind } from '../lib/outboxInsumos'
import { fmtFechaHora } from '../lib/fechas'

/**
 * Aviso de lo que se registró sin señal y todavía no ha subido.
 *
 * Sin esto el supervisor no tiene forma de saber que le quedan cosas por
 * enviar: la pantalla se ve igual con la cola vacía que con diez despachos
 * dentro. Y el problema que reportó fue justamente ese — creía que los
 * registros se perdían.
 *
 * Se muestra solo cuando hay algo pendiente; con la cola vacía no ocupa
 * espacio ni genera ruido.
 */
export function AvisoPendientes() {
  const { isOnline, outboxCount } = useAppData()
  const [items, setItems] = useState<{ id: number; kind: string; cuando: string; error?: string }[]>([])
  const [abierto, setAbierto] = useState(false)

  const revisar = useCallback(async () => {
    const todos = await db.outbox.where('status').anyOf(['pending', 'error']).toArray()
    setItems(
      todos
        .filter((i) => i.type === 'INSUMO')
        .map((i) => ({
          id: i.id!,
          kind: i.insumoOp?.kind ?? '',
          cuando: i.queuedAt,
          error: i.status === 'error' ? i.errorMessage : undefined,
        }))
        .sort((a, b) => a.cuando.localeCompare(b.cuando)),
    )
  }, [])

  // `outboxCount` cambia al sincronizar; revisar de nuevo mantiene el detalle
  // al día sin necesidad de sondear.
  useEffect(() => { void revisar() }, [revisar, outboxCount, isOnline])

  if (items.length === 0) return null

  const conError = items.filter((i) => i.error)

  return (
    <div className={`pend-aviso${conError.length ? ' pend-aviso--error' : ''}`}>
      <button type="button" className="pend-aviso__head" onClick={() => setAbierto(!abierto)} aria-expanded={abierto}>
        <span className="pend-aviso__icono" aria-hidden>{isOnline ? '↑' : '⏸'}</span>
        <span className="pend-aviso__txt">
          <strong>
            {items.length} registro{items.length === 1 ? '' : 's'} sin enviar
          </strong>
          <small>
            {conError.length > 0
              ? `${conError.length} necesita${conError.length === 1 ? '' : 'n'} revisión · toca para ver`
              : isOnline
                ? 'Enviando…'
                : 'Se envían solos cuando haya señal'}
          </small>
        </span>
        <span className="pend-aviso__chevron" aria-hidden>{abierto ? '▴' : '▾'}</span>
      </button>

      {abierto && (
        <div className="pend-aviso__lista">
          {items.map((i) => (
            <div key={i.id} className="pend-aviso__row">
              <span>
                {OP_LABEL[i.kind as InsumoOpKind] ?? i.kind}
                <small>{fmtFechaHora(i.cuando)}</small>
              </span>
              {i.error && <span className="pend-aviso__err">{i.error}</span>}
            </div>
          ))}
          <p className="pend-aviso__pie">
            Nada de esto se pierde: queda guardado en el equipo hasta que suba.
          </p>
        </div>
      )}
    </div>
  )
}

export default AvisoPendientes
