import { useMemo, useState } from 'react'
import { useAppData } from '../../context/AppDataContext'
import { useTaller } from './TallerContext'
import {
  loadCompras, crearCompra, recibirCompra, anularCompra, saveProveedor,
} from '../../services/tallerApi'
import { SearchableSelect } from '../../components/SearchableSelect'
import { fmtFechaHora } from '../../lib/fechas'
import { fmtCantidad } from '../../lib/cantidad'
import type { Compra, CompraItem, Proveedor, ProveedorTipo } from '../../domain/sam'
import { useEffect } from 'react'
import { Ayuda } from '../../components/Ayuda'

/**
 * Compras y proveedores.
 *
 * El ciclo del apunte: proveedor → compra → entra a bodega → sale al equipo.
 * La compra se crea en BORRADOR y solo al **recibirla** entra al inventario,
 * con su movimiento de kardex. Es la misma regla que rige todo lo demás: el
 * stock nunca aparece de la nada.
 *
 * Recibir también actualiza el precio del repuesto para ese proveedor, así el
 * histórico de precios se arma solo.
 */

const money = (v: number) => `$${Math.round(v).toLocaleString('es-CO')}`

const TIPOS: { v: ProveedorTipo; l: string }[] = [
  { v: 'REPUESTOS', l: 'Repuestos' },
  { v: 'AGROINSUMOS', l: 'Agroinsumos' },
  { v: 'SERVICIOS', l: 'Servicios' },
  { v: 'OTRO', l: 'Otro' },
]

export function ComprasTab() {
  const { insumos, session, busy, setBusy, setError, setInfo } = useAppData()
  const { proveedores, bodegaTaller, refrescar } = useTaller()

  const [compras, setCompras] = useState<Compra[]>([])
  const [cargando, setCargando] = useState(true)
  const [nuevaOpen, setNuevaOpen] = useState(false)
  const [provOpen, setProvOpen] = useState<Partial<Proveedor> | null>(null)
  const [detalle, setDetalle] = useState<Compra | null>(null)

  const [cProv, setCProv] = useState('')
  const [cFecha, setCFecha] = useState(() => new Date().toISOString().slice(0, 10))
  const [cFactura, setCFactura] = useState('')
  const [cImp, setCImp] = useState('')
  const [cItems, setCItems] = useState<CompraItem[]>([{ insumoId: '', cantidad: 0, precioUnitario: 0 }])

  async function recargar() {
    setCargando(true)
    try { setCompras(await loadCompras({ limit: 200 })) } finally { setCargando(false) }
  }
  useEffect(() => { void recargar() }, [])

  const insumoInfo = useMemo(() => {
    const m = new Map<string, { nombre: string; unidad: string }>()
    insumos.forEach((i) => m.set(i.id, { nombre: i.nombre, unidad: i.unidad }))
    return m
  }, [insumos])

  const subtotal = useMemo(
    () => cItems.reduce((t, i) => t + (Number(i.cantidad) || 0) * (Number(i.precioUnitario) || 0), 0),
    [cItems],
  )

  async function guardarCompra() {
    const items = cItems.filter((i) => i.insumoId && Number(i.cantidad) > 0)
    if (items.length === 0) { setError('Agrega al menos un ítem con cantidad.'); return }
    if (!bodegaTaller) { setError('No hay bodega de taller configurada.'); return }
    setBusy(true); setError('')
    try {
      await crearCompra({
        proveedorId: cProv || undefined,
        bodegaId: bodegaTaller.id,
        fecha: cFecha,
        factura: cFactura || undefined,
        impuestos: Number(cImp) || 0,
        creadoPor: session?.id,
        creadoNombre: session?.name,
        items: items.map((i) => ({ ...i, cantidad: Number(i.cantidad), precioUnitario: Number(i.precioUnitario) })),
      })
      setInfo('Compra creada en borrador. Recíbela para que entre al inventario.')
      setNuevaOpen(false)
      setCProv(''); setCFactura(''); setCImp('')
      setCItems([{ insumoId: '', cantidad: 0, precioUnitario: 0 }])
      await recargar()
    } catch (err) {
      setError(`No se pudo crear. (${(err as { message?: string })?.message ?? 'error'})`)
    } finally { setBusy(false) }
  }

  async function recibir(c: Compra) {
    setBusy(true); setError('')
    try {
      await recibirCompra(c.id, session?.id)
      setInfo(`Compra #${c.consecutivo} recibida. El material entró a la bodega.`)
      setDetalle(null)
      await recargar(); await refrescar()
    } catch (err) {
      setError(`No se pudo recibir. (${(err as { message?: string })?.message ?? 'error'})`)
    } finally { setBusy(false) }
  }

  return (
    <section className="panel-card">
      <div className="bod-head">
        <h2 className="bod-head__title">🧾 Compras y proveedores</h2>
        <button type="button" className="primary-button bod-head__btn"
          onClick={() => { setNuevaOpen(true); setError('') }} disabled={busy}>
          + Nueva compra
        </button>
      </div>
      <Ayuda>
        <p>La compra nace en <strong>borrador</strong>. Solo al recibirla entra al inventario,
        con su movimiento de kardex — así se sabe siempre de dónde salió cada repuesto.</p>
      </Ayuda>

      {/* Proveedores */}
      <div className="bod-head" style={{ marginTop: 14 }}>
        <p className="ins-res__lbl" style={{ margin: 0 }}>Proveedores ({proveedores.filter((p) => p.activo).length})</p>
        <button type="button" className="inline-button" onClick={() => setProvOpen({ tipo: 'REPUESTOS', activo: true })} disabled={busy}>
          + Proveedor
        </button>
      </div>
      {proveedores.length === 0 ? (
        <p className="muted-text" style={{ margin: 0 }}>Sin proveedores. Crea el primero.</p>
      ) : (
        <div className="inv-list">
          {proveedores.filter((p) => p.activo).map((p) => (
            <div key={p.id} className="inv-row">
              <div className="inv-row__main">
                <strong>{p.nombre}</strong>
                <span className="inv-cat inv-cat--mat">{TIPOS.find((t) => t.v === p.tipo)?.l ?? p.tipo}</span>
                <span className="subtle-copy">
                  {[p.contacto, p.telefono, p.zona].filter(Boolean).join(' · ') || 'sin contacto'}
                </span>
              </div>
              <div className="inv-row__actions">
                <button type="button" className="inline-button" onClick={() => setProvOpen(p)} disabled={busy}>Editar</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Compras */}
      <p className="ins-res__lbl" style={{ marginTop: 16 }}>Compras</p>
      {cargando ? (
        <p className="muted-text">Cargando…</p>
      ) : compras.length === 0 ? (
        <p className="muted-text">Sin compras registradas.</p>
      ) : (
        <div className="inv-list">
          {compras.map((c) => (
            <button key={c.id} type="button" className="taller-ot" onClick={() => setDetalle(c)}>
              <div className="taller-ot__main">
                <div className="aval-row__top">
                  <strong>#{c.consecutivo}</strong>
                  <span className={`aval-tag aval-tag--${c.estado === 'RECIBIDA' ? 'carro' : c.estado === 'ANULADA' ? 'vehiculo' : 'maquina'}`}>
                    {c.estado === 'RECIBIDA' ? '✔ Recibida' : c.estado === 'ANULADA' ? '✕ Anulada' : '⏳ Borrador'}
                  </span>
                  {c.proveedorNombre && <span className="aval-tag aval-tag--origen">{c.proveedorNombre}</span>}
                </div>
                <span className="subtle-copy">
                  {c.fecha}{c.factura ? ` · factura ${c.factura}` : ''} · {c.items.length} ítem(s)
                  {c.recibidaEn ? ` · recibida ${fmtFechaHora(c.recibidaEn)}` : ''}
                </span>
              </div>
              <strong className="bod-stock__val">{money(c.total)}</strong>
            </button>
          ))}
        </div>
      )}

      {/* ── Nueva compra ── */}
      {nuevaOpen && (
        <div className="modal-overlay open" onClick={() => { if (!busy) setNuevaOpen(false) }}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 'min(560px, calc(100vw - 32px))' }}>
            <div className="labor-detail-header">
              <div><p className="eyebrow">Taller</p><h3>🧾 Nueva compra</h3></div>
              <button type="button" className="modal-close-btn" onClick={() => setNuevaOpen(false)} disabled={busy}>&#x2715;</button>
            </div>
            <div className="flota-grid">
              <label>Proveedor
                <SearchableSelect value={cProv} onChange={setCProv}
                  options={proveedores.filter((p) => p.activo).map((p) => ({ value: p.id, label: p.nombre, rightLabel: p.tipo }))}
                  placeholder="Buscar proveedor…" disabled={busy} />
              </label>
              <label>Fecha<input type="date" value={cFecha} onChange={(e) => setCFecha(e.target.value)} disabled={busy} /></label>
              <label>Factura<input type="text" value={cFactura} onChange={(e) => setCFactura(e.target.value)} disabled={busy} /></label>
              <label>Impuestos<input type="number" min={0} step="any" value={cImp} onChange={(e) => setCImp(e.target.value)} disabled={busy} /></label>
            </div>

            <p className="ins-res__lbl" style={{ marginTop: 12 }}>Ítems</p>
            {cItems.map((it, idx) => (
              <div key={idx} className="taller-item-row">
                <SearchableSelect value={it.insumoId}
                  onChange={(v) => setCItems(cItems.map((x, i) => i === idx ? { ...x, insumoId: v } : x))}
                  options={insumos.filter((i) => i.activo).map((i) => ({
                    value: i.id, label: i.nombre, rightLabel: i.unidad, frecuente: i.frecuente,
                  }))}
                  placeholder="Buscar ítem…" disabled={busy} />
                <input type="number" min={0} step="any" placeholder="Cant." value={it.cantidad || ''}
                  onChange={(e) => setCItems(cItems.map((x, i) => i === idx ? { ...x, cantidad: Number(e.target.value) } : x))}
                  disabled={busy} />
                <input type="number" min={0} step="any" placeholder="Precio" value={it.precioUnitario || ''}
                  onChange={(e) => setCItems(cItems.map((x, i) => i === idx ? { ...x, precioUnitario: Number(e.target.value) } : x))}
                  disabled={busy} />
                <button type="button" className="inline-button" disabled={busy || cItems.length === 1}
                  onClick={() => setCItems(cItems.filter((_, i) => i !== idx))}>✕</button>
              </div>
            ))}
            <button type="button" className="inline-button" style={{ marginTop: 6 }} disabled={busy}
              onClick={() => setCItems([...cItems, { insumoId: '', cantidad: 0, precioUnitario: 0 }])}>
              + Otro ítem
            </button>

            <p className="tq-total" style={{ marginTop: 12 }}>
              Subtotal <strong>{money(subtotal)}</strong> · Total <strong>{money(subtotal + (Number(cImp) || 0))}</strong>
            </p>

            <div className="modal-footer">
              <button type="button" className="inline-button" onClick={() => setNuevaOpen(false)} disabled={busy}>Cancelar</button>
              <button type="button" className="primary-button" onClick={() => void guardarCompra()} disabled={busy}>
                {busy ? 'Guardando…' : 'Crear borrador'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Detalle de compra ── */}
      {detalle && (
        <div className="modal-overlay open" onClick={() => { if (!busy) setDetalle(null) }}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 'min(480px, calc(100vw - 32px))' }}>
            <div className="labor-detail-header">
              <div><p className="eyebrow">{detalle.proveedorNombre ?? 'Sin proveedor'}</p><h3>Compra #{detalle.consecutivo}</h3></div>
              <button type="button" className="modal-close-btn" onClick={() => setDetalle(null)} disabled={busy}>&#x2715;</button>
            </div>
            <div className="taller-ficha">
              <div><span>Fecha</span><strong>{detalle.fecha}</strong></div>
              <div><span>Factura</span><strong>{detalle.factura ?? '—'}</strong></div>
              <div><span>Estado</span><strong>{detalle.estado}</strong></div>
              <div><span>Total</span><strong>{money(detalle.total)}</strong></div>
            </div>
            <p className="ins-res__lbl" style={{ marginTop: 12 }}>Ítems</p>
            {detalle.items.map((it) => {
              const info = insumoInfo.get(it.insumoId)
              return (
                <div key={it.id} className="bod-stock__row">
                  <span className="bod-stock__nom">
                    {info?.nombre ?? it.insumoId}
                    <small className="bod-stock__reparto">
                      {fmtCantidad(it.cantidad, info?.unidad)} {info?.unidad ?? ''} × {money(it.precioUnitario)}
                    </small>
                  </span>
                  <strong className="bod-stock__val">{money(it.cantidad * it.precioUnitario)}</strong>
                </div>
              )
            })}
            {detalle.estado === 'BORRADOR' && (
              <div className="taller-acciones" style={{ marginTop: 12 }}>
                <button type="button" className="inline-button" disabled={busy}
                  onClick={async () => {
                    setBusy(true)
                    try { await anularCompra(detalle.id); await recargar(); setDetalle(null); setInfo('Compra anulada.') }
                    catch { setError('No se pudo anular') } finally { setBusy(false) }
                  }}>Anular</button>
                <button type="button" className="primary-button aval-btn" onClick={() => void recibir(detalle)} disabled={busy}>
                  ✔ Recibir e ingresar
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Proveedor ── */}
      {provOpen && (
        <div className="modal-overlay open" onClick={() => { if (!busy) setProvOpen(null) }}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 'min(460px, calc(100vw - 32px))' }}>
            <div className="labor-detail-header">
              <div><p className="eyebrow">Proveedor</p><h3>{provOpen.id ? 'Editar' : 'Nuevo'}</h3></div>
              <button type="button" className="modal-close-btn" onClick={() => setProvOpen(null)} disabled={busy}>&#x2715;</button>
            </div>
            <div className="flota-grid">
              <label>Nombre <span style={{ color: '#b3261e' }}>*</span>
                <input type="text" value={provOpen.nombre ?? ''} onChange={(e) => setProvOpen({ ...provOpen, nombre: e.target.value })} disabled={busy} />
              </label>
              <label>Tipo
                <SearchableSelect value={provOpen.tipo ?? 'REPUESTOS'}
                  onChange={(v) => setProvOpen({ ...provOpen, tipo: v as ProveedorTipo })}
                  options={TIPOS.map((t) => ({ value: t.v, label: t.l }))} disabled={busy} />
              </label>
              <label>NIT<input type="text" value={provOpen.nit ?? ''} onChange={(e) => setProvOpen({ ...provOpen, nit: e.target.value })} disabled={busy} /></label>
              <label>Contacto<input type="text" value={provOpen.contacto ?? ''} onChange={(e) => setProvOpen({ ...provOpen, contacto: e.target.value })} disabled={busy} /></label>
              <label>Teléfono<input type="text" value={provOpen.telefono ?? ''} onChange={(e) => setProvOpen({ ...provOpen, telefono: e.target.value })} disabled={busy} /></label>
              <label>Zona<input type="text" value={provOpen.zona ?? ''} onChange={(e) => setProvOpen({ ...provOpen, zona: e.target.value })} disabled={busy} /></label>
            </div>
            <div className="modal-footer">
              <button type="button" className="inline-button" onClick={() => setProvOpen(null)} disabled={busy}>Cancelar</button>
              <button type="button" className="primary-button" disabled={busy}
                onClick={async () => {
                  if (!provOpen.nombre?.trim()) { setError('Escribe el nombre.'); return }
                  setBusy(true); setError('')
                  try {
                    await saveProveedor({ ...provOpen, nombre: provOpen.nombre })
                    setInfo('Proveedor guardado.')
                    setProvOpen(null)
                    await refrescar()
                  } catch (err) {
                    setError(`No se pudo guardar. (${(err as { message?: string })?.message ?? 'error'})`)
                  } finally { setBusy(false) }
                }}>Guardar</button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
