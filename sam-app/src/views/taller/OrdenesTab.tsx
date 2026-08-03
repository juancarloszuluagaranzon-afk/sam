import { useMemo, useState } from 'react'
import { useAppData } from '../../context/AppDataContext'
import { useTaller } from './TallerContext'
import {
  crearOrden, cerrarOrden, anularOrden, updateOrden,
  addRepuestoOt, deleteRepuestoOt,
} from '../../services/tallerApi'
import { SearchableSelect } from '../../components/SearchableSelect'
import { fmtFechaHora, fmtLapso } from '../../lib/fechas'
import { fmtCantidad } from '../../lib/cantidad'
import { OT_TIPO_LABEL, type OrdenTrabajo, type OtEstado, type OtTipo } from '../../domain/sam'
import { Ayuda } from '../../components/Ayuda'

/**
 * Órdenes de trabajo — la pieza central del taller.
 *
 * Sin OT no hay dónde colgar repuestos, mano de obra ni servicios externos, y
 * sobre todo no hay PARO: sin la hora en que la máquina dejó de producir y la
 * hora en que volvió, no se pueden calcular disponibilidad ni TMR. Por eso el
 * paro se pide al abrir y el arranque al cerrar.
 *
 * Los repuestos NO se descuentan al agregarlos sino al CERRAR: mientras la orden
 * está abierta uno todavía está armando la lista.
 */

const nf = (v: number, d = 1) => v.toLocaleString('es-CO', { minimumFractionDigits: d, maximumFractionDigits: d })
const money = (v: number) => `$${Math.round(v).toLocaleString('es-CO')}`

const ESTADOS: { key: OtEstado | 'TODAS'; label: string }[] = [
  { key: 'ABIERTA', label: 'Abiertas' },
  { key: 'EN_PROCESO', label: 'En proceso' },
  { key: 'CERRADA', label: 'Cerradas' },
  { key: 'TODAS', label: 'Todas' },
]

export function OrdenesTab() {
  const { equipment, insumos, session, busy, setBusy, setError, setInfo } = useAppData()
  const { ordenes, horasDe, bodegaTaller, proveedores, refrescar } = useTaller()

  const [filtro, setFiltro] = useState<OtEstado | 'TODAS'>('ABIERTA')
  const [nuevaOpen, setNuevaOpen] = useState(false)
  const [detalle, setDetalle] = useState<OrdenTrabajo | null>(null)

  // Nueva orden
  const [nEquipo, setNEquipo] = useState('')
  const [nTipo, setNTipo] = useState<OtTipo>('CORRECTIVO')
  const [nDesc, setNDesc] = useState('')
  const [nCausa, setNCausa] = useState('')
  const [nHorom, setNHorom] = useState('')
  const [nResp, setNResp] = useState('')
  const [nParada, setNParada] = useState(true)

  // Cierre
  const [cierre, setCierre] = useState<{ ot: OrdenTrabajo; trabajo: string; horom: string } | null>(null)
  // Agregar repuesto
  const [addRep, setAddRep] = useState<{ ot: OrdenTrabajo; insumo: string; cant: string; costo: string } | null>(null)
  // Costos de la OT
  const [costos, setCostos] = useState<{ ot: OrdenTrabajo; horas: string; valor: string; externo: string; prov: string } | null>(null)

  const equiposOrd = useMemo(
    () => [...equipment].sort((a, b) => a.code.localeCompare(b.code, 'es', { numeric: true })),
    [equipment],
  )
  const insumoInfo = useMemo(() => {
    const m = new Map<string, { nombre: string; unidad: string; costo: number }>()
    insumos.forEach((i) => m.set(i.id, { nombre: i.nombre, unidad: i.unidad, costo: i.costoPromedio ?? 0 }))
    return m
  }, [insumos])

  const lista = useMemo(
    () => (filtro === 'TODAS' ? ordenes : ordenes.filter((o) => o.estado === filtro)),
    [ordenes, filtro],
  )

  const costoDe = (o: OrdenTrabajo) =>
    o.repuestos.reduce((t, r) => t + r.cantidad * r.costoUnitario, 0) +
    o.horasMo * o.valorHoraMo + o.costoExterno

  function abrirNueva() {
    setNEquipo(''); setNTipo('CORRECTIVO'); setNDesc(''); setNCausa('')
    setNHorom(''); setNResp(session?.name ?? ''); setNParada(true)
    setError(''); setNuevaOpen(true)
  }

  async function guardarNueva() {
    if (!nEquipo) { setError('Elige la máquina.'); return }
    if (!nDesc.trim()) { setError('Describe qué hay que hacer.'); return }
    setBusy(true); setError('')
    try {
      await crearOrden({
        equipoCodigo: nEquipo,
        tipo: nTipo,
        descripcion: nDesc,
        causa: nCausa || undefined,
        horometro: nHorom ? Number(nHorom) : (horasDe.get(nEquipo) ?? undefined),
        // El paro arranca ahora si la máquina quedó fuera de servicio. Si no se
        // marca, la orden no descuenta disponibilidad (un cambio de aceite con
        // la máquina disponible no es una parada).
        paroEn: nParada ? new Date().toISOString() : undefined,
        responsable: nResp || undefined,
        creadoPor: session?.id,
        creadoNombre: session?.name,
      })
      setInfo('Orden creada.')
      setNuevaOpen(false)
      await refrescar()
    } catch (err) {
      setError(`No se pudo crear. (${(err as { message?: string })?.message ?? 'error'})`)
    } finally { setBusy(false) }
  }

  async function guardarCierre() {
    if (!cierre) return
    setBusy(true); setError('')
    try {
      await cerrarOrden({
        otId: cierre.ot.id,
        trabajoRealizado: cierre.trabajo || undefined,
        horometro: cierre.horom ? Number(cierre.horom) : undefined,
        cerradaPor: session?.id,
      })
      setInfo('Orden cerrada. Los repuestos salieron del inventario.')
      setCierre(null); setDetalle(null)
      await refrescar()
    } catch (err) {
      setError(`No se pudo cerrar. (${(err as { message?: string })?.message ?? 'error'})`)
    } finally { setBusy(false) }
  }

  async function guardarRepuesto() {
    if (!addRep) return
    const c = Number(addRep.cant)
    if (!addRep.insumo) { setError('Elige el repuesto.'); return }
    if (!c || c <= 0) { setError('Escribe la cantidad.'); return }
    setBusy(true); setError('')
    try {
      await addRepuestoOt({
        otId: addRep.ot.id,
        insumoId: addRep.insumo,
        bodegaId: bodegaTaller?.id,
        cantidad: c,
        costoUnitario: Number(addRep.costo) || 0,
      })
      setInfo('Repuesto agregado. Sale del inventario al cerrar la orden.')
      setAddRep(null)
      await refrescar()
      setDetalle(null)
    } catch (err) {
      setError(`No se pudo agregar. (${(err as { message?: string })?.message ?? 'error'})`)
    } finally { setBusy(false) }
  }

  async function guardarCostos() {
    if (!costos) return
    setBusy(true); setError('')
    try {
      await updateOrden(costos.ot.id, {
        horasMo: Number(costos.horas) || 0,
        valorHoraMo: Number(costos.valor) || 0,
        costoExterno: Number(costos.externo) || 0,
        proveedorExternoId: costos.prov || null,
      })
      setInfo('Costos guardados.')
      setCostos(null); setDetalle(null)
      await refrescar()
    } catch (err) {
      setError(`No se pudo guardar. (${(err as { message?: string })?.message ?? 'error'})`)
    } finally { setBusy(false) }
  }

  return (
    <section className="panel-card">
      <div className="bod-head">
        <h2 className="bod-head__title">🔧 Órdenes de trabajo</h2>
        <button type="button" className="primary-button bod-head__btn" onClick={abrirNueva} disabled={busy}>
          + Nueva orden
        </button>
      </div>
      <Ayuda>
        <p>Todo lo que se le hace a una máquina pasa por una orden. De aquí salen el costo
        de mantenimiento y los indicadores: sin la hora del paro y la del arranque no hay
        forma de medir disponibilidad ni tiempo de reparación.</p>
      </Ayuda>

      <div className="realizadas-seg" role="group" aria-label="Estado" style={{ marginTop: 10 }}>
        {ESTADOS.map((e) => (
          <button key={e.key} type="button"
            className={`realizadas-seg__btn ${filtro === e.key ? 'is-active' : ''}`}
            onClick={() => setFiltro(e.key)}>
            {e.label}
          </button>
        ))}
      </div>

      {lista.length === 0 ? (
        <p className="muted-text" style={{ marginTop: 12 }}>Sin órdenes en este filtro.</p>
      ) : (
        <div className="inv-list" style={{ marginTop: 12 }}>
          {lista.map((o) => (
            <button key={o.id} type="button" className="taller-ot" onClick={() => setDetalle(o)}>
              <div className="taller-ot__main">
                <div className="aval-row__top">
                  <strong>#{o.consecutivo}</strong>
                  <span className={`aval-tag aval-tag--${o.tipo === 'CORRECTIVO' ? 'vehiculo' : 'carro'}`}>
                    {OT_TIPO_LABEL[o.tipo]}
                  </span>
                  <span className="aval-tag aval-tag--origen">{o.equipoCodigo}</span>
                  {o.estado !== 'CERRADA' && <span className="aval-tag aval-tag--maquina">{o.estado.replace('_', ' ')}</span>}
                </div>
                <span className="subtle-copy">{o.descripcion}</span>
                <span className="subtle-copy">
                  {fmtFechaHora(o.createdAt)}
                  {o.horometro ? ` · ${nf(o.horometro)} h` : ''}
                  {o.responsable ? ` · ${o.responsable}` : ''}
                  {o.paroEn && o.arranqueEn ? ` · parada ${fmtLapso(o.paroEn, o.arranqueEn)}` : ''}
                  {o.paroEn && !o.arranqueEn ? ` · ⏱ parada hace ${fmtLapso(o.paroEn, new Date().toISOString())}` : ''}
                </span>
              </div>
              <strong className="bod-stock__val">{money(costoDe(o))}</strong>
            </button>
          ))}
        </div>
      )}

      {/* ── Nueva orden ── */}
      {nuevaOpen && (
        <div className="modal-overlay open" onClick={() => { if (!busy) setNuevaOpen(false) }}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 'min(460px, calc(100vw - 32px))' }}>
            <div className="labor-detail-header">
              <div><p className="eyebrow">Taller</p><h3>🔧 Nueva orden</h3></div>
              <button type="button" className="modal-close-btn" onClick={() => setNuevaOpen(false)} disabled={busy}>&#x2715;</button>
            </div>
            <div className="flota-grid">
              <label>Máquina <span style={{ color: '#b3261e' }}>*</span>
                <SearchableSelect value={nEquipo} onChange={setNEquipo}
                  options={equiposOrd.map((e) => ({ value: e.code, label: e.code, rightLabel: e.name }))}
                  placeholder="Buscar máquina…" disabled={busy} />
              </label>
              <label>Tipo
                <SearchableSelect value={nTipo} onChange={(v) => setNTipo(v as OtTipo)}
                  options={(['CORRECTIVO', 'PREVENTIVO', 'MEJORA'] as OtTipo[]).map((t) => ({ value: t, label: OT_TIPO_LABEL[t] }))}
                  disabled={busy} />
              </label>
              <label>Horómetro
                <input type="number" min={0} step="any" value={nHorom}
                  placeholder={nEquipo ? String(horasDe.get(nEquipo) ?? '') : ''}
                  onChange={(e) => setNHorom(e.target.value)} disabled={busy} />
              </label>
              <label>Responsable
                <input type="text" value={nResp} onChange={(e) => setNResp(e.target.value)} disabled={busy} />
              </label>
            </div>
            <label style={{ marginTop: 8 }}>¿Qué hay que hacer? <span style={{ color: '#b3261e' }}>*</span>
              <input type="text" value={nDesc} onChange={(e) => setNDesc(e.target.value)} disabled={busy} />
            </label>
            <label style={{ marginTop: 8 }}>Causa <span className="field-optional">(opcional)</span>
              <input type="text" value={nCausa} onChange={(e) => setNCausa(e.target.value)} disabled={busy} />
            </label>

            <label className="taller-check" style={{ marginTop: 10 }}>
              <input type="checkbox" checked={nParada} onChange={(e) => setNParada(e.target.checked)} disabled={busy} />
              <span>
                <strong>La máquina queda parada</strong>
                <small>Arranca el reloj de la parada desde ahora. Si se le hace mantenimiento
                  sin sacarla de servicio, desmárcalo: no debe descontar disponibilidad.</small>
              </span>
            </label>

            <div className="modal-footer">
              <button type="button" className="inline-button" onClick={() => setNuevaOpen(false)} disabled={busy}>Cancelar</button>
              <button type="button" className="primary-button" onClick={() => void guardarNueva()} disabled={busy}>
                {busy ? 'Guardando…' : 'Crear orden'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Detalle de la orden ── */}
      {detalle && (
        <div className="modal-overlay open" onClick={() => { if (!busy) setDetalle(null) }}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 'min(520px, calc(100vw - 32px))' }}>
            <div className="labor-detail-header">
              <div>
                <p className="eyebrow">{detalle.equipoCodigo} · {OT_TIPO_LABEL[detalle.tipo]}</p>
                <h3>Orden #{detalle.consecutivo}</h3>
              </div>
              <button type="button" className="modal-close-btn" onClick={() => setDetalle(null)} disabled={busy}>&#x2715;</button>
            </div>

            <p style={{ marginTop: 0 }}>{detalle.descripcion}</p>
            {detalle.causa && <p className="subtle-copy">Causa: {detalle.causa}</p>}
            {detalle.trabajoRealizado && <p className="subtle-copy">Se hizo: {detalle.trabajoRealizado}</p>}

            <div className="taller-ficha">
              <div><span>Estado</span><strong>{detalle.estado.replace('_', ' ')}</strong></div>
              <div><span>Abierta</span><strong>{fmtFechaHora(detalle.createdAt)}</strong></div>
              <div><span>Paro</span><strong>{detalle.paroEn ? fmtFechaHora(detalle.paroEn) : 'no paró'}</strong></div>
              <div><span>Arranque</span><strong>{detalle.arranqueEn ? fmtFechaHora(detalle.arranqueEn) : '—'}</strong></div>
            </div>

            <p className="ins-res__lbl" style={{ marginTop: 12 }}>Repuestos</p>
            {detalle.repuestos.length === 0 ? (
              <p className="muted-text" style={{ margin: 0 }}>Sin repuestos.</p>
            ) : (
              detalle.repuestos.map((r) => {
                const info = insumoInfo.get(r.insumoId)
                return (
                  <div key={r.id} className="bod-stock__row">
                    <span className="bod-stock__nom">
                      {info?.nombre ?? r.insumoId}
                      <small className="bod-stock__reparto">
                        {fmtCantidad(r.cantidad, info?.unidad)} {info?.unidad ?? ''} × {money(r.costoUnitario)}
                        {r.descargado ? ' · ✔ descargado' : ' · pendiente de descargar'}
                      </small>
                    </span>
                    <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <strong className="bod-stock__val">{money(r.cantidad * r.costoUnitario)}</strong>
                      {!r.descargado && detalle.estado !== 'CERRADA' && (
                        <button type="button" className="inline-button" disabled={busy}
                          onClick={async () => {
                            setBusy(true)
                            try { await deleteRepuestoOt(r.id!); await refrescar(); setDetalle(null) }
                            catch { setError('No se pudo quitar') } finally { setBusy(false) }
                          }}>Quitar</button>
                      )}
                    </span>
                  </div>
                )
              })
            )}

            <div className="taller-ficha" style={{ marginTop: 12 }}>
              <div><span>Mano de obra</span><strong>{money(detalle.horasMo * detalle.valorHoraMo)}</strong></div>
              <div><span>Servicios externos</span><strong>{money(detalle.costoExterno)}</strong></div>
              <div><span>Repuestos</span><strong>{money(detalle.repuestos.reduce((t, r) => t + r.cantidad * r.costoUnitario, 0))}</strong></div>
              <div><span>Total</span><strong>{money(costoDe(detalle))}</strong></div>
            </div>

            {detalle.estado !== 'CERRADA' && detalle.estado !== 'ANULADA' && (
              <div className="taller-acciones" style={{ marginTop: 12 }}>
                <button type="button" className="inline-button" disabled={busy}
                  onClick={() => setAddRep({ ot: detalle, insumo: '', cant: '', costo: '' })}>
                  + Repuesto
                </button>
                <button type="button" className="inline-button" disabled={busy}
                  onClick={() => setCostos({
                    ot: detalle,
                    horas: String(detalle.horasMo || ''),
                    valor: String(detalle.valorHoraMo || ''),
                    externo: String(detalle.costoExterno || ''),
                    prov: detalle.proveedorExternoId ?? '',
                  })}>
                  💵 Mano de obra y externos
                </button>
                <button type="button" className="inline-button" disabled={busy}
                  onClick={async () => {
                    setBusy(true)
                    try { await anularOrden(detalle.id); await refrescar(); setDetalle(null); setInfo('Orden anulada.') }
                    catch { setError('No se pudo anular') } finally { setBusy(false) }
                  }}>
                  Anular
                </button>
                <button type="button" className="primary-button aval-btn" disabled={busy}
                  onClick={() => setCierre({
                    ot: detalle, trabajo: detalle.trabajoRealizado ?? '',
                    horom: String(detalle.horometro ?? horasDe.get(detalle.equipoCodigo) ?? ''),
                  })}>
                  ✔ Cerrar orden
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Cerrar ── */}
      {cierre && (
        <div className="modal-overlay open" onClick={() => { if (!busy) setCierre(null) }}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 'min(420px, calc(100vw - 32px))' }}>
            <div className="labor-detail-header">
              <div><p className="eyebrow">Orden #{cierre.ot.consecutivo}</p><h3>✔ Cerrar</h3></div>
              <button type="button" className="modal-close-btn" onClick={() => setCierre(null)} disabled={busy}>&#x2715;</button>
            </div>
            <p className="subtle-copy" style={{ marginTop: 0 }}>
              Al cerrar, los {cierre.ot.repuestos.filter((r) => !r.descargado).length} repuesto(s)
              pendientes salen del inventario y la máquina queda disponible.
            </p>
            <label>¿Qué se hizo?
              <input type="text" value={cierre.trabajo} onChange={(e) => setCierre({ ...cierre, trabajo: e.target.value })} disabled={busy} />
            </label>
            <label style={{ marginTop: 8 }}>Horómetro al cerrar
              <input type="number" min={0} step="any" value={cierre.horom}
                onChange={(e) => setCierre({ ...cierre, horom: e.target.value })} disabled={busy} />
            </label>
            <div className="modal-footer">
              <button type="button" className="inline-button" onClick={() => setCierre(null)} disabled={busy}>Cancelar</button>
              <button type="button" className="primary-button" onClick={() => void guardarCierre()} disabled={busy}>
                {busy ? 'Cerrando…' : 'Cerrar orden'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Agregar repuesto ── */}
      {addRep && (
        <div className="modal-overlay open" onClick={() => { if (!busy) setAddRep(null) }}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 'min(420px, calc(100vw - 32px))' }}>
            <div className="labor-detail-header">
              <div><p className="eyebrow">Orden #{addRep.ot.consecutivo}</p><h3>+ Repuesto</h3></div>
              <button type="button" className="modal-close-btn" onClick={() => setAddRep(null)} disabled={busy}>&#x2715;</button>
            </div>
            <label>Repuesto <span style={{ color: '#b3261e' }}>*</span>
              <SearchableSelect
                value={addRep.insumo}
                onChange={(v) => {
                  const c = insumoInfo.get(v)?.costo ?? 0
                  setAddRep({ ...addRep, insumo: v, costo: c ? String(c) : addRep.costo })
                }}
                options={insumos.filter((i) => i.activo).map((i) => ({
                  value: i.id, label: i.nombre, rightLabel: i.unidad, frecuente: i.frecuente,
                }))}
                placeholder="Buscar repuesto…" disabled={busy} />
            </label>
            <div className="flota-grid" style={{ marginTop: 8 }}>
              <label>Cantidad <span style={{ color: '#b3261e' }}>*</span>
                <input type="number" min={0} step="any" value={addRep.cant}
                  onChange={(e) => setAddRep({ ...addRep, cant: e.target.value })} disabled={busy} />
              </label>
              <label>Costo unitario
                <input type="number" min={0} step="any" value={addRep.costo}
                  onChange={(e) => setAddRep({ ...addRep, costo: e.target.value })} disabled={busy} />
              </label>
            </div>
            <div className="modal-footer">
              <button type="button" className="inline-button" onClick={() => setAddRep(null)} disabled={busy}>Cancelar</button>
              <button type="button" className="primary-button" onClick={() => void guardarRepuesto()} disabled={busy}>
                {busy ? 'Guardando…' : 'Agregar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Mano de obra y externos ── */}
      {costos && (
        <div className="modal-overlay open" onClick={() => { if (!busy) setCostos(null) }}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 'min(420px, calc(100vw - 32px))' }}>
            <div className="labor-detail-header">
              <div><p className="eyebrow">Orden #{costos.ot.consecutivo}</p><h3>💵 Costos</h3></div>
              <button type="button" className="modal-close-btn" onClick={() => setCostos(null)} disabled={busy}>&#x2715;</button>
            </div>
            <div className="flota-grid">
              <label>Horas de mano de obra
                <input type="number" min={0} step="any" value={costos.horas}
                  onChange={(e) => setCostos({ ...costos, horas: e.target.value })} disabled={busy} />
              </label>
              <label>Valor por hora
                <input type="number" min={0} step="any" value={costos.valor}
                  onChange={(e) => setCostos({ ...costos, valor: e.target.value })} disabled={busy} />
              </label>
              <label>Servicio externo
                <input type="number" min={0} step="any" value={costos.externo}
                  onChange={(e) => setCostos({ ...costos, externo: e.target.value })} disabled={busy} />
              </label>
              <label>Proveedor del servicio
                <SearchableSelect value={costos.prov} onChange={(v) => setCostos({ ...costos, prov: v })}
                  options={proveedores.filter((p) => p.activo).map((p) => ({ value: p.id, label: p.nombre, rightLabel: p.tipo }))}
                  placeholder="Buscar proveedor…" disabled={busy} />
              </label>
            </div>
            <div className="modal-footer">
              <button type="button" className="inline-button" onClick={() => setCostos(null)} disabled={busy}>Cancelar</button>
              <button type="button" className="primary-button" onClick={() => void guardarCostos()} disabled={busy}>
                {busy ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
