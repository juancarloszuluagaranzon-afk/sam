import { useEffect, useMemo, useState } from 'react'
import { useAppData } from '../context/AppDataContext'
import { loadBodegas, loadStockBodega, loadKardexReporte } from '../services/samApi'
import { fmtCantidad } from '../lib/cantidad'
import type { Bodega, StockBodega, InsumoKardex } from '../domain/sam'

/**
 * Insumos — vista de DUEÑO/administración: qué ha entregado cada supervisor
 * (Genaro, Eduvin…) en un rango de fechas, y qué le queda cargado en su carro.
 *
 * No es la operación (eso vive en el módulo de insumos): es el resumen de
 * control, para responder de un vistazo "¿cuánto combustible y ganchos entregó
 * cada uno y con qué les quedó el carro?".
 */
function primerDiaMes(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}
function hoyISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function InsumosResumenTab() {
  const { insumos, users, sortedEquipment, busy, setBusy, setError, setInfo } = useAppData()

  const [bodegas, setBodegas] = useState<Bodega[]>([])
  const [stock, setStock] = useState<StockBodega[]>([])
  const [movs, setMovs] = useState<InsumoKardex[]>([])
  const [cargando, setCargando] = useState(true)
  const [desde, setDesde] = useState(primerDiaMes())
  const [hasta, setHasta] = useState(hoyISO())
  const [abierta, setAbierta] = useState<string>('')

  const nombreUsuario = useMemo(() => {
    const m = new Map<string, string>()
    users.forEach((u) => m.set(u.id, u.name))
    return m
  }, [users])
  const insumoInfo = useMemo(() => {
    const m = new Map<string, { nombre: string; unidad: string }>()
    insumos.forEach((i) => m.set(i.id, { nombre: i.nombre, unidad: i.unidad }))
    return m
  }, [insumos])
  const equipoNombre = useMemo(() => {
    const m = new Map<string, string>()
    sortedEquipment.forEach((e) => m.set(e.code, e.name))
    return m
  }, [sortedEquipment])

  async function refresh() {
    setCargando(true)
    try {
      const [bs, st, kx] = await Promise.all([
        loadBodegas(),
        loadStockBodega(),
        loadKardexReporte({ desde: desde || undefined, hasta: hasta ? `${hasta}T23:59:59` : undefined }),
      ])
      setBodegas(bs)
      setStock(st)
      setMovs(kx)
    } finally { setCargando(false) }
  }
  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desde, hasta])

  const satelites = useMemo(() => bodegas.filter((b) => b.tipo === 'SATELITE'), [bodegas])

  /**
   * Entregado por cada satélite en el rango: SALIDA − devoluciones.
   * Se ordena por ACTIVIDAD (más entregas primero): el dueño quiere ver arriba
   * a quien más movió, y los que no han entregado nada al final.
   */
  const porSatelite = useMemo(() => {
    return satelites.map((b) => {
      const suyos = movs.filter((m) => m.bodegaId === b.id)
      const entregado = new Map<string, number>()
      let entregas = 0
      for (const m of suyos) {
        if (m.tipo === 'SALIDA') {
          entregado.set(m.insumoId, (entregado.get(m.insumoId) ?? 0) + m.cantidad)
          if (m.equipoCodigo) entregas += 1
        } else if (m.tipo === 'ENTRADA' && m.equipoCodigo) {
          // Devolución de una entrega (el operario recibió menos).
          entregado.set(m.insumoId, (entregado.get(m.insumoId) ?? 0) - m.cantidad)
        }
      }
      const enCarro = stock.filter((s) => s.bodegaId === b.id && s.stock !== 0)
      // Máquinas atendidas (para saber a cuántos tractores le movió).
      const maquinas = new Set(suyos.filter((m) => m.tipo === 'SALIDA' && m.equipoCodigo).map((m) => m.equipoCodigo!))
      return {
        bodega: b,
        responsable: b.responsableId ? (nombreUsuario.get(b.responsableId) ?? b.responsableId) : 'Sin responsable',
        entregas,
        maquinas: maquinas.size,
        entregado: Array.from(entregado.entries())
          .filter(([, v]) => Math.abs(v) > 0.001)
          .map(([id, v]) => ({ id, total: v, info: insumoInfo.get(id) }))
          .sort((a, b2) => (a.info?.nombre ?? '').localeCompare(b2.info?.nombre ?? '')),
        enCarro: enCarro
          .map((s) => ({ ...s, info: insumoInfo.get(s.insumoId) }))
          .sort((a, b2) => (a.info?.nombre ?? '').localeCompare(b2.info?.nombre ?? '')),
        detalle: suyos
          .filter((m) => m.tipo === 'SALIDA' && m.equipoCodigo)
          .sort((a, b2) => b2.createdAt.localeCompare(a.createdAt)),
      }
    })
    .sort((a, b) => {
      // 1º el que más entregas hizo; si empatan, el que más volumen movió;
      // por último, alfabético para que el orden sea estable.
      if (b.entregas !== a.entregas) return b.entregas - a.entregas
      const volA = a.entregado.reduce((t, e) => t + Math.abs(e.total), 0)
      const volB = b.entregado.reduce((t, e) => t + Math.abs(e.total), 0)
      if (volB !== volA) return volB - volA
      return a.responsable.localeCompare(b.responsable, 'es', { sensitivity: 'base' })
    })
  }, [satelites, movs, stock, insumoInfo, nombreUsuario])

  async function exportar() {
    setBusy(true); setError('')
    try {
      const { utils, writeFile } = await import('xlsx')
      const filas: Record<string, string | number>[] = []
      for (const s of porSatelite) {
        for (const e of s.entregado) {
          filas.push({
            'Supervisor': s.responsable,
            'Bodega': s.bodega.nombre,
            'Insumo': e.info?.nombre ?? e.id,
            'Entregado': Number(e.total.toFixed(2)),
            'Unidad': e.info?.unidad ?? '',
          })
        }
      }
      const wb = utils.book_new()
      utils.book_append_sheet(wb, utils.json_to_sheet(filas), 'Entregado por supervisor')
      writeFile(wb, `insumos-por-supervisor-${desde}-a-${hasta}.xlsx`)
      setInfo('Reporte descargado.')
    } catch {
      setError('No se pudo generar el Excel.')
    } finally { setBusy(false) }
  }

  return (
    <section className="panel-card">
      <div className="bod-head">
        <h2 className="bod-head__title">🛢️ Insumos — entregas por supervisor</h2>
        <button type="button" className="primary-button bod-head__btn" onClick={() => void exportar()} disabled={busy || cargando}>
          ⬇ Excel
        </button>
      </div>
      <p className="subtle-copy" style={{ marginTop: 0 }}>
        Cuánto ha entregado cada supervisor a las máquinas en el rango, y qué le queda cargado en el carro.
      </p>

      <div className="rep-toolbar">
        <label className="rep-fecha">Desde<input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></label>
        <label className="rep-fecha">Hasta<input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></label>
      </div>

      {cargando ? (
        <p className="muted-text" style={{ marginTop: 14 }}>Cargando…</p>
      ) : porSatelite.length === 0 ? (
        <p className="muted-text" style={{ marginTop: 14 }}>
          Todavía no hay bodegas satélite. Se crean en <strong>Más → 🏢 Bodegas</strong>.
        </p>
      ) : (
        <div className="inv-list" style={{ marginTop: 14 }}>
          {porSatelite.map((s) => {
            const open = abierta === s.bodega.id
            return (
              <div key={s.bodega.id} className="bod-item">
                <div className={`inv-row${open ? ' bod-row--abierta' : ''}`}>
                  <div className="inv-row__main">
                    <strong>🚚 {s.responsable}</strong>
                    <span className="inv-cat inv-cat--comb">{s.bodega.nombre}</span>
                    <span className="subtle-copy">
                      {s.entregas} entrega{s.entregas === 1 ? '' : 's'}
                      {s.maquinas > 0 && ` · ${s.maquinas} máquina${s.maquinas === 1 ? '' : 's'}`}
                    </span>
                  </div>
                  <div className="inv-row__actions">
                    <button type="button" className="inline-button" onClick={() => setAbierta(open ? '' : s.bodega.id)} aria-expanded={open}>
                      {open ? 'Ocultar ▴' : 'Ver detalle ▾'}
                    </button>
                  </div>
                </div>

                {/* Resumen SIEMPRE visible: lo entregado y lo que le queda */}
                <div className="bod-stock">
                  <p className="ins-res__lbl">Entregado en el rango</p>
                  {s.entregado.length === 0 ? (
                    <p className="muted-text" style={{ margin: 0 }}>Sin entregas en estas fechas.</p>
                  ) : (
                    s.entregado.map((e) => (
                      <div key={e.id} className="bod-stock__row">
                        <span className="bod-stock__nom">{e.info?.nombre ?? e.id}</span>
                        <strong className="bod-stock__val">{fmtCantidad(e.total, e.info?.unidad)} <small>{e.info?.unidad ?? ''}</small></strong>
                      </div>
                    ))
                  )}

                  <p className="ins-res__lbl" style={{ marginTop: 10 }}>Le queda en el carro</p>
                  {s.enCarro.length === 0 ? (
                    <p className="muted-text" style={{ margin: 0 }}>Carro vacío.</p>
                  ) : (
                    s.enCarro.map((c) => (
                      <div key={c.insumoId} className="bod-stock__row">
                        <span className="bod-stock__nom">{c.info?.nombre ?? c.insumoId}</span>
                        <strong className="bod-stock__val">{fmtCantidad(c.stock, c.info?.unidad)} <small>{c.info?.unidad ?? ''}</small></strong>
                      </div>
                    ))
                  )}

                  {/* Detalle entrega por entrega (al desplegar) */}
                  {open && (
                    <>
                      <p className="ins-res__lbl" style={{ marginTop: 10 }}>Detalle de entregas</p>
                      {s.detalle.length === 0 ? (
                        <p className="muted-text" style={{ margin: 0 }}>Sin movimientos.</p>
                      ) : (
                        s.detalle.map((m) => {
                          const info = insumoInfo.get(m.insumoId)
                          return (
                            <div key={m.id} className="bod-stock__row">
                              <span className="bod-stock__nom">
                                {new Date(m.createdAt).toLocaleDateString('es-CO', { day: '2-digit', month: 'short' })}
                                {' · '}{info?.nombre ?? ''}
                                {m.equipoCodigo ? ` → 🚜 ${equipoNombre.get(m.equipoCodigo) ?? m.equipoCodigo}` : ''}
                              </span>
                              <strong className="bod-stock__val">{fmtCantidad(m.cantidad, info?.unidad)} <small>{info?.unidad ?? ''}</small></strong>
                            </div>
                          )
                        })
                      )}
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

export default InsumosResumenTab
