import { memo, useMemo, useState } from 'react'
import type { Assignment, Equipment, MaestroRow } from '../domain/sam'
import { formatTime, executionDateKey } from '../services/samApi'
import { AssignmentDetailModal } from './AssignmentDetailModal'

interface EditPatch {
  executedArea?: number
  horometroInicial?: number | null
  horometroFinal?: number | null
  notes?: string
  equipmentCode?: string
  equipmentName?: string
}

export type SummaryQuincena = 'TODO' | 'PRIMERA' | 'SEGUNDA' | 'HOY'

export type SummaryEntity =
  | { type: 'operator'; id: string; name: string }
  | { type: 'equipment'; code: string; name: string }

export function matchesSummaryFilter(
  dateKey: string,
  month: string,
  quincena: SummaryQuincena,
  todayKey?: string,
): boolean {
  if (quincena === 'HOY') return todayKey ? dateKey === todayKey : false
  if (!dateKey.startsWith(month)) return false
  const day = Number(dateKey.slice(8, 10))
  if (quincena === 'PRIMERA') return day >= 1 && day <= 15
  if (quincena === 'SEGUNDA') return day >= 16
  return true
}

export function buildMonthOptions(reference: string): { value: string; label: string }[] {
  const [y, m] = reference.split('-').map(Number)
  const base = new Date(y, m - 1, 1)
  const fmt = new Intl.DateTimeFormat('es-CO', { month: 'long', year: 'numeric' })
  const out: { value: string; label: string }[] = []
  for (let i = 0; i < 12; i++) {
    const d = new Date(base.getFullYear(), base.getMonth() - i, 1)
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const label = fmt.format(d)
    out.push({ value, label: label.charAt(0).toUpperCase() + label.slice(1) })
  }
  return out
}

function formatArea(value: number) {
  return `${value.toFixed(1)} ha`
}

function getStatusMeta(a: Assignment) {
  if (a.status === 'PARCIAL') {
    return { label: 'Parcial', tone: 'progress' as const }
  }
  if (a.status === 'COMPLETADA') {
    if (a.executedArea > 0 && a.executedArea < a.area) {
      return { label: 'Parcial', tone: 'progress' as const }
    }
    return { label: 'Completada', tone: 'done' as const }
  }
  if (a.status === 'EN_PROCESO') return { label: 'Laborando', tone: 'progress' as const }
  if (a.status === 'CANCELADA') return { label: 'Cancelada', tone: 'cancel' as const }
  return { label: 'Programada', tone: 'pending' as const }
}

interface EntityHistoryModalProps {
  entity: SummaryEntity | null
  assignments: Assignment[]
  defaultMonth: string
  defaultQuincena: SummaryQuincena
  onClose: () => void
  canEdit?: boolean
  equipment?: Equipment[]
  // Maestro para que el AssignmentDetailModal pueda resolver el ingenio.
  maestro?: MaestroRow[]
  onSaveAssignment?: (assignment: Assignment, patch: EditPatch) => Promise<boolean>
  busy?: boolean
}

export const EntityHistoryModal = memo(function EntityHistoryModal({
  entity,
  assignments,
  defaultMonth,
  defaultQuincena,
  onClose,
  canEdit,
  equipment,
  maestro,
  onSaveAssignment,
  busy,
}: EntityHistoryModalProps) {
  const [month, setMonth] = useState(defaultMonth)
  const [quincena, setQuincena] = useState<SummaryQuincena>(defaultQuincena)
  const [selectedAssignment, setSelectedAssignment] = useState<Assignment | null>(null)

  const monthOptions = useMemo(() => buildMonthOptions(defaultMonth), [defaultMonth])

  const filtered = useMemo(() => {
    if (!entity) return []
    return assignments
      .filter((a) => {
        if (entity.type === 'operator' && a.operatorId !== entity.id) return false
        if (entity.type === 'equipment' && a.equipmentCode !== entity.code) return false
        if (a.status === 'CANCELADA') return false
        // Agrupar por fecha de EJECUCIÓN (fecha_fin / fecha_inicio según estado),
        // no por fecha de asignación. Una labor del 14-may ejecutada el 16-may cuenta
        // para la 2da quincena.
        return matchesSummaryFilter(executionDateKey(a), month, quincena)
      })
      .sort((a, b) => b.dateKey.localeCompare(a.dateKey))
  }, [entity, assignments, month, quincena])

  if (!entity) return null

  const planned = filtered.reduce((sum, a) => sum + a.area, 0)
  // PARCIAL aporta a "executed" porque la hectarea hecha es hectarea
  // hecha. "completed" solo cuenta cierres definitivos.
  const executed = filtered
    .filter((a) => a.status === 'COMPLETADA' || a.status === 'PARCIAL')
    .reduce((sum, a) => sum + a.executedArea, 0)
  const completed = filtered.filter((a) => a.status === 'COMPLETADA').length
  const completion = planned ? Math.round((executed / planned) * 100) : 0

  return (
    <div className="modal-overlay open" onClick={onClose}>
      <div
        className="modal-card entity-history-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="labor-detail-header">
          <div>
            <p className="eyebrow">{entity.type === 'operator' ? 'Operador' : 'Equipo'}</p>
            <h3>{entity.name}</h3>
          </div>
          <button className="modal-close-btn" onClick={onClose} aria-label="Cerrar">
            &#x2715;
          </button>
        </div>

        <div className="entity-kpi-card">
          <div>
            <strong>{executed.toFixed(1)}</strong>
            <span>ha ejecutadas</span>
          </div>
          <div>
            <strong>{planned.toFixed(1)}</strong>
            <span>ha planificadas</span>
          </div>
          <div>
            <strong>{completed}</strong>
            <span>{completed === 1 ? 'labor completada' : 'labores completadas'}</span>
          </div>
          <div>
            <strong>{planned ? `${completion}%` : '-'}</strong>
            <span>cumplimiento</span>
          </div>
        </div>

        <div className="entity-history-filters">
          <label>
            Mes
            <select value={month} onChange={(e) => setMonth(e.target.value)}>
              {monthOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </label>
          <label>
            Quincena
            <select value={quincena} onChange={(e) => setQuincena(e.target.value as SummaryQuincena)}>
              <option value="TODO">Todo el mes</option>
              <option value="PRIMERA">1ra quincena (1-15)</option>
              <option value="SEGUNDA">2da quincena (16-fin)</option>
            </select>
          </label>
        </div>

        <div className="entity-history-list">
          {filtered.length === 0 && (
            <p className="muted-text">Sin labores en el periodo seleccionado.</p>
          )}
          {filtered.map((a) => {
            const meta = getStatusMeta(a)
            const display = (a.status === 'COMPLETADA' || a.status === 'PARCIAL') && a.executedArea > 0 ? a.executedArea : a.area
            return (
              <button
                key={a.id}
                type="button"
                className="movement-row movement-row--clickable"
                onClick={() => setSelectedAssignment(a)}
              >
                <div>
                  <strong>{a.haciendaName} - {a.suerte}</strong>
                  <span>
                    {a.dateKey} - {a.labor}
                    {a.kind === 'ASIGNADA' ? (
                      <span className="kind-badge asignada">Prog.</span>
                    ) : (
                      <span className="kind-badge libre">Campo</span>
                    )}
                  </span>
                </div>
                <div className="movement-side">
                  <span className={`status-pill ${meta.tone}`}>
                    {meta.label} · {formatArea(display)}
                  </span>
                  {a.finishedAt && <small>{formatTime(a.finishedAt)}</small>}
                </div>
              </button>
            )
          })}
        </div>
      </div>
      <AssignmentDetailModal
        assignment={selectedAssignment}
        onClose={() => setSelectedAssignment(null)}
        canEdit={canEdit}
        equipment={equipment}
        maestro={maestro}
        onSave={onSaveAssignment}
        busy={busy}
      />
    </div>
  )
})
