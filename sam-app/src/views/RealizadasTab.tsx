import { useMemo, useState } from 'react'
import { useAppData } from '../context/AppDataContext'
import SearchableSelect from '../components/SearchableSelect'
import { executionDateKey } from '../services/samApi'

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

export function RealizadasTab() {
  const { assignments } = useAppData()
  const [haciendaCode, setHaciendaCode] = useState('')
  const [labor, setLabor] = useState('')

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
    return realizadas
      .filter(
        (a) =>
          (!haciendaCode || a.haciendaCode === haciendaCode) &&
          (!labor || a.labor === labor),
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
  }, [realizadas, haciendaCode, labor])

  const totalArea = useMemo(() => filtered.reduce((s, a) => s + (a.executedArea ?? 0), 0), [filtered])

  return (
    <section className="panel-card">
      <div className="panel-title">
        <h2>Labores realizadas</h2>
        <span className="realizadas-resumen">
          <strong>{filtered.length}</strong> {filtered.length === 1 ? 'labor' : 'labores'}
          {' · '}
          <strong>{fmtArea(totalArea)}</strong> ejecutadas
        </span>
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

      {filtered.length === 0 ? (
        <p className="muted-text" style={{ marginTop: 8 }}>Sin labores realizadas con esos filtros.</p>
      ) : (
        <ul className="realizadas-list">
          {filtered.map((a) => {
            const parcial = a.status === 'PARCIAL' || (a.executedArea ?? 0) < a.area
            return (
              <li key={a.id} className="realizada-item">
                <div className="realizada-item__main">
                  <strong>{a.haciendaName} · {a.suerte}</strong>
                  <span className="realizada-item__sub">
                    {a.labor} — {a.operatorName}
                    {a.equipmentName ? ` · ${a.equipmentName}` : ''}
                  </span>
                </div>
                <div className="realizada-item__meta">
                  <span className="realizada-item__area">{fmtArea(a.executedArea ?? 0)}</span>
                  <span className="realizada-item__date">{fmtDate(executionDateKey(a))}</span>
                  <span className={`realizada-chip ${parcial ? 'parcial' : 'completa'}`}>
                    {parcial ? 'Parcial' : 'Completada'}
                  </span>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
