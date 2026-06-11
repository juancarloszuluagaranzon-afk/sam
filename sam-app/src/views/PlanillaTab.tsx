import { useMemo, useState } from 'react'
import { useAppData } from '../context/AppDataContext'
import { executionDateKey } from '../services/samApi'
import {
  matchesSummaryFilter,
  buildMonthOptions,
  type SummaryQuincena,
} from '../components/EntityHistoryModal'

// Planilla quincenal: filas = operarios (orden descendente por total de ha),
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
  const { assignments, todayKey } = useAppData()

  const [planillaMonth, setPlanillaMonth] = useState(() => todayKey.slice(0, 7))
  const [planillaQuincena, setPlanillaQuincena] = useState<SummaryQuincena>(() =>
    Number(todayKey.slice(8, 10)) >= 16 ? 'SEGUNDA' : 'PRIMERA',
  )
  const [search, setSearch] = useState('')

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
    return Array.from(map.values()).sort((a, b) => b.total - a.total)
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

  return (
    <section className="panel-card">
      <div className="panel-title">
        <h2>Planilla quincenal</h2>
      </div>

      <p className="planilla-caption">
        Hectáreas de las labores que cada operario <strong>abrió</strong> ese día (área de las
        suertes iniciadas, se suman a medida que abre más). {monthLabel} · {quincenaLabel}.
      </p>

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
              {filteredRows.map((r) => (
                <tr key={r.id || r.name}>
                  <td className="planilla-sticky planilla-op">{r.name}</td>
                  {days.map((d) => {
                    const v = r.perDay[d.key] ?? 0
                    return (
                      <td
                        key={d.key}
                        className={`planilla-cell${d.isToday ? ' planilla-today' : ''}${v > 0 ? ' planilla-has' : ''}`}
                      >
                        {fmt(v)}
                      </td>
                    )
                  })}
                  <td className="planilla-total-col">{r.total.toFixed(1)}</td>
                </tr>
              ))}
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
    </section>
  )
}
