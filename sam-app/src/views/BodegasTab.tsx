import { useEffect, useMemo, useState } from 'react'
import { useAppData } from '../context/AppDataContext'
import {
  loadBodegas, createBodega, updateBodega, loadStockBodega,
  crearTraslado, loadTraslados,
} from '../services/samApi'
import type { Bodega, StockBodega, Traslado, TrasladoItem } from '../domain/sam'
import { SearchableSelect } from '../components/SearchableSelect'
import { fmtCantidad, stepDe, normalizarCantidad } from '../lib/cantidad'

/**
 * Bodegas (administración/dueño): la PRINCIPAL y los SATÉLITES (el vehículo de
 * cada supervisor de insumos). Permite crear satélites, ver el stock de cada
 * bodega y **surtir** un satélite con un traslado desde la principal.
 *
 * El traslado descuenta de la principal de una vez y queda EN TRÁNSITO hasta
 * que el supervisor del satélite confirma lo que recibió (aval).
 */
function fmtFecha(iso: string): string {
  if (!iso) return ''
  return new Date(iso).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export function BodegasTab() {
  const { session, users, insumos, busy, setBusy, setError, setInfo } = useAppData()

  const [bodegas, setBodegas] = useState<Bodega[]>([])
  const [stock, setStock] = useState<StockBodega[]>([])
  const [traslados, setTraslados] = useState<Traslado[]>([])
  const [cargando, setCargando] = useState(true)
  const [verBodegaId, setVerBodegaId] = useState<string>('')

  // Crear satélite
  const [nuevoOpen, setNuevoOpen] = useState(false)
  const [nNombre, setNNombre] = useState('')
  const [nResp, setNResp] = useState('')
  const [nVehiculo, setNVehiculo] = useState('')

  // Surtir satélite (traslado)
  const [surtirDestino, setSurtirDestino] = useState<Bodega | null>(null)
  const [surtirItems, setSurtirItems] = useState<{ insumoId: string; cantidad: string }[]>([{ insumoId: '', cantidad: '' }])
  const [surtirNota, setSurtirNota] = useState('')

  const supervisoresInsumos = useMemo(
    () => users.filter((u) => u.active !== false && u.role === 'supervisor_insumos')
      .sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' })),
    [users],
  )
  const principal = useMemo(() => bodegas.find((b) => b.tipo === 'PRINCIPAL') ?? null, [bodegas])
  const insumosActivos = useMemo(
    () => insumos.filter((i) => i.activo).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' })),
    [insumos],
  )
  const nombreUsuario = useMemo(() => {
    const m = new Map<string, string>()
    users.forEach((u) => m.set(u.id, u.name))
    return m
  }, [users])

  async function refresh() {
    setCargando(true)
    try {
      const [bs, st, trs] = await Promise.all([loadBodegas(), loadStockBodega(), loadTraslados({ limit: 60 })])
      setBodegas(bs)
      setStock(st)
      setTraslados(trs)
      if (!verBodegaId && bs.length) setVerBodegaId(bs.find((b) => b.tipo === 'PRINCIPAL')?.id ?? bs[0].id)
    } finally { setCargando(false) }
  }
  useEffect(() => { void refresh() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [])

  /** Stock de la bodega que se está viendo, con nombre de insumo. */
  const stockVista = useMemo(() => {
    return stock
      .filter((s) => s.bodegaId === verBodegaId && s.stock !== 0)
      .map((s) => ({ ...s, insumo: insumos.find((i) => i.id === s.insumoId) }))
      .filter((s) => s.insumo)
      .sort((a, b) => (a.insumo!.nombre).localeCompare(b.insumo!.nombre, 'es', { sensitivity: 'base' }))
  }, [stock, verBodegaId, insumos])

  const stockDe = (insumoId: string, bodegaId: string) =>
    stock.find((s) => s.insumoId === insumoId && s.bodegaId === bodegaId)?.stock ?? 0

  async function crearSatelite() {
    if (!nNombre.trim()) { setError('Ponle nombre a la bodega.'); return }
    setBusy(true); setError('')
    try {
      await createBodega({ nombre: nNombre, tipo: 'SATELITE', responsableId: nResp || undefined, vehiculo: nVehiculo || undefined })
      setInfo(`Bodega "${nNombre.trim().toUpperCase()}" creada.`)
      setNuevoOpen(false); setNNombre(''); setNResp(''); setNVehiculo('')
      void refresh()
    } catch (err) {
      const e = err as { message?: string }
      setError(`No se pudo crear. (${e?.message ?? 'error'})`)
    } finally { setBusy(false) }
  }

  function abrirSurtir(b: Bodega) {
    setSurtirDestino(b)
    setSurtirItems([{ insumoId: '', cantidad: '' }])
    setSurtirNota('')
    setError('')
  }

  async function confirmarSurtir() {
    if (!surtirDestino || !principal) return
    const items: TrasladoItem[] = surtirItems
      .filter((r) => r.insumoId && Number(r.cantidad) > 0)
      .map((r) => {
        const ins = insumos.find((i) => i.id === r.insumoId)!
        return { insumoId: r.insumoId, insumoNombre: ins.nombre, unidad: ins.unidad, cantidad: normalizarCantidad(Number(r.cantidad), ins.unidad) }
      })
    if (items.length === 0) { setError('Agrega al menos un insumo con cantidad.'); return }
    const excedido = items.find((it) => it.cantidad > stockDe(it.insumoId, principal.id))
    if (excedido) { setError(`No hay suficiente ${excedido.insumoNombre} en la principal.`); return }

    setBusy(true); setError('')
    try {
      await crearTraslado({
        origenId: principal.id,
        destinoId: surtirDestino.id,
        enviadoPor: session?.id,
        nota: surtirNota.trim() || undefined,
        items,
      })
      setInfo(`Traslado enviado a ${surtirDestino.nombre}. Queda pendiente de su confirmación.`)
      setSurtirDestino(null)
      void refresh()
    } catch (err) {
      const e = err as { message?: string }
      setError(`No se pudo enviar. (${e?.message ?? 'error'})`)
    } finally { setBusy(false) }
  }

  async function toggleActivo(b: Bodega) {
    setBusy(true); setError('')
    try {
      await updateBodega(b.id, { activo: !b.activo })
      void refresh()
    } catch (err) {
      const e = err as { message?: string }
      setError(`No se pudo cambiar. (${e?.message ?? 'error'})`)
    } finally { setBusy(false) }
  }

  const enTransito = traslados.filter((t) => t.estado === 'EN_TRANSITO')

  return (
    <section className="panel-card">
      <div className="panel-title split">
        <h2>Bodegas</h2>
        <button type="button" className="primary-button" onClick={() => setNuevoOpen(true)} disabled={busy}>+ Nueva bodega satélite</button>
      </div>
      <p className="subtle-copy" style={{ marginTop: 0 }}>
        La <strong>principal</strong> compra y almacena; cada <strong>satélite</strong> es el vehículo de un supervisor de
        insumos, de donde consumen los operarios. Se surten con un traslado que el supervisor confirma al recibir.
      </p>

      {cargando ? <p className="muted-text">Cargando…</p> : (
        <>
          {/* Bodegas */}
          <div className="inv-list">
            {bodegas.map((b) => {
              const items = stock.filter((s) => s.bodegaId === b.id && s.stock > 0).length
              return (
                <div key={b.id} className={`inv-row${b.activo ? '' : ' inv-row--off'}`}>
                  <div className="inv-row__main">
                    <strong>{b.tipo === 'PRINCIPAL' ? '🏢' : '🚚'} {b.nombre}</strong>
                    <span className={`inv-cat ${b.tipo === 'PRINCIPAL' ? 'inv-cat--mat' : 'inv-cat--comb'}`}>
                      {b.tipo === 'PRINCIPAL' ? 'Principal' : 'Satélite'}
                    </span>
                    {b.responsableId && <span className="subtle-copy">{nombreUsuario.get(b.responsableId) ?? b.responsableId}</span>}
                    {b.vehiculo && <span className="subtle-copy">🚙 {b.vehiculo}</span>}
                    {!b.activo && <span className="inv-cat inv-cat--off">Inactiva</span>}
                  </div>
                  <div className="inv-stock" title="Insumos con existencia">{items} <small>ítems</small></div>
                  <div className="inv-row__actions">
                    <button type="button" className="inline-button" onClick={() => setVerBodegaId(b.id)} disabled={busy}>Ver stock</button>
                    {b.tipo === 'SATELITE' && (
                      <button type="button" className="inline-button inv-entrada-btn" onClick={() => abrirSurtir(b)} disabled={busy || !principal}>
                        📦 Surtir
                      </button>
                    )}
                    {b.tipo === 'SATELITE' && (
                      <button type="button" className="inline-button" onClick={() => void toggleActivo(b)} disabled={busy}>
                        {b.activo ? 'Desactivar' : 'Activar'}
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Traslados en tránsito */}
          {enTransito.length > 0 && (
            <div className="bod-aviso" style={{ marginTop: 14 }}>
              <p className="bod-aviso__lbl">🚚 En tránsito <span className="field-optional">(esperando confirmación del satélite)</span></p>
              {enTransito.map((t) => (
                <div key={t.id} className="bod-aviso__row">
                  <div className="bod-aviso__info">
                    <strong>{bodegas.find((b) => b.id === t.destinoId)?.nombre ?? 'Satélite'}</strong>
                    <span className="subtle-copy">
                      {t.items.map((i) => `${i.cantidad} ${i.unidad} ${i.insumoNombre}`).join(', ')} · {fmtFecha(t.createdAt)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Stock de la bodega seleccionada */}
          <div className="panel-title split" style={{ marginTop: 18 }}>
            <h3 style={{ margin: 0, fontSize: '1rem' }}>
              Stock · {bodegas.find((b) => b.id === verBodegaId)?.nombre ?? '—'}
            </h3>
          </div>
          {stockVista.length === 0 ? (
            <p className="muted-text">Sin existencias en esta bodega.</p>
          ) : (
            <div className="inv-list">
              {stockVista.map((s) => (
                <div key={`${s.insumoId}-${s.bodegaId}`} className="inv-row">
                  <div className="inv-row__main">
                    <strong>{s.insumo!.nombre}</strong>
                    <span className={`inv-cat ${s.insumo!.categoria === 'COMBUSTIBLE' ? 'inv-cat--comb' : 'inv-cat--mat'}`}>
                      {s.insumo!.categoria === 'COMBUSTIBLE' ? '⛽' : '🔩'}
                    </span>
                  </div>
                  <div className={`inv-stock${s.stock <= 0 ? ' inv-stock--zero' : ''}`}>{fmtCantidad(s.stock, s.insumo!.unidad)} <small>{s.insumo!.unidad}</small></div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Modal: nueva bodega satélite */}
      {nuevoOpen && (
        <div className="modal-overlay open" onClick={() => setNuevoOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 'min(430px, calc(100vw - 32px))' }}>
            <div className="labor-detail-header">
              <div><p className="eyebrow">Bodegas</p><h3>Nueva bodega satélite</h3></div>
              <button type="button" className="modal-close-btn" onClick={() => setNuevoOpen(false)} disabled={busy} aria-label="Cerrar">&#x2715;</button>
            </div>
            <label>Nombre<input type="text" placeholder="ej. CARRO GENARO" value={nNombre} onChange={(e) => setNNombre(e.target.value)} disabled={busy} autoFocus /></label>
            <label>Responsable (supervisor de insumos)
              <SearchableSelect
                value={nResp}
                onChange={setNResp}
                options={supervisoresInsumos.map((u) => ({ value: u.id, label: u.name }))}
                placeholder="Buscar responsable…"
                disabled={busy}
              />
            </label>
            <label>Vehículo (placa) <span className="field-optional">(opcional)</span>
              <input type="text" value={nVehiculo} onChange={(e) => setNVehiculo(e.target.value)} disabled={busy} />
            </label>
            <div className="modal-footer">
              <button type="button" className="inline-button" onClick={() => setNuevoOpen(false)} disabled={busy}>Cancelar</button>
              <button type="button" className="primary-button" onClick={() => void crearSatelite()} disabled={busy}>{busy ? 'Creando…' : 'Crear'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: surtir satélite */}
      {surtirDestino && principal && (
        <div className="modal-overlay open" onClick={() => { if (!busy) setSurtirDestino(null) }}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 'min(480px, calc(100vw - 32px))' }}>
            <div className="labor-detail-header">
              <div><p className="eyebrow">Traslado</p><h3>📦 Surtir {surtirDestino.nombre}</h3></div>
              <button type="button" className="modal-close-btn" onClick={() => setSurtirDestino(null)} disabled={busy} aria-label="Cerrar">&#x2715;</button>
            </div>
            <p className="subtle-copy" style={{ marginTop: 0 }}>
              Sale de <strong>{principal.nombre}</strong>. Queda en tránsito hasta que el supervisor confirme lo que recibió.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
              {surtirItems.map((row, idx) => {
                const disp = row.insumoId ? stockDe(row.insumoId, principal.id) : 0
                const ins = insumos.find((i) => i.id === row.insumoId)
                const excede = Number(row.cantidad) > disp
                return (
                  <div key={idx} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <SearchableSelect
                        value={row.insumoId}
                        onChange={(v) => setSurtirItems((prev) => prev.map((r, i) => (i === idx ? { ...r, insumoId: v } : r)))}
                        options={insumosActivos.map((i) => ({
                          value: i.id,
                          label: `${i.nombre} (${i.unidad})`,
                          rightLabel: fmtCantidad(stockDe(i.id, principal.id), i.unidad),
                          frecuente: i.frecuente,
                        }))}
                        placeholder="Buscar insumo…"
                        disabled={busy}
                      />
                    </div>
                    <input
                      type="number" min={0} step={stepDe(ins?.unidad)} placeholder="Cant."
                      value={row.cantidad}
                      onChange={(e) => setSurtirItems((prev) => prev.map((r, i) => (i === idx ? { ...r, cantidad: e.target.value } : r)))}
                      disabled={busy} style={{ width: 84, borderColor: excede ? '#b3261e' : undefined }}
                      title={excede ? `Solo hay ${disp} en la principal` : ''}
                    />
                    <span className="subtle-copy" style={{ width: 46, fontSize: '0.78rem' }}>{ins?.unidad ?? ''}</span>
                    {surtirItems.length > 1 && (
                      <button type="button" className="modal-close-btn" onClick={() => setSurtirItems((prev) => prev.filter((_, i) => i !== idx))} disabled={busy} aria-label="Quitar">&#x2715;</button>
                    )}
                  </div>
                )
              })}
            </div>
            <button type="button" className="inline-button" style={{ marginTop: 8 }} onClick={() => setSurtirItems((prev) => [...prev, { insumoId: '', cantidad: '' }])} disabled={busy}>
              + Agregar otro insumo
            </button>

            <label style={{ marginTop: 10 }}>Nota <span className="field-optional">(opcional)</span>
              <input type="text" value={surtirNota} onChange={(e) => setSurtirNota(e.target.value)} disabled={busy} />
            </label>

            <div className="modal-footer">
              <button type="button" className="inline-button" onClick={() => setSurtirDestino(null)} disabled={busy}>Cancelar</button>
              <button type="button" className="primary-button" onClick={() => void confirmarSurtir()} disabled={busy}>
                {busy ? 'Enviando…' : 'Enviar traslado'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

export default BodegasTab
