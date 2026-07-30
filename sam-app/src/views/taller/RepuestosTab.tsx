import { useEffect, useMemo, useState } from 'react'
import { useAppData } from '../../context/AppDataContext'
import { useTaller } from './TallerContext'
import {
  updateRepuestoFicha, loadAplicabilidad, addAplicabilidad, deleteAplicabilidad,
  loadInsumoProveedores, saveInsumoProveedor,
} from '../../services/tallerApi'
import { loadStockBodega, loadInsumos } from '../../services/samApi'
import { SearchableSelect } from '../../components/SearchableSelect'
import { fmtCantidad } from '../../lib/cantidad'
import type { Aplicabilidad, InsumoProveedor, StockBodega } from '../../domain/sam'

/**
 * Catálogo de repuestos.
 *
 * Lo que lo separa del insumo de uso diario: **referencia, marca, número de
 * parte, ubicación y a qué máquinas aplica**. Un filtro sirve para el modelo X
 * y para ningún otro; un tornillo es genérico. Sin esa distinción, buscar el
 * repuesto correcto es imposible y se termina comprando por duplicado.
 *
 * La llave sigue siendo el código propio del ítem: la referencia del proveedor
 * es un alias, y cada proveedor tiene la suya con su precio.
 */

const money = (v: number) => `$${Math.round(v).toLocaleString('es-CO')}`

export function RepuestosTab() {
  const { insumos, setInsumos, equipment, busy, setBusy, setError, setInfo } = useAppData()
  const { proveedores, bodegaTaller, refrescar } = useTaller()

  const [q, setQ] = useState('')
  const [soloRepuestos, setSoloRepuestos] = useState(true)
  const [abierto, setAbierto] = useState('')
  const [stock, setStock] = useState<StockBodega[]>([])
  const [aplic, setAplic] = useState<Aplicabilidad[]>([])
  const [provs, setProvs] = useState<InsumoProveedor[]>([])

  const [ficha, setFicha] = useState<{
    id: string; referencia: string; marca: string; parte: string
    ubicacion: string; maximo: string; seguridad: string; costo: string
  } | null>(null)
  const [nuevaAplic, setNuevaAplic] = useState<{ insumoId: string; marca: string; modelo: string; equipo: string } | null>(null)
  const [nuevoProv, setNuevoProv] = useState<{ insumoId: string; prov: string; ref: string; precio: string } | null>(null)

  useEffect(() => {
    if (bodegaTaller) void loadStockBodega(bodegaTaller.id).then(setStock)
  }, [bodegaTaller])

  useEffect(() => {
    if (!abierto) return
    void loadAplicabilidad(abierto).then(setAplic)
    void loadInsumoProveedores(abierto).then(setProvs)
  }, [abierto])

  const stockDe = useMemo(() => {
    const m = new Map<string, number>()
    stock.forEach((s) => m.set(s.insumoId, s.stock))
    return m
  }, [stock])

  const lista = useMemo(() => {
    const t = q.trim().toUpperCase()
    return insumos
      .filter((i) => i.activo)
      .filter((i) => !soloRepuestos || i.esRepuesto)
      .filter((i) => !t || [i.nombre, i.referencia, i.marca, i.numeroParte]
        .filter(Boolean).some((v) => String(v).toUpperCase().includes(t)))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }))
  }, [insumos, q, soloRepuestos])

  async function guardarFicha() {
    if (!ficha) return
    setBusy(true); setError('')
    try {
      await updateRepuestoFicha(ficha.id, {
        referencia: ficha.referencia,
        marca: ficha.marca,
        numeroParte: ficha.parte,
        ubicacion: ficha.ubicacion,
        stockMaximo: ficha.maximo ? Number(ficha.maximo) : null,
        stockSeguridad: ficha.seguridad ? Number(ficha.seguridad) : null,
        costoPromedio: ficha.costo ? Number(ficha.costo) : null,
        esRepuesto: true,
      })
      setInfo('Ficha guardada.')
      setFicha(null)
      const { data } = await loadInsumos()
      setInsumos(data)
      await refrescar()
    } catch (err) {
      setError(`No se pudo guardar. (${(err as { message?: string })?.message ?? 'error'})`)
    } finally { setBusy(false) }
  }

  async function marcarRepuesto(id: string, valor: boolean) {
    setBusy(true); setError('')
    try {
      await updateRepuestoFicha(id, { esRepuesto: valor })
      setInfo(valor ? 'Marcado como repuesto de taller.' : 'Ya no es repuesto de taller.')
      const { data } = await loadInsumos()
      setInsumos(data)
    } catch { setError('No se pudo actualizar') } finally { setBusy(false) }
  }

  return (
    <section className="panel-card">
      <h2>🔩 Repuestos</h2>
      <p className="subtle-copy" style={{ marginTop: 0 }}>
        El repuesto se identifica por el <strong>código propio</strong>; la referencia del
        proveedor es un alias. Marca a qué máquinas aplica para no comprar dos veces lo
        mismo con nombres distintos.
      </p>

      <label style={{ marginTop: 10 }}>Buscar por nombre, referencia, marca o número de parte
        <input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtro aceite, W950…" />
      </label>
      <label className="taller-check" style={{ marginTop: 8 }}>
        <input type="checkbox" checked={soloRepuestos} onChange={(e) => setSoloRepuestos(e.target.checked)} />
        <span><strong>Solo repuestos de taller</strong>
          <small>Desmárcalo para ver todo el catálogo y marcar ítems nuevos como repuesto.</small>
        </span>
      </label>

      {lista.length === 0 ? (
        <p className="muted-text" style={{ marginTop: 12 }}>
          {soloRepuestos
            ? 'Todavía no hay repuestos marcados. Desmarca el filtro y marca los que sean de taller.'
            : 'Sin resultados.'}
        </p>
      ) : (
        <div className="inv-list" style={{ marginTop: 12 }}>
          {lista.map((i) => {
            const open = abierto === i.id
            const s = stockDe.get(i.id) ?? 0
            const bajo = i.stockMinimo != null && s <= i.stockMinimo
            return (
              <div key={i.id} className="bod-item">
                <div className={`inv-row${open ? ' bod-row--abierta' : ''}`}>
                  <div className="inv-row__main">
                    <strong>{i.nombre}</strong>
                    {i.referencia && <span className="inv-cat inv-cat--mat">{i.referencia}</span>}
                    {i.marca && <span className="subtle-copy">{i.marca}</span>}
                    {i.ubicacion && <span className="subtle-copy">📍 {i.ubicacion}</span>}
                    {bajo && <span className="inv-cat inv-cat--off">⚠ Bajo mínimo</span>}
                  </div>
                  <div className={`inv-stock${s <= 0 ? ' inv-stock--zero' : ''}`}>
                    {fmtCantidad(s, i.unidad)} <small>{i.unidad}</small>
                  </div>
                  <div className="inv-row__actions">
                    <button type="button" className="inline-button" onClick={() => setAbierto(open ? '' : i.id)} aria-expanded={open}>
                      {open ? 'Ocultar ▴' : 'Ficha ▾'}
                    </button>
                  </div>
                </div>

                {open && (
                  <div className="bod-stock">
                    <div className="taller-ficha">
                      <div><span>Referencia</span><strong>{i.referencia ?? '—'}</strong></div>
                      <div><span>Marca</span><strong>{i.marca ?? '—'}</strong></div>
                      <div><span>N° de parte</span><strong>{i.numeroParte ?? '—'}</strong></div>
                      <div><span>Ubicación</span><strong>{i.ubicacion ?? '—'}</strong></div>
                      <div><span>Mín / Máx</span><strong>{i.stockMinimo ?? '—'} / {i.stockMaximo ?? '—'}</strong></div>
                      <div><span>Costo</span><strong>{i.costoPromedio ? money(i.costoPromedio) : '—'}</strong></div>
                    </div>

                    <div className="taller-acciones">
                      <button type="button" className="inline-button" disabled={busy}
                        onClick={() => setFicha({
                          id: i.id,
                          referencia: i.referencia ?? '', marca: i.marca ?? '',
                          parte: i.numeroParte ?? '', ubicacion: i.ubicacion ?? '',
                          maximo: i.stockMaximo ? String(i.stockMaximo) : '',
                          seguridad: '', costo: i.costoPromedio ? String(i.costoPromedio) : '',
                        })}>
                        ✎ Editar ficha
                      </button>
                      <button type="button" className="inline-button" disabled={busy}
                        onClick={() => setNuevaAplic({ insumoId: i.id, marca: '', modelo: '', equipo: '' })}>
                        + Aplica a…
                      </button>
                      <button type="button" className="inline-button" disabled={busy}
                        onClick={() => setNuevoProv({ insumoId: i.id, prov: '', ref: '', precio: '' })}>
                        + Proveedor
                      </button>
                      {!i.esRepuesto && (
                        <button type="button" className="inline-button" disabled={busy}
                          onClick={() => void marcarRepuesto(i.id, true)}>
                          Marcar como repuesto
                        </button>
                      )}
                    </div>

                    <p className="ins-res__lbl" style={{ marginTop: 12 }}>Aplica a</p>
                    {aplic.length === 0 ? (
                      <p className="muted-text" style={{ margin: 0 }}>Genérico — sirve para cualquier máquina.</p>
                    ) : (
                      aplic.map((a) => (
                        <div key={a.id} className="bod-stock__row">
                          <span className="bod-stock__nom">
                            {a.equipoCodigo ? `Máquina ${a.equipoCodigo}` : [a.marca, a.modelo].filter(Boolean).join(' ') || 'Sin detalle'}
                          </span>
                          <button type="button" className="inline-button" disabled={busy}
                            onClick={async () => {
                              setBusy(true)
                              try { await deleteAplicabilidad(a.id); setAplic(await loadAplicabilidad(i.id)) }
                              catch { setError('No se pudo') } finally { setBusy(false) }
                            }}>Quitar</button>
                        </div>
                      ))
                    )}

                    <p className="ins-res__lbl" style={{ marginTop: 12 }}>Proveedores</p>
                    {provs.length === 0 ? (
                      <p className="muted-text" style={{ margin: 0 }}>Sin proveedores vinculados.</p>
                    ) : (
                      provs.map((p) => (
                        <div key={p.id} className="bod-stock__row">
                          <span className="bod-stock__nom">
                            {p.proveedorNombre ?? p.proveedorId}
                            <small className="bod-stock__reparto">
                              {p.referenciaProveedor ? `ref. ${p.referenciaProveedor}` : 'sin referencia'}
                              {p.ultimaCompra ? ` · última compra ${p.ultimaCompra}` : ''}
                            </small>
                          </span>
                          <strong className="bod-stock__val">{p.precio ? money(p.precio) : '—'}</strong>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Ficha */}
      {ficha && (
        <div className="modal-overlay open" onClick={() => { if (!busy) setFicha(null) }}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 'min(460px, calc(100vw - 32px))' }}>
            <div className="labor-detail-header">
              <div><p className="eyebrow">Repuesto</p><h3>✎ Ficha</h3></div>
              <button type="button" className="modal-close-btn" onClick={() => setFicha(null)} disabled={busy}>&#x2715;</button>
            </div>
            <div className="flota-grid">
              <label>Referencia<input type="text" value={ficha.referencia} onChange={(e) => setFicha({ ...ficha, referencia: e.target.value })} disabled={busy} /></label>
              <label>Marca<input type="text" value={ficha.marca} onChange={(e) => setFicha({ ...ficha, marca: e.target.value })} disabled={busy} /></label>
              <label>N° de parte<input type="text" value={ficha.parte} onChange={(e) => setFicha({ ...ficha, parte: e.target.value })} disabled={busy} /></label>
              <label>Ubicación<input type="text" value={ficha.ubicacion} placeholder="Estante A-3" onChange={(e) => setFicha({ ...ficha, ubicacion: e.target.value })} disabled={busy} /></label>
              <label>Stock máximo<input type="number" min={0} step="any" value={ficha.maximo} onChange={(e) => setFicha({ ...ficha, maximo: e.target.value })} disabled={busy} /></label>
              <label>Costo unitario<input type="number" min={0} step="any" value={ficha.costo} onChange={(e) => setFicha({ ...ficha, costo: e.target.value })} disabled={busy} /></label>
            </div>
            <div className="modal-footer">
              <button type="button" className="inline-button" onClick={() => setFicha(null)} disabled={busy}>Cancelar</button>
              <button type="button" className="primary-button" onClick={() => void guardarFicha()} disabled={busy}>
                {busy ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Aplicabilidad */}
      {nuevaAplic && (
        <div className="modal-overlay open" onClick={() => { if (!busy) setNuevaAplic(null) }}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 'min(420px, calc(100vw - 32px))' }}>
            <div className="labor-detail-header">
              <div><p className="eyebrow">Repuesto</p><h3>Aplica a…</h3></div>
              <button type="button" className="modal-close-btn" onClick={() => setNuevaAplic(null)} disabled={busy}>&#x2715;</button>
            </div>
            <p className="subtle-copy" style={{ marginTop: 0 }}>
              Una máquina puntual, o toda una marca/modelo. Si no se especifica nada, el
              repuesto queda como genérico.
            </p>
            <label>Máquina
              <SearchableSelect value={nuevaAplic.equipo}
                onChange={(v) => setNuevaAplic({ ...nuevaAplic, equipo: v, marca: '', modelo: '' })}
                options={equipment.map((e) => ({ value: e.code, label: e.code, rightLabel: e.name }))}
                placeholder="Buscar máquina…" disabled={busy} />
            </label>
            <div className="flota-grid" style={{ marginTop: 8 }}>
              <label>Marca<input type="text" value={nuevaAplic.marca} onChange={(e) => setNuevaAplic({ ...nuevaAplic, marca: e.target.value, equipo: '' })} disabled={busy} /></label>
              <label>Modelo<input type="text" value={nuevaAplic.modelo} onChange={(e) => setNuevaAplic({ ...nuevaAplic, modelo: e.target.value, equipo: '' })} disabled={busy} /></label>
            </div>
            <div className="modal-footer">
              <button type="button" className="inline-button" onClick={() => setNuevaAplic(null)} disabled={busy}>Cancelar</button>
              <button type="button" className="primary-button" disabled={busy}
                onClick={async () => {
                  setBusy(true); setError('')
                  try {
                    await addAplicabilidad({
                      insumoId: nuevaAplic.insumoId,
                      marca: nuevaAplic.marca || undefined,
                      modelo: nuevaAplic.modelo || undefined,
                      equipoCodigo: nuevaAplic.equipo || undefined,
                    })
                    setAplic(await loadAplicabilidad(nuevaAplic.insumoId))
                    setNuevaAplic(null); setInfo('Guardado.')
                  } catch { setError('No se pudo guardar') } finally { setBusy(false) }
                }}>Agregar</button>
            </div>
          </div>
        </div>
      )}

      {/* Proveedor del repuesto */}
      {nuevoProv && (
        <div className="modal-overlay open" onClick={() => { if (!busy) setNuevoProv(null) }}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 'min(420px, calc(100vw - 32px))' }}>
            <div className="labor-detail-header">
              <div><p className="eyebrow">Repuesto</p><h3>+ Proveedor</h3></div>
              <button type="button" className="modal-close-btn" onClick={() => setNuevoProv(null)} disabled={busy}>&#x2715;</button>
            </div>
            <label>Proveedor <span style={{ color: '#b3261e' }}>*</span>
              <SearchableSelect value={nuevoProv.prov} onChange={(v) => setNuevoProv({ ...nuevoProv, prov: v })}
                options={proveedores.filter((p) => p.activo).map((p) => ({ value: p.id, label: p.nombre, rightLabel: p.tipo }))}
                placeholder="Buscar proveedor…" disabled={busy} />
            </label>
            <div className="flota-grid" style={{ marginTop: 8 }}>
              <label>Referencia del proveedor<input type="text" value={nuevoProv.ref} onChange={(e) => setNuevoProv({ ...nuevoProv, ref: e.target.value })} disabled={busy} /></label>
              <label>Precio<input type="number" min={0} step="any" value={nuevoProv.precio} onChange={(e) => setNuevoProv({ ...nuevoProv, precio: e.target.value })} disabled={busy} /></label>
            </div>
            <div className="modal-footer">
              <button type="button" className="inline-button" onClick={() => setNuevoProv(null)} disabled={busy}>Cancelar</button>
              <button type="button" className="primary-button" disabled={busy}
                onClick={async () => {
                  if (!nuevoProv.prov) { setError('Elige el proveedor.'); return }
                  setBusy(true); setError('')
                  try {
                    await saveInsumoProveedor({
                      insumoId: nuevoProv.insumoId, proveedorId: nuevoProv.prov,
                      referenciaProveedor: nuevoProv.ref || undefined,
                      precio: nuevoProv.precio ? Number(nuevoProv.precio) : undefined,
                    })
                    setProvs(await loadInsumoProveedores(nuevoProv.insumoId))
                    setNuevoProv(null); setInfo('Guardado.')
                  } catch { setError('No se pudo guardar') } finally { setBusy(false) }
                }}>Guardar</button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
