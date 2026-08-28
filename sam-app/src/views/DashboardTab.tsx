import { unidadDeLabor } from '../lib/texto'
import { useEffect, useMemo, useState } from 'react'
import { useAppData } from '../context/AppDataContext'
import { loadEquiposEstado, executionDateKey, loadKardexReporte, loadBodegas, type EquipoEstado } from '../services/samApi'
import { fmtCantidad } from '../lib/cantidad'
import { fmtFechaHora } from '../lib/fechas'
import { Donut, BarrasH, Columnas, plegarOtros, SERIES, type Punto } from '../components/Charts'
import type { Assignment, InsumoKardex, Bodega } from '../domain/sam'
import { agruparDespachos } from '../lib/despachos'
import { DetalleDespacho } from '../components/DetalleDespacho'

/**
 * Inicio del propietario — el tablero de la operación.
 *
 * Todo gira alrededor de esta pantalla: KPIs arriba, gráficos tocables abajo, y
 * cada dato abre el detalle en una ventana emergente. Pensado para el celular
 * (es donde el dueño lo mira): una columna, toques grandes, cero scroll lateral.
 *
 * Formas elegidas por el trabajo del dato (no por gusto):
 *  · Números sueltos (ha, labores, máquinas, operarios) → fichas, no gráficos.
 *  · Participación por labor → dona (parte-a-todo, ≤6 + "Otros").
 *  · Ranking de operarios/haciendas → barras horizontales (magnitud).
 *  · Evolución por día → columnas.
 */

type Periodo = 'HOY' | 'AYER' | 'PRIMERA' | 'SEGUNDA' | 'MES' | 'RANGO'
const PERIODOS: { value: Periodo; label: string }[] = [
  { value: 'HOY', label: 'Hoy' },
  { value: 'AYER', label: 'Ayer' },
  { value: 'PRIMERA', label: '1ra quinc.' },
  { value: 'SEGUNDA', label: '2da quinc.' },
  { value: 'MES', label: 'Mes' },
  { value: 'RANGO', label: 'Rango' },
]

function rangoDe(p: Periodo, hoy: string): { desde: string; hasta: string } {
  if (p === 'AYER') {
    const d = new Date(`${hoy}T12:00:00`)
    d.setDate(d.getDate() - 1)
    const ayer = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    return { desde: ayer, hasta: ayer }
  }
  const [y, m] = hoy.split('-')
  const fin = `${y}-${m}-${String(new Date(Number(y), Number(m), 0).getDate()).padStart(2, '0')}`
  if (p === 'PRIMERA') return { desde: `${y}-${m}-01`, hasta: `${y}-${m}-15` }
  if (p === 'SEGUNDA') return { desde: `${y}-${m}-16`, hasta: fin }
  if (p === 'MES') return { desde: `${y}-${m}-01`, hasta: fin }
  return { desde: hoy, hasta: hoy }
}

/** Área que cuenta como ejecutada (solo labores cerradas: es lo que se paga). */
function areaEjec(a: Assignment): number {
  if (a.status !== 'COMPLETADA' && a.status !== 'PARCIAL') return 0
  return a.executedArea > 0 ? a.executedArea : a.area
}

function fmtDia(key: string): string {
  const [, m, d] = key.split('-')
  return `${d}/${m}`
}

/**
 * Pie de un ranking: dice cuánto de lo que hay se está viendo y deja abrirlo todo.
 *
 * Los rankings arrancan cortados (los primeros) para que quepan en el celular,
 * pero eso hacía que la suma de las barras no cuadrara con el total de arriba —
 * y el dueño lee ese total. Así que la línea muestra "8 de 34 · 1.204 de 3.150 ha"
 * y el botón despliega el resto.
 */
function VerTodo({
  datos,
  visto,
  ver,
  onVer,
  unidad,
}: {
  datos: Punto[]
  visto: number
  ver: boolean
  onVer: (v: boolean) => void
  unidad: string
}) {
  if (datos.length <= visto && !ver) return null
  const total = datos.reduce((t, d) => t + d.valor, 0)
  const mostrados = ver ? datos : datos.slice(0, visto)
  const suma = mostrados.reduce((t, d) => t + d.valor, 0)
  const dec = (n: number) => n.toFixed(n >= 100 ? 0 : 2)
  return (
    <div className="dash-vertodo">
      <span className="dash-vertodo__res">
        {mostrados.length} de {datos.length} · {dec(suma)} de {dec(total)} {unidad}
      </span>
      <button type="button" className="dash-vertodo__btn" onClick={() => onVer(!ver)}>
        {ver ? 'Mostrar menos' : `Mostrar todos (${datos.length})`}
      </button>
    </div>
  )
}

export function DashboardTab({ onIr }: { onIr?: (destino: string) => void }) {
  const { assignments, users, insumos, sortedEquipment, todayKey, operatorStatusMap } = useAppData()

  const [periodo, setPeriodo] = useState<Periodo>('HOY')
  const [desde, setDesde] = useState(() => rangoDe('HOY', todayKey).desde)
  const [hasta, setHasta] = useState(() => rangoDe('HOY', todayKey).hasta)
  const [equipos, setEquipos] = useState<EquipoEstado[]>([])
  const [movs, setMovs] = useState<InsumoKardex[]>([])
  const [bodegas, setBodegas] = useState<Bodega[]>([])
  // Detalle de insumos (entregas) en ventana emergente.
  /** Despacho abierto desde el detalle de entregas. */
  const [verDespacho, setVerDespacho] = useState<InsumoKardex | null>(null)
  const [detIns, setDetIns] = useState<{ titulo: string; items: InsumoKardex[] } | null>(null)
  // Los rankings muestran los primeros y ocultan la cola tras "Mostrar todos",
  // para que el dueño pueda cuadrar contra el total de arriba.
  const [verOp, setVerOp] = useState(false)
  const [verHac, setVerHac] = useState(false)
  const [verProd, setVerProd] = useState(false)
  const TOPE = 8
  // Ventana emergente de detalle: título + labores que lo componen.
  const [detalle, setDetalle] = useState<{ titulo: string; items: Assignment[] } | null>(null)

  useEffect(() => {
    void loadEquiposEstado().then(setEquipos)
    void loadBodegas().then(setBodegas)
  }, [])

  // Movimientos de insumos del periodo (para el indicador de entregas).
  useEffect(() => {
    void loadKardexReporte({ desde, hasta: `${hasta}T23:59:59` }).then(setMovs)
  }, [desde, hasta])

  function elegir(p: Periodo) {
    setPeriodo(p)
    if (p !== 'RANGO') {
      const r = rangoDe(p, todayKey)
      setDesde(r.desde); setHasta(r.hasta)
    }
  }

  /** Labores del periodo (por fecha de EJECUCIÓN). */
  const enRango = useMemo(() => {
    return assignments.filter((a) => {
      if (a.status === 'CANCELADA') return false
      const k = executionDateKey(a)
      return k >= desde && k <= hasta
    })
  }, [assignments, desde, hasta])

  const cerradas = useMemo(() => enRango.filter((a) => a.status === 'COMPLETADA' || a.status === 'PARCIAL'), [enRango])
  const totalHa = useMemo(() => cerradas.reduce((t, a) => t + areaEjec(a), 0), [cerradas])
  const enProceso = useMemo(() => assignments.filter((a) => a.status === 'EN_PROCESO'), [assignments])

  // ── Máquinas ──
  const maq = useMemo(() => {
    const activos = equipos.filter((e) => e.estado === 'activo' && e.activo)
    const mant = equipos.filter((e) => e.estado === 'en_mantenimiento')
    const inact = equipos.filter((e) => e.estado === 'inactivo' || !e.activo)
    const trabajando = new Set(enProceso.map((a) => a.equipmentCode).filter(Boolean))
    return { activos, mant, inact, trabajando, total: equipos.length }
  }, [equipos, enProceso])

  // ── Operarios ──
  const operarios = useMemo(() => users.filter((u) => u.role === 'operador' && u.active !== false), [users])
  const trabajando = useMemo(
    () => operarios.filter((u) => operatorStatusMap.get(u.id) === 'ocupado'),
    [operarios, operatorStatusMap],
  )

  // ── Series ──
  const porLabor = useMemo<Punto[]>(() => {
    const m = new Map<string, number>()
    cerradas.forEach((a) => m.set(a.labor, (m.get(a.labor) ?? 0) + areaEjec(a)))
    return plegarOtros(Array.from(m.entries()).map(([k, v]) => ({ id: k, label: k, valor: v })))
  }, [cerradas])

  const porOperario = useMemo<Punto[]>(() => {
    const m = new Map<string, number>()
    cerradas.forEach((a) => m.set(a.operatorName, (m.get(a.operatorName) ?? 0) + areaEjec(a)))
    return Array.from(m.entries())
      .map(([k, v]) => ({ id: k, label: k, valor: v }))
      .sort((a, b) => b.valor - a.valor)
  }, [cerradas])

  const porHacienda = useMemo<Punto[]>(() => {
    const m = new Map<string, number>()
    cerradas.forEach((a) => m.set(a.haciendaName, (m.get(a.haciendaName) ?? 0) + areaEjec(a)))
    return Array.from(m.entries())
      .map(([k, v]) => ({ id: k, label: k, valor: v }))
      .sort((a, b) => b.valor - a.valor)
  }, [cerradas])

  const porDia = useMemo<Punto[]>(() => {
    const m = new Map<string, number>()
    cerradas.forEach((a) => {
      const k = executionDateKey(a)
      m.set(k, (m.get(k) ?? 0) + areaEjec(a))
    })
    return Array.from(m.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => ({ id: k, label: fmtDia(k), valor: v }))
  }, [cerradas])

  // ── Insumos entregados en el periodo ──
  // Entregas = SALIDA con máquina. El CONCEPTO sale del motivo del movimiento
  // (Despacho de solicitud, Entrega directa, Traslado a satélite, Carga en
  // estación…), así el dueño ve por qué se movió cada galón.
  const insumosMovs = useMemo(() => movs.filter((m) => m.tipo === 'SALIDA' && m.equipoCodigo), [movs])

  const insumoNombre = useMemo(() => {
    const m = new Map<string, { nombre: string; unidad: string }>()
    insumos.forEach((i) => m.set(i.id, { nombre: i.nombre, unidad: i.unidad }))
    return m
  }, [insumos])
  /** El código crudo (CASE1301) no es como la gente llama la máquina. */
  const equipoNombre = useMemo(() => {
    const m = new Map<string, string>()
    sortedEquipment.forEach((e) => m.set(e.code, e.name))
    return m
  }, [sortedEquipment])
  const bodegaNombre = useMemo(() => {
    const m = new Map<string, string>()
    bodegas.forEach((b) => m.set(b.id, b.nombre))
    return m
  }, [bodegas])

  /** Total entregado por insumo (lo que salió a las máquinas). */
  const insPorProducto = useMemo<Punto[]>(() => {
    const m = new Map<string, number>()
    insumosMovs.forEach((k) => m.set(k.insumoId, (m.get(k.insumoId) ?? 0) + k.cantidad))
    return Array.from(m.entries())
      .map(([id, v]) => ({
        id,
        label: insumoNombre.get(id)?.nombre ?? id,
        valor: v,
        sufijo: insumoNombre.get(id)?.unidad,
      }))
      .sort((a, b) => b.valor - a.valor)
  }, [insumosMovs, insumoNombre])

  /**
   * Participación por CONCEPTO (el motivo del movimiento).
   *
   * Se cuentan ENTREGAS, no cantidades: sumar 40 ganchos con 23,95 galones da
   * un "63,95" que no significa nada. Las entregas sí son comparables.
   */
  const insPorConcepto = useMemo<Punto[]>(() => {
    const m = new Map<string, number>()
    insumosMovs.forEach((k) => {
      const c = (k.motivo ?? 'Otro').split('(')[0].trim()
      m.set(c, (m.get(c) ?? 0) + 1)
    })
    return plegarOtros(Array.from(m.entries()).map(([k, v]) => ({ id: k, label: k, valor: v })))
  }, [insumosMovs])

  const maquinasAtendidas = useMemo(
    () => new Set(insumosMovs.map((k) => k.equipoCodigo)).size,
    [insumosMovs],
  )

  /* ── Abrir detalle ── */
  const abrir = (titulo: string, items: Assignment[]) => setDetalle({ titulo, items })
  const detLabor = (p: Punto) => {
    if (p.id === '__otros') {
      const top = porLabor.filter((x) => x.id !== '__otros').map((x) => x.id)
      abrir('Otras labores', cerradas.filter((a) => !top.includes(a.labor)))
    } else abrir(p.label, cerradas.filter((a) => a.labor === p.id))
  }

  const nf = (n: number, d = 2) => n.toLocaleString('es-CO', { minimumFractionDigits: d, maximumFractionDigits: d })

  return (
    <section className="dash">
      {/* Filtros */}
      <div className="dash-filtros">
        <div className="realizadas-seg" role="group" aria-label="Periodo">
          {PERIODOS.map((p) => (
            <button
              key={p.value}
              type="button"
              className={`realizadas-seg__btn ${periodo === p.value ? 'is-active' : ''}`}
              onClick={() => elegir(p.value)}
            >
              {p.label}
            </button>
          ))}
        </div>
        {periodo === 'RANGO' && (
          <div className="realizadas-rango">
            <label><span>Desde</span><input type="date" value={desde} max={hasta} onChange={(e) => setDesde(e.target.value)} /></label>
            <label><span>Hasta</span><input type="date" value={hasta} min={desde} onChange={(e) => setHasta(e.target.value)} /></label>
          </div>
        )}
      </div>

      {/* Cifra principal */}
      <div className="dash-hero">
        <span className="dash-hero__num">{nf(totalHa)}</span>
        <span className="dash-hero__uni">hectáreas ejecutadas</span>
        <span className="dash-hero__sub">
          {cerradas.length} labor{cerradas.length === 1 ? '' : 'es'} cerrada{cerradas.length === 1 ? '' : 's'}
          {periodo === 'HOY' ? ' hoy' : ` · ${fmtDia(desde)} al ${fmtDia(hasta)}`}
        </span>
      </div>

      {/* Fichas: estado ahora mismo */}
      <div className="dash-kpis">
        <button type="button" className="dash-kpi" onClick={() => abrir('Trabajando ahora', enProceso)}>
          <span className="dash-kpi__val">{enProceso.length}</span>
          <span className="dash-kpi__lbl">labores en curso</span>
          <span className="dash-kpi__pie">ahora mismo</span>
        </button>
        <button type="button" className="dash-kpi" onClick={() => abrir('Operarios trabajando', enProceso)}>
          <span className="dash-kpi__val">{trabajando.length}<small>/{operarios.length}</small></span>
          <span className="dash-kpi__lbl">operarios activos</span>
          <span className="dash-kpi__pie">{operarios.length - trabajando.length} disponibles</span>
        </button>
        <button type="button" className="dash-kpi" onClick={() => onIr?.('equipos')}>
          <span className="dash-kpi__val">{maq.trabajando.size}<small>/{maq.activos.length}</small></span>
          <span className="dash-kpi__lbl">máquinas en uso</span>
          <span className="dash-kpi__pie">
            {maq.mant.length > 0 && <span className="dash-alerta">🔧 {maq.mant.length} en taller</span>}
            {maq.mant.length === 0 && `${maq.activos.length - maq.trabajando.size} libres`}
          </span>
        </button>
        <button type="button" className="dash-kpi" onClick={() => abrir('Pendientes por aprobar', enRango.filter((a) => a.approval === 'PENDIENTE' && (a.status === 'COMPLETADA' || a.status === 'PARCIAL')))}>
          <span className="dash-kpi__val">{enRango.filter((a) => a.approval === 'PENDIENTE' && (a.status === 'COMPLETADA' || a.status === 'PARCIAL')).length}</span>
          <span className="dash-kpi__lbl">por facturar</span>
          <span className="dash-kpi__pie">esperan aprobación</span>
        </button>
      </div>

      {/* Participación por labor */}
      <div className="dash-card">
        <div className="dash-card__head">
          <h3>Participación por labor</h3>
          <span className="dash-card__hint">Toca para ver el detalle</span>
        </div>
        <Donut datos={porLabor} total={totalHa} unidad="ha" onPick={detLabor} />
      </div>

      {/* Evolución por día (solo si el periodo abarca varios días) */}
      {porDia.length > 1 && (
        <div className="dash-card">
          <div className="dash-card__head">
            <h3>Hectáreas por día</h3>
            <span className="dash-card__hint">Toca una columna</span>
          </div>
          <Columnas
            datos={porDia}
            color={SERIES[2]}
            onPick={(p) => abrir(`Día ${p.label}`, cerradas.filter((a) => executionDateKey(a) === p.id))}
          />
        </div>
      )}

      {/* Ranking de operarios */}
      <div className="dash-card">
        <div className="dash-card__head">
          <h3>Operarios · hectáreas</h3>
          <span className="dash-card__hint">Toca un nombre</span>
        </div>
        <BarrasH
          datos={verOp ? porOperario : porOperario.slice(0, TOPE)}
          unidad="ha"
          onPick={(p) => abrir(p.label, cerradas.filter((a) => a.operatorName === p.id))}
        />
        <VerTodo datos={porOperario} visto={TOPE} ver={verOp} onVer={setVerOp} unidad="ha" />
      </div>

      {/* Ranking de haciendas */}
      <div className="dash-card">
        <div className="dash-card__head">
          <h3>Haciendas · hectáreas</h3>
          <span className="dash-card__hint">Toca una hacienda</span>
        </div>
        <BarrasH
          datos={verHac ? porHacienda : porHacienda.slice(0, TOPE)}
          unidad="ha"
          color={SERIES[1]}
          onPick={(p) => abrir(p.label, cerradas.filter((a) => a.haciendaName === p.id))}
        />
        <VerTodo datos={porHacienda} visto={TOPE} ver={verHac} onVer={setVerHac} unidad="ha" />
      </div>

      {/* Insumos entregados: qué salió, por qué concepto y a qué máquinas */}
      <div className="dash-card">
        <div className="dash-card__head">
          <h3>Insumos entregados</h3>
          <button type="button" className="dash-card__link" onClick={() => setDetIns({ titulo: 'Todas las entregas', items: insumosMovs })}>
            Ver todo →
          </button>
        </div>
        {insumos.length === 0 ? (
          /* El catálogo llega por su lado; sin él las barras mostrarían el UUID
             crudo del insumo en la pantalla de Inicio del dueño. */
          <p className="dash-vacio">Cargando insumos…</p>
        ) : insumosMovs.length === 0 ? (
          <p className="dash-vacio">Sin entregas de insumos en este periodo.</p>
        ) : (
          <>
            <div className="dash-maq" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <div className="dash-maq__box"><strong>{insumosMovs.length}</strong><span>entregas</span></div>
              <div className="dash-maq__box"><strong>{maquinasAtendidas}</strong><span>máquinas atendidas</span></div>
            </div>

            <p className="ins-res__lbl" style={{ marginTop: 12 }}>Por producto</p>
            <BarrasH
              datos={verProd ? insPorProducto : insPorProducto.slice(0, 6)}
              unidad=""
              color={SERIES[3]}
              onPick={(p) => setDetIns({
                titulo: insumoNombre.get(p.id)?.nombre ?? p.label,
                items: insumosMovs.filter((k) => k.insumoId === p.id),
              })}
            />
            <VerTodo datos={insPorProducto} visto={6} ver={verProd} onVer={setVerProd} unidad="" />

            <p className="ins-res__lbl" style={{ marginTop: 12 }}>Por concepto (entregas)</p>
            <BarrasH
              datos={insPorConcepto}
              unidad=""
              color={SERIES[5]}
              onPick={(p) => setDetIns({
                titulo: p.label,
                items: p.id === '__otros'
                  ? insumosMovs.filter((k) => !insPorConcepto.some((c) => c.id !== '__otros' && c.id === (k.motivo ?? 'Otro').split('(')[0].trim()))
                  : insumosMovs.filter((k) => (k.motivo ?? 'Otro').split('(')[0].trim() === p.id),
              })}
            />
          </>
        )}
      </div>

      {/* Máquinas: pocos valores → fichas, no gráfico */}
      <div className="dash-card">
        <div className="dash-card__head">
          <h3>Parque de máquinas</h3>
          <button type="button" className="dash-card__link" onClick={() => onIr?.('equipos')}>Ver todas →</button>
        </div>
        <div className="dash-maq">
          <div className="dash-maq__box"><strong>{maq.trabajando.size}</strong><span>trabajando</span></div>
          <div className="dash-maq__box"><strong>{Math.max(maq.activos.length - maq.trabajando.size, 0)}</strong><span>disponibles</span></div>
          <div className={`dash-maq__box${maq.mant.length ? ' is-warn' : ''}`}><strong>{maq.mant.length}</strong><span>en taller</span></div>
          <div className="dash-maq__box"><strong>{maq.inact.length}</strong><span>inactivas</span></div>
        </div>
        {maq.mant.length > 0 && (
          <p className="dash-maq__nota">🔧 En taller: {maq.mant.map((e) => e.name).join(', ')}</p>
        )}
      </div>

      {/* Detalle de entregas de insumos */}
      {detIns && (
        <div className="modal-overlay open" onClick={() => setDetIns(null)}>
          <div className="modal-card dash-modal" onClick={(e) => e.stopPropagation()}>
            <div className="labor-detail-header">
              <div><p className="eyebrow">Insumos entregados</p><h3>{detIns.titulo}</h3></div>
              <button type="button" className="modal-close-btn" onClick={() => setDetIns(null)} aria-label="Cerrar">&#x2715;</button>
            </div>
            <p className="subtle-copy" style={{ marginTop: 0 }}>
              {agruparDespachos(detIns.items).length} entrega{agruparDespachos(detIns.items).length === 1 ? '' : 's'}
              {' · '}{detIns.items.length} ítem{detIns.items.length === 1 ? '' : 's'}
            </p>
            <div className="dash-detalle">
              {/* El catálogo llega por el contexto compartido; sin esperarlo
                  la lista muestra el UUID crudo del insumo. */}
              {insumos.length === 0 ? (
                <p className="muted-text">Cargando insumos…</p>
              ) : detIns.items.length === 0 ? (
                <p className="muted-text">Nada que mostrar.</p>
              ) : (
                agruparDespachos(detIns.items).map((g) => {
                  const maq = g.cabeza.equipoCodigo ?? ''
                  const bod = g.cabeza.bodegaId ? bodegaNombre.get(g.cabeza.bodegaId) : ''
                  return (
                    <button
                      key={g.id}
                      type="button"
                      className="ent-row"
                      onClick={() => setVerDespacho(g.cabeza)}
                      aria-label={`Ver el detalle de la entrega a ${equipoNombre.get(maq) ?? maq}`}
                    >
                      <div className="ent-row__cab">
                        <strong>🚜 {equipoNombre.get(maq) ?? maq}</strong>
                        <span className="ent-row__hora">{fmtFechaHora(g.cuando)}</span>
                      </div>
                      <ul className="ent-row__items">
                        {g.movs.map((m) => {
                          const info = insumoNombre.get(m.insumoId)
                          return (
                            <li key={m.id}>
                              {/* Cada insumo con SU unidad: no se suman entre sí. */}
                              <span className="sol-card__qty">
                                {fmtCantidad(m.cantidad, info?.unidad)} {info?.unidad ?? ''}
                              </span>
                              <span className="ent-row__ins">{info?.nombre ?? m.insumoId}</span>
                            </li>
                          )
                        })}
                      </ul>
                      <span className="ent-row__pie">
                        {g.cabeza.motivo ?? 'Entrega'}{bod ? ` · ${bod}` : ''}
                        <span className="ent-row__ver" aria-hidden>ver detalle ›</span>
                      </span>
                    </button>
                  )
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* La entrega completa: el mismo detalle que en Reportes, para que no
          haya dos versiones de la misma verdad. Va después del listado, así
          se pinta encima y al cerrarlo se vuelve a la lista. */}
      {verDespacho && (
        <DetalleDespacho mov={verDespacho} onClose={() => setVerDespacho(null)} />
      )}

      {/* Ventana emergente con el detalle */}
      {detalle && (
        <div className="modal-overlay open" onClick={() => setDetalle(null)}>
          <div className="modal-card dash-modal" onClick={(e) => e.stopPropagation()}>
            <div className="labor-detail-header">
              <div>
                <p className="eyebrow">Detalle</p>
                <h3>{detalle.titulo}</h3>
              </div>
              <button type="button" className="modal-close-btn" onClick={() => setDetalle(null)} aria-label="Cerrar">&#x2715;</button>
            </div>
            <p className="subtle-copy" style={{ marginTop: 0 }}>
              {detalle.items.length} labor{detalle.items.length === 1 ? '' : 'es'} ·{' '}
              <strong>{nf(detalle.items.reduce((t, a) => t + areaEjec(a), 0))} ha</strong>
            </p>
            <div className="dash-detalle">
              {detalle.items.length === 0 ? (
                <p className="muted-text">Nada que mostrar.</p>
              ) : (
                detalle.items.map((a) => (
                  <div key={a.id} className="dash-detalle__row">
                    <div className="dash-detalle__main">
                      <strong>{a.haciendaName} · {a.suerte}</strong>
                      <span>{a.labor} — {a.operatorName}</span>
                    </div>
                    <div className="dash-detalle__side">
                      <strong>{nf(areaEjec(a) || a.area)} {unidadDeLabor(a.labor)}</strong>
                      <small>{fmtDia(executionDateKey(a))}</small>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

export default DashboardTab
