import { useEffect, useMemo, useState } from 'react'
import { useAppData } from '../context/AppDataContext'
import {
  executionDateKey,
  loadPlanillaRevisiones,
  setPlanillaRevision,
  clearAllPlanillaRevisiones,
} from '../services/samApi'
import {
  matchesSummaryFilter,
  buildMonthOptions,
  type SummaryQuincena,
} from '../components/EntityHistoryModal'

// Planilla quincenal: filas = operarios (orden alfabetico por nombre),
// columnas = cada dia de la quincena. La celda suma el AREA de las labores que
// el operario ABRIO/inicio ese dia (status iniciado: EN_PROCESO / PARCIAL /
// COMPLETADA). "Abrir" = poner horometro inicial; en cuanto abre, su area entra
// en el dia y se va sumando con las que abra despues. Misma logica de 1ra/2da
// quincena del Resumen del propietario (matchesSummaryFilter + executionDateKey).

const WEEKDAY = ['D', 'L', 'M', 'M', 'J', 'V', 'S']

function fmt(value: number) {
  return value > 0 ? value.toFixed(1) : ''
}

export function PlanillaTab() {
  const { assignments, todayKey, session, setError, setInfo } = useAppData()

  const [planillaMonth, setPlanillaMonth] = useState(() => todayKey.slice(0, 7))
  const [planillaQuincena, setPlanillaQuincena] = useState<SummaryQuincena>(() =>
    Number(todayKey.slice(8, 10)) >= 16 ? 'SEGUNDA' : 'PRIMERA',
  )
  const [search, setSearch] = useState('')
  const [exporting, setExporting] = useState(false)

  // Marcas de "casilla revisada" (azul celeste), persistidas en BD. Clave:
  // `${operadorKey}|${fecha}`. `markMode` activa el clic-para-marcar.
  const [revisadas, setRevisadas] = useState<Set<string>>(new Set())
  const [markMode, setMarkMode] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)
  const [confirmClearAll, setConfirmClearAll] = useState(false)

  useEffect(() => {
    let alive = true
    void loadPlanillaRevisiones().then((rows) => {
      if (alive) setRevisadas(new Set(rows.map((r) => `${r.operadorId}|${r.fecha}`)))
    })
    return () => {
      alive = false
    }
  }, [])

  async function toggleRevision(operadorKey: string, fecha: string) {
    const cellKey = `${operadorKey}|${fecha}`
    const yaEsta = revisadas.has(cellKey)
    // Optimista: refleja el cambio de inmediato y revierte si falla.
    setRevisadas((prev) => {
      const next = new Set(prev)
      if (yaEsta) next.delete(cellKey)
      else next.add(cellKey)
      return next
    })
    try {
      await setPlanillaRevision(operadorKey, fecha, !yaEsta, session?.id)
    } catch {
      setRevisadas((prev) => {
        const next = new Set(prev)
        if (yaEsta) next.add(cellKey)
        else next.delete(cellKey)
        return next
      })
      setError('No se pudo guardar la marca de revisión. Revisa la conexión.')
    }
  }

  // Nombre del operario y área abierta por celda (operadorKey|fecha), sobre TODAS
  // las asignaciones (las marcas abarcan cualquier periodo, no solo el visible).
  const nameByKey = useMemo(() => {
    const m = new Map<string, string>()
    for (const a of assignments) {
      const opKey = a.operatorId || a.operatorName || 'Sin operador'
      if (!m.has(opKey)) m.set(opKey, a.operatorName || opKey)
    }
    return m
  }, [assignments])

  const areaByCell = useMemo(() => {
    const m = new Map<string, number>()
    for (const a of assignments) {
      if (a.status !== 'EN_PROCESO' && a.status !== 'PARCIAL' && a.status !== 'COMPLETADA') continue
      const opKey = a.operatorId || a.operatorName || 'Sin operador'
      const k = `${opKey}|${executionDateKey(a)}`
      m.set(k, (m.get(k) ?? 0) + a.area)
    }
    return m
  }, [assignments])

  // Detalle ordenado (operario alfabético, luego fecha) de las casillas marcadas.
  const revisadasList = useMemo(() => {
    return Array.from(revisadas)
      .map((key) => {
        const [opKey, fecha] = key.split('|')
        return {
          key,
          opKey,
          fecha,
          name: nameByKey.get(opKey) ?? opKey,
          area: areaByCell.get(key) ?? 0,
        }
      })
      .sort((a, b) => {
        const n = a.name.localeCompare(b.name, 'es', { sensitivity: 'base' })
        return n !== 0 ? n : b.fecha.localeCompare(a.fecha)
      })
  }, [revisadas, nameByKey, areaByCell])

  async function clearOne(opKey: string, fecha: string) {
    const cellKey = `${opKey}|${fecha}`
    setRevisadas((prev) => {
      const next = new Set(prev)
      next.delete(cellKey)
      return next
    })
    try {
      await setPlanillaRevision(opKey, fecha, false, session?.id)
    } catch {
      setRevisadas((prev) => new Set(prev).add(cellKey))
      setError('No se pudo quitar la marca. Revisa la conexión.')
    }
  }

  async function clearAll() {
    const backup = new Set(revisadas)
    setRevisadas(new Set())
    setConfirmClearAll(false)
    try {
      await clearAllPlanillaRevisiones()
      setInfo('Se limpiaron todas las casillas revisadas.')
    } catch {
      setRevisadas(backup)
      setError('No se pudieron limpiar las marcas. Revisa la conexión.')
    }
  }

  function fmtFecha(key: string) {
    const [y, m, d] = key.split('-')
    return d && m && y ? `${d}/${m}/${y}` : key
  }

  const monthOptions = useMemo(() => buildMonthOptions(todayKey.slice(0, 7)), [todayKey])

  // Dias de la quincena seleccionada (1-15 o 16-fin de mes).
  const days = useMemo(() => {
    const [y, m] = planillaMonth.split('-').map(Number)
    const lastDay = new Date(y, m, 0).getDate()
    const start = planillaQuincena === 'SEGUNDA' ? 16 : 1
    const end = planillaQuincena === 'SEGUNDA' ? lastDay : 15
    const out: { key: string; day: number; weekday: string; isToday: boolean }[] = []
    for (let d = start; d <= end; d++) {
      const key = `${planillaMonth}-${String(d).padStart(2, '0')}`
      const wd = new Date(y, m - 1, d).getDay()
      out.push({ key, day: d, weekday: WEEKDAY[wd], isToday: key === todayKey })
    }
    return out
  }, [planillaMonth, planillaQuincena, todayKey])

  // Matriz operario x dia.
  const rows = useMemo(() => {
    const map = new Map<
      string,
      { id: string; name: string; perDay: Record<string, number>; total: number }
    >()
    for (const a of assignments) {
      // Solo labores YA INICIADAS (el operario "abrio" la labor).
      if (a.status !== 'EN_PROCESO' && a.status !== 'PARCIAL' && a.status !== 'COMPLETADA') continue
      const dk = executionDateKey(a)
      if (!matchesSummaryFilter(dk, planillaMonth, planillaQuincena, todayKey)) continue
      const name = a.operatorName || 'Sin operador'
      const id = a.operatorId || ''
      const key = id || `name:${name.trim().toUpperCase()}`
      let row = map.get(key)
      if (!row) {
        row = { id, name, perDay: {}, total: 0 }
        map.set(key, row)
      }
      row.perDay[dk] = (row.perDay[dk] ?? 0) + a.area
      row.total += a.area
    }
    return Array.from(map.values()).sort((a, b) =>
      a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }),
    )
  }, [assignments, planillaMonth, planillaQuincena, todayKey])

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) => r.name.toLowerCase().includes(q))
  }, [rows, search])

  // Totales por columna (dia) y gran total.
  const dayTotals = useMemo(() => {
    const t: Record<string, number> = {}
    let grand = 0
    for (const r of filteredRows) {
      for (const d of days) {
        const v = r.perDay[d.key] ?? 0
        t[d.key] = (t[d.key] ?? 0) + v
      }
      grand += r.total
    }
    return { t, grand }
  }, [filteredRows, days])

  const quincenaLabel = planillaQuincena === 'SEGUNDA' ? '2da quincena (16-fin)' : '1ra quincena (1-15)'
  const monthLabel = monthOptions.find((o) => o.value === planillaMonth)?.label ?? planillaMonth

  async function handleDownload() {
    if (filteredRows.length === 0) {
      setError('No hay datos para exportar en este periodo.')
      return
    }
    setExporting(true)
    try {
      const { utils, writeFile } = await import('xlsx')
      const cell = (v: number) => (v > 0 ? Number(v.toFixed(1)) : '')
      const header = ['Operario', ...days.map((d) => `${d.weekday}${d.day}`), 'Total']
      const body = filteredRows.map((r) => [
        r.name,
        ...days.map((d) => cell(r.perDay[d.key] ?? 0)),
        Number(r.total.toFixed(1)),
      ])
      const footer = [
        'Total',
        ...days.map((d) => cell(dayTotals.t[d.key] ?? 0)),
        Number(dayTotals.grand.toFixed(1)),
      ]
      const aoa = [
        [`Planilla quincenal · ${monthLabel} · ${quincenaLabel}`],
        ['Hectáreas abiertas por operario y día'],
        [],
        header,
        ...body,
        footer,
      ]
      const ws = utils.aoa_to_sheet(aoa)
      ws['!cols'] = [{ wch: 24 }, ...days.map(() => ({ wch: 6 })), { wch: 9 }]
      const wb = utils.book_new()
      utils.book_append_sheet(wb, ws, 'Planilla')
      writeFile(wb, `planilla-${planillaMonth}-${planillaQuincena.toLowerCase()}.xlsx`)
      setInfo('Planilla exportada a Excel.')
    } catch {
      setError('No se pudo exportar la planilla.')
    } finally {
      setExporting(false)
    }
  }

  return (
    <section className="panel-card">
      <div className="panel-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <h2>Planilla quincenal</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            className={`inline-button planilla-mark-toggle${markMode ? ' is-active' : ''}`}
            onClick={() => setMarkMode((v) => !v)}
            title="Activa el clic para resaltar en azul las casillas revisadas"
          >
            {markMode ? '✓ Marcando revisadas' : '🖍 Marcar revisadas'}
          </button>
          <button
            type="button"
            className="inline-button"
            onClick={() => setDetailOpen(true)}
            disabled={revisadas.size === 0}
            title="Ver el detalle de las casillas revisadas y limpiarlas"
          >
            📋 Revisadas ({revisadas.size})
          </button>
          <button
            type="button"
            className="inline-button"
            onClick={() => void handleDownload()}
            disabled={exporting}
          >
            {exporting ? 'Exportando…' : '⬇ Excel'}
          </button>
        </div>
      </div>

      <p className="planilla-caption">
        Hectáreas de las labores que cada operario <strong>abrió</strong> ese día (área de las
        suertes iniciadas, se suman a medida que abre más). {monthLabel} · {quincenaLabel}.
      </p>

      {markMode && (
        <p className="planilla-mark-hint">
          🖍 Modo marcar activo: haz clic en una casilla para resaltarla en azul (revisada) o quitarla.
          El cambio queda guardado.
        </p>
      )}

      <div className="planilla-filters">
        <label>
          Mes
          <select value={planillaMonth} onChange={(e) => setPlanillaMonth(e.target.value)}>
            {monthOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Quincena
          <select
            value={planillaQuincena === 'SEGUNDA' ? 'SEGUNDA' : 'PRIMERA'}
            onChange={(e) => setPlanillaQuincena(e.target.value as SummaryQuincena)}
          >
            <option value="PRIMERA">1ra quincena (1-15)</option>
            <option value="SEGUNDA">2da quincena (16-fin)</option>
          </select>
        </label>
        <input
          className="planilla-search"
          type="search"
          placeholder="Buscar operario..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {filteredRows.length === 0 ? (
        <div className="empty-card" style={{ marginTop: 12 }}>
          <h2>Sin labores iniciadas</h2>
          <p>Ningún operario ha abierto labores en este periodo.</p>
        </div>
      ) : (
        <div className="planilla-scroll">
          <table className="planilla-table">
            <thead>
              <tr>
                <th className="planilla-sticky planilla-th-op">Operario</th>
                {days.map((d) => (
                  <th key={d.key} className={d.isToday ? 'planilla-today' : ''}>
                    <span className="planilla-wd">{d.weekday}</span>
                    <span className="planilla-day">{d.day}</span>
                  </th>
                ))}
                <th className="planilla-total-col">Total</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((r) => {
                const rowKey = r.id || r.name
                return (
                  <tr key={rowKey}>
                    <td className="planilla-sticky planilla-op">{r.name}</td>
                    {days.map((d) => {
                      const v = r.perDay[d.key] ?? 0
                      const revisada = revisadas.has(`${rowKey}|${d.key}`)
                      return (
                        <td
                          key={d.key}
                          className={`planilla-cell${d.isToday ? ' planilla-today' : ''}${v > 0 ? ' planilla-has' : ''}${revisada ? ' planilla-revisada' : ''}${markMode ? ' planilla-markable' : ''}`}
                          onClick={markMode ? () => void toggleRevision(rowKey, d.key) : undefined}
                          title={markMode ? (revisada ? 'Quitar marca de revisado' : 'Marcar como revisado') : undefined}
                        >
                          {fmt(v)}
                        </td>
                      )
                    })}
                    <td className="planilla-total-col">{r.total.toFixed(1)}</td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr>
                <td className="planilla-sticky planilla-op">Total</td>
                {days.map((d) => (
                  <td key={d.key} className={`planilla-foot${d.isToday ? ' planilla-today' : ''}`}>
                    {fmt(dayTotals.t[d.key] ?? 0)}
                  </td>
                ))}
                <td className="planilla-total-col planilla-foot">{dayTotals.grand.toFixed(1)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Ventana emergente: detalle de casillas revisadas + limpiar */}
      {detailOpen && (
        <div className="modal-overlay open" onClick={() => { setDetailOpen(false); setConfirmClearAll(false) }}>
          <div
            className="modal-card"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 'min(520px, calc(100vw - 32px))' }}
          >
            <div className="labor-detail-header">
              <div>
                <p className="eyebrow">Planilla</p>
                <h3>Casillas revisadas ({revisadasList.length})</h3>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => { setDetailOpen(false); setConfirmClearAll(false) }}
                aria-label="Cerrar"
              >
                &#x2715;
              </button>
            </div>

            {revisadasList.length === 0 ? (
              <p className="subtle-copy" style={{ marginTop: 0 }}>No hay casillas marcadas como revisadas.</p>
            ) : (
              <>
                <ul className="revisadas-list">
                  {revisadasList.map((it) => (
                    <li key={it.key} className="revisadas-item">
                      <div className="revisadas-item__main">
                        <strong>{it.name}</strong>
                        <span>{fmtFecha(it.fecha)}{it.area > 0 ? ` · ${it.area.toFixed(1)} ha` : ''}</span>
                      </div>
                      <button
                        type="button"
                        className="inline-button revisadas-clear-one"
                        onClick={() => void clearOne(it.opKey, it.fecha)}
                        title="Quitar esta marca"
                      >
                        ✕ Limpiar
                      </button>
                    </li>
                  ))}
                </ul>

                {confirmClearAll ? (
                  <div className="revisadas-confirm">
                    <p className="subtle-copy" style={{ margin: 0 }}>
                      ¿Seguro? Se quitarán <strong>todas</strong> las {revisadasList.length} marcas.
                    </p>
                    <div className="modal-footer" style={{ marginTop: 8 }}>
                      <button type="button" className="inline-button" onClick={() => setConfirmClearAll(false)}>Cancelar</button>
                      <button type="button" className="release-confirm-btn" onClick={() => void clearAll()}>Sí, limpiar todas</button>
                    </div>
                  </div>
                ) : (
                  <div className="modal-footer">
                    <button type="button" className="inline-button" onClick={() => setDetailOpen(false)}>Cerrar</button>
                    <button type="button" className="release-confirm-btn" onClick={() => setConfirmClearAll(true)}>
                      Limpiar todas
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
