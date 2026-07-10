import { useMemo, useState } from 'react'
import SearchableSelect from './SearchableSelect'

export interface AreaDetailRow {
  id: string
  haciendaName: string
  suerte: string
  labor: string
  operatorName: string
  status: string
  area: number
}

const STATUS_LABEL: Record<string, string> = {
  COMPLETADA: 'Completada',
  PARCIAL: 'Parcial',
  EN_PROCESO: 'En proceso',
  PENDIENTE: 'Pendiente',
  CANCELADA: 'Cancelada',
}

/**
 * Modal de detalle de un KPI de área (Planificadas / Ejecutadas) del Resumen.
 * Lista los registros que COMPONEN ese número, con barra de búsqueda y filtros
 * (hacienda / operador), y un total que refleja lo filtrado. Autocontenido: las
 * opciones de los filtros salen de los propios registros.
 */
export function AreaDetailModal({
  open,
  onClose,
  title,
  areaLabel,
  rows,
  showStatus,
}: {
  open: boolean
  onClose: () => void
  title: string
  areaLabel: string
  rows: AreaDetailRow[]
  showStatus?: boolean
}) {
  const [search, setSearch] = useState('')
  const [haciendaFilter, setHaciendaFilter] = useState('')
  const [operatorFilter, setOperatorFilter] = useState('')

  const haciendaOptions = useMemo(() => {
    const set = new Map<string, string>()
    for (const r of rows) if (r.haciendaName) set.set(r.haciendaName, r.haciendaName)
    return [...set.keys()].sort((a, b) => a.localeCompare(b, 'es')).map((h) => ({ value: h, label: h }))
  }, [rows])

  const operatorOptions = useMemo(() => {
    const set = new Map<string, string>()
    for (const r of rows) if (r.operatorName) set.set(r.operatorName, r.operatorName)
    return [...set.keys()].sort((a, b) => a.localeCompare(b, 'es')).map((o) => ({ value: o, label: o }))
  }, [rows])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows
      .filter((r) => {
        if (haciendaFilter && r.haciendaName !== haciendaFilter) return false
        if (operatorFilter && r.operatorName !== operatorFilter) return false
        if (q) {
          const hay = `${r.haciendaName} ${r.suerte} ${r.labor} ${r.operatorName}`.toLowerCase()
          if (!hay.includes(q)) return false
        }
        return true
      })
      .sort((a, b) => b.area - a.area)
  }, [rows, search, haciendaFilter, operatorFilter])

  const total = useMemo(() => filtered.reduce((s, r) => s + r.area, 0), [filtered])

  if (!open) return null

  return (
    <div className="modal-overlay open" onClick={onClose}>
      <div
        className="modal-card"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 'min(680px, calc(100vw - 32px))' }}
      >
        <div className="labor-detail-header">
          <div>
            <p className="eyebrow">Detalle de área</p>
            <h3>{title}</h3>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Cerrar">&#x2715;</button>
        </div>

        <input
          className="labores-search-input"
          type="search"
          placeholder="Buscar hacienda, suerte, labor u operario…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ marginBottom: 8 }}
        />
        <div className="report-filter-row" style={{ marginBottom: 8 }}>
          <SearchableSelect
            value={haciendaFilter}
            onChange={setHaciendaFilter}
            placeholder="Todas las haciendas"
            options={haciendaOptions}
          />
          <SearchableSelect
            value={operatorFilter}
            onChange={setOperatorFilter}
            placeholder="Todos los operadores"
            options={operatorOptions}
          />
        </div>

        <div className="list-rows" style={{ maxHeight: '52vh', overflowY: 'auto' }}>
          {filtered.length === 0 ? (
            <p className="muted-text">Sin registros que coincidan.</p>
          ) : (
            filtered.map((r) => (
              <div key={r.id} className="movement-row">
                <div>
                  <strong>{r.haciendaName} · {r.suerte}</strong>
                  <span>
                    {r.labor}
                    {r.operatorName ? ` · ${r.operatorName}` : ''}
                    {showStatus ? ` · ${STATUS_LABEL[r.status] ?? r.status}` : ''}
                  </span>
                </div>
                <div className="movement-side">
                  <span className="status-pill">{r.area.toFixed(2)} ha</span>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="modal-footer" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="subtle-copy">
            {filtered.length} registro{filtered.length === 1 ? '' : 's'} · <strong>{total.toFixed(2)} ha {areaLabel}</strong>
          </span>
          <button type="button" className="primary-button" onClick={onClose}>Cerrar</button>
        </div>
      </div>
    </div>
  )
}

export default AreaDetailModal
