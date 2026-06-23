import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { useAppData } from '../context/AppDataContext'
import { loadSolicitudes, updateSolicitudEstado, entregarSolicitud, uploadEvidencia } from '../services/samApi'
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
  const { users, session, insumos, setInsumos, busy, setBusy, setError, setInfo } = useAppData()

  const [filtro, setFiltro] = useState<'PENDIENTE' | 'PROGRAMADA' | 'TODAS'>('PENDIENTE')
  const [solicitudes, setSolicitudes] = useState<SolicitudInsumo[]>([])
  const [loading, setLoading] = useState(false)
  const [rechazoTarget, setRechazoTarget] = useState<SolicitudInsumo | null>(null)
  const [motivo, setMotivo] = useState('')

  // Entrega (despacho) — fase 3
  const [entregaTarget, setEntregaTarget] = useState<SolicitudInsumo | null>(null)
  const [entregaItems, setEntregaItems] = useState<{ itemId?: string; insumoId?: string; insumoNombre: string; unidad: string; cantidad: string }[]>([])
  const [entregaRuta, setEntregaRuta] = useState('')
  const [entregaHorometro, setEntregaHorometro] = useState('')
  const [evidencias, setEvidencias] = useState<string[]>([])
  const [subiendoFoto, setSubiendoFoto] = useState(false)
  const fotoInputRef = useRef<HTMLInputElement>(null)

  const stockDe = (insumoId?: string) => (insumoId ? insumos.find((i) => i.id === insumoId)?.stock ?? 0 : 0)

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

  function openEntrega(s: SolicitudInsumo) {
    setEntregaTarget(s)
    setEntregaItems(s.items.map((it) => ({
      itemId: it.id, insumoId: it.insumoId, insumoNombre: it.insumoNombre, unidad: it.unidad,
      cantidad: String(it.cantidad),
    })))
    setEntregaRuta('')
    setEntregaHorometro('')
    setEvidencias([])
    setError('')
  }

  async function handleFotoChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    const input = e.target
    if (!file || !entregaTarget) return
    if (!file.type.startsWith('image/')) { setError('Selecciona una imagen.'); input.value = ''; return }
    setSubiendoFoto(true); setError('')
    try {
      const url = await uploadEvidencia(entregaTarget.id, file, evidencias.length)
      setEvidencias((prev) => [...prev, url])
    } catch {
      setError('No se pudo subir la foto.')
    } finally { setSubiendoFoto(false); input.value = '' }
  }

  async function confirmarEntrega() {
    if (!entregaTarget) return
    const items = entregaItems
      .map((r) => ({ itemId: r.itemId, insumoId: r.insumoId, cantidadDespachada: Number(r.cantidad) }))
      .filter((r) => r.cantidadDespachada > 0)
    if (items.length === 0) { setError('Indica al menos una cantidad a despachar.'); return }
    const horometro = Number(entregaHorometro)
    if (!entregaHorometro.trim() || isNaN(horometro) || horometro < 0) {
      setError('El horómetro de la máquina es obligatorio.'); return
    }
    setBusy(true); setError('')
    try {
      const actualizados = await entregarSolicitud({
        solicitudId: entregaTarget.id,
        despachadoPor: session?.id,
        ruta: entregaRuta.trim() || undefined,
        horometro,
        evidenciaUrls: evidencias,
        items,
      })
      // Refresca el stock en el contexto con los insumos devueltos.
      if (actualizados.length) {
        setInsumos((prev) => prev.map((i) => actualizados.find((a) => a.id === i.id) ?? i))
      }
      setInfo('Entrega registrada y descontada del inventario.')
      setEntregaTarget(null)
      void refresh()
    } catch (err) {
      const e = err as { message?: string }
      setError(`No se pudo registrar la entrega. (${e?.message ?? 'error'})`)
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
                <button type="button" className="primary-button outline" style={{ padding: '6px 14px' }} onClick={() => openEntrega(s)} disabled={busy}>📦 Entregar</button>
                <button type="button" className="inline-button maestro-delete-btn" onClick={() => { setRechazoTarget(s); setMotivo(''); setError('') }} disabled={busy}>Rechazar</button>
              </div>
            )}
            {s.estado === 'PROGRAMADA' && (
              <div className="maestro-row-actions">
                <button type="button" className="primary-button" style={{ padding: '6px 14px' }} onClick={() => openEntrega(s)} disabled={busy}>📦 Entregar</button>
                <button type="button" className="inline-button maestro-delete-btn" onClick={() => { setRechazoTarget(s); setMotivo(''); setError('') }} disabled={busy}>Rechazar</button>
              </div>
            )}
            {s.estado === 'ENTREGADA' && (
              <div className="subtle-copy" style={{ fontSize: '0.82rem' }}>
                Entregado {s.entregadoEn ? fmtFecha(s.entregadoEn) : ''}
                {s.despachadoPor ? ` · por ${userName.get(s.despachadoPor) ?? s.despachadoPor}` : ''}
                {s.horometro != null ? ` · Horómetro: ${s.horometro}` : ''}
                {s.ruta ? ` · Ruta: ${s.ruta}` : ''}
                {s.items.some((it) => it.cantidadDespachada != null) && (
                  <div>Despachado: {s.items.filter((it) => it.cantidadDespachada != null).map((it) => `${it.cantidadDespachada} ${it.unidad} ${it.insumoNombre}`).join(', ')}</div>
                )}
                {s.evidenciaUrls && s.evidenciaUrls.length > 0 && (
                  <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                    {s.evidenciaUrls.map((u, i) => (
                      <a key={i} href={u} target="_blank" rel="noreferrer">
                        <img src={u} alt={`evidencia ${i + 1}`} style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 8 }} />
                      </a>
                    ))}
                  </div>
                )}
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

      {entregaTarget && (
        <div className="modal-overlay open" onClick={() => { if (!busy && !subiendoFoto) setEntregaTarget(null) }}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 'min(480px, calc(100vw - 32px))' }}>
            <div className="labor-detail-header">
              <div><p className="eyebrow">Despacho</p><h3>📦 Entregar a {entregaTarget.operarioNombre ?? userName.get(entregaTarget.operarioId) ?? entregaTarget.operarioId}</h3></div>
              <button type="button" className="modal-close-btn" onClick={() => setEntregaTarget(null)} disabled={busy} aria-label="Cerrar">&#x2715;</button>
            </div>
            <p className="subtle-copy" style={{ marginTop: 0 }}>Confirma la cantidad despachada por ítem. Se descontará del inventario (kardex SALIDA).</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {entregaItems.map((row, idx) => {
                const stock = stockDe(row.insumoId)
                const excede = Number(row.cantidad) > stock
                return (
                  <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <strong style={{ fontSize: '0.9rem' }}>{row.insumoNombre}</strong>
                      <div className="subtle-copy" style={{ fontSize: '0.76rem', color: excede ? '#b3261e' : undefined }}>
                        Stock: {stock} {row.unidad}{excede ? ' · excede el stock' : ''}
                      </div>
                    </div>
                    <input type="number" min={0} step="any" value={row.cantidad}
                      onChange={(e) => setEntregaItems((prev) => prev.map((r, i) => (i === idx ? { ...r, cantidad: e.target.value } : r)))}
                      disabled={busy} style={{ width: 90 }} />
                    <span className="subtle-copy" style={{ width: 44, fontSize: '0.78rem' }}>{row.unidad}</span>
                  </div>
                )
              })}
            </div>
            <label style={{ marginTop: 10 }}>
              Horómetro de la máquina <span style={{ color: '#b3261e' }}>*</span>
              <input
                type="number" min={0} step="any" inputMode="decimal" placeholder="Lectura del horómetro"
                value={entregaHorometro}
                onChange={(e) => setEntregaHorometro(e.target.value)}
                disabled={busy}
                required
              />
            </label>
            <label style={{ marginTop: 10 }}>
              Ruta <span className="field-optional">(opcional)</span>
              <input type="text" placeholder="Ruta / lugar de entrega" value={entregaRuta} onChange={(e) => setEntregaRuta(e.target.value)} disabled={busy} />
            </label>
            <div style={{ marginTop: 10 }}>
              <span className="subtle-copy" style={{ display: 'block', marginBottom: 6 }}>Evidencia (fotos)</span>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                {evidencias.map((u, i) => (
                  <img key={i} src={u} alt={`evidencia ${i + 1}`} style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 8 }} />
                ))}
                <button type="button" className="inline-button" onClick={() => fotoInputRef.current?.click()} disabled={busy || subiendoFoto}>
                  {subiendoFoto ? 'Subiendo…' : '📷 Agregar foto'}
                </button>
              </div>
              <input ref={fotoInputRef} type="file" accept="image/*" capture="environment" hidden onChange={handleFotoChange} />
            </div>
            <div className="modal-footer">
              <button type="button" className="inline-button" onClick={() => setEntregaTarget(null)} disabled={busy}>Cancelar</button>
              <button type="button" className="primary-button" onClick={() => void confirmarEntrega()} disabled={busy || subiendoFoto || !entregaHorometro.trim()}>
                {busy ? 'Guardando…' : 'Confirmar entrega'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

export default BandejaInsumosTab
