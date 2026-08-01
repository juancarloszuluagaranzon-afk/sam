import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useAppData } from '../context/AppDataContext'
import { loadKardexReporte, loadCombustibleExterno, loadSolicitudes } from '../services/samApi'
import type { InsumoKardex, CombustibleExterno, SolicitudInsumo } from '../domain/sam'
import { fmtFechaHoraLarga as fmtFecha, fmtFechaHora as fmtFechaCorta, fmtLapso } from '../lib/fechas'
import { fmtCantidad, redondear2 } from '../lib/cantidad'

/**
 * Reportes de consumo de insumos — por máquina y por insumo, en un rango de
 * fechas, con exportación a Excel.
 *
 * El consumo NETO = SALIDA (despacho) − ENTRADA con máquina (devolución por
 * diferencia confirmada por el operario). Las ENTRADAS de compra (sin máquina)
 * y los AJUSTES no cuentan como consumo. La exportación incluye el detalle
 * completo de movimientos + dos resúmenes.
 */
function primerDiaMes(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}
function hoyISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function ConsumoEquiposTab() {
  const { insumos, sortedEquipment, users, busy, setBusy, setError, setInfo } = useAppData()

  const [movimientos, setMovimientos] = useState<InsumoKardex[]>([])
  // Tanqueos en bomba cargados a una máquina: NO pasan por inventario, pero su
  // costo/consumo sí es de la máquina — se suman al reporte.
  const [tanqueos, setTanqueos] = useState<CombustibleExterno[]>([])
  // Detalle de una máquina: el total no dice de dónde salió ni por qué. Al
  // tocar la tarjeta se ven los movimientos uno por uno, con su nota.
  const [detalle, setDetalle] = useState<string>('')
  /**
   * La entrega completa detrás de cada despacho.
   *
   * El kardex sabe qué salió y de dónde, pero no a quién: el operario, la
   * evidencia, el horómetro y el aval viven en la solicitud. Sin esto la
   * pregunta "¿quién recibió esos 40 ganchos?" no tiene respuesta en pantalla.
   */
  const [entregas, setEntregas] = useState<SolicitudInsumo[]>([])
  /** Despacho abierto en el detalle. */
  const [verDespacho, setVerDespacho] = useState<{ mov?: InsumoKardex; tq?: CombustibleExterno } | null>(null)
  const [loading, setLoading] = useState(false)
  const [busca, setBusca] = useState('')
  const [desde, setDesde] = useState(primerDiaMes())
  const [hasta, setHasta] = useState(hoyISO())
  const [vista, setVista] = useState<'maquina' | 'insumo' | 'despacho'>('maquina')

  const equipoNombre = useMemo(() => {
    const m = new Map<string, string>()
    sortedEquipment.forEach((e) => m.set(e.code, e.name))
    return m
  }, [sortedEquipment])
  const insumoInfo = useMemo(() => {
    const m = new Map<string, { nombre: string; unidad: string }>()
    insumos.forEach((i) => m.set(i.id, { nombre: i.nombre, unidad: i.unidad }))
    return m
  }, [insumos])
  const userName = useMemo(() => {
    const m = new Map<string, string>()
    users.forEach((u) => m.set(u.id, u.name))
    return m
  }, [users])

  async function refresh() {
    setLoading(true)
    try {
      // `hasta` inclusivo hasta el final del día.
      const hastaFin = hasta ? `${hasta}T23:59:59` : undefined
      const [kx, cb, sol] = await Promise.all([
        loadKardexReporte({ desde: desde || undefined, hasta: hastaFin }),
        loadCombustibleExterno({ desde: desde || undefined, hasta: hasta || undefined, destino: 'MAQUINA' }),
        loadSolicitudes({ limit: 800 }),
      ])
      setMovimientos(kx)
      setTanqueos(cb)
      setEntregas(sol)
    } finally { setLoading(false) }
  }
  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desde, hasta])

  // Solo movimientos con máquina cuentan como consumo (despacho/devolución).
  const conEquipo = useMemo(() => movimientos.filter((m) => m.equipoCodigo), [movimientos])

  /** La entrega de la que salió cada movimiento: el kardex la guarda en `referencia`. */
  const entregaPorId = useMemo(() => {
    const m = new Map<string, SolicitudInsumo>()
    entregas.forEach((e) => m.set(e.id, e))
    return m
  }, [entregas])
  const entregaDe = (m?: InsumoKardex) => (m?.referencia ? entregaPorId.get(m.referencia) : undefined)

  /**
   * El tanqueo del que salió el movimiento.
   *
   * Un abastecimiento en SEDE cargado a una máquina sale de la principal, así
   * que SÍ deja huella en el kardex, y su `referencia` apunta al tanqueo — no
   * a una solicitud. Sin esto el detalle salía vacío ("Registró —").
   */
  const tanqueoPorId = useMemo(() => {
    const m = new Map<string, CombustibleExterno>()
    tanqueos.forEach((t) => m.set(t.id, t))
    return m
  }, [tanqueos])
  const tanqueoDe = (m?: InsumoKardex) => (m?.referencia ? tanqueoPorId.get(m.referencia) : undefined)

  /**
   * Cada despacho por separado, del más nuevo al más viejo.
   *
   * Las otras dos vistas agrupan —una por máquina, otra por insumo— y ahí se
   * pierde el hecho suelto: quién entregó qué, cuándo y por qué. Esta no agrupa
   * nada; es el libro corrido.
   */
  const porDespacho = useMemo(() => {
    type Fila = {
      id: string; cuando: string; equipo: string; insumoId: string
      cantidad: number; concepto: string; quien: string; recibio: string; nota: string
      devuelto: boolean; pendiente: boolean
      mov?: InsumoKardex; tq?: CombustibleExterno
    }
    const filas: Fila[] = []

    for (const m of conEquipo) {
      filas.push({
        id: m.id,
        cuando: m.createdAt,
        equipo: m.equipoCodigo!,
        insumoId: m.insumoId,
        cantidad: m.cantidad,
        concepto: m.motivo ?? 'Movimiento',
        quien: m.creadoPor ? (userName.get(m.creadoPor) ?? m.creadoPor) : '',
        recibio: (() => {
          const e = entregaDe(m)
          return e?.operarioNombre ?? (e ? (userName.get(e.operarioId) ?? '') : '')
        })(),
        nota: entregaDe(m)?.nota ?? '',
        devuelto: m.tipo === 'ENTRADA',
        pendiente: false,
        mov: m,
      })
    }
    // Los tanqueos en estación no pasan por bodega, así que no están en el
    // kardex: hay que traerlos aparte o el libro quedaría incompleto.
    for (const t of tanqueos) {
      if (!t.equipoCodigo || t.origen !== 'ESTACION' || t.estado === 'RECHAZADO') continue
      filas.push({
        id: t.id,
        cuando: t.createdAt || `${t.fecha}T12:00:00`,
        equipo: t.equipoCodigo,
        insumoId: t.insumoId ?? '',
        cantidad: t.galones,
        concepto: `Tanqueo en estación${t.estacion ? ` (${t.estacion})` : ''}`,
        quien: t.registradoNombre ?? '',
        // El tanqueo en bomba va directo a la máquina: no hay operario que reciba.
        recibio: '',
        nota: [t.horometro != null ? `horómetro ${t.horometro}` : '', t.factura ? `tirilla ${t.factura}` : '', t.nota ?? '']
          .filter(Boolean).join(' · '),
        devuelto: false,
        pendiente: t.estado === 'PENDIENTE',
        tq: t,
      })
    }

    const q = busca.trim().toLowerCase()
    return filas
      .filter((f) => {
        if (!q) return true
        const ins = insumoInfo.get(f.insumoId)?.nombre ?? ''
        const eq = equipoNombre.get(f.equipo) ?? f.equipo
        return [eq, ins, f.concepto, f.quien, f.recibio, f.nota].some((v) => v.toLowerCase().includes(q))
      })
      .sort((a, b) => b.cuando.localeCompare(a.cuando))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conEquipo, tanqueos, insumoInfo, equipoNombre, userName, entregaPorId, busca])

  // Agrupación por MÁQUINA → insumo (neto).
  const porMaquina = useMemo(() => {
    const byEquipo = new Map<string, { equipo: string; entregas: number; tanqueos: number; insumos: Map<string, number> }>()
    const get = (code: string) =>
      byEquipo.get(code) ?? { equipo: code, entregas: 0, tanqueos: 0, insumos: new Map<string, number>() }

    for (const m of conEquipo) {
      const g = get(m.equipoCodigo!)
      if (m.tipo === 'SALIDA') g.entregas += 1
      const delta = m.tipo === 'SALIDA' ? m.cantidad : -m.cantidad
      g.insumos.set(m.insumoId, (g.insumos.get(m.insumoId) ?? 0) + delta)
      byEquipo.set(m.equipoCodigo!, g)
    }
    // Combustible comprado en la BOMBA: es el unico que no dejo huella en el
    // kardex, porque nunca paso por una bodega. El tanqueo `origen=SEDE` SI la
    // dejo (sale de la principal), asi que sumarlo aqui lo contaria dos veces.
    // Y los rechazados por el analista no cuentan: ese combustible se reverso.
    for (const t of tanqueos) {
      if (!t.equipoCodigo || !t.insumoId) continue
      if (t.origen !== 'ESTACION' || t.estado === 'RECHAZADO') continue
      const g = get(t.equipoCodigo)
      g.tanqueos += 1
      g.insumos.set(t.insumoId, (g.insumos.get(t.insumoId) ?? 0) + t.galones)
      byEquipo.set(t.equipoCodigo, g)
    }

    const q = busca.trim().toLowerCase()
    return Array.from(byEquipo.values())
      .map((g) => ({ ...g, nombre: equipoNombre.get(g.equipo) ?? g.equipo }))
      .filter((g) => !q || g.nombre.toLowerCase().includes(q))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }))
  }, [conEquipo, tanqueos, equipoNombre, busca])

  // Agrupación por INSUMO → total neto (para el resumen de costos).
  const porInsumo = useMemo(() => {
    const byInsumo = new Map<string, number>()
    for (const m of conEquipo) {
      const delta = m.tipo === 'SALIDA' ? m.cantidad : -m.cantidad
      byInsumo.set(m.insumoId, (byInsumo.get(m.insumoId) ?? 0) + delta)
    }
    for (const t of tanqueos) {
      if (!t.insumoId) continue
      byInsumo.set(t.insumoId, (byInsumo.get(t.insumoId) ?? 0) + t.galones)
    }
    const q = busca.trim().toLowerCase()
    return Array.from(byInsumo.entries())
      .map(([id, total]) => ({ id, total, info: insumoInfo.get(id) }))
      .filter((r) => !q || (r.info?.nombre ?? '').toLowerCase().includes(q))
      .sort((a, b) => (a.info?.nombre ?? '').localeCompare(b.info?.nombre ?? ''))
  }, [conEquipo, tanqueos, insumoInfo, busca])

  async function exportarExcel() {
    if (movimientos.length === 0) { setError('No hay movimientos en el rango elegido.'); return }
    setBusy(true); setError('')
    try {
      const { utils, writeFile } = await import('xlsx')
      const wb = utils.book_new()

      // Hoja 1 — Detalle de movimientos.
      const detalle: Record<string, string | number>[] = movimientos.map((m) => {
        const info = insumoInfo.get(m.insumoId)
        const signo = m.tipo === 'SALIDA' ? -1 : m.tipo === 'AJUSTE' ? Math.sign(m.cantidad) || 1 : 1
        return {
          'Fecha': fmtFecha(m.createdAt),
          'Insumo': info?.nombre ?? m.insumoId,
          'Unidad': info?.unidad ?? '',
          'Tipo': m.tipo,
          'Cantidad': m.tipo === 'AJUSTE' ? m.cantidad : signo * Math.abs(m.cantidad),
          'Saldo': m.saldo,
          'Máquina': m.equipoCodigo ? (equipoNombre.get(m.equipoCodigo) ?? m.equipoCodigo) : '',
          'Origen': 'Bodega',
          'Motivo': m.motivo ?? '',
          'Registró': m.creadoPor ? (userName.get(m.creadoPor) ?? m.creadoPor) : '',
        }
      })
      // Tanqueos en bomba directos a máquina (no pasan por inventario).
      for (const t of tanqueos) {
        const info = t.insumoId ? insumoInfo.get(t.insumoId) : undefined
        detalle.push({
          'Fecha': fmtFecha(t.createdAt) || t.fecha,
          'Insumo': info?.nombre ?? 'COMBUSTIBLE',
          'Unidad': info?.unidad ?? 'galón',
          'Tipo': 'TANQUEO',
          'Cantidad': t.galones,
          'Saldo': '',
          'Máquina': t.equipoCodigo ? (equipoNombre.get(t.equipoCodigo) ?? t.equipoCodigo) : '',
          'Origen': 'Estación (directo a máquina)',
          'Motivo': `${t.estacion ?? 'Bomba'}${t.horometro != null ? ` · horóm. ${t.horometro}` : ''}${t.valor ? ` · $${t.valor}` : ''}`,
          'Registró': t.registradoNombre ?? '',
        })
      }
      utils.book_append_sheet(wb, utils.json_to_sheet(detalle), 'Movimientos')

      // Hoja 2 — Consumo por máquina.
      const filasMaq: Record<string, unknown>[] = []
      for (const g of porMaquina) {
        for (const [insumoId, total] of g.insumos.entries()) {
          const info = insumoInfo.get(insumoId)
          filasMaq.push({ 'Máquina': g.nombre, 'Insumo': info?.nombre ?? insumoId, 'Consumo': redondear2(total), 'Unidad': info?.unidad ?? '' })
        }
      }
      utils.book_append_sheet(wb, utils.json_to_sheet(filasMaq), 'Por máquina')

      // Hoja 3 — Consumo por insumo.
      const filasIns = porInsumo.map((r) => ({ 'Insumo': r.info?.nombre ?? r.id, 'Consumo': redondear2(r.total), 'Unidad': r.info?.unidad ?? '' }))
      utils.book_append_sheet(wb, utils.json_to_sheet(filasIns), 'Por insumo')

      writeFile(wb, `consumo-insumos-${desde}-a-${hasta}.xlsx`)
      setInfo(`Reporte descargado: ${movimientos.length} movimientos.`)
    } catch {
      setError('No se pudo generar el Excel.')
    } finally { setBusy(false) }
  }

  return (
    <section className="panel-card">
      <div className="panel-title split">
        <h2>Reportes de consumo</h2>
        <button type="button" className="inline-button" onClick={() => void refresh()} disabled={loading}>↻ Actualizar</button>
      </div>
      <p className="subtle-copy" style={{ marginTop: 0 }}>
        Combustible y materiales cargados a cada máquina (consumo neto), en el rango elegido.
      </p>

      <div className="rep-toolbar">
        <label className="rep-fecha">Desde<input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></label>
        <label className="rep-fecha">Hasta<input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></label>
        <button type="button" className="primary-button rep-export" onClick={() => void exportarExcel()} disabled={busy || loading || movimientos.length === 0}>
          ⬇ Descargar Excel
        </button>
      </div>

      <div className="sol-filtros" style={{ marginTop: 12 }}>
        <button type="button" className={`sol-filtro${vista === 'maquina' ? ' is-active' : ''}`} onClick={() => setVista('maquina')}>🚜 Por máquina</button>
        <button type="button" className={`sol-filtro${vista === 'insumo' ? ' is-active' : ''}`} onClick={() => setVista('insumo')}>🛢️ Por insumo</button>
        <button type="button" className={`sol-filtro${vista === 'despacho' ? ' is-active' : ''}`} onClick={() => setVista('despacho')}>📋 Despacho por despacho</button>
      </div>

      <input
        type="search"
        className="labores-search-input"
        placeholder={vista === 'maquina' ? 'Buscar máquina…' : vista === 'insumo' ? 'Buscar insumo…' : 'Buscar máquina, insumo, concepto o persona…'}
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        style={{ margin: '12px 0' }}
      />

      {loading || insumos.length === 0 ? (
        <p className="muted-text">Cargando…</p>
      ) : vista === 'maquina' ? (
        porMaquina.length === 0 ? (
          <p className="muted-text">Sin consumos en este rango.</p>
        ) : (
          <div className="list-rows">
            {porMaquina.map((g) => (
              <button
                key={g.equipo}
                type="button"
                className="panel-card consumo-maq"
                style={{ padding: '12px 14px', marginBottom: 10 }}
                onClick={() => setDetalle(g.equipo)}
                aria-label={`Ver el detalle de ${g.nombre}`}
              >
                <div className="panel-title split" style={{ marginBottom: 6 }}>
                  <h3 style={{ margin: 0, fontSize: '1rem' }}>🚜 {g.nombre}</h3>
                  <span className="subtle-copy">
                    {g.entregas} despacho{g.entregas === 1 ? '' : 's'}
                    {g.tanqueos > 0 && ` · ⛽ ${g.tanqueos} tanqueo${g.tanqueos === 1 ? '' : 's'} en estación`}
                    {' · '}<span className="consumo-maq__ver">ver detalle →</span>
                  </span>
                </div>
                <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {Array.from(g.insumos.entries())
                    .map(([insumoId, total]) => ({ insumoId, total, info: insumoInfo.get(insumoId) }))
                    .sort((a, b) => (a.info?.nombre ?? '').localeCompare(b.info?.nombre ?? ''))
                    .map(({ insumoId, total, info }) => (
                      <li key={insumoId} style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                        <span>{info?.nombre ?? insumoId}</span>
                        <strong>{fmtCantidad(total, info?.unidad)} {info?.unidad ?? ''}</strong>
                      </li>
                    ))}
                </ul>
              </button>
            ))}
          </div>
        )
      ) : vista === 'insumo' ? (
        porInsumo.length === 0 ? (
          <p className="muted-text">Sin consumos en este rango.</p>
        ) : (
          <div className="panel-card" style={{ padding: '12px 14px' }}>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {porInsumo.map((r) => (
                <li key={r.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                  <span>{r.info?.nombre ?? r.id}</span>
                  <strong>{fmtCantidad(r.total, r.info?.unidad)} {r.info?.unidad ?? ''}</strong>
                </li>
              ))}
            </ul>
          </div>
        )
      ) : (
        porDespacho.length === 0 ? (
          <p className="muted-text">Sin despachos en este rango.</p>
        ) : (
          <>
            <p className="ins-res__lbl">{porDespacho.length} despacho(s), del más reciente al más antiguo</p>
            <div className="inv-list">
              {porDespacho.map((d) => {
                const info = insumoInfo.get(d.insumoId)
                return (
                  <button
                    key={d.id}
                    type="button"
                    className="desp-row desp-row--tocable"
                    onClick={() => setVerDespacho({ mov: d.mov, tq: d.tq })}
                    aria-label={`Ver el detalle de la entrega a ${d.recibio || d.equipo}`}
                  >
                    <div className="desp-row__cab">
                      <strong>{equipoNombre.get(d.equipo) ?? d.equipo}</strong>
                      {d.devuelto && <span className="aval-tag aval-tag--vehiculo">devolución</span>}
                      {d.pendiente && <span className="aval-tag aval-tag--maquina">⏳ sin avalar</span>}
                      <strong className={`desp-row__cant${d.devuelto ? ' bod-stock__val--cero' : ''}`}>
                        {d.devuelto ? '−' : ''}{fmtCantidad(d.cantidad, info?.unidad)} <small>{info?.unidad ?? ''}</small>
                      </strong>
                    </div>
                    <span className="subtle-copy">{info?.nombre ?? d.insumoId} · {d.concepto}</span>
                    {d.recibio && (
                      <span className="subtle-copy">🙋 Recibió <strong>{d.recibio}</strong></span>
                    )}
                    <span className="subtle-copy">
                      {fmtFechaCorta(d.cuando)}{d.quien ? ` · entregó ${d.quien}` : ''}
                      {' · '}<span className="consumo-maq__ver">ver detalle →</span>
                    </span>
                    {d.nota && <span className="subtle-copy">{d.nota}</span>}
                  </button>
                )
              })}
            </div>
          </>
        )
      )}

      {/* Detalle de la máquina: cada movimiento con su fecha, su concepto y su
          nota. El total de la tarjeta no dice de dónde salió ni por qué. */}
      {detalle && (() => {
        const movs = conEquipo
          .filter((m) => m.equipoCodigo === detalle)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        const tqs = tanqueos
          .filter((t) => t.equipoCodigo === detalle && t.origen === 'ESTACION' && t.estado !== 'RECHAZADO')
          .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
        const nombre = equipoNombre.get(detalle) ?? detalle
        return (
          <div className="modal-overlay open" onClick={() => setDetalle('')}>
            <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 'min(560px, calc(100vw - 32px))' }}>
              <div className="labor-detail-header">
                <div><p className="eyebrow">Consumo</p><h3>🚜 {nombre}</h3></div>
                <button type="button" className="modal-close-btn" onClick={() => setDetalle('')} aria-label="Cerrar">&#x2715;</button>
              </div>
              <p className="subtle-copy" style={{ marginTop: 0 }}>
                {movs.length + tqs.length} movimiento(s) entre {desde || 'el inicio'} y {hasta || 'hoy'}.
              </p>

              {movs.length === 0 && tqs.length === 0 ? (
                <p className="muted-text">Sin movimientos en este rango.</p>
              ) : (
                <div className="inv-list" style={{ marginTop: 8 }}>
                  {movs.map((m) => {
                    const info = insumoInfo.get(m.insumoId)
                    const devuelto = m.tipo === 'ENTRADA'
                    return (
                      <div key={m.id} className="bod-stock__row">
                        <span className="bod-stock__nom">
                          {info?.nombre ?? m.insumoId}
                          {devuelto && <span className="inv-cat inv-cat--off"> devolución</span>}
                          <small className="bod-stock__reparto">
                            {fmtFecha(m.createdAt)}
                            {m.motivo ? ` · ${m.motivo}` : ''}
                            {m.creadoPor ? ` · ${userName.get(m.creadoPor) ?? m.creadoPor}` : ''}
                          </small>
                        </span>
                        <strong className={`bod-stock__val${devuelto ? ' bod-stock__val--cero' : ''}`}>
                          {devuelto ? '−' : ''}{fmtCantidad(m.cantidad, info?.unidad)} <small>{info?.unidad ?? ''}</small>
                        </strong>
                      </div>
                    )
                  })}

                  {tqs.map((t) => {
                    const info = t.insumoId ? insumoInfo.get(t.insumoId) : undefined
                    return (
                      <div key={t.id} className="bod-stock__row">
                        <span className="bod-stock__nom">
                          ⛽ {info?.nombre ?? 'COMBUSTIBLE'}
                          <small className="bod-stock__reparto">
                            {fmtFecha(t.createdAt)} · Tanqueo en estación
                            {t.estacion ? ` (${t.estacion})` : ''}
                            {t.horometro != null ? ` · horómetro ${t.horometro}` : ''}
                            {t.registradoNombre ? ` · ${t.registradoNombre}` : ''}
                            {t.nota ? ` · ${t.nota}` : ''}
                            {t.estado === 'PENDIENTE' ? ' · ⏳ sin avalar' : ''}
                          </small>
                        </span>
                        <strong className="bod-stock__val">
                          {fmtCantidad(t.galones, 'galón')} <small>galón</small>
                        </strong>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        )
      })()}

      {/* Detalle de UN despacho: el formulario completo tal como se llenó.
          La fila dice qué salió; aquí está a quién, con qué evidencia, con qué
          horómetro y si el operario ya lo avaló. */}
      {verDespacho && (() => {
        const { mov } = verDespacho
        const e = entregaDe(mov)
        // Si el movimiento no viene de una entrega, puede venir de un tanqueo.
        const tq = verDespacho.tq ?? tanqueoDe(mov)
        const insumoIdVer = mov?.insumoId ?? tq?.insumoId ?? ''
        const infoVer = insumoInfo.get(insumoIdVer)
        const equipoVer = mov?.equipoCodigo ?? tq?.equipoCodigo ?? ''
        const fotos = e?.evidenciaUrls ?? (tq?.tirillaUrl ? [tq.tirillaUrl] : [])
        const espera = e?.entregadoEn ? fmtLapso(e.createdAt, e.entregadoEn) : ''

        const Dato = ({ k, v }: { k: string; v: ReactNode }) => (
          <div className="desp-det__fila"><span>{k}</span><strong>{v}</strong></div>
        )

        return (
          <div className="modal-overlay open" onClick={() => setVerDespacho(null)}>
            <div className="modal-card" onClick={(ev) => ev.stopPropagation()} style={{ maxWidth: 'min(520px, calc(100vw - 32px))' }}>
              <div className="labor-detail-header">
                <div>
                  <p className="eyebrow">{tq ? (tq.origen === 'SEDE' ? 'Abastecimiento en sede' : 'Tanqueo en estación') : 'Entrega'}</p>
                  <h3>🚜 {equipoNombre.get(equipoVer) ?? equipoVer}</h3>
                </div>
                <button type="button" className="modal-close-btn" onClick={() => setVerDespacho(null)} aria-label="Cerrar">&#x2715;</button>
              </div>

              <div className="desp-det">
                {/* Qué se entregó — con TODOS los ítems del despacho, no solo
                    el de la fila que se tocó. */}
                {e && e.items.length > 0 ? (
                  <>
                    <p className="ins-res__lbl">Qué se entregó</p>
                    {e.items.map((it, idx) => (
                      <Dato key={idx}
                        k={it.insumoNombre ?? insumoInfo.get(it.insumoId ?? '')?.nombre ?? 'Insumo'}
                        v={`${fmtCantidad(it.cantidadDespachada ?? it.cantidad, it.unidad)} ${it.unidad ?? ''}`} />
                    ))}
                  </>
                ) : (
                  <>
                    <p className="ins-res__lbl">Qué se entregó</p>
                    <Dato k={infoVer?.nombre ?? 'Combustible'}
                      v={`${fmtCantidad(mov?.cantidad ?? tq?.galones ?? 0, infoVer?.unidad ?? 'galón')} ${infoVer?.unidad ?? 'galón'}`} />
                  </>
                )}

                <p className="ins-res__lbl" style={{ marginTop: 12 }}>Quién</p>
                {e ? (
                  <>
                    <Dato k="Recibió" v={e.operarioNombre ?? userName.get(e.operarioId) ?? e.operarioId} />
                    <Dato k="Entregó" v={e.despachadoPor ? (userName.get(e.despachadoPor) ?? e.despachadoPor) : '—'} />
                  </>
                ) : (
                  <Dato k="Registró" v={tq?.registradoNombre ?? '—'} />
                )}

                <p className="ins-res__lbl" style={{ marginTop: 12 }}>Cuándo</p>
                {e && (
                  <Dato k={e.origen === 'DIRECTA' ? 'Entregado' : 'Lo pidió'}
                    v={fmtFecha(e.createdAt)} />
                )}
                {e?.entregadoEn && e.origen !== 'DIRECTA' && (
                  <Dato k="Se lo entregaron" v={
                    <>{fmtFecha(e.entregadoEn)}{espera && <> <small>· {espera} de espera</small></>}</>
                  } />
                )}
                {!e && <Dato k={tq?.origen === 'SEDE' ? 'Abastecido' : 'Tanqueado'} v={fmtFecha(tq?.createdAt ?? mov?.createdAt ?? '')} />}

                {/* Lo que se llenó en el formulario */}
                {(e?.horometro != null || tq?.horometro != null) && (
                  <>
                    <p className="ins-res__lbl" style={{ marginTop: 12 }}>Máquina</p>
                    <Dato k="Horómetro" v={e?.horometro ?? tq?.horometro} />
                  </>
                )}
                {tq && (
                  <>
                    {tq.origen === 'SEDE' && <Dato k="Salió de" v="Bodega principal" />}
                    {tq.estacion && <Dato k="Estación" v={tq.estacion} />}
                    {tq.factura && <Dato k="N° tirilla" v={tq.factura} />}
                    {tq.valor != null && tq.valor > 0 && <Dato k="Valor" v={`$${tq.valor.toLocaleString('es-CO')}`} />}
                  </>
                )}
                {(e?.nota || tq?.nota) && (
                  <>
                    <p className="ins-res__lbl" style={{ marginTop: 12 }}>Nota</p>
                    <p className="subtle-copy" style={{ margin: 0 }}>{e?.nota ?? tq?.nota}</p>
                  </>
                )}

                {/* El aval: sin esto no se sabe si el operario reconoció lo que
                    recibió, que es lo que sostiene el cobro. */}
                {e && (
                  <>
                    <p className="ins-res__lbl" style={{ marginTop: 12 }}>Aval del operario</p>
                    {e.confirmadoEn ? (
                      <>
                        <Dato k={e.conforme === false ? '⚠️ Reportó diferencia' : '✔ Confirmado'} v={fmtFecha(e.confirmadoEn)} />
                        {e.confirmacionNota && <p className="subtle-copy" style={{ margin: 0 }}>{e.confirmacionNota}</p>}
                      </>
                    ) : (
                      <p className="subtle-copy" style={{ margin: 0 }}>⏳ Todavía no lo ha confirmado.</p>
                    )}
                  </>
                )}
                {tq && (
                  <>
                    <p className="ins-res__lbl" style={{ marginTop: 12 }}>Aval del analista</p>
                    <p className="subtle-copy" style={{ margin: 0 }}>
                      {tq.estado === 'PENDIENTE' ? '⏳ Pendiente de aval.'
                        : tq.estado === 'RECHAZADO' ? '✖ Rechazado.'
                        : `✔ Avalado${tq.revisadoNombre ? ` por ${tq.revisadoNombre}` : ''}${tq.revisadoEn ? ` · ${fmtFecha(tq.revisadoEn)}` : ''}`}
                    </p>
                  </>
                )}

                {fotos.length > 0 && (
                  <>
                    <p className="ins-res__lbl" style={{ marginTop: 12 }}>Evidencia</p>
                    <div className="desp-det__fotos">
                      {fotos.map((u, i) => (
                        <a key={i} href={u} target="_blank" rel="noreferrer">
                          <img src={u} alt={`evidencia ${i + 1}`} className="flota-foto-thumb" />
                        </a>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        )
      })()}
    </section>
  )
}

export default ConsumoEquiposTab
