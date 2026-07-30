import { useEffect, useMemo, useState } from 'react'
import { useAppData } from '../../context/AppDataContext'
import { useTaller } from './TallerContext'
import {
  updateRepuestoFicha, loadAplicabilidad, addAplicabilidad, deleteAplicabilidad,
  loadInsumoProveedores, saveInsumoProveedor, loadFamilias, siguienteCodigo,
  type Familia,
} from '../../services/tallerApi'
import { lineaPedidoTexto, faltantesParaPedir, copiar } from '../../lib/pedidoTexto'
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
    id: string; codigo: string; familia: string; descripcion: string
    referencia: string; marca: string; parte: string
    ubicacion: string; maximo: string; seguridad: string; costo: string
  } | null>(null)
  const [nuevaAplic, setNuevaAplic] = useState<{ insumoId: string; marca: string; modelo: string; equipo: string } | null>(null)
  const [nuevoProv, setNuevoProv] = useState<{ insumoId: string; prov: string; ref: string; precio: string } | null>(null)
  const [familias, setFamilias] = useState<Familia[]>([])
  // Cuantas unidades pedir, para armar el texto del pedido.
  const [pedir, setPedir] = useState<{ insumoId: string; cant: string } | null>(null)

  useEffect(() => { void loadFamilias().then(setFamilias) }, [])

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
      .filter((i) => !t || [i.codigo, i.nombre, i.referencia, i.marca, i.numeroParte, i.descripcion]
        .filter(Boolean).some((v) => String(v).toUpperCase().includes(t)))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }))
  }, [insumos, q, soloRepuestos])

  async function guardarFicha() {
    if (!ficha) return
    setBusy(true); setError('')
    try {
      await updateRepuestoFicha(ficha.id, {
        codigo: ficha.codigo,
        familia: ficha.familia,
        descripcion: ficha.descripcion,
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

      <label style={{ marginTop: 10 }}>Buscar por código, nombre, referencia, marca o N° de parte
        <input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="ROD-0002, rodamiento, 30206…" />
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
                    {i.codigo && <span className="rep-codigo">{i.codigo}</span>}
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
                      <div><span>Código propio</span><strong>{i.codigo ?? '—'}</strong></div>
                      <div><span>Referencia fabricante</span><strong>{i.referencia ?? '—'}</strong></div>
                      <div><span>Marca</span><strong>{i.marca ?? '—'}</strong></div>
                      <div><span>N° de parte</span><strong>{i.numeroParte ?? '—'}</strong></div>
                      <div><span>Ubicación</span><strong>{i.ubicacion ?? '—'}</strong></div>
                      <div><span>Mín / Máx</span><strong>{i.stockMinimo ?? '—'} / {i.stockMaximo ?? '—'}</strong></div>
                      <div><span>Costo</span><strong>{i.costoPromedio ? money(i.costoPromedio) : '—'}</strong></div>
                    </div>
                    {i.descripcion && <p className="subtle-copy" style={{ marginTop: 8 }}>{i.descripcion}</p>}

                    {/* Lo que le falta para que el proveedor lo entienda sin
                        preguntar. Mejor avisar antes de mandar el pedido que
                        despues de recibir "cual de todos?". */}
                    {faltantesParaPedir(i, aplic).length > 0 && (
                      <div className="taller-aviso taller-aviso--warn" style={{ marginTop: 8 }}>
                        <strong>⚠ Al proveedor le faltaría saber</strong>
                        <span>{faltantesParaPedir(i, aplic).join(' · ')}. Sin eso toca adivinar cuál es.</span>
                      </div>
                    )}

                    <div className="taller-acciones">
                      <button type="button" className="inline-button" disabled={busy}
                        onClick={() => setFicha({
                          id: i.id,
                          codigo: i.codigo ?? '', familia: i.familia ?? '', descripcion: i.descripcion ?? '',
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
                      <button type="button" className="inline-button" disabled={busy}
                        onClick={() => setPedir({ insumoId: i.id, cant: '1' })}>
                        📋 Copiar para pedir
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
            <p className="subtle-copy" style={{ marginTop: 0 }}>
              El <strong>código propio</strong> es interno: sirve para que aquí todos hablen del
              mismo ítem. Lo que el proveedor entiende es la <strong>referencia del fabricante</strong>,
              la marca y para qué máquina es.
            </p>
            <div className="flota-grid">
              <label>Familia
                <SearchableSelect value={ficha.familia}
                  onChange={async (v) => {
                    // Al cambiar de familia se propone el consecutivo de esa
                    // familia; solo si el codigo esta vacio o es de otra.
                    const proponer = !ficha.codigo || !ficha.codigo.startsWith(v)
                    const cod = proponer ? await siguienteCodigo(v).catch(() => ficha.codigo) : ficha.codigo
                    setFicha({ ...ficha, familia: v, codigo: cod })
                  }}
                  options={familias.map((f) => ({ value: f.codigo, label: `${f.codigo} · ${f.nombre}` }))}
                  placeholder="Buscar familia…" disabled={busy} />
              </label>
              <label>Código propio
                <input type="text" value={ficha.codigo} placeholder="ROD-0005"
                  onChange={(e) => setFicha({ ...ficha, codigo: e.target.value.toUpperCase() })} disabled={busy} />
              </label>
              <label>Referencia<input type="text" value={ficha.referencia} onChange={(e) => setFicha({ ...ficha, referencia: e.target.value })} disabled={busy} /></label>
              <label>Marca<input type="text" value={ficha.marca} onChange={(e) => setFicha({ ...ficha, marca: e.target.value })} disabled={busy} /></label>
              <label>N° de parte<input type="text" value={ficha.parte} onChange={(e) => setFicha({ ...ficha, parte: e.target.value })} disabled={busy} /></label>
              <label>Ubicación<input type="text" value={ficha.ubicacion} placeholder="Estante A-3" onChange={(e) => setFicha({ ...ficha, ubicacion: e.target.value })} disabled={busy} /></label>
              <label>Stock máximo<input type="number" min={0} step="any" value={ficha.maximo} onChange={(e) => setFicha({ ...ficha, maximo: e.target.value })} disabled={busy} /></label>
              <label>Costo unitario<input type="number" min={0} step="any" value={ficha.costo} onChange={(e) => setFicha({ ...ficha, costo: e.target.value })} disabled={busy} /></label>
            </div>
            <label style={{ marginTop: 8 }}>Descripción para el proveedor <span className="field-optional">(medidas, especificación…)</span>
              <input type="text" value={ficha.descripcion} placeholder="Cónico, 30x62x17,25 mm"
                onChange={(e) => setFicha({ ...ficha, descripcion: e.target.value })} disabled={busy} />
            </label>
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

      {/* Texto del pedido, listo para mandar */}
      {pedir && (() => {
        const ins = insumos.find((x) => x.id === pedir.insumoId)
        if (!ins) return null
        const prov = provs.find((p) => p.preferido) ?? provs[0]
        const texto = lineaPedidoTexto({
          insumo: ins,
          cantidad: Number(pedir.cant) || 1,
          aplica: aplic,
          referenciaProveedor: prov?.referenciaProveedor,
        })
        return (
          <div className="modal-overlay open" onClick={() => { if (!busy) setPedir(null) }}>
            <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 'min(460px, calc(100vw - 32px))' }}>
              <div className="labor-detail-header">
                <div><p className="eyebrow">{ins.codigo ?? 'Repuesto'}</p><h3>📋 Pedir al proveedor</h3></div>
                <button type="button" className="modal-close-btn" onClick={() => setPedir(null)} disabled={busy}>&#x2715;</button>
              </div>
              <label>Cantidad
                <input type="number" min={1} step="any" value={pedir.cant} autoFocus
                  onChange={(e) => setPedir({ ...pedir, cant: e.target.value })} disabled={busy} />
              </label>
              <p className="ins-res__lbl" style={{ marginTop: 10 }}>Así le llega al proveedor</p>
              <pre className="rep-pedido">{texto}</pre>
              <div className="modal-footer">
                <button type="button" className="inline-button" onClick={() => setPedir(null)} disabled={busy}>Cerrar</button>
                <button type="button" className="primary-button" disabled={busy}
                  onClick={async () => {
                    const ok = await copiar(texto)
                    setInfo(ok ? 'Copiado. Pégalo en el WhatsApp o el correo del proveedor.' : 'No se pudo copiar; selecciónalo a mano.')
                    if (ok) setPedir(null)
                  }}>Copiar</button>
              </div>
            </div>
          </div>
        )
      })()}

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
