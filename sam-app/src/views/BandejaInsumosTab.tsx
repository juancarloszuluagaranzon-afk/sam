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
  const { users, session, insumos, setInsumos, sortedEquipment, busy, setBusy, setError, setInfo } = useAppData()

  const equipoNombre = useMemo(() => {
    const m = new Map<string, string>()
    sortedEquipment.forEach((e) => m.set(e.code, e.name))
    return m
  }, [sortedEquipment])
  const equipoDeOperario = (operarioId: string) => users.find((u) => u.id === operarioId)?.equipmentCode ?? ''

  const [filtro, setFiltro] = useState<'PENDIENTE' | 'PROGRAMADA' | 'ENTREGADA' | 'TODAS'>('PENDIENTE')
  const [solicitudes, setSolicitudes] = useState<SolicitudInsumo[]>([])
  const [loading, setLoading] = useState(false)
  const [rechazoTarget, setRechazoTarget] = useState<SolicitudInsumo | null>(null)
  const [motivo, setMotivo] = useState('')

  // Entrega (despacho) — fase 3
  const [entregaTarget, setEntregaTarget] = useState<SolicitudInsumo | null>(null)
  const [entregaItems, setEntregaItems] = useState<{ itemId?: string; insumoId?: string; insumoNombre: string; unidad: string; cantidad: string }[]>([])
  const [entregaRuta, setEntregaRuta] = useState('')
  const [entregaEquipo, setEntregaEquipo] = useState('')
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
    setEntregaEquipo(equipoDeOperario(s.operarioId))
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
    if (!entregaEquipo) { setError('Selecciona la máquina a la que se carga el material.'); return }
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
        equipoCodigo: entregaEquipo,
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

      <div className="sol-filtros" role="tablist" aria-label="Filtrar solicitudes">
        {([
          { key: 'PENDIENTE', icon: '🕐', label: 'Pendientes' },
          { key: 'PROGRAMADA', icon: '📅', label: 'Programadas' },
          { key: 'ENTREGADA', icon: '✅', label: 'Entregadas' },
          { key: 'TODAS', icon: '📋', label: 'Todas' },
        ] as const).map((f) => (
          <button
            key={f.key}
            type="button"
            role="tab"
            aria-selected={filtro === f.key}
            className={`sol-filtro${filtro === f.key ? ' is-active' : ''}`}
            onClick={() => setFiltro(f.key)}
          >
            <span aria-hidden>{f.icon}</span> {f.label}
            {f.key === 'PENDIENTE' && pendientesCount > 0 && <span className="sol-filtro__badge">{pendientesCount}</span>}
          </button>
        ))}
      </div>

      <div className="list-rows" style={{ marginTop: 12 }}>
        {loading ? (
          <p className="muted-text">Cargando…</p>
        ) : solicitudes.length === 0 ? (
          <p className="muted-text">No hay solicitudes {filtro === 'PENDIENTE' ? 'pendientes' : filtro === 'PROGRAMADA' ? 'programadas' : filtro === 'ENTREGADA' ? 'entregadas' : ''}.</p>
        ) : solicitudes.map((s) => {
          const nombre = s.operarioNombre ?? userName.get(s.operarioId) ?? s.operarioId
          const iniciales = nombre.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase()
          const tone = s.estado === 'PENDIENTE' ? 'pend' : s.estado === 'PROGRAMADA' ? 'prog' : s.estado === 'RECHAZADA' ? 'rech' : 'entr'
          return (
            <article key={s.id} className={`sol-card sol-card--${tone}`}>
              <header className="sol-card__head">
                <span className="sol-card__avatar" aria-hidden>{iniciales || '?'}</span>
                <div className="sol-card__who">
                  <strong>{nombre}</strong>
                  <span>{fmtFecha(s.createdAt)}{s.zona ? ` · Zona ${s.zona}` : ''}</span>
                </div>
                <span className={`status-pill ${s.estado === 'PENDIENTE' ? '' : s.estado === 'PROGRAMADA' ? 'amber' : s.estado === 'RECHAZADA' ? 'red' : 'green'}`}>
                  {ESTADO_LABEL[s.estado]}
                </span>
              </header>

              <ul className="sol-card__items">
                {s.items.map((it) => (
                  <li key={it.id}>
                    <span className="sol-card__qty">{it.cantidadDespachada ?? it.cantidad} {it.unidad}</span>
                    <span className="sol-card__item-name">{it.insumoNombre}</span>
                    {it.cantidadDespachada != null && it.cantidadDespachada !== it.cantidad && (
                      <span className="sol-card__qty-orig">pidió {it.cantidad}</span>
                    )}
                  </li>
                ))}
              </ul>

              {s.nota && <p className="sol-card__nota">💬 {s.nota}</p>}
              {s.motivoRechazo && <p className="sol-card__nota sol-card__nota--rechazo">✕ Rechazo: {s.motivoRechazo}</p>}

              {s.estado === 'ENTREGADA' && (
                <>
                  {/* Aval del operario: banner que cierra (o no) el ciclo de dos partes. */}
                  <div className={`sol-card__aval ${s.confirmadoEn ? (s.conforme ? 'sol-card__aval--ok' : 'sol-card__aval--dif') : 'sol-card__aval--wait'}`}>
                    {s.confirmadoEn
                      ? s.conforme
                        ? <>✔ Confirmada por el operario · {fmtFecha(s.confirmadoEn)}</>
                        : <>⚠ DIFERENCIA reportada · {fmtFecha(s.confirmadoEn)}{s.confirmacionNota ? ` — ${s.confirmacionNota}` : ''}</>
                      : <>⏳ Sin confirmar por el operario</>}
                  </div>
                  <div className="sol-card__meta">
                    {s.entregadoEn && <span title="Fecha de entrega">📦 {fmtFecha(s.entregadoEn)}</span>}
                    {s.despachadoPor && <span title="Despachado por">👤 {userName.get(s.despachadoPor) ?? s.despachadoPor}</span>}
                    {s.equipoCodigo && <span title="Máquina">🚜 {equipoNombre.get(s.equipoCodigo) ?? s.equipoCodigo}</span>}
                    {s.horometro != null && <span title="Horómetro">⏱ {s.horometro}</span>}
                    {s.ruta && <span title="Ruta">🛣 {s.ruta}</span>}
                  </div>
                  {s.evidenciaUrls && s.evidenciaUrls.length > 0 && (
                    <div className="sol-card__fotos">
                      {s.evidenciaUrls.map((u, i) => (
                        <a key={i} href={u} target="_blank" rel="noreferrer">
                          <img src={u} alt={`evidencia ${i + 1}`} />
                        </a>
                      ))}
                    </div>
                  )}
                </>
              )}

              {(s.estado === 'PENDIENTE' || s.estado === 'PROGRAMADA') && (
                <footer className="sol-card__actions">
                  {s.estado === 'PENDIENTE' && (
                    <button type="button" className="primary-button" onClick={() => void programar(s)} disabled={busy}>Programar</button>
                  )}
                  <button type="button" className="primary-button outline" onClick={() => openEntrega(s)} disabled={busy}>📦 Entregar</button>
                  <button type="button" className="inline-button maestro-delete-btn" onClick={() => { setRechazoTarget(s); setMotivo(''); setError('') }} disabled={busy}>Rechazar</button>
                </footer>
              )}
            </article>
          )
        })}
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
              Máquina (tractor) <span style={{ color: '#b3261e' }}>*</span>
              <select value={entregaEquipo} onChange={(e) => setEntregaEquipo(e.target.value)} disabled={busy}>
                <option value="">Seleccionar máquina…</option>
                {entregaEquipo && !sortedEquipment.some((eq) => eq.code === entregaEquipo) && (
                  <option value={entregaEquipo}>{equipoNombre.get(entregaEquipo) ?? entregaEquipo}</option>
                )}
                {sortedEquipment.map((eq) => (
                  <option key={eq.code} value={eq.code}>{eq.name}</option>
                ))}
              </select>
              <span className="field-hint" style={{ fontSize: '0.76rem' }}>Por defecto el equipo del operario. El material se carga a esta máquina.</span>
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
              <button type="button" className="primary-button" onClick={() => void confirmarEntrega()} disabled={busy || subiendoFoto || !entregaHorometro.trim() || !entregaEquipo}>
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
