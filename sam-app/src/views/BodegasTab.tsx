import { useEffect, useMemo, useState } from 'react'
import { useAppData } from '../context/AppDataContext'
import {
  loadBodegas, createBodega, updateBodega, loadStockBodega,
  crearTraslado, loadTraslados, anularTraslado,
} from '../services/samApi'
import type { Bodega, StockBodega, Traslado, TrasladoItem } from '../domain/sam'
import { SearchableSelect } from '../components/SearchableSelect'
import { fmtCantidad, stepDe, normalizarCantidad, redondear2 } from '../lib/cantidad'

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
  // Traslado que se va a anular: se despachó por error y hay que devolverlo.
  const [anular, setAnular] = useState<Traslado | null>(null)
  const [anularMotivo, setAnularMotivo] = useState('')
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
      // Arranca todo colapsado: el stock se ve al desplegar cada bodega.
    } finally { setCargando(false) }
  }
  useEffect(() => { void refresh() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [])

  const stockDe = (insumoId: string, bodegaId: string) =>
    stock.find((s) => s.insumoId === insumoId && s.bodegaId === bodegaId)?.stock ?? 0

  /** Insumos que hoy existen en algún lado (para no listar el catálogo entero). */
  const enOperacion = useMemo(
    () => new Set(stock.filter((s) => s.stock !== 0).map((s) => s.insumoId)),
    [stock],
  )

  /**
   * Stock de UNA bodega, con el reparto al lado.
   *
   * Muestra también lo que está en CERO aquí pero existe en otra bodega: si el
   * combustible desaparece de la principal porque está todo en los carros, se
   * lee como "falta información" y no como "está repartido". Cada fila dice
   * cuánto hay aquí, cuánto en las otras bodegas y cuánto tiene la empresa.
   */
  const stockDeBodega = (bodegaId: string) =>
    insumos
      .filter((i) => enOperacion.has(i.id))
      .map((i) => {
        const aqui = stockDe(i.id, bodegaId)
        const total = redondear2(stock.filter((s) => s.insumoId === i.id).reduce((t, s) => t + s.stock, 0))
        return { insumoId: i.id, insumo: i, stock: aqui, fuera: redondear2(total - aqui), total }
      })
      .sort((a, b) => a.insumo.nombre.localeCompare(b.insumo.nombre, 'es', { sensitivity: 'base' }))

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

  /**
   * Devuelve el traslado entero a la principal.
   *
   * El material ya había salido; si el traslado no debía existir, ese stock
   * queda en el aire —ni en la principal ni en el carro— y el saldo no cuadra
   * con nada. Aquí vuelve completo, con su movimiento en el kardex.
   */
  async function confirmarAnular() {
    if (!anular) return
    setBusy(true); setError('')
    try {
      await anularTraslado({
        trasladoId: anular.id,
        origenId: anular.origenId,
        items: anular.items.map((i) => ({ insumoId: i.insumoId, cantidad: i.cantidad })),
        anuladoPor: session?.id,
        anuladoNombre: session?.name,
        rol: 'ENVIA',
        motivo: anularMotivo,
      })
      setInfo('Traslado anulado. El material volvió a la bodega principal.')
      setAnular(null); setAnularMotivo('')
      void refresh()
    } catch (err) {
      const e = err as { message?: string }
      setError(e?.message ?? 'No se pudo anular')
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
      <p className="subtle-copy" style={{ marginTop: 0 }}>
        Ojo con la lectura: aquí cada bodega muestra <strong>lo que tiene ella</strong>. Lo que ya está en
        los carros salió de la principal, así que no se cuenta dos veces — el total de la empresa es el
        que aparece en <strong>Inventario</strong>.
      </p>

      {cargando ? <p className="muted-text">Cargando…</p> : (
        <>
          {/* Bodegas — cada una despliega SU stock justo debajo (acordeón) */}
          <div className="inv-list">
            {bodegas.map((b) => {
              const items = stock.filter((s) => s.bodegaId === b.id && s.stock > 0).length
              const abierta = verBodegaId === b.id
              const suStock = stockDeBodega(b.id)
              return (
                <div key={b.id} className="bod-item">
                  <div className={`inv-row${b.activo ? '' : ' inv-row--off'}${abierta ? ' bod-row--abierta' : ''}`}>
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
                      <button
                        type="button"
                        className="inline-button"
                        onClick={() => setVerBodegaId(abierta ? '' : b.id)}
                        disabled={busy}
                        aria-expanded={abierta}
                      >
                        {abierta ? 'Ocultar ▴' : 'Ver stock ▾'}
                      </button>
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

                  {abierta && (
                    <div className="bod-stock">
                      {suStock.length === 0 ? (
                        <p className="muted-text" style={{ margin: 0 }}>Sin existencias en esta bodega.</p>
                      ) : (
                        suStock.map((s) => (
                          <div key={s.insumoId} className="bod-stock__row">
                            <span className="bod-stock__nom">
                              {s.insumo.categoria === 'COMBUSTIBLE' ? '⛽' : '🔩'} {s.insumo.nombre}
                              {s.fuera > 0 && (
                                <small className="bod-stock__reparto">
                                  {b.tipo === 'PRINCIPAL' ? 'En los carros' : 'En otras bodegas'}: {fmtCantidad(s.fuera, s.insumo.unidad)}
                                  {' · '}Total empresa: {fmtCantidad(s.total, s.insumo.unidad)}
                                </small>
                              )}
                            </span>
                            <strong className={`bod-stock__val${s.stock <= 0 ? ' bod-stock__val--cero' : ''}`}>
                              {fmtCantidad(s.stock, s.insumo.unidad)} <small>{s.insumo.unidad}</small>
                            </strong>
                          </div>
                        ))
                      )}
                    </div>
                  )}
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
                      {t.items.map((i) => `${fmtCantidad(i.cantidad, i.unidad)} ${i.unidad} ${i.insumoNombre}`).join(', ')} · {fmtFecha(t.createdAt)}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="inline-button maestro-delete-btn"
                    onClick={() => { setAnular(t); setAnularMotivo(''); setError('') }}
                    disabled={busy}
                  >
                    Anular
                  </button>
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

      {/* Anular un traslado que no debía salir: el material vuelve entero. */}
      {anular && (
        <div className="modal-overlay open" onClick={() => { if (!busy) setAnular(null) }}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 'min(440px, calc(100vw - 32px))' }}>
            <div className="labor-detail-header">
              <div><p className="eyebrow">Traslado</p><h3>Anular y devolver</h3></div>
              <button type="button" className="modal-close-btn" onClick={() => setAnular(null)} disabled={busy} aria-label="Cerrar">&#x2715;</button>
            </div>
            <p className="subtle-copy" style={{ marginTop: 0 }}>
              Va para <strong>{bodegas.find((b) => b.id === anular.destinoId)?.nombre ?? 'el satélite'}</strong>,
              enviado el {fmtFecha(anular.createdAt)}.
            </p>
            <div className="inv-list" style={{ marginTop: 6 }}>
              {anular.items.map((i) => (
                <div key={i.id} className="bod-stock__row">
                  <span className="bod-stock__nom">{i.insumoNombre}</span>
                  <strong className="bod-stock__val">{fmtCantidad(i.cantidad, i.unidad)} <small>{i.unidad}</small></strong>
                </div>
              ))}
            </div>
            <p className="subtle-copy">
              Todo esto <strong>regresa a la bodega principal</strong> y queda su movimiento en el kardex.
              El satélite no recibe nada.
            </p>
            <label>
              Motivo <span className="field-optional">(opcional)</span>
              <input type="text" placeholder="No era para él, cantidad equivocada…" value={anularMotivo}
                onChange={(e) => setAnularMotivo(e.target.value)} disabled={busy} autoFocus />
            </label>
            <div className="modal-footer">
              <button type="button" className="inline-button" onClick={() => setAnular(null)} disabled={busy}>Cancelar</button>
              <button type="button" className="release-confirm-btn" onClick={() => void confirmarAnular()} disabled={busy}>
                {busy ? 'Anulando…' : 'Anular y devolver'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

export default BodegasTab
