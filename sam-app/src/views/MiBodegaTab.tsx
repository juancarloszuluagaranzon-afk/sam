import { useEffect, useMemo, useState } from 'react'
import { useAppData } from '../context/AppDataContext'
import { bodegaDeResponsable, loadStockBodega, loadTraslados, confirmarTraslado, autoAbastecer } from '../services/samApi'
import type { Bodega, StockBodega, Traslado } from '../domain/sam'
import { TanqueoModal } from '../components/TanqueoModal'
import { enviarOEncolar } from '../lib/outboxInsumos'
import { fmtFechaHora as fmtFecha } from '../lib/fechas'
import { fmtCantidad, stepDe, normalizarCantidad } from '../lib/cantidad'
import { SearchableSelect } from '../components/SearchableSelect'

/**
 * "Mi bodega" — vista del supervisor de insumos sobre SU satélite (su vehículo):
 *  · Stock actual de su carro.
 *  · Traslados EN TRÁNSITO de la principal → los confirma (aval) rectificando
 *    cantidades si recibió menos; la diferencia regresa a la principal.
 *  · Tanqueo: en estación o en la sede, al tanque de distribución, a pimpinas,
 *    al vehículo (con placa) o a una máquina (con horómetro). Todo queda
 *    pendiente del aval del analista de insumos.
 *
 * Ojo: aquí NO se manipula inventario a mano. El supervisor no tiene "+ Entrada";
 * lo que entra a su carro entra por un traslado avalado o por un tanqueo avalado,
 * y así siempre se sabe de dónde salió cada galón.
 */


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

  const [tanqueoOpen, setTanqueoOpen] = useState(false)
  // Tomar material de la principal sin esperar a nadie: el supervisor entra a
  // las 5:30 y el analista a las 7:00.
  const [surtirOpen, setSurtirOpen] = useState(false)
  const [surtirItems, setSurtirItems] = useState<{ insumoId: string; cantidad: string }[]>([{ insumoId: '', cantidad: '' }])
  const [surtirNota, setSurtirNota] = useState('')

  const materiales = useMemo(
    () => insumos.filter((i) => i.activo && i.categoria !== 'COMBUSTIBLE')
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' })),
    [insumos],
  )

  async function guardarSurtido() {
    if (!bodega) return
    const items = surtirItems
      .filter((it) => it.insumoId && Number(it.cantidad) > 0)
      .map((it) => {
        const ins = insumos.find((i) => i.id === it.insumoId)!
        return {
          insumoId: it.insumoId,
          insumoNombre: ins.nombre,
          unidad: ins.unidad,
          cantidad: normalizarCantidad(Number(it.cantidad), ins.unidad),
        }
      })
    if (items.length === 0) { setError('Elige al menos un insumo con cantidad.'); return }
    setBusy(true); setError('')
    try {
      const payload = {
        bodegaDestinoId: bodega.id,
        supervisorId: session!.id,
        supervisorNombre: session?.name,
        nota: surtirNota.trim() || undefined,
        items,
      }
      const { enviado } = await enviarOEncolar('AUTOABASTECER', payload, () => autoAbastecer(payload))
      setInfo(enviado
        ? 'Material cargado a tu carro. Queda pendiente del aval del analista.'
        : 'Guardado sin señal. Se registra solo cuando haya cobertura.')
      setSurtirOpen(false)
      setSurtirItems([{ insumoId: '', cantidad: '' }])
      setSurtirNota('')
      void refresh()
    } catch (err) {
      const e = err as { message?: string }
      setError(`No se pudo registrar. (${e?.message ?? 'error'})`)
    } finally { setBusy(false) }
  }

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
      const payload = {
        trasladoId: recibir.id,
        origenId: recibir.origenId,
        destinoId: bodega.id,
        recibidoPor: session!.id,
        conforme,
        nota: notaRecepcion.trim() || undefined,
        items,
      }
      const { enviado } = await enviarOEncolar('CONFIRMAR_TRASLADO', payload, () => confirmarTraslado(payload))
      setInfo(!enviado
        ? 'Guardado. Se confirma solo cuando haya señal.'
        : conforme ? 'Recepción confirmada. El material ya está en tu bodega.' : 'Diferencia reportada. Lo que faltó regresó a la principal.')
      setRecibir(null)
      void refresh()
    } catch (err) {
      const e = err as { message?: string }
      setError(`No se pudo confirmar. (${e?.message ?? 'error'})`)
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
        <div className="bod-head__acciones">
          <button type="button" className="primary-button bod-head__btn" onClick={() => { setSurtirOpen(true); setError('') }} disabled={busy}>
            📦 Surtirme de la principal
          </button>
          <button type="button" className="primary-button bod-head__btn" onClick={() => setTanqueoOpen(true)} disabled={busy}>
            ⛽ Registrar tanqueo
          </button>
        </div>
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
                <strong>{t.items.map((i) => `${fmtCantidad(i.cantidad, i.unidad)} ${i.unidad} ${i.insumoNombre}`).join(', ')}</strong>
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
              <div className={`inv-stock${s.stock <= 0 ? ' inv-stock--zero' : ''}`}>{fmtCantidad(s.stock, s.insumo!.unidad)} <small>{s.insumo!.unidad}</small></div>
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
                    type="number" min={0} max={it.cantidad} step={stepDe(it.unidad)}
                    value={cantRecibida[it.id ?? ''] ?? String(it.cantidad)}
                    onChange={(e) => setCantRecibida((p) => ({ ...p, [it.id ?? '']: e.target.value }))}
                    disabled={busy} style={{ width: 84 }}
                  />
                  <span className="subtle-copy" style={{ width: 78, fontSize: '0.78rem' }}>de {fmtCantidad(it.cantidad, it.unidad)} {it.unidad}</span>
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

      {/* Surtirse de la principal */}
      {surtirOpen && (
        <div className="modal-overlay open" onClick={() => { if (!busy) setSurtirOpen(false) }}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 'min(500px, calc(100vw - 32px))' }}>
            <div className="labor-detail-header">
              <div><p className="eyebrow">Bodega principal</p><h3>📦 Surtirme</h3></div>
              <button type="button" className="modal-close-btn" onClick={() => setSurtirOpen(false)} disabled={busy} aria-label="Cerrar">&#x2715;</button>
            </div>
            <p className="subtle-copy" style={{ marginTop: 0 }}>
              Toma de la bodega principal lo que necesites para el día. Sale de la
              principal y entra a tu carro de una; el analista lo avala después.
            </p>
            <p className="subtle-copy">
              Para combustible usa <strong>⛽ Registrar tanqueo</strong>, que además pide los
              galones y la tirilla.
            </p>

            {surtirItems.map((it, idx) => (
              <div key={idx} className="taller-item-row" style={{ gridTemplateColumns: '1fr 90px auto' }}>
                <SearchableSelect
                  value={it.insumoId}
                  onChange={(v) => setSurtirItems(surtirItems.map((x, i) => (i === idx ? { ...x, insumoId: v } : x)))}
                  options={materiales.map((i) => ({
                    value: i.id, label: i.nombre, rightLabel: i.unidad, frecuente: i.frecuente,
                  }))}
                  placeholder="Buscar insumo…"
                  disabled={busy}
                />
                <input
                  type="number" min={0} step={stepDe(insumos.find((i) => i.id === it.insumoId)?.unidad)}
                  placeholder="Cant." value={it.cantidad}
                  onChange={(e) => setSurtirItems(surtirItems.map((x, i) => (i === idx ? { ...x, cantidad: e.target.value } : x)))}
                  disabled={busy}
                />
                <button type="button" className="inline-button" disabled={busy || surtirItems.length === 1}
                  onClick={() => setSurtirItems(surtirItems.filter((_, i) => i !== idx))}>✕</button>
              </div>
            ))}
            <button type="button" className="inline-button" style={{ marginTop: 6 }} disabled={busy}
              onClick={() => setSurtirItems([...surtirItems, { insumoId: '', cantidad: '' }])}>
              + Otro insumo
            </button>

            <label style={{ marginTop: 10 }}>Nota <span className="field-optional">(opcional)</span>
              <input type="text" value={surtirNota} onChange={(e) => setSurtirNota(e.target.value)} disabled={busy} />
            </label>

            <div className="modal-footer">
              <button type="button" className="inline-button" onClick={() => setSurtirOpen(false)} disabled={busy}>Cancelar</button>
              <button type="button" className="primary-button" onClick={() => void guardarSurtido()} disabled={busy}>
                {busy ? 'Guardando…' : 'Cargar a mi carro'}
              </button>
            </div>
          </div>
        </div>
      )}

      <TanqueoModal
        open={tanqueoOpen}
        onClose={() => setTanqueoOpen(false)}
        onSaved={() => void refresh()}
        bodegaId={bodega.id}
        destinos={['CARRO', 'PIMPINAS', 'VEHICULO', 'MAQUINA']}
      />
    </section>
  )
}

export default MiBodegaTab
