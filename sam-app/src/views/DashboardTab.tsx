import { useEffect, useMemo, useState } from 'react'
import { useAppData } from '../context/AppDataContext'
import { loadEquiposEstado, executionDateKey, type EquipoEstado } from '../services/samApi'
import { Donut, BarrasH, Columnas, plegarOtros, SERIES, type Punto } from '../components/Charts'
import type { Assignment } from '../domain/sam'

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

type Periodo = 'HOY' | 'PRIMERA' | 'SEGUNDA' | 'MES' | 'RANGO'
const PERIODOS: { value: Periodo; label: string }[] = [
  { value: 'HOY', label: 'Hoy' },
  { value: 'PRIMERA', label: '1ra quinc.' },
  { value: 'SEGUNDA', label: '2da quinc.' },
  { value: 'MES', label: 'Mes' },
  { value: 'RANGO', label: 'Rango' },
]

function rangoDe(p: Periodo, hoy: string): { desde: string; hasta: string } {
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

export function DashboardTab({ onIr }: { onIr?: (destino: string) => void }) {
  const { assignments, users, todayKey, operatorStatusMap } = useAppData()

  const [periodo, setPeriodo] = useState<Periodo>('HOY')
  const [desde, setDesde] = useState(() => rangoDe('HOY', todayKey).desde)
  const [hasta, setHasta] = useState(() => rangoDe('HOY', todayKey).hasta)
  const [equipos, setEquipos] = useState<EquipoEstado[]>([])
  // Ventana emergente de detalle: título + labores que lo componen.
  const [detalle, setDetalle] = useState<{ titulo: string; items: Assignment[] } | null>(null)

  useEffect(() => { void loadEquiposEstado().then(setEquipos) }, [])

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
      .slice(0, 8)
  }, [cerradas])

  const porHacienda = useMemo<Punto[]>(() => {
    const m = new Map<string, number>()
    cerradas.forEach((a) => m.set(a.haciendaName, (m.get(a.haciendaName) ?? 0) + areaEjec(a)))
    return Array.from(m.entries())
      .map(([k, v]) => ({ id: k, label: k, valor: v }))
      .sort((a, b) => b.valor - a.valor)
      .slice(0, 8)
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
          datos={porOperario}
          unidad="ha"
          onPick={(p) => abrir(p.label, cerradas.filter((a) => a.operatorName === p.id))}
        />
      </div>

      {/* Ranking de haciendas */}
      <div className="dash-card">
        <div className="dash-card__head">
          <h3>Haciendas · hectáreas</h3>
          <span className="dash-card__hint">Toca una hacienda</span>
        </div>
        <BarrasH
          datos={porHacienda}
          unidad="ha"
          color={SERIES[1]}
          onPick={(p) => abrir(p.label, cerradas.filter((a) => a.haciendaName === p.id))}
        />
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

      {/* Accesos rápidos: el dashboard es el centro, desde aquí va a todo */}
      {onIr && (
        <div className="dash-card">
          <div className="dash-card__head"><h3>Ir a</h3></div>
          <div className="dash-accesos">
            {[
              { id: 'labores', ico: '✓', txt: 'Labores' },
              { id: 'realizadas', ico: '☑', txt: 'Realizadas' },
              { id: 'aprobaciones', ico: '✔', txt: 'A facturar' },
              { id: 'asignar', ico: '＋', txt: 'Asignar' },
              { id: 'equipos', ico: '▣', txt: 'Máquinas' },
              { id: 'insumosresumen', ico: '🛢️', txt: 'Insumos' },
              { id: 'planilla', ico: '▦', txt: 'Planilla' },
              { id: 'reporte', ico: '⬦', txt: 'Reporte' },
              { id: 'usuarios', ico: '👤', txt: 'Usuarios' },
              { id: 'mapa', ico: '🗺️', txt: 'Mapa' },
            ].map((x) => (
              <button key={x.id} type="button" className="dash-acceso" onClick={() => onIr(x.id)}>
                <span aria-hidden>{x.ico}</span>{x.txt}
              </button>
            ))}
          </div>
        </div>
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
                      <strong>{nf(areaEjec(a) || a.area)} ha</strong>
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
