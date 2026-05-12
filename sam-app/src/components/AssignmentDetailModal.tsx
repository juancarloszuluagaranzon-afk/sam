import { memo } from 'react'
import type { Assignment } from '../domain/sam'
import { formatTime } from '../services/samApi'

interface Props {
  assignment: Assignment | null
  onClose: () => void
}

function getStatusMeta(a: Assignment) {
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
}: Props) {
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
        </div>

        <section className="assignment-detail-section">
          <p className="eyebrow">Labor</p>
          <p className="assignment-detail-labor">{a.labor}</p>
        </section>

        <section className="assignment-detail-section">
          <p className="eyebrow">Áreas</p>
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
        </section>

        <section className="assignment-detail-section">
          <p className="eyebrow">Personas y equipo</p>
          <dl className="assignment-detail-grid">
            <Row label="Operador" value={a.operatorName} />
            <Row label="Equipo" value={a.equipmentName || a.equipmentCode} />
          </dl>
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

        {horometroDiff !== null && (
          <section className="assignment-detail-section">
            <p className="eyebrow">Horómetros</p>
            <dl className="assignment-detail-grid">
              <Row label="Inicial" value={a.horometroInicial} />
              <Row label="Final" value={a.horometroFinal} />
              <Row label="Trabajado" value={horometroDiff.toFixed(1)} />
            </dl>
          </section>
        )}

        {(a.zone || a.cliente) && (
          <section className="assignment-detail-section">
            <p className="eyebrow">Contexto</p>
            <dl className="assignment-detail-grid">
              <Row label="Zona" value={a.zone} />
              <Row label="Cliente" value={a.cliente} />
            </dl>
          </section>
        )}

        {approvalLabel && (
          <section className="assignment-detail-section">
            <p className="eyebrow">Aprobación</p>
            <p>{approvalLabel}</p>
          </section>
        )}

        {a.notes && a.notes.trim() && (
          <section className="assignment-detail-section">
            <p className="eyebrow">Notas</p>
            <p className="assignment-detail-notes">{a.notes}</p>
          </section>
        )}
      </div>
    </div>
  )
})
