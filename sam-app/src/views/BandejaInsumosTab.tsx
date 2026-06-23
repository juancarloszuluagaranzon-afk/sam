import { useEffect, useMemo, useState } from 'react'
import { useAppData } from '../context/AppDataContext'
import { loadSolicitudes, updateSolicitudEstado } from '../services/samApi'
import type { SolicitudInsumo, SolicitudEstado } from '../domain/sam'

/**
 * Bandeja de entrada de solicitudes de insumos (módulo Insumos — fase 2).
 *
 * El supervisor de insumos ve las solicitudes de los operarios y puede
 * PROGRAMARLAS (aceptar, listas para despachar en fase 3) o RECHAZARLAS con
 * motivo. El despacho real + descuento de inventario llega en la fase 3.
 */
function fmtFecha(iso: string): string {
  if (!iso) return ''
  return new Date(iso).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

const ESTADO_LABEL: Record<SolicitudEstado, string> = {
  PENDIENTE: 'Pendiente', PROGRAMADA: 'Programada', ENTREGADA: 'Entregada', RECHAZADA: 'Rechazada', CANCELADA: 'Cancelada',
}

export function BandejaInsumosTab() {
  const { users, busy, setBusy, setError, setInfo } = useAppData()

  const [filtro, setFiltro] = useState<'PENDIENTE' | 'PROGRAMADA' | 'TODAS'>('PENDIENTE')
  const [solicitudes, setSolicitudes] = useState<SolicitudInsumo[]>([])
  const [loading, setLoading] = useState(false)
  const [rechazoTarget, setRechazoTarget] = useState<SolicitudInsumo | null>(null)
  const [motivo, setMotivo] = useState('')

  const userName = useMemo(() => {
    const m = new Map<string, string>()
    users.forEach((u) => m.set(u.id, u.name))
    return m
  }, [users])

  async function refresh() {
    setLoading(true)
    try {
      const estados = filtro === 'TODAS' ? undefined : [filtro as SolicitudEstado]
      setSolicitudes(await loadSolicitudes({ estados, limit: 100 }))
    } finally { setLoading(false) }
  }
  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtro])

  async function programar(s: SolicitudInsumo) {
    setBusy(true); setError('')
    try {
      await updateSolicitudEstado(s.id, 'PROGRAMADA')
      setInfo('Solicitud programada.')
      void refresh()
    } catch (err) {
      const e = err as { message?: string }
      setError(`No se pudo programar. (${e?.message ?? 'error'})`)
    } finally { setBusy(false) }
  }

  async function confirmarRechazo() {
    if (!rechazoTarget) return
    setBusy(true); setError('')
    try {
      await updateSolicitudEstado(rechazoTarget.id, 'RECHAZADA', motivo.trim() || undefined)
      setInfo('Solicitud rechazada.')
      setRechazoTarget(null); setMotivo('')
      void refresh()
    } catch (err) {
      const e = err as { message?: string }
      setError(`No se pudo rechazar. (${e?.message ?? 'error'})`)
    } finally { setBusy(false) }
  }

  const pendientesCount = solicitudes.filter((s) => s.estado === 'PENDIENTE').length

  return (
    <section className="panel-card">
      <div className="panel-title split">
        <h2>Bandeja de solicitudes {filtro === 'PENDIENTE' && pendientesCount > 0 ? `(${pendientesCount})` : ''}</h2>
        <button type="button" className="inline-button" onClick={() => void refresh()} disabled={loading}>↻ Actualizar</button>
      </div>
      <p className="subtle-copy" style={{ marginTop: 0 }}>
        Solicitudes de insumos de los operarios. <strong>Programa</strong> las que vas a despachar o <strong>rechaza</strong> con motivo.
      </p>

      <div className="realizadas-seg" style={{ marginTop: 4 }}>
        {(['PENDIENTE', 'PROGRAMADA', 'TODAS'] as const).map((f) => (
          <button key={f} type="button" className={filtro === f ? 'is-active' : ''} onClick={() => setFiltro(f)}>
            {f === 'PENDIENTE' ? 'Pendientes' : f === 'PROGRAMADA' ? 'Programadas' : 'Todas'}
          </button>
        ))}
      </div>

      <div className="list-rows" style={{ marginTop: 12 }}>
        {loading ? (
          <p className="muted-text">Cargando…</p>
        ) : solicitudes.length === 0 ? (
          <p className="muted-text">No hay solicitudes {filtro === 'PENDIENTE' ? 'pendientes' : filtro === 'PROGRAMADA' ? 'programadas' : ''}.</p>
        ) : solicitudes.map((s) => (
          <div key={s.id} className="panel-card" style={{ padding: '12px 14px', marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 6 }}>
              <div>
                <strong>{s.operarioNombre ?? userName.get(s.operarioId) ?? s.operarioId}</strong>
                <div className="subtle-copy" style={{ fontSize: '0.8rem' }}>{fmtFecha(s.createdAt)}</div>
              </div>
              <span className={`status-pill ${s.estado === 'PENDIENTE' ? '' : s.estado === 'PROGRAMADA' ? 'amber' : s.estado === 'RECHAZADA' ? 'red' : 'green'}`}>
                {ESTADO_LABEL[s.estado]}
              </span>
            </div>
            <ul style={{ listStyle: 'none', margin: '0 0 6px', padding: 0 }}>
              {s.items.map((it) => (
                <li key={it.id} style={{ fontSize: '0.92rem' }}>• <strong>{it.cantidad} {it.unidad}</strong> {it.insumoNombre}</li>
              ))}
            </ul>
            {s.nota && <p className="subtle-copy" style={{ margin: '0 0 6px' }}>Nota: {s.nota}</p>}
            {s.motivoRechazo && <p className="subtle-copy" style={{ margin: '0 0 6px', color: '#b3261e' }}>Rechazo: {s.motivoRechazo}</p>}
            {s.estado === 'PENDIENTE' && (
              <div className="maestro-row-actions">
                <button type="button" className="primary-button" style={{ padding: '6px 14px' }} onClick={() => void programar(s)} disabled={busy}>Programar</button>
                <button type="button" className="inline-button maestro-delete-btn" onClick={() => { setRechazoTarget(s); setMotivo(''); setError('') }} disabled={busy}>Rechazar</button>
              </div>
            )}
          </div>
        ))}
      </div>

      {rechazoTarget && (
        <div className="modal-overlay open" onClick={() => setRechazoTarget(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 'min(420px, calc(100vw - 32px))' }}>
            <div className="labor-detail-header">
              <div><p className="eyebrow">Bandeja</p><h3>Rechazar solicitud</h3></div>
              <button type="button" className="modal-close-btn" onClick={() => setRechazoTarget(null)} disabled={busy} aria-label="Cerrar">&#x2715;</button>
            </div>
            <label>
              Motivo <span className="field-optional">(opcional)</span>
              <input type="text" placeholder="Sin stock, no procede…" value={motivo} onChange={(e) => setMotivo(e.target.value)} disabled={busy} autoFocus />
            </label>
            <div className="modal-footer">
              <button type="button" className="inline-button" onClick={() => setRechazoTarget(null)} disabled={busy}>Cancelar</button>
              <button type="button" className="release-confirm-btn" onClick={() => void confirmarRechazo()} disabled={busy}>{busy ? 'Guardando…' : 'Rechazar'}</button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

export default BandejaInsumosTab
