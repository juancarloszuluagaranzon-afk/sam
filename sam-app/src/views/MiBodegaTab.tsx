import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { useAppData } from '../context/AppDataContext'
import {
  bodegaDeResponsable, loadStockBodega, loadTraslados, confirmarTraslado,
  registrarCombustibleExterno, uploadEvidencia,
} from '../services/samApi'
import type { Bodega, StockBodega, Traslado } from '../domain/sam'

/**
 * "Mi bodega" — vista del supervisor de insumos sobre SU satélite (su vehículo):
 *  · Stock actual de su carro.
 *  · Traslados EN TRÁNSITO de la principal → los confirma (aval) rectificando
 *    cantidades si recibió menos; la diferencia regresa a la principal.
 *  · Carga en estación de servicio: llena el TANQUE DE DISTRIBUCIÓN que lleva
 *    el vehículo → ENTRA a su bodega (con tirilla). NO es el combustible que
 *    consume el vehículo para andar (eso se maneja fuera del app).
 */
function fmtFecha(iso: string): string {
  if (!iso) return ''
  return new Date(iso).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}
function hoyISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function MiBodegaTab() {
  const { session, insumos, busy, setBusy, setError, setInfo } = useAppData()

  const [bodega, setBodega] = useState<Bodega | null>(null)
  const [stock, setStock] = useState<StockBodega[]>([])
  const [pendientes, setPendientes] = useState<Traslado[]>([])
  const [cargando, setCargando] = useState(true)

  // Recepción de traslado
  const [recibir, setRecibir] = useState<Traslado | null>(null)
  const [cantRecibida, setCantRecibida] = useState<Record<string, string>>({})
  const [notaRecepcion, setNotaRecepcion] = useState('')

  // Tanqueo del carro en bomba
  const [tanqueoOpen, setTanqueoOpen] = useState(false)
  const [tFecha, setTFecha] = useState(hoyISO())
  const [tInsumo, setTInsumo] = useState('')
  const [tGalones, setTGalones] = useState('')
  const [tValor, setTValor] = useState('')
  const [tEstacion, setTEstacion] = useState('')
  const [tFactura, setTFactura] = useState('')
  const [tTirilla, setTTirilla] = useState('')
  const [subiendo, setSubiendo] = useState(false)
  const tirillaRef = useRef<HTMLInputElement>(null)

  const combustibles = useMemo(
    () => insumos.filter((i) => i.activo && i.categoria === 'COMBUSTIBLE'),
    [insumos],
  )

  async function refresh() {
    if (!session) return
    setCargando(true)
    try {
      const b = await bodegaDeResponsable(session.id)
      setBodega(b)
      if (b) {
        const [st, trs] = await Promise.all([
          loadStockBodega(b.id),
          loadTraslados({ destinoId: b.id, estados: ['EN_TRANSITO'] }),
        ])
        setStock(st)
        setPendientes(trs)
      }
    } finally { setCargando(false) }
  }
  useEffect(() => { void refresh() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [session?.id])

  const stockVista = useMemo(() => {
    return stock
      .filter((s) => s.stock !== 0)
      .map((s) => ({ ...s, insumo: insumos.find((i) => i.id === s.insumoId) }))
      .filter((s) => s.insumo)
      .sort((a, b) => a.insumo!.nombre.localeCompare(b.insumo!.nombre, 'es', { sensitivity: 'base' }))
  }, [stock, insumos])

  function abrirRecibir(t: Traslado) {
    setRecibir(t)
    const init: Record<string, string> = {}
    t.items.forEach((it) => { init[it.id ?? ''] = String(it.cantidad) })
    setCantRecibida(init)
    setNotaRecepcion('')
    setError('')
  }

  async function confirmarRecibo(conforme: boolean) {
    if (!recibir || !bodega) return
    const items = recibir.items.map((it) => ({
      itemId: it.id,
      insumoId: it.insumoId,
      cantidadEnviada: it.cantidad,
      cantidadRecibida: conforme ? it.cantidad : Math.max(0, Math.min(Number(cantRecibida[it.id ?? ''] ?? it.cantidad) || 0, it.cantidad)),
    }))
    if (!conforme && items.every((it) => it.cantidadRecibida >= it.cantidadEnviada)) {
      setError('Si recibiste todo, usa "Recibí todo". Si no, baja la cantidad de lo que faltó.')
      return
    }
    setBusy(true); setError('')
    try {
      await confirmarTraslado({
        trasladoId: recibir.id,
        origenId: recibir.origenId,
        destinoId: bodega.id,
        recibidoPor: session!.id,
        conforme,
        nota: notaRecepcion.trim() || undefined,
        items,
      })
      setInfo(conforme ? 'Recepción confirmada. El material ya está en tu bodega.' : 'Diferencia reportada. Lo que faltó regresó a la principal.')
      setRecibir(null)
      void refresh()
    } catch (err) {
      const e = err as { message?: string }
      setError(`No se pudo confirmar. (${e?.message ?? 'error'})`)
    } finally { setBusy(false) }
  }

  async function onTirilla(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setSubiendo(true); setError('')
    try {
      setTTirilla(await uploadEvidencia(`tanqueo-${session?.id ?? 'x'}-${Date.now()}`, file, 0))
    } catch {
      setError('No se pudo subir la tirilla.')
    } finally { setSubiendo(false) }
  }

  async function guardarTanqueo() {
    if (!bodega) return
    const gal = Number(tGalones)
    if (!tInsumo) { setError('Elige el combustible.'); return }
    if (!gal || gal <= 0) { setError('Escribe cuántos galones te tanquearon.'); return }
    setBusy(true); setError('')
    try {
      await registrarCombustibleExterno({
        fecha: tFecha,
        destino: 'CARRO',
        bodegaId: bodega.id,
        insumoId: tInsumo,
        galones: gal,
        valor: Number(tValor) || 0,
        estacion: tEstacion.trim() || undefined,
        factura: tFactura.trim() || undefined,
        tirillaUrl: tTirilla || undefined,
        registradoPor: session?.id,
        registradoNombre: session?.name,
      })
      setInfo(`Carga registrada: +${gal} galones entraron a tu bodega.`)
      setTanqueoOpen(false)
      setTGalones(''); setTValor(''); setTEstacion(''); setTFactura(''); setTTirilla('')
      void refresh()
    } catch (err) {
      const e = err as { message?: string }
      setError(`No se pudo registrar. (${e?.message ?? 'error'})`)
    } finally { setBusy(false) }
  }

  if (cargando) return <section className="panel-card"><p className="muted-text">Cargando…</p></section>

  if (!bodega) {
    return (
      <section className="panel-card">
        <h2>Mi bodega</h2>
        <p className="subtle-copy">
          Todavía no tienes una bodega satélite asignada. Administración la crea en
          <strong> Bodegas → Nueva bodega satélite</strong> y te pone como responsable.
        </p>
      </section>
    )
  }

  return (
    <section className="panel-card">
      <div className="bod-head">
        <h2 className="bod-head__title">🚚 {bodega.nombre}</h2>
        <button type="button" className="primary-button bod-head__btn" onClick={() => setTanqueoOpen(true)} disabled={busy}>
          ⛽ Cargar en estación
        </button>
      </div>
      <p className="subtle-copy" style={{ marginTop: 0 }}>
        Lo que tienes cargado en tu vehículo. De aquí sale lo que entregas a los operarios.
      </p>

      {/* Traslados por confirmar */}
      {pendientes.length > 0 && (
        <div className="bod-aviso">
          <p className="bod-aviso__lbl">📦 Te enviaron material <span className="field-optional">(confirma lo que recibiste)</span></p>
          {pendientes.map((t) => (
            <div key={t.id} className="bod-aviso__row">
              <div className="bod-aviso__info">
                <strong>{t.items.map((i) => `${i.cantidad} ${i.unidad} ${i.insumoNombre}`).join(', ')}</strong>
                <span className="subtle-copy">{fmtFecha(t.createdAt)}{t.nota ? ` · ${t.nota}` : ''}</span>
              </div>
              <button type="button" className="primary-button bod-aviso__btn" onClick={() => abrirRecibir(t)} disabled={busy}>
                Revisar y recibir
              </button>
            </div>
          ))}
        </div>
      )}

      {stockVista.length === 0 ? (
        <p className="muted-text" style={{ marginTop: 12 }}>Tu carro está vacío. Pide que te surtan desde la bodega principal.</p>
      ) : (
        <div className="inv-list" style={{ marginTop: 12 }}>
          {stockVista.map((s) => (
            <div key={s.insumoId} className="inv-row">
              <div className="inv-row__main">
                <strong>{s.insumo!.nombre}</strong>
                <span className={`inv-cat ${s.insumo!.categoria === 'COMBUSTIBLE' ? 'inv-cat--comb' : 'inv-cat--mat'}`}>
                  {s.insumo!.categoria === 'COMBUSTIBLE' ? '⛽ Combustible' : '🔩 Material'}
                </span>
              </div>
              <div className={`inv-stock${s.stock <= 0 ? ' inv-stock--zero' : ''}`}>{s.stock} <small>{s.insumo!.unidad}</small></div>
            </div>
          ))}
        </div>
      )}

      {/* Modal: recibir traslado */}
      {recibir && (
        <div className="modal-overlay open" onClick={() => { if (!busy) setRecibir(null) }}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 'min(460px, calc(100vw - 32px))' }}>
            <div className="labor-detail-header">
              <div><p className="eyebrow">Traslado</p><h3>📦 ¿Recibiste esto?</h3></div>
              <button type="button" className="modal-close-btn" onClick={() => setRecibir(null)} disabled={busy} aria-label="Cerrar">&#x2715;</button>
            </div>
            <p className="subtle-copy" style={{ marginTop: 0 }}>
              Si algo llegó incompleto, baja la cantidad: la diferencia regresa a la bodega principal.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
              {recibir.items.map((it) => (
                <div key={it.id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ flex: 1, minWidth: 0 }}>{it.insumoNombre}</span>
                  <input
                    type="number" min={0} max={it.cantidad} step="any"
                    value={cantRecibida[it.id ?? ''] ?? String(it.cantidad)}
                    onChange={(e) => setCantRecibida((p) => ({ ...p, [it.id ?? '']: e.target.value }))}
                    disabled={busy} style={{ width: 84 }}
                  />
                  <span className="subtle-copy" style={{ width: 78, fontSize: '0.78rem' }}>de {it.cantidad} {it.unidad}</span>
                </div>
              ))}
            </div>
            <label style={{ marginTop: 10 }}>Nota <span className="field-optional">(opcional)</span>
              <input type="text" value={notaRecepcion} onChange={(e) => setNotaRecepcion(e.target.value)} disabled={busy} />
            </label>
            <div className="modal-footer" style={{ flexWrap: 'wrap', gap: 8 }}>
              <button type="button" className="inline-button" onClick={() => void confirmarRecibo(false)} disabled={busy}>Faltó algo</button>
              <button type="button" className="primary-button" onClick={() => void confirmarRecibo(true)} disabled={busy}>
                {busy ? 'Guardando…' : '✔ Recibí todo'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: tanqueo del carro en bomba externa */}
      {tanqueoOpen && (
        <div className="modal-overlay open" onClick={() => { if (!busy && !subiendo) setTanqueoOpen(false) }}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 'min(440px, calc(100vw - 32px))' }}>
            <div className="labor-detail-header">
              <div><p className="eyebrow">Estación de servicio</p><h3>⛽ Cargar mi bodega</h3></div>
              <button type="button" className="modal-close-btn" onClick={() => setTanqueoOpen(false)} disabled={busy} aria-label="Cerrar">&#x2715;</button>
            </div>
            <p className="subtle-copy" style={{ marginTop: 0 }}>
              Combustible que cargas en la estación <strong>al tanque de distribución</strong>: entra a tu
              bodega y queda disponible para entregar a las máquinas. <em>No es el combustible del vehículo.</em>
            </p>
            <div className="flota-grid">
              <label>Fecha<input type="date" value={tFecha} onChange={(e) => setTFecha(e.target.value)} disabled={busy} /></label>
              <label>Combustible
                <select value={tInsumo} onChange={(e) => setTInsumo(e.target.value)} disabled={busy}>
                  <option value="">Elegir…</option>
                  {combustibles.map((i) => <option key={i.id} value={i.id}>{i.nombre}</option>)}
                </select>
              </label>
              <label>Galones cargados <span style={{ color: '#b3261e' }}>*</span>
                <input type="number" min={0} step="any" value={tGalones} onChange={(e) => setTGalones(e.target.value)} disabled={busy} />
              </label>
              <label>Valor <span className="field-optional">(opcional)</span>
                <input type="number" min={0} step="any" value={tValor} onChange={(e) => setTValor(e.target.value)} disabled={busy} />
              </label>
              <label>Estación<input type="text" value={tEstacion} onChange={(e) => setTEstacion(e.target.value)} disabled={busy} /></label>
              <label>N° tirilla / factura<input type="text" value={tFactura} onChange={(e) => setTFactura(e.target.value)} disabled={busy} /></label>
            </div>

            <div className="flota-comprobante" style={{ marginTop: 10 }}>
              <span className="flota-comprobante__lbl">📷 Foto de la tirilla</span>
              <div className="flota-foto-row">
                {tTirilla && <img src={tTirilla} alt="tirilla" className="flota-foto-thumb" />}
                <button type="button" className="inline-button" onClick={() => tirillaRef.current?.click()} disabled={busy || subiendo}>
                  {subiendo ? 'Subiendo…' : tTirilla ? 'Cambiar foto' : '📷 Tomar foto'}
                </button>
                <input ref={tirillaRef} type="file" accept="image/*" capture="environment" hidden onChange={onTirilla} />
              </div>
            </div>

            <div className="modal-footer">
              <button type="button" className="inline-button" onClick={() => setTanqueoOpen(false)} disabled={busy}>Cancelar</button>
              <button type="button" className="primary-button" onClick={() => void guardarTanqueo()} disabled={busy || subiendo}>
                {busy ? 'Guardando…' : 'Cargar a mi bodega'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

export default MiBodegaTab
