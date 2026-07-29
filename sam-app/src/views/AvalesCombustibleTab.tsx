import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAppData } from '../context/AppDataContext'
import { loadCombustibleExterno, revisarCombustible } from '../services/samApi'
import { DESTINO_LABEL, type CombustibleEstado, type CombustibleExterno } from '../domain/sam'
import { fmtCantidad } from '../lib/cantidad'
import { fmtDia, fmtFechaHora } from '../lib/fechas'

/**
 * Avales de combustible — la bandeja del analista de insumos y materiales.
 *
 * Todo tanqueo (del operario o del supervisor de insumos, en estación o en la
 * sede) aterriza aquí PENDIENTE. El inventario ya se movió cuando se registró,
 * porque el combustible físicamente ya se lo llevaron; lo que hace el analista
 * es validar que lo registrado corresponde. Si rechaza, el stock se reversa.
 */


const FILTROS: { key: CombustibleEstado; label: string }[] = [
  { key: 'PENDIENTE', label: 'Por avalar' },
  { key: 'APROBADO', label: 'Avalados' },
  { key: 'RECHAZADO', label: 'Rechazados' },
]

export function AvalesCombustibleTab() {
  const { session, insumos, busy, setBusy, setError, setInfo } = useAppData()

  const [estado, setEstado] = useState<CombustibleEstado>('PENDIENTE')
  const [items, setItems] = useState<CombustibleExterno[]>([])
  const [cargando, setCargando] = useState(true)
  const [revisar, setRevisar] = useState<{ ev: CombustibleExterno; aprobar: boolean } | null>(null)
  const [nota, setNota] = useState('')

  const refresh = useCallback(async () => {
    setCargando(true)
    try {
      setItems(await loadCombustibleExterno({ estado, limit: 300 }))
    } finally { setCargando(false) }
  }, [estado])
  useEffect(() => { void refresh() }, [refresh])

  const nombreInsumo = useMemo(() => {
    const m = new Map<string, { nombre: string; unidad: string }>()
    insumos.forEach((i) => m.set(i.id, { nombre: i.nombre, unidad: i.unidad }))
    return m
  }, [insumos])

  const totalPendiente = useMemo(
    () => items.reduce((t, e) => t + e.galones, 0),
    [items],
  )

  async function confirmar() {
    if (!revisar || !session) return
    setBusy(true); setError('')
    try {
      await revisarCombustible({
        evento: revisar.ev,
        aprobar: revisar.aprobar,
        revisadoPor: session.id,
        revisadoNombre: session.name,
        nota: nota.trim() || undefined,
      })
      setInfo(revisar.aprobar
        ? 'Avalado. El movimiento queda en firme.'
        : 'Rechazado. El combustible regresó a su bodega.')
      setRevisar(null); setNota('')
      void refresh()
    } catch (err) {
      const e = err as { message?: string }
      setError(`No se pudo registrar el aval. (${e?.message ?? 'error'})`)
    } finally { setBusy(false) }
  }

  return (
    <section className="panel-card">
      <h2>⛽ Avales de combustible</h2>
      <p className="subtle-copy" style={{ marginTop: 0 }}>
        Cada tanqueo que registran los operarios y los supervisores de insumos pasa por aquí.
        Al rechazar, el combustible regresa a la bodega de donde salió.
      </p>

      <div className="realizadas-seg" role="group" aria-label="Estado del aval" style={{ marginTop: 10 }}>
        {FILTROS.map((f) => (
          <button
            key={f.key}
            type="button"
            className={`realizadas-seg__btn ${estado === f.key ? 'is-active' : ''}`}
            onClick={() => setEstado(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {cargando ? (
        <p className="muted-text" style={{ marginTop: 12 }}>Cargando…</p>
      ) : items.length === 0 ? (
        <p className="muted-text" style={{ marginTop: 12 }}>
          {estado === 'PENDIENTE' ? 'Nada pendiente por avalar. Todo al día.' : 'Sin registros.'}
        </p>
      ) : (
        <>
          <p className="ins-res__lbl" style={{ marginTop: 12 }}>
            {items.length} registro(s) · {fmtCantidad(totalPendiente, 'galón')} galones
          </p>
          <div className="inv-list">
            {items.map((e) => {
              const ins = e.insumoId ? nombreInsumo.get(e.insumoId) : undefined
              return (
                <div key={e.id} className="aval-row">
                  <div className="aval-row__main">
                    <div className="aval-row__top">
                      <strong>{fmtCantidad(e.galones, 'galón')} gal</strong>
                      <span className={`aval-tag aval-tag--${e.destino.toLowerCase()}`}>{DESTINO_LABEL[e.destino]}</span>
                      <span className="aval-tag aval-tag--origen">{e.origen === 'SEDE' ? '🏭 Sede' : '⛽ Estación'}</span>
                    </div>
                    <span className="subtle-copy">
                      {fmtDia(`${e.fecha}T12:00:00`)} · {e.registradoNombre ?? 'sin nombre'}
                      {ins ? ` · ${ins.nombre}` : ''}
                      {' · '}<span className="subtle-copy">registrado {fmtFechaHora(e.createdAt)}</span>
                    </span>
                    <span className="subtle-copy">
                      {e.destino === 'MAQUINA' && e.equipoCodigo ? `Máquina ${e.equipoCodigo} · horómetro ${e.horometro ?? '—'}` : null}
                      {e.destino === 'VEHICULO' && e.placa ? `Placa ${e.placa}` : null}
                      {e.destino === 'PIMPINAS' ? `${e.pimpinasCantidad ?? '?'} pimpinas × ${e.pimpinasCapacidad ?? '?'} gal` : null}
                      {e.estacion ? ` · ${e.estacion}` : ''}
                      {e.factura ? ` · tirilla ${e.factura}` : ''}
                    </span>
                    {e.estado !== 'PENDIENTE' && (
                      <span className="subtle-copy">
                        {e.estado === 'APROBADO' ? '✔ Avalado' : '✕ Rechazado'} por {e.revisadoNombre ?? '—'}
                        {e.revisadoEn ? ` · ${fmtFechaHora(e.revisadoEn)}` : ''}
                        {e.revisionNota ? ` · ${e.revisionNota}` : ''}
                      </span>
                    )}
                  </div>
                  <div className="aval-row__side">
                    {e.tirillaUrl && (
                      <a href={e.tirillaUrl} target="_blank" rel="noreferrer" className="aval-foto">
                        <img src={e.tirillaUrl} alt="soporte" />
                      </a>
                    )}
                    {e.estado === 'PENDIENTE' && (
                      <div className="aval-row__acts">
                        <button type="button" className="inline-button" onClick={() => { setRevisar({ ev: e, aprobar: false }); setNota('') }} disabled={busy}>
                          Rechazar
                        </button>
                        <button type="button" className="primary-button aval-btn" onClick={() => { setRevisar({ ev: e, aprobar: true }); setNota('') }} disabled={busy}>
                          ✔ Avalar
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

      {revisar && (
        <div className="modal-overlay open" onClick={() => { if (!busy) setRevisar(null) }}>
          <div className="modal-card" onClick={(ev) => ev.stopPropagation()} style={{ maxWidth: 'min(420px, calc(100vw - 32px))' }}>
            <div className="labor-detail-header">
              <div>
                <p className="eyebrow">Aval</p>
                <h3>{revisar.aprobar ? '✔ Avalar tanqueo' : '✕ Rechazar tanqueo'}</h3>
              </div>
              <button type="button" className="modal-close-btn" onClick={() => setRevisar(null)} disabled={busy} aria-label="Cerrar">&#x2715;</button>
            </div>
            <p className="subtle-copy" style={{ marginTop: 0 }}>
              {fmtCantidad(revisar.ev.galones, 'galón')} galones · {DESTINO_LABEL[revisar.ev.destino]} ·{' '}
              {revisar.ev.registradoNombre ?? 'sin nombre'}.
              {revisar.aprobar
                ? ' El movimiento queda en firme.'
                : ' El combustible regresa a la bodega de donde salió.'}
            </p>
            <label>Nota <span className="field-optional">(opcional)</span>
              <input type="text" value={nota} onChange={(ev) => setNota(ev.target.value)} disabled={busy} />
            </label>
            <div className="modal-footer">
              <button type="button" className="inline-button" onClick={() => setRevisar(null)} disabled={busy}>Cancelar</button>
              <button type="button" className="primary-button" onClick={() => void confirmar()} disabled={busy}>
                {busy ? 'Guardando…' : revisar.aprobar ? 'Avalar' : 'Rechazar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

export default AvalesCombustibleTab
