import { useMemo, useState } from 'react'
import { useAppData } from '../context/AppDataContext'
import SearchableSelect from '../components/SearchableSelect'
import { executionDateKey, formatTime } from '../services/samApi'
import type { Assignment } from '../domain/sam'

// Una tarjeta = un "corte": misma suerte + labor + MISMA fecha de ejecución.
// Varios parciales del mismo día (p. ej. dos operarios) se consolidan; si se
// reanudó otro día, queda en otra tarjeta (otra fecha). Al hacer clic se ve el
// detalle de cada parcial del grupo.
interface RealizadaGroup {
  key: string
  rows: Assignment[]
  haciendaName: string
  haciendaCode: string
  suerte: string
  labor: string
  dateKey: string
  executed: number
  asignada: number
  operators: string[]
  completa: boolean
}
import {
  matchesSummaryFilter,
  buildMonthOptions,
  type SummaryQuincena,
} from '../components/EntityHistoryModal'

// Segmento de fecha: TODAS = todo el historico; RANGO = fecha inicio/fin
// personalizada; el resto se apoya en matchesSummaryFilter (scoped al mes
// seleccionado salvo HOY, que usa todayKey).
type DateSeg = 'TODAS' | 'RANGO' | SummaryQuincena

// Vista del propietario: labores REALIZADAS (COMPLETADA + PARCIAL = con trabajo
// ejecutado), filtrables por hacienda y labor. Orden: hacienda alfabético y,
// dentro de cada una, de la MÁS RECIENTE a la más antigua (fecha de ejecución).
// Así, al filtrar por una hacienda, la lista queda puramente reciente→antigua.

function fmtArea(v: number) {
  return `${v.toFixed(1)} ha`
}

function fmtDate(key: string) {
  const [y, m, d] = key.split('-')
  return d && m && y ? `${d}/${m}/${y}` : key
}

const SEG_OPTIONS: { value: DateSeg; label: string }[] = [
  { value: 'TODAS', label: 'Todas' },
  { value: 'TODO', label: 'Mes' },
  { value: 'PRIMERA', label: '1ra quinc.' },
  { value: 'SEGUNDA', label: '2da quinc.' },
  { value: 'HOY', label: 'Hoy' },
  { value: 'RANGO', label: 'Rango' },
]

export function RealizadasTab() {
  const { assignments, maestro, todayKey } = useAppData()
  const [haciendaCode, setHaciendaCode] = useState('')
  const [labor, setLabor] = useState('')
  const [dateSeg, setDateSeg] = useState<DateSeg>('TODAS')
  const [mes, setMes] = useState(() => todayKey.slice(0, 7))
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')
  const [detail, setDetail] = useState<RealizadaGroup | null>(null)

  const monthOptions = useMemo(() => buildMonthOptions(todayKey.slice(0, 7)), [todayKey])

  const realizadas = useMemo(
    () => assignments.filter((a) => a.status === 'COMPLETADA' || a.status === 'PARCIAL'),
    [assignments],
  )

  const haciendaOptions = useMemo(() => {
    const map = new Map<string, string>()
    realizadas.forEach((a) => {
      if (!map.has(a.haciendaCode)) map.set(a.haciendaCode, a.haciendaName)
    })
    return Array.from(map.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [realizadas])

  const laborOptions = useMemo(() => {
    const set = new Set<string>()
    realizadas.forEach((a) => set.add(a.labor))
    return Array.from(set)
      .sort((a, b) => a.localeCompare(b))
      .map((l) => ({ value: l, label: l }))
  }, [realizadas])

  const filtered = useMemo(() => {
    const passesDate = (a: Assignment) => {
      if (dateSeg === 'TODAS') return true
      const dk = executionDateKey(a)
      if (dateSeg === 'RANGO') {
        if (desde && dk < desde) return false
        if (hasta && dk > hasta) return false
        return true
      }
      return matchesSummaryFilter(dk, mes, dateSeg, todayKey)
    }
    return realizadas
      .filter(
        (a) =>
          (!haciendaCode || a.haciendaCode === haciendaCode) &&
          (!labor || a.labor === labor) &&
          passesDate(a),
      )
      .sort((a, b) => {
        // 1) Hacienda alfabético
        const h = a.haciendaName.localeCompare(b.haciendaName)
        if (h !== 0) return h
        // 2) Más reciente primero (fecha de ejecución desc)
        const da = executionDateKey(a)
        const db = executionDateKey(b)
        if (da !== db) return db.localeCompare(da)
        // 3) Suerte (numérico/alfabético)
        return a.suerte.localeCompare(b.suerte, undefined, { numeric: true })
      })
  }, [realizadas, haciendaCode, labor, dateSeg, mes, desde, hasta, todayKey])

  // Agrupa los parciales del mismo corte (suerte+labor+fecha) en una sola tarjeta.
  const grouped = useMemo<RealizadaGroup[]>(() => {
    const map = new Map<string, Assignment[]>()
    for (const a of filtered) {
      const k = `${a.suerteCode}|${a.labor.trim().toUpperCase()}|${executionDateKey(a)}`
      const arr = map.get(k)
      if (arr) arr.push(a)
      else map.set(k, [a])
    }
    const groups: RealizadaGroup[] = []
    for (const [key, rows] of map) {
      const rep = rows[0]
      const executed = rows.reduce((s, r) => s + (r.executedArea ?? 0), 0)
      const maestroRow = maestro.find(
        (m) => m.haciendaCode === rep.haciendaCode && m.suerte === rep.suerte,
      )
      const asignada = maestroRow?.area ?? Math.max(...rows.map((r) => r.area))
      const operators = Array.from(new Set(rows.map((r) => r.operatorName).filter(Boolean)))
      const completa = rows.every((r) => r.status === 'COMPLETADA') && executed + 0.01 >= asignada
      groups.push({
        key,
        rows,
        haciendaName: rep.haciendaName,
        haciendaCode: rep.haciendaCode,
        suerte: rep.suerte,
        labor: rep.labor,
        dateKey: executionDateKey(rep),
        executed,
        asignada,
        operators,
        completa,
      })
    }
    groups.sort((a, b) => {
      const h = a.haciendaName.localeCompare(b.haciendaName, 'es', { sensitivity: 'base' })
      if (h !== 0) return h
      if (a.dateKey !== b.dateKey) return b.dateKey.localeCompare(a.dateKey)
      return a.suerte.localeCompare(b.suerte, undefined, { numeric: true })
    })
    return groups
  }, [filtered, maestro])

  const totalArea = useMemo(() => grouped.reduce((s, g) => s + g.executed, 0), [grouped])

  return (
    <section className="panel-card">
      <div className="panel-title">
        <h2>Labores realizadas</h2>
        <span className="realizadas-resumen">
          <strong>{grouped.length}</strong> {grouped.length === 1 ? 'labor' : 'labores'}
          {' · '}
          <strong>{fmtArea(totalArea)}</strong> ejecutadas
        </span>
      </div>

      <div className="realizadas-dateseg">
        <div className="realizadas-seg" role="group" aria-label="Periodo">
          {SEG_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`realizadas-seg__btn ${dateSeg === opt.value ? 'is-active' : ''}`}
              onClick={() => setDateSeg(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
        {(dateSeg === 'TODO' || dateSeg === 'PRIMERA' || dateSeg === 'SEGUNDA') && (
          <select
            className="realizadas-mes"
            value={mes}
            onChange={(e) => setMes(e.target.value)}
            aria-label="Mes"
          >
            {monthOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        )}
        {dateSeg === 'RANGO' && (
          <div className="realizadas-rango">
            <label>
              <span>Desde</span>
              <input
                type="date"
                value={desde}
                max={hasta || undefined}
                onChange={(e) => setDesde(e.target.value)}
              />
            </label>
            <label>
              <span>Hasta</span>
              <input
                type="date"
                value={hasta}
                min={desde || undefined}
                onChange={(e) => setHasta(e.target.value)}
              />
            </label>
          </div>
        )}
      </div>

      <div className="realizadas-filters">
        <label className="realizadas-filters__field">
          <span>Hacienda</span>
          <SearchableSelect
            value={haciendaCode}
            onChange={setHaciendaCode}
            options={haciendaOptions}
            placeholder="Todas las haciendas"
          />
        </label>
        <label className="realizadas-filters__field">
          <span>Labor</span>
          <SearchableSelect
            value={labor}
            onChange={setLabor}
            options={laborOptions}
            placeholder="Todas las labores"
          />
        </label>
      </div>

      {grouped.length === 0 ? (
        <p className="muted-text" style={{ marginTop: 8 }}>Sin labores realizadas con esos filtros.</p>
      ) : (
        <ul className="realizadas-list">
          {grouped.map((g) => {
            const multi = g.rows.length > 1
            const operLabel =
              g.operators.length === 0
                ? '—'
                : g.operators.length === 1
                  ? g.operators[0]
                  : `${g.operators[0]} +${g.operators.length - 1}`
            return (
              <li
                key={g.key}
                className="realizada-item realizada-item--clickable"
                onClick={() => setDetail(g)}
                title="Ver detalle de los parciales"
              >
                <div className="realizada-item__main">
                  <strong>{g.haciendaName} · {g.suerte}</strong>
                  <span className="realizada-item__sub">
                    {g.labor} — {operLabel}
                    {multi ? ` · ${g.rows.length} parciales` : ''}
                  </span>
                </div>
                <div className="realizada-item__meta">
                  <span className="realizada-item__area">
                    {g.executed.toFixed(1)} / {g.asignada.toFixed(1)} ha
                  </span>
                  <span className="realizada-item__date">{fmtDate(g.dateKey)}</span>
                  <span className={`realizada-chip ${g.completa ? 'completa' : 'parcial'}`}>
                    {g.completa ? 'Completada' : 'Parcial'}
                  </span>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {detail && (
        <div className="modal-overlay open" onClick={() => setDetail(null)}>
          <div
            className="modal-card"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 'min(540px, calc(100vw - 32px))' }}
          >
            <div className="labor-detail-header">
              <div>
                <p className="eyebrow">Realizadas · detalle</p>
                <h3>{detail.haciendaName} · {detail.suerte}</h3>
              </div>
              <button type="button" className="modal-close-btn" onClick={() => setDetail(null)} aria-label="Cerrar">
                &#x2715;
              </button>
            </div>
            <p className="subtle-copy" style={{ marginTop: 0 }}>
              {detail.labor} · {fmtDate(detail.dateKey)} ·{' '}
              <strong>{detail.executed.toFixed(1)} / {detail.asignada.toFixed(1)} ha</strong>
              {detail.rows.length > 1 ? ` · ${detail.rows.length} parciales` : ''}
            </p>
            <ul className="revisadas-list">
              {detail.rows.map((r) => (
                <li key={r.id} className="revisadas-item">
                  <div className="revisadas-item__main">
                    <strong>{r.operatorName || 'Sin operario'}</strong>
                    <span>
                      {(r.executedArea ?? 0).toFixed(1)} ha · {r.status === 'PARCIAL' ? 'Parcial' : 'Completada'}
                      {r.equipmentName ? ` · ${r.equipmentName}` : ''}
                      {r.finishedAt ? ` · ${formatTime(r.finishedAt)}` : ''}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
            <div className="modal-footer">
              <button type="button" className="inline-button" onClick={() => setDetail(null)}>Cerrar</button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
