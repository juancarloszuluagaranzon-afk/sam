import { memo, useEffect, useState } from 'react'
import type { Assignment, Equipment, MaestroRow } from '../domain/sam'
import { formatTime, getIngenioName } from '../services/samApi'

interface EditPatch {
  executedArea?: number
  horometroInicial?: number | null
  horometroFinal?: number | null
  notes?: string
  equipmentCode?: string
  equipmentName?: string
}

interface Props {
  assignment: Assignment | null
  onClose: () => void
  canEdit?: boolean
  equipment?: Equipment[]
  // Maestro pasa para resolver el ingenio de la suerte. Si no se pasa, no se
  // muestra el ingenio (no falla, solo lo omite).
  maestro?: MaestroRow[]
  onSave?: (assignment: Assignment, patch: EditPatch) => Promise<boolean>
  busy?: boolean
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

function formatDateTime(value: string | null) {
  if (!value) return '-'
  const d = new Date(value)
  const date = d.toLocaleDateString('es-CO', {
    timeZone: 'America/Bogota',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
  return `${date}, ${formatTime(value)}`
}

function Row({ label, value }: { label: string; value: string | number | null | undefined }) {
  if (value === null || value === undefined || value === '') return null
  return (
    <div className="assignment-detail-row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

export const AssignmentDetailModal = memo(function AssignmentDetailModal({
  assignment,
  onClose,
  canEdit,
  equipment,
  maestro,
  onSave,
  busy,
}: Props) {
  const [editing, setEditing] = useState(false)
  const [executedArea, setExecutedArea] = useState('')
  const [horometroInicial, setHorometroInicial] = useState('')
  const [horometroFinal, setHorometroFinal] = useState('')
  const [notes, setNotes] = useState('')
  const [equipmentCode, setEquipmentCode] = useState('')

  useEffect(() => {
    if (!assignment) {
      setEditing(false)
      return
    }
    setExecutedArea(assignment.executedArea ? String(assignment.executedArea) : '')
    setHorometroInicial(assignment.horometroInicial != null ? String(assignment.horometroInicial) : '')
    setHorometroFinal(assignment.horometroFinal != null ? String(assignment.horometroFinal) : '')
    setNotes(assignment.notes ?? '')
    setEquipmentCode(assignment.equipmentCode ?? '')
    setEditing(false)
  }, [assignment])

  if (!assignment) return null

  const a = assignment
  const meta = getStatusMeta(a)
  const completion = a.area > 0 ? Math.round((a.executedArea / a.area) * 100) : 0
  const horometroDiff =
    a.horometroInicial !== null && a.horometroFinal !== null
      ? Math.max(0, a.horometroFinal - a.horometroInicial)
      : null

  const approvalLabel =
    a.approval === 'APROBADA'
      ? `Aprobada${a.approvedAt ? ` el ${formatDateTime(a.approvedAt)}` : ''}`
      : a.approval === 'RECHAZADA'
      ? 'Rechazada'
      : null

  const showEditButton = canEdit && onSave && !editing

  async function handleSave() {
    if (!onSave) return
    const patch: EditPatch = {}
    const exec = Number(executedArea)
    if (!isNaN(exec) && exec !== a.executedArea) patch.executedArea = exec
    const hi = horometroInicial.trim() === '' ? null : Number(horometroInicial)
    if (hi !== a.horometroInicial) patch.horometroInicial = hi
    const hf = horometroFinal.trim() === '' ? null : Number(horometroFinal)
    if (hf !== a.horometroFinal) patch.horometroFinal = hf
    if (notes !== (a.notes ?? '')) patch.notes = notes
    if (equipmentCode !== a.equipmentCode) patch.equipmentCode = equipmentCode

    if (Object.keys(patch).length === 0) {
      setEditing(false)
      return
    }
    const ok = await onSave(a, patch)
    if (ok) setEditing(false)
  }

  return (
    <div
      className="modal-overlay open"
      onClick={(e) => {
        e.stopPropagation()
        onClose()
      }}
    >
      <div
        className="modal-card assignment-detail-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="labor-detail-header">
          <div>
            <p className="eyebrow">{a.haciendaName}</p>
            <h3>Suerte {a.suerte}</h3>
          </div>
          <button className="modal-close-btn" onClick={onClose} aria-label="Cerrar">
            &#x2715;
          </button>
        </div>

        <div className="assignment-detail-status">
          <span className={`status-pill ${meta.tone}`}>{meta.label}</span>
          <span className={`kind-badge ${a.kind === 'ASIGNADA' ? 'asignada' : 'libre'}`}>
            {a.kind === 'ASIGNADA' ? 'Programada' : 'Campo libre'}
          </span>
          {showEditButton && (
            <button
              type="button"
              className="inline-button"
              onClick={() => setEditing(true)}
              style={{ marginLeft: 'auto' }}
            >
              Editar
            </button>
          )}
        </div>

        <section className="assignment-detail-section">
          <p className="eyebrow">Labor</p>
          <p className="assignment-detail-labor">{a.labor}</p>
        </section>

        <section className="assignment-detail-section">
          <p className="eyebrow">Áreas</p>
          {editing ? (
            <label className="assignment-detail-field">
              <span>Hectáreas ejecutadas</span>
              <input
                type="number"
                min={0}
                step={0.01}
                value={executedArea}
                onChange={(e) => setExecutedArea(e.target.value)}
              />
              <small>Planificadas: {a.area.toFixed(2)} ha</small>
            </label>
          ) : (
            <>
              <div className="assignment-detail-areas">
                <div>
                  <strong>{a.executedArea.toFixed(2)}</strong>
                  <span>ha ejecutadas</span>
                </div>
                <div>
                  <strong>{a.area.toFixed(2)}</strong>
                  <span>ha planificadas</span>
                </div>
                <div>
                  <strong>{a.area > 0 ? `${completion}%` : '-'}</strong>
                  <span>cumplimiento</span>
                </div>
              </div>
              {a.area > 0 && (
                <div className="progress-track">
                  <span style={{ width: `${Math.min(completion, 100)}%` }} />
                </div>
              )}
            </>
          )}
        </section>

        <section className="assignment-detail-section">
          <p className="eyebrow">Personas y equipo</p>
          {editing ? (
            <>
              <Row label="Operador" value={a.operatorName} />
              <label className="assignment-detail-field">
                <span>Equipo</span>
                <select value={equipmentCode} onChange={(e) => setEquipmentCode(e.target.value)}>
                  <option value="">Sin equipo</option>
                  {(equipment ?? []).map((eq) => (
                    <option key={eq.code} value={eq.code}>{eq.name}</option>
                  ))}
                </select>
              </label>
            </>
          ) : (
            <dl className="assignment-detail-grid">
              <Row label="Operador" value={a.operatorName} />
              <Row label="Equipo" value={a.equipmentName || a.equipmentCode} />
            </dl>
          )}
        </section>

        <section className="assignment-detail-section">
          <p className="eyebrow">Tiempos</p>
          <dl className="assignment-detail-grid">
            <Row label="Programada" value={a.dateKey} />
            <Row label="Creada" value={formatDateTime(a.createdAt)} />
            <Row label="Iniciada" value={formatDateTime(a.startedAt)} />
            <Row label="Finalizada" value={formatDateTime(a.finishedAt)} />
          </dl>
        </section>

        <section className="assignment-detail-section">
          <p className="eyebrow">Horómetros</p>
          {editing ? (
            <div className="assignment-detail-field-grid">
              <label className="assignment-detail-field">
                <span>Inicial</span>
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  value={horometroInicial}
                  onChange={(e) => setHorometroInicial(e.target.value)}
                />
              </label>
              <label className="assignment-detail-field">
                <span>Final</span>
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  value={horometroFinal}
                  onChange={(e) => setHorometroFinal(e.target.value)}
                />
              </label>
            </div>
          ) : horometroDiff !== null ? (
            <dl className="assignment-detail-grid">
              <Row label="Inicial" value={a.horometroInicial} />
              <Row label="Final" value={a.horometroFinal} />
              <Row label="Trabajado" value={horometroDiff.toFixed(1)} />
            </dl>
          ) : (
            <p className="muted-text">Sin horómetros registrados.</p>
          )}
        </section>

        {(() => {
          const ingenio = maestro ? getIngenioName(a, maestro) : null
          if (editing || (!a.zone && !a.cliente && !ingenio)) return null
          return (
            <section className="assignment-detail-section">
              <p className="eyebrow">Contexto</p>
              <dl className="assignment-detail-grid">
                <Row label="Ingenio" value={ingenio} />
                <Row label="Zona" value={a.zone} />
                <Row label="Cliente" value={a.cliente} />
              </dl>
            </section>
          )
        })()}

        {approvalLabel && !editing && (
          <section className="assignment-detail-section">
            <p className="eyebrow">Aprobación</p>
            <p>{approvalLabel}</p>
          </section>
        )}

        <section className="assignment-detail-section">
          <p className="eyebrow">Notas</p>
          {editing ? (
            <textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Observaciones"
              className="assignment-detail-notes-input"
            />
          ) : a.notes && a.notes.trim() ? (
            <p className="assignment-detail-notes">{a.notes}</p>
          ) : (
            <p className="muted-text">Sin notas.</p>
          )}
        </section>

        {editing && (
          <div className="modal-footer">
            <button
              type="button"
              className="inline-button"
              onClick={() => setEditing(false)}
              disabled={busy}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="primary-button"
              onClick={() => void handleSave()}
              disabled={busy}
            >
              {busy ? 'Guardando...' : 'Guardar cambios'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
})
