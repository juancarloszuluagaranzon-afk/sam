import { useEffect, useMemo, useState } from 'react'
import { useAppData } from '../context/AppDataContext'
import { loadKardexReporte, loadCombustibleExterno, loadSolicitudes } from '../services/samApi'
import type { InsumoKardex, CombustibleExterno, SolicitudInsumo } from '../domain/sam'
import { fmtFechaHoraLarga as fmtFecha, fmtFechaHora as fmtFechaCorta } from '../lib/fechas'
import { fmtCantidad, redondear2 } from '../lib/cantidad'
import { Ayuda } from '../components/Ayuda'
import { agruparDespachos } from '../lib/despachos'
import { DetalleDespacho } from '../components/DetalleDespacho'

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
   * evidencia, el horómetro y la aprobación viven en la solicitud. Sin esto la
   * pregunta "¿quién recibió esos 40 ganchos?" no tiene respuesta en pantalla.
   */
  const [entregas, setEntregas] = useState<SolicitudInsumo[]>([])
  /** Despacho abierto en el detalle. */
  const [verDespacho, setVerDespacho] = useState<{ mov?: InsumoKardex; tq?: CombustibleExterno } | null>(null)
  /** Insumo abierto en la vista "por insumo": el total tampoco dice de dónde salió. */
  const [detalleInsumo, setDetalleInsumo] = useState<string>('')
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
    type Item = { insumoId: string; cantidad: number }
    type Fila = {
      id: string; cuando: string; equipo: string; items: Item[]
      concepto: string; quien: string; recibio: string; nota: string
      devuelto: boolean; pendiente: boolean
      mov?: InsumoKardex; tq?: CombustibleExterno
    }
    const filas: Fila[] = []

    // Una entrega de ganchos + combustible son dos filas de kardex, pero UN
    // solo hecho. Se agrupan o la lista se duplica sin decir nada nuevo.
    for (const g of agruparDespachos(conEquipo)) {
      const e = entregaDe(g.cabeza)
      filas.push({
        id: g.id,
        cuando: g.cuando,
        equipo: g.cabeza.equipoCodigo!,
        items: g.movs.map((m) => ({ insumoId: m.insumoId, cantidad: m.cantidad })),
        concepto: g.cabeza.motivo ?? 'Movimiento',
        quien: g.cabeza.creadoPor ? (userName.get(g.cabeza.creadoPor) ?? g.cabeza.creadoPor) : '',
        recibio: e?.operarioNombre ?? (e ? (userName.get(e.operarioId) ?? '') : ''),
        nota: e?.nota ?? '',
        devuelto: g.devuelto,
        pendiente: false,
        mov: g.cabeza,
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
        items: [{ insumoId: t.insumoId ?? '', cantidad: t.galones }],
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
        const ins = f.items.map((i) => insumoInfo.get(i.insumoId)?.nombre ?? '').join(' ')
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
      <Ayuda>
        <p>Combustible y materiales cargados a cada máquina (consumo neto), en el rango elegido.</p>
      </Ayuda>

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
                <li key={r.id}>
                  <button type="button" className="bod-stock__row mov-row"
                    onClick={() => setDetalleInsumo(r.id)}
                    aria-label={`Ver en qué máquinas se gastó ${r.info?.nombre ?? r.id}`}>
                    <span className="bod-stock__nom">
                      {r.info?.nombre ?? r.id}
                      <small className="consumo-maq__ver">ver detalle →</small>
                    </span>
                    <strong className="bod-stock__val">
                      {fmtCantidad(r.total, r.info?.unidad)} <small>{r.info?.unidad ?? ''}</small>
                    </strong>
                  </button>
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
              {porDespacho.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  className="desp-row desp-row--tocable"
                  onClick={() => setVerDespacho({ mov: d.mov, tq: d.tq })}
                  aria-label={`Ver el detalle de la entrega a ${d.recibio || d.equipo}`}
                >
                  <div className="desp-row__cab">
                    <strong>{equipoNombre.get(d.equipo) ?? d.equipo}</strong>
                    {d.devuelto && <span className="aprobación-tag aprobación-tag--vehiculo">devolución</span>}
                    {d.pendiente && <span className="aprobación-tag aprobación-tag--maquina">⏳ sin aprobar</span>}
                    <span className="desp-row__cant">{d.concepto}</span>
                  </div>
                  {/* Los insumos del MISMO despacho, cada uno con su unidad: no
                      se suman entre sí (galones con unidades no dan nada). */}
                  <div className="desp-row__items">
                    {d.items.map((it, i) => {
                      const info = insumoInfo.get(it.insumoId)
                      return (
                        <span key={i} className="desp-row__item">
                          {info?.nombre ?? it.insumoId}
                          <strong className={d.devuelto ? ' bod-stock__val--cero' : ''}>
                            {' '}{d.devuelto ? '−' : ''}{fmtCantidad(it.cantidad, info?.unidad)} {info?.unidad ?? ''}
                          </strong>
                        </span>
                      )
                    })}
                  </div>
                  {d.recibio && (
                    <span className="subtle-copy">🙋 Recibió <strong>{d.recibio}</strong></span>
                  )}
                  <span className="subtle-copy">
                    {fmtFechaCorta(d.cuando)}{d.quien ? ` · entregó ${d.quien}` : ''}
                    {' · '}<span className="consumo-maq__ver">ver detalle →</span>
                  </span>
                  {d.nota && <span className="subtle-copy">{d.nota}</span>}
                </button>
              ))}
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
                {agruparDespachos(movs).length + tqs.length} despacho(s) entre {desde || 'el inicio'} y {hasta || 'hoy'}.
              </p>

              {movs.length === 0 && tqs.length === 0 ? (
                <p className="muted-text">Sin movimientos en este rango.</p>
              ) : (
                <div className="inv-list" style={{ marginTop: 8 }}>
                  {agruparDespachos(movs).map((g) => {
                    const e = entregaDe(g.cabeza)
                    const recibio = e?.operarioNombre ?? (e ? userName.get(e.operarioId) : '')
                    return (
                      <button key={g.id} type="button" className="bod-stock__row mov-row"
                        onClick={() => setVerDespacho({ mov: g.cabeza })}
                        aria-label={`Ver el detalle de la entrega a ${recibio || detalle}`}>
                        <span className="bod-stock__nom">
                          <span className="mov-row__items">
                            {g.movs.map((m) => {
                              const info = insumoInfo.get(m.insumoId)
                              return (
                                <span key={m.id} className="desp-row__item">
                                  {info?.nombre ?? m.insumoId}
                                  <strong className={g.devuelto ? ' bod-stock__val--cero' : ''}>
                                    {' '}{g.devuelto ? '−' : ''}{fmtCantidad(m.cantidad, info?.unidad)} {info?.unidad ?? ''}
                                  </strong>
                                </span>
                              )
                            })}
                            {g.devuelto && <span className="inv-cat inv-cat--off">devolución</span>}
                          </span>
                          <small className="bod-stock__reparto">
                            {fmtFecha(g.cuando)}
                            {g.cabeza.motivo ? ` · ${g.cabeza.motivo}` : ''}
                            {g.cabeza.creadoPor ? ` · ${userName.get(g.cabeza.creadoPor) ?? g.cabeza.creadoPor}` : ''}
                          </small>
                          {recibio && <small className="bod-stock__reparto">🙋 Recibió {recibio}</small>}
                          <small className="consumo-maq__ver">ver detalle →</small>
                        </span>
                      </button>
                    )
                  })}

                  {tqs.map((t) => {
                    const info = t.insumoId ? insumoInfo.get(t.insumoId) : undefined
                    return (
                      <button key={t.id} type="button" className="bod-stock__row mov-row"
                        onClick={() => setVerDespacho({ tq: t })}
                        aria-label={`Ver el detalle del tanqueo de ${detalle}`}>
                        <span className="bod-stock__nom">
                          ⛽ {info?.nombre ?? 'COMBUSTIBLE'}
                          <small className="bod-stock__reparto">
                            {fmtFecha(t.createdAt)} · Tanqueo en estación
                            {t.estacion ? ` (${t.estacion})` : ''}
                            {t.horometro != null ? ` · horómetro ${t.horometro}` : ''}
                            {t.registradoNombre ? ` · ${t.registradoNombre}` : ''}
                            {t.nota ? ` · ${t.nota}` : ''}
                            {t.estado === 'PENDIENTE' ? ' · ⏳ sin aprobar' : ''}
                          </small>
                          <small className="consumo-maq__ver">ver detalle →</small>
                        </span>
                        <strong className="bod-stock__val">
                          {fmtCantidad(t.galones, 'galón')} <small>galón</small>
                        </strong>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        )
      })()}


      {/* Detalle de un insumo: en qué máquinas se gastó, movimiento a
          movimiento. El total suelto no dice a quién ni cuándo. */}
      {detalleInsumo && (() => {
        const movs = conEquipo
          .filter((m) => m.insumoId === detalleInsumo)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        const tqs = tanqueos
          .filter((t) => t.insumoId === detalleInsumo && t.origen === 'ESTACION' && t.estado !== 'RECHAZADO')
          .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
        const info = insumoInfo.get(detalleInsumo)
        return (
          <div className="modal-overlay open" onClick={() => setDetalleInsumo('')}>
            <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 'min(560px, calc(100vw - 32px))' }}>
              <div className="labor-detail-header">
                <div><p className="eyebrow">Consumo</p><h3>{info?.nombre ?? detalleInsumo}</h3></div>
                <button type="button" className="modal-close-btn" onClick={() => setDetalleInsumo('')} aria-label="Cerrar">&#x2715;</button>
              </div>
              <p className="subtle-copy" style={{ marginTop: 0 }}>
                {movs.length + tqs.length} movimiento(s) entre {desde || 'el inicio'} y {hasta || 'hoy'}.
              </p>

              <div className="inv-list" style={{ marginTop: 8 }}>
                {movs.map((m) => {
                  const devuelto = m.tipo === 'ENTRADA'
                  const e = entregaDe(m)
                  const recibio = e?.operarioNombre ?? (e ? userName.get(e.operarioId) : '')
                  return (
                    <button key={m.id} type="button" className="bod-stock__row mov-row"
                      onClick={() => setVerDespacho({ mov: m })}
                      aria-label={`Ver el detalle de la entrega a ${recibio || m.equipoCodigo}`}>
                      <span className="bod-stock__nom">
                        🚜 {equipoNombre.get(m.equipoCodigo ?? '') ?? m.equipoCodigo}
                        {devuelto && <span className="inv-cat inv-cat--off"> devolución</span>}
                        <small className="bod-stock__reparto">
                          {fmtFecha(m.createdAt)}
                          {m.motivo ? ` · ${m.motivo}` : ''}
                          {m.creadoPor ? ` · ${userName.get(m.creadoPor) ?? m.creadoPor}` : ''}
                        </small>
                        {recibio && <small className="bod-stock__reparto">🙋 Recibió {recibio}</small>}
                        <small className="consumo-maq__ver">ver detalle →</small>
                      </span>
                      <strong className={`bod-stock__val${devuelto ? ' bod-stock__val--cero' : ''}`}>
                        {devuelto ? '−' : ''}{fmtCantidad(m.cantidad, info?.unidad)} <small>{info?.unidad ?? ''}</small>
                      </strong>
                    </button>
                  )
                })}

                {tqs.map((t) => (
                  <button key={t.id} type="button" className="bod-stock__row mov-row"
                    onClick={() => setVerDespacho({ tq: t })}
                    aria-label={`Ver el detalle del tanqueo de ${t.equipoCodigo}`}>
                    <span className="bod-stock__nom">
                      ⛽ {equipoNombre.get(t.equipoCodigo ?? '') ?? t.equipoCodigo}
                      <small className="bod-stock__reparto">
                        {fmtFecha(t.createdAt)} · Tanqueo en estación
                        {t.estacion ? ` (${t.estacion})` : ''}
                        {t.registradoNombre ? ` · ${t.registradoNombre}` : ''}
                        {t.estado === 'PENDIENTE' ? ' · ⏳ sin aprobar' : ''}
                      </small>
                      <small className="consumo-maq__ver">ver detalle →</small>
                    </span>
                    <strong className="bod-stock__val">
                      {fmtCantidad(t.galones, 'galón')} <small>galón</small>
                    </strong>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )
      })()}

      {/* El formulario de la entrega, tal como se llenó. Vive en su propio
          componente porque se abre desde aquí, desde el detalle de la máquina,
          desde el del insumo y desde el tablero de Inicio. */}
      {verDespacho && (
        <DetalleDespacho
          mov={verDespacho.mov}
          tq={verDespacho.tq ?? tanqueoDe(verDespacho.mov)}
          entrega={entregaDe(verDespacho.mov)}
          onClose={() => setVerDespacho(null)}
        />
      )}
    </section>
  )
}

export default ConsumoEquiposTab
