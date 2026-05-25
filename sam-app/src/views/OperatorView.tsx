import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useAppData } from '../context/AppDataContext'
import { useAssignmentActions } from '../hooks/useAssignmentActions'
import { useFreeFieldForm } from '../hooks/useFreeFieldForm'
import { usePhotoUpload } from '../hooks/usePhotoUpload'
import logoAgromorales from '../assets/logo-agromorales.jpeg'
import SearchableSelect from '../components/SearchableSelect'
import { DictateButton } from '../components/DictateButton'
import { DictateInlineButton } from '../components/DictateInlineButton'
import { DiagnosticModal } from '../components/DiagnosticModal'
import { ThemeToggle } from '../components/ThemeToggle'
import { parseSpokenNumber, findItemByVoice } from '../utils/voiceParser'
import { WORKFLOW } from '../data/constants'
import type { Assignment, UserProfile } from '../domain/sam'
import { formatTime, executionDateKey } from '../services/samApi'

type OperatorTab = 'activas' | 'campo' | 'historial'

const INGENIOS = [
  { id: 'risaralda', nombre: 'Ingenio Risaralda' },
  { id: 'pichichi', nombre: 'Ingenio Pichichi' },
  { id: 'mayaguez', nombre: 'Ingenio Mayaguez' },
  { id: 'san_carlos', nombre: 'Ingenio San Carlos' },
  { id: 'riopaila', nombre: 'Ingenio Riopaila' },
]

function initials(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
}

function getRoleLabel(role: UserProfile['role'] | undefined): string {
  if (role === 'owner') return 'Propietario'
  if (role === 'supervisor') return 'Supervisor'
  if (role === 'administracion') return 'Administración'
  return 'Operador'
}

function formatArea(value: number) {
  return `${value.toFixed(2)} ha`
}

function normalizeText(value: string) {
  return value.trim().toUpperCase()
}

function getRemainingArea(assignments: Assignment[], suerteCode: string, labor: string, totalArea: number): number {
  const executed = assignments
    .filter(
      (a) =>
        a.suerteCode === suerteCode &&
        normalizeText(a.labor) === normalizeText(labor) &&
        a.status === 'COMPLETADA',
    )
    .reduce((sum, a) => sum + (a.executedArea ?? 0), 0)
  return Math.max(0, totalArea - executed)
}

function getSuggestedLabor(assignments: Assignment[], suerteCode: string) {
  const completed = assignments
    .filter(
      (a) =>
        a.suerteCode === suerteCode &&
        a.status === 'COMPLETADA' &&
        WORKFLOW.includes(normalizeText(a.labor)),
    )
    .map((a) => normalizeText(a.labor))
  return WORKFLOW.find((labor) => !completed.includes(labor)) ?? WORKFLOW[0]
}

function getStatusMeta(assignment: Pick<Assignment, 'status' | 'executedArea' | 'area'>) {
  if (assignment.status === 'COMPLETADA') {
    if (assignment.executedArea > 0 && assignment.executedArea < assignment.area) {
      return { label: 'Parcial', tone: 'progress' as const }
    }
    return { label: 'Completada', tone: 'done' as const }
  }
  if (assignment.status === 'EN_PROCESO') return { label: 'Laborando', tone: 'progress' as const }
  if (assignment.status === 'CANCELADA') return { label: 'Cancelada', tone: 'cancel' as const }
  return { label: 'Pendiente', tone: 'pending' as const }
}

function normalizeIdentity(value: string | null | undefined) {
  return String(value ?? '').trim().toUpperCase()
}

interface Props {
  operatorTab: OperatorTab
  setOperatorTab: (tab: OperatorTab) => void
  isSideMenuOpen: boolean
  setIsSideMenuOpen: (open: boolean) => void
  isPinModalOpen: boolean
  setIsPinModalOpen: (open: boolean) => void
  historyMonth: string
  setHistoryMonth: React.Dispatch<React.SetStateAction<string>>
  historyPeriod: 'Q1' | 'Q2' | 'MES'
  setHistoryPeriod: React.Dispatch<React.SetStateAction<'Q1' | 'Q2' | 'MES'>>
  pinForm: { current: string; newPin: string; confirm: string; error: string; loading: boolean }
  setPinForm: React.Dispatch<React.SetStateAction<{ current: string; newPin: string; confirm: string; error: string; loading: boolean }>>
  handleChangePin: (e: FormEvent) => Promise<void>
  onSaveSession: (user: UserProfile | null) => void
}

export function OperatorView({
  operatorTab,
  setOperatorTab,
  isSideMenuOpen,
  setIsSideMenuOpen,
  isPinModalOpen,
  setIsPinModalOpen,
  historyMonth,
  setHistoryMonth,
  historyPeriod,
  setHistoryPeriod,
  pinForm,
  setPinForm,
  handleChangePin,
  onSaveSession,
}: Props) {
  const { session, assignments, setAssignments, sortedEquipment, isOnline, outboxCount, busy, error, info, todayKey } = useAppData()
  const [isDiagOpen, setIsDiagOpen] = useState(false)

  const [isFreeFieldOpen, setIsFreeFieldOpen] = useState(false)

  const {
    freeFieldForm, updateFreeFieldForm,
    freeFieldSuertesList, toggleFreeFieldSuerte,
    freeFieldHaciendas, freeFieldSuertes,
    supervisors: freeFieldSupervisors,
    takeFreeField: onCreateFreeField,
  } = useFreeFieldForm({
    onFreeFieldTaken: () => {
      setIsFreeFieldOpen(false)
      setOperatorTab('activas')
    },
  })

  const {
    finishDrafts, setFinishDrafts,
    startEquipmentDrafts, setStartEquipmentDrafts,
    startHorometroDrafts, setStartHorometroDrafts,
    startAssignment: onStartAssignment,
    finishAssignment: onFinishAssignment,
  } = useAssignmentActions()

  const { fileInputRef: photoInputRef, triggerUpload: triggerPhotoUpload, handleFileChange: handlePhotoChange, uploading: photoUploading } = usePhotoUpload()

  const operatorAssignments = useMemo(() => {
    if (!session) return []
    const sessionId = normalizeIdentity(session.id)
    const sessionName = normalizeIdentity(session.name)
    return assignments.filter((a) => {
      const aId = normalizeIdentity(a.operatorId)
      const aName = normalizeIdentity(a.operatorName)
      return aId === sessionId || (aId === '' && aName === sessionName) || aName === sessionName
    })
  }, [assignments, session])

  const operatorMetrics = useMemo(() => {
    const todayBogota = (iso: string | null) =>
      iso ? new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Bogota' }) : ''
    const relevant = operatorAssignments.filter(
      (a) =>
        a.status !== 'CANCELADA' &&
        (a.dateKey === todayKey || (a.status === 'COMPLETADA' && todayBogota(a.finishedAt) === todayKey)),
    )
    const todayPlanned = relevant.reduce((sum, a) => sum + a.area, 0)
    const todayExecuted = relevant.filter((a) => a.status === 'COMPLETADA').reduce((sum, a) => sum + a.executedArea, 0)
    const completion = todayPlanned ? Math.round((todayExecuted / todayPlanned) * 100) : 0
    const inProgress = relevant.filter((a) => a.status === 'EN_PROCESO').length
    const pending = relevant.filter((a) => a.status === 'PENDIENTE').length
    return { todayPlanned, todayExecuted, completion, inProgress, pending }
  }, [operatorAssignments, todayKey])

  const activeAssignments = useMemo(
    () => operatorAssignments.filter((a) => a.status === 'PENDIENTE' || a.status === 'EN_PROCESO'),
    [operatorAssignments],
  )

  const [selectedActiveAssignment, setSelectedActiveAssignment] = useState<Assignment | null>(null)

  useEffect(() => {
    if (!selectedActiveAssignment) return
    const fresh = activeAssignments.find((a) => a.id === selectedActiveAssignment.id)
    if (!fresh) {
      setSelectedActiveAssignment(null)
    } else if (fresh !== selectedActiveAssignment) {
      setSelectedActiveAssignment(fresh)
    }
  }, [activeAssignments, selectedActiveAssignment])


  const historyAssignments = useMemo(
    () => operatorAssignments.filter((a) => a.status === 'COMPLETADA' || a.status === 'CANCELADA'),
    [operatorAssignments],
  )

  const historyMonths = useMemo(() => {
    const set = new Set<string>()
    historyAssignments.forEach((a) => { if (a.dateKey) set.add(a.dateKey.slice(0, 7)) })
    return Array.from(set).sort((a, b) => b.localeCompare(a))
  }, [historyAssignments])

  const filteredHistory = useMemo(() => {
    const [year, month] = historyMonth.split('-').map(Number)
    let startLimit: Date
    let endLimit: Date
    if (historyPeriod === 'Q1') {
      startLimit = new Date(year, month - 1, 1)
      endLimit = new Date(year, month - 1, 15)
    } else if (historyPeriod === 'Q2') {
      startLimit = new Date(year, month - 1, 16)
      endLimit = new Date(year, month, 0)
    } else {
      startLimit = new Date(year, month - 1, 1)
      endLimit = new Date(year, month, 0)
    }
    return historyAssignments.filter((a) => {
      // Agrupar por fecha de EJECUCIÓN, no de asignación. Una labor asignada el 14-may
      // pero terminada el 16-may aparece en la Q2 de mayo, no en la Q1.
      const key = executionDateKey(a)
      if (!key) return false
      const [y, m, d] = key.split('-').map(Number)
      const date = new Date(y, m - 1, d)
      return date >= startLimit && date <= endLimit
    })
  }, [historyAssignments, historyMonth, historyPeriod])

  if (!session) return null

  function updateFinishDraft(assignmentId: string, field: 'area' | 'notes' | 'horometroFinal', value: string) {
    setFinishDrafts((current) => ({
      ...current,
      [assignmentId]: {
        area: current[assignmentId]?.area ?? '',
        notes: current[assignmentId]?.notes ?? '',
        horometroFinal: current[assignmentId]?.horometroFinal ?? '',
        isComplete: current[assignmentId]?.isComplete ?? false,
        [field]: value,
      },
    }))
  }

  function setFinishDraftComplete(assignmentId: string, isComplete: boolean, fullArea: number) {
    setFinishDrafts((current) => ({
      ...current,
      [assignmentId]: {
        area: isComplete ? fullArea.toFixed(2) : (current[assignmentId]?.area ?? ''),
        notes: current[assignmentId]?.notes ?? '',
        horometroFinal: current[assignmentId]?.horometroFinal ?? '',
        isComplete,
      },
    }))
  }

  function updateStartHorometroDraft(assignmentId: string, value: string) {
    setStartHorometroDrafts((current) => ({ ...current, [assignmentId]: value }))
  }

  function updateStartEquipmentDraft(assignmentId: string, equipmentCode: string) {
    setStartEquipmentDrafts((current) => ({ ...current, [assignmentId]: equipmentCode }))
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <button
            className="top-icon-btn menu-left"
            onClick={() => setIsSideMenuOpen(!isSideMenuOpen)}
            aria-expanded={isSideMenuOpen}
            aria-controls="side-menu"
            aria-label="Abrir menu"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <rect y="3" width="20" height="2" rx="1" fill="currentColor"/>
              <rect y="9" width="20" height="2" rx="1" fill="currentColor"/>
              <rect y="15" width="20" height="2" rx="1" fill="currentColor"/>
            </svg>
          </button>
          <div className="brand-info">
            <img src={logoAgromorales} alt="AgroMorales" className="header-logo" />
            <div>
              <strong>AgroMorales</strong>
              <span>{getRoleLabel(session.role)}</span>
            </div>
          </div>
        </div>
        <div className="topbar-actions">
          <ThemeToggle />
        </div>
      </header>

      <div
        className={`side-overlay ${isSideMenuOpen ? 'open' : ''}`}
        onClick={() => setIsSideMenuOpen(false)}
      />

      <aside
        id="side-menu"
        className={`side-drawer ${isSideMenuOpen ? 'open' : ''}`}
        aria-hidden={!isSideMenuOpen}
      >
        <div className="side-drawer-head">
          <strong>Sesion activa</strong>
          <button className="inline-button" onClick={() => setIsSideMenuOpen(false)}>
            Cerrar
          </button>
        </div>
        <div className="side-user-card">
          {session.photoUrl ? (
            <img src={session.photoUrl} alt={session.name} className="side-user-photo" />
          ) : (
            <div className="avatar side-user-photo">{initials(session.name)}</div>
          )}
          <div className="side-user-info">
            <strong>{session.name}</strong>
            <p>{getRoleLabel(session.role)}</p>
          </div>
        </div>
        <input
          ref={photoInputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={handlePhotoChange}
        />
        <button
          className="primary-button outline"
          onClick={triggerPhotoUpload}
          disabled={photoUploading}
          style={{ marginBottom: '8px' }}
        >
          {photoUploading ? 'Subiendo foto...' : 'Cambiar foto'}
        </button>
        <button
          className="primary-button outline"
          onClick={() => { setIsSideMenuOpen(false); setIsPinModalOpen(true) }}
          style={{ marginBottom: '8px' }}
        >
          Cambiar PIN
        </button>
        <button
          className="primary-button outline"
          onClick={() => { setIsSideMenuOpen(false); setIsDiagOpen(true) }}
          style={{ marginBottom: '8px' }}
        >
          Diagnóstico
        </button>
        <button className="primary-button" onClick={() => onSaveSession(null)}>
          Salir
        </button>
        <div className="side-version-badge" title={`Build: ${__APP_BUILD_TIME__}`}>
          Version <code>{__APP_VERSION__}</code>
        </div>
      </aside>

      {isDiagOpen && session && (
        <DiagnosticModal
          session={session}
          assignmentsInState={assignments}
          isOnline={isOnline}
          outboxCount={outboxCount}
          onClose={() => setIsDiagOpen(false)}
          onAssignmentsReloaded={setAssignments}
        />
      )}

      {!isOnline && (
        <div className="offline-banner">
          <div className="offline-banner-left">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="1" y1="1" x2="23" y2="23"/>
              <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/>
              <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/>
              <path d="M10.71 5.05A16 16 0 0 1 22.56 9"/>
              <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/>
              <path d="M8.53 16.11a6 6 0 0 1 6.95 0"/>
              <line x1="12" y1="20" x2="12.01" y2="20"/>
            </svg>
            <span>Sin conexion - modo campo</span>
          </div>
          {outboxCount > 0 && (
            <span className="offline-badge">{outboxCount} pendiente{outboxCount > 1 ? 's' : ''}</span>
          )}
        </div>
      )}

      <div className="dashboard-shell">
        <section className="toolbar-card">
          <nav className="tab-nav floating-nav operator-tab-nav" aria-label="Navegacion principal">
            <button
              className={operatorTab === 'activas' ? 'active' : ''}
              onClick={() => setOperatorTab('activas')}
            >
              <span className="nav-item">
                <span className="nav-icon">▶</span>
                <span className="nav-label">Activas</span>
              </span>
            </button>
            <button
              className={operatorTab === 'campo' ? 'active' : ''}
              onClick={() => setOperatorTab('campo')}
            >
              <span className="nav-item">
                <span className="nav-icon">⌖</span>
                <span className="nav-label">Campo</span>
              </span>
            </button>
            <button
              className={operatorTab === 'historial' ? 'active' : ''}
              onClick={() => setOperatorTab('historial')}
            >
              <span className="nav-item">
                <span className="nav-icon">◷</span>
                <span className="nav-label">Historial</span>
              </span>
            </button>
          </nav>
        </section>

        {(error || info) && (
          <section className="message-stack">
            {error ? <div className="feedback error">{error}</div> : null}
            {info ? <div className="feedback success">{info}</div> : null}
          </section>
        )}

        {operatorTab === 'activas' ? (
          <section className="operator-stack operator-mobile-stack">
            <div className="operator-kpi-grid">
              <article className="operator-kpi-card operator-kpi-card--neutral">
                <strong>{operatorMetrics.todayPlanned.toFixed(2)}</strong>
                <span>ha planificadas hoy</span>
              </article>
              <article className="operator-kpi-card operator-kpi-card--green">
                <strong>{operatorMetrics.todayExecuted.toFixed(2)}</strong>
                <span>ha ejecutadas</span>
                <div className="operator-kpi-bar">
                  <span style={{ width: `${Math.min(operatorMetrics.completion, 100)}%` }} />
                </div>
              </article>
              <article className={`operator-kpi-card ${operatorMetrics.completion >= 70 ? 'operator-kpi-card--green' : operatorMetrics.completion >= 30 ? 'operator-kpi-card--amber' : 'operator-kpi-card--red'}`}>
                <strong>{operatorMetrics.completion}%</strong>
                <span>cumplimiento</span>
                <div className="operator-kpi-bar">
                  <span style={{ width: `${Math.min(operatorMetrics.completion, 100)}%` }} />
                </div>
              </article>
              <article className="operator-kpi-card operator-kpi-card--amber">
                <strong>{operatorMetrics.inProgress}</strong>
                <span>{operatorMetrics.inProgress === 1 ? 'labor en progreso' : 'labores en progreso'}</span>
              </article>
            </div>
            {activeAssignments.map((assignment) => {
              const meta = getStatusMeta(assignment)
              return (
                <button
                  key={assignment.id}
                  type="button"
                  className="panel-card active-card-compact"
                  onClick={() => setSelectedActiveAssignment(assignment)}
                >
                  <div className="active-card-compact__main">
                    <h2>{assignment.haciendaName} - {assignment.suerte}</h2>
                    <p className="subtle-copy">
                      {assignment.labor}{' '}
                      {assignment.kind === 'ASIGNADA' ? (
                        <span className="kind-badge asignada">Prog.</span>
                      ) : (
                        <span className="kind-badge libre">Campo</span>
                      )}{' '}
                      - {formatArea(assignment.area)}
                    </p>
                  </div>
                  <span className={`status-pill ${meta.tone}`}>{meta.label}</span>
                </button>
              )
            })}
            {!activeAssignments.length ? (
              <section className="panel-card empty-card">
                <h2>Sin labores activas</h2>
                <p>Puedes tomar una suerte desde la pestana Campo libre.</p>
              </section>
            ) : null}

            {selectedActiveAssignment && (() => {
              const a = selectedActiveAssignment
              const draft = finishDrafts[a.id]
              return (
                <>
                  <div className="more-sheet-overlay" onClick={() => setSelectedActiveAssignment(null)} />
                  <div className="more-sheet active-sheet" role="dialog" aria-label={`Labor ${a.labor}`}>
                    <div className="more-sheet__handle" />
                    <div className="active-sheet__header">
                      <div>
                        <strong>{a.haciendaName} - {a.suerte}</strong>
                        <span className="subtle-copy">{a.labor} - {formatArea(a.area)}</span>
                      </div>
                      <button
                        type="button"
                        className="active-sheet__close"
                        onClick={() => setSelectedActiveAssignment(null)}
                        aria-label="Cerrar"
                      >
                        ✕
                      </button>
                    </div>

                    <div className="active-meta">
                      <span>Equipo: {a.equipmentName || '-'}</span>
                      <span>Inicio: {formatTime(a.startedAt)}</span>
                      {a.horometroInicial != null && (
                        <span>Horometro inicial: {a.horometroInicial}</span>
                      )}
                    </div>

                    {a.status === 'PENDIENTE' ? (
                      <div className="start-grid">
                        <label>
                          Equipo para ejecutar
                          <select
                            value={
                              startEquipmentDrafts[a.id] ||
                              a.equipmentCode ||
                              session.equipmentCode
                            }
                            onChange={(event) =>
                              updateStartEquipmentDraft(a.id, event.target.value)
                            }
                          >
                            <option value="">Seleccionar equipo</option>
                            {sortedEquipment.map((item) => (
                              <option key={item.code} value={item.code}>
                                {item.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Horometro inicial
                          <div className="dictate-input-wrap">
                            <input
                              type="number"
                              min={0}
                              step={0.1}
                              value={startHorometroDrafts[a.id] ?? ''}
                              onChange={(event) =>
                                updateStartHorometroDraft(a.id, event.target.value)
                              }
                              placeholder="Ej: 4523.5"
                            />
                            <DictateInlineButton
                              ariaLabel="Dictar horómetro inicial"
                              onComplete={(text) => {
                                const num = parseSpokenNumber(text)
                                if (num !== null) updateStartHorometroDraft(a.id, String(num))
                              }}
                            />
                          </div>
                        </label>
                        <button
                          className="primary-button"
                          onClick={() => void onStartAssignment(a)}
                          disabled={busy}
                        >
                          Iniciar labor
                        </button>
                      </div>
                    ) : (
                      <div className="finish-grid">
                        <div className="complete-toggle-row">
                          <div>
                            <span className="complete-toggle-label">Labor completada al 100%</span>
                            <span className="complete-toggle-hint">
                              {draft?.isComplete
                                ? `Se registran ${formatArea(a.area)}`
                                : 'Ingresa el área ejecutada'}
                            </span>
                          </div>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={draft?.isComplete ?? false}
                            className={`toggle-switch ${(draft?.isComplete ?? false) ? 'on' : ''}`}
                            onClick={() => setFinishDraftComplete(a.id, !(draft?.isComplete ?? false), a.area)}
                          >
                            <span className="toggle-thumb" />
                          </button>
                        </div>

                        {!(draft?.isComplete ?? false) && (
                          <label>
                            Ha ejecutadas
                            <div className="dictate-input-wrap">
                              <input
                                type="number"
                                min={0.1}
                                step={0.1}
                                max={a.area}
                                value={draft?.area ?? ''}
                                onChange={(event) =>
                                  updateFinishDraft(a.id, 'area', event.target.value)
                                }
                                placeholder={`máx. ${a.area.toFixed(2)}`}
                              />
                              <DictateInlineButton
                                ariaLabel="Dictar hectáreas ejecutadas"
                                onComplete={(text) => {
                                  const num = parseSpokenNumber(text)
                                  if (num !== null) updateFinishDraft(a.id, 'area', String(num))
                                }}
                              />
                            </div>
                          </label>
                        )}

                        <label>
                          Horometro final
                          <div className="dictate-input-wrap">
                            <input
                              type="number"
                              min={0}
                              step={0.1}
                              value={draft?.horometroFinal ?? ''}
                              onChange={(event) =>
                                updateFinishDraft(a.id, 'horometroFinal', event.target.value)
                              }
                              placeholder="Ej: 4541.2"
                            />
                            <DictateInlineButton
                              ariaLabel="Dictar horómetro final"
                              onComplete={(text) => {
                                const num = parseSpokenNumber(text)
                                if (num !== null) updateFinishDraft(a.id, 'horometroFinal', String(num))
                              }}
                            />
                          </div>
                        </label>
                        <label className="finish-notes">
                          <div className="dictate-field-header">
                            <span>Observaciones</span>
                            <DictateButton
                              onComplete={(text) => {
                                const prev = (draft?.notes ?? '').trimEnd()
                                const next = prev ? `${prev} ${text}` : text
                                updateFinishDraft(a.id, 'notes', next)
                              }}
                            />
                          </div>
                          <textarea
                            rows={3}
                            value={draft?.notes ?? ''}
                            onChange={(event) =>
                              updateFinishDraft(a.id, 'notes', event.target.value)
                            }
                            placeholder="Notas de cierre"
                          />
                        </label>
                        <button
                          className="primary-button"
                          onClick={() => void onFinishAssignment(a)}
                          disabled={busy}
                        >
                          Finalizar
                        </button>
                      </div>
                    )}
                  </div>
                </>
              )
            })()}
          </section>
        ) : null}

        {operatorTab === 'campo' ? (
          <section className="assign-tab-stack">
            <button
              type="button"
              className="primary-button assign-cta"
              onClick={() => setIsFreeFieldOpen(true)}
            >
              + Tomar suerte en campo
            </button>

            <article className="panel-card operator-journey-card">
              <div className="panel-title">
                <h2>Tu jornada</h2>
              </div>
              <div className="journey-stats">
                <div>
                  <strong>{activeAssignments.length}</strong>
                  <span>activas</span>
                </div>
                <div>
                  <strong>{historyAssignments.length}</strong>
                  <span>cerradas</span>
                </div>
                <div>
                  <strong>
                    {historyAssignments
                      .filter((item) => item.status === 'COMPLETADA')
                      .reduce((sum, item) => sum + item.executedArea, 0)
                      .toFixed(2)}
                  </strong>
                  <span>ha ejecutadas</span>
                </div>
              </div>
            </article>
          </section>
        ) : null}

        {operatorTab === 'historial' ? (
          <section className="panel-card operator-history-card">
            <div className="panel-title split">
              <h2>Historial</h2>
              <div style={{ display: 'flex', gap: '6px' }}>
                <select
                  value={historyMonth}
                  onChange={(e) => setHistoryMonth(e.target.value)}
                  className="base-input"
                  style={{ width: 'auto', margin: 0, padding: '4px 8px', fontSize: '0.85rem' }}
                >
                  {historyMonths.length === 0 && (
                    <option value={historyMonth}>{historyMonth}</option>
                  )}
                  {historyMonths.map((m) => {
                    const [y, mo] = m.split('-')
                    const label = new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString('es-CO', { month: 'long', year: 'numeric' })
                    return <option key={m} value={m}>{label}</option>
                  })}
                </select>
                <select
                  value={historyPeriod}
                  onChange={(e) => setHistoryPeriod(e.target.value as 'Q1' | 'Q2' | 'MES')}
                  className="base-input"
                  style={{ width: 'auto', margin: 0, padding: '4px 8px', fontSize: '0.85rem' }}
                >
                  <option value="MES">Mes completo</option>
                  <option value="Q1">Quincena 1 (1–15)</option>
                  <option value="Q2">Quincena 2 (16–fin)</option>
                </select>
              </div>
            </div>

            {(() => {
              const completadas = filteredHistory.filter((a) => a.status === 'COMPLETADA')
              const haPlaneadas = completadas.reduce((sum, a) => sum + a.area, 0)
              const haEjecutadas = completadas.reduce((sum, a) => sum + a.executedArea, 0)
              const eficiencia = haPlaneadas ? Math.round((haEjecutadas / haPlaneadas) * 100) : 0
              return (
                <div className="operator-kpi-grid" style={{ margin: '1rem 0 1.5rem' }}>
                  <article className="operator-kpi-card operator-kpi-card--neutral">
                    <strong>{haPlaneadas.toFixed(2)}</strong>
                    <span>ha planificadas</span>
                  </article>
                  <article className="operator-kpi-card operator-kpi-card--green">
                    <strong>{haEjecutadas.toFixed(2)}</strong>
                    <span>ha ejecutadas</span>
                  </article>
                  <article className="operator-kpi-card operator-kpi-card--green">
                    <strong>{completadas.length}</strong>
                    <span>{completadas.length === 1 ? 'completada' : 'completadas'}</span>
                  </article>
                  <article className={`operator-kpi-card ${eficiencia >= 70 ? 'operator-kpi-card--green' : eficiencia >= 30 ? 'operator-kpi-card--amber' : 'operator-kpi-card--red'}`}>
                    <strong>{haPlaneadas ? `${eficiencia}%` : '-'}</strong>
                    <span>eficiencia</span>
                    {haPlaneadas > 0 && (
                      <div className="operator-kpi-bar">
                        <span style={{ width: `${Math.min(eficiencia, 100)}%` }} />
                      </div>
                    )}
                  </article>
                </div>
              )
            })()}

            <div className="list-rows">
              {filteredHistory.map((assignment) => {
                const meta = getStatusMeta(assignment)
                return (
                  <div key={assignment.id} className="movement-row">
                    <div>
                      <strong>
                        {assignment.haciendaName} - {assignment.suerte}
                      </strong>
                      <span>
                        {assignment.labor}{' '}
                        {assignment.kind === 'ASIGNADA' ? (
                          <span className="kind-badge asignada">Prog.</span>
                        ) : (
                          <span className="kind-badge libre">Campo</span>
                        )}{' '}
                        - {assignment.executedArea.toFixed(2)} ha
                      </span>
                    </div>
                    <div className="movement-side">
                      <span className={`status-pill ${meta.tone}`}>{meta.label}</span>
                      <small>{formatTime(assignment.finishedAt)}</small>
                    </div>
                  </div>
                )
              })}
              {!filteredHistory.length ? (
                <p className="muted-text">Aun no hay labores cerradas.</p>
              ) : null}
            </div>
          </section>
        ) : null}

        <div className={`modal-overlay ${isPinModalOpen ? 'open' : ''}`}>
          <div className="modal-card">
            <h3>Cambiar PIN</h3>
            <form onSubmit={handleChangePin} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div className="field">
                <label>PIN Actual</label>
                <input
                  type="password"
                  pattern="[0-9]*"
                  inputMode="numeric"
                  value={pinForm.current}
                  onChange={e => setPinForm(p => ({ ...p, current: e.target.value, error: '' }))}
                  required
                />
              </div>
              <div className="field">
                <label>Nuevo PIN</label>
                <input
                  type="password"
                  pattern="[0-9]*"
                  inputMode="numeric"
                  value={pinForm.newPin}
                  onChange={e => setPinForm(p => ({ ...p, newPin: e.target.value, error: '' }))}
                  required
                />
              </div>
              <div className="field">
                <label>Confirmar Nuevo PIN</label>
                <input
                  type="password"
                  pattern="[0-9]*"
                  inputMode="numeric"
                  value={pinForm.confirm}
                  onChange={e => setPinForm(p => ({ ...p, confirm: e.target.value, error: '' }))}
                  required
                />
              </div>
              {pinForm.error && <div className="detail-error" style={{ marginBottom: '0' }}>{pinForm.error}</div>}
              <div className="modal-footer">
                <button type="button" className="inline-button" onClick={() => setIsPinModalOpen(false)}>Cancelar</button>
                <button type="submit" className="primary-button" disabled={pinForm.loading}>
                  {pinForm.loading ? 'Cambiando...' : 'Guardar'}
                </button>
              </div>
            </form>
          </div>
        </div>

      </div>

      {isFreeFieldOpen && (
        <>
          <div className="more-sheet-overlay" onClick={() => setIsFreeFieldOpen(false)} />
          <div className="more-sheet assign-sheet" role="dialog" aria-label="Tomar suerte en campo">
            <div className="more-sheet__handle" />
            <div className="active-sheet__header">
              <div>
                <strong>Tomar suerte en campo</strong>
                <span className="subtle-copy">Registra una labor que no estaba programada</span>
              </div>
              <button
                type="button"
                className="active-sheet__close"
                onClick={() => setIsFreeFieldOpen(false)}
                aria-label="Cerrar"
              >
                ✕
              </button>
            </div>

            <form className="form-grid-block" onSubmit={onCreateFreeField}>
              <label>
                Zona
                <div className="dictate-input-wrap">
                  <SearchableSelect
                    value={freeFieldForm.zone}
                    onChange={(value) => updateFreeFieldForm('zone', value)}
                    placeholder="Selecciona la zona"
                    options={[
                      { value: 'NORTE', label: 'Zona Norte' },
                      { value: 'SUR', label: 'Zona Sur' },
                    ]}
                  />
                  <DictateInlineButton
                    ariaLabel="Dictar zona"
                    onComplete={(text) => {
                      const match = findItemByVoice(text, [
                        { code: 'NORTE', name: 'Norte' },
                        { code: 'SUR', name: 'Sur' },
                      ])
                      if (match) updateFreeFieldForm('zone', match.code)
                    }}
                  />
                </div>
              </label>
              <label>
                Cliente
                <div className="dictate-input-wrap">
                  <SearchableSelect
                    value={freeFieldForm.cliente}
                    onChange={(value) => updateFreeFieldForm('cliente', value)}
                    options={[
                      { value: 'ingenios', label: 'Ingenios' },
                      { value: 'proveedores', label: 'Proveedores' },
                    ]}
                  />
                  <DictateInlineButton
                    ariaLabel="Dictar cliente"
                    onComplete={(text) => {
                      const match = findItemByVoice(text, [
                        { code: 'ingenios', name: 'Ingenios' },
                        { code: 'proveedores', name: 'Proveedores' },
                      ])
                      if (match) updateFreeFieldForm('cliente', match.code)
                    }}
                  />
                </div>
              </label>
              <label>
                Ingenio
                <div className="dictate-input-wrap">
                  <SearchableSelect
                    value={freeFieldForm.ingenioId}
                    onChange={(value) => updateFreeFieldForm('ingenioId', value)}
                    placeholder="Selecciona un ingenio"
                    options={INGENIOS.map((ing) => ({ value: ing.id, label: ing.nombre }))}
                  />
                  <DictateInlineButton
                    ariaLabel="Dictar ingenio"
                    onComplete={(text) => {
                      const match = findItemByVoice(
                        text,
                        INGENIOS.map((ing) => ({ code: ing.id, name: ing.nombre })),
                      )
                      if (match) updateFreeFieldForm('ingenioId', match.code)
                    }}
                  />
                </div>
              </label>
              <label>
                Hacienda
                <div className="dictate-input-wrap">
                  <SearchableSelect
                    value={freeFieldForm.haciendaCode}
                    onChange={(value) => updateFreeFieldForm('haciendaCode', value)}
                    placeholder={!freeFieldForm.ingenioId ? 'Selecciona un ingenio primero' : 'Hacienda'}
                    options={freeFieldHaciendas.map((item) => ({
                      value: item.code,
                      label: `${item.code} - ${item.name}`,
                    }))}
                  />
                  <DictateInlineButton
                    ariaLabel="Dictar hacienda"
                    disabled={!freeFieldForm.ingenioId}
                    onComplete={(text) => {
                      const match = findItemByVoice(text, freeFieldHaciendas)
                      if (match) updateFreeFieldForm('haciendaCode', match.code)
                    }}
                  />
                </div>
              </label>
              <div>
                <span className="field-label">Suertes</span>
                {freeFieldForm.haciendaCode ? (
                  <ul className="suertes-checklist">
                    {freeFieldSuertes.map((row) => {
                      const suerteCode = `${freeFieldForm.haciendaCode}-${row.suerte}`
                      const remaining = freeFieldForm.labor
                        ? getRemainingArea(assignments, suerteCode, freeFieldForm.labor, row.area)
                        : row.area
                      const isCompleted = freeFieldForm.labor && remaining === 0
                      return (
                        <li key={row.suerte}>
                          <label className={`suerte-check-item${isCompleted ? ' suerte-check-item--done' : ''}`}>
                            <input
                              type="checkbox"
                              checked={freeFieldSuertesList.includes(row.suerte)}
                              onChange={() => !isCompleted && toggleFreeFieldSuerte(row.suerte)}
                              disabled={!!isCompleted}
                            />
                            <span className="suerte-check-code">{row.suerte}</span>
                            {isCompleted
                              ? <span className="suerte-check-done">Completa</span>
                              : <span className="suerte-check-area">{formatArea(remaining)}</span>
                            }
                          </label>
                        </li>
                      )
                    })}
                  </ul>
                ) : (
                  <p className="field-hint">Selecciona una hacienda primero</p>
                )}
                {freeFieldSuertesList.length > 0 && (
                  <p className="suertes-count">{freeFieldSuertesList.length} suerte(s) seleccionada(s)</p>
                )}
              </div>
              <label>
                Labor
                <div className="dictate-input-wrap">
                  <SearchableSelect
                    value={freeFieldForm.labor}
                    onChange={(value) => updateFreeFieldForm('labor', value)}
                    options={WORKFLOW.map((labor) => {
                      const firstSuerte = freeFieldSuertesList[0]
                      const isSuggested =
                        freeFieldForm.haciendaCode && firstSuerte
                          ? labor === getSuggestedLabor(assignments, `${freeFieldForm.haciendaCode}-${firstSuerte}`)
                          : false
                      return { value: labor, label: labor, rightLabel: isSuggested ? '<- sugerida' : undefined }
                    })}
                  />
                  <DictateInlineButton
                    ariaLabel="Dictar labor"
                    onComplete={(text) => {
                      const match = findItemByVoice(
                        text,
                        WORKFLOW.map((labor) => ({ code: labor, name: labor })),
                      )
                      if (match) updateFreeFieldForm('labor', match.code)
                    }}
                  />
                </div>
              </label>
              <label>
                Equipo
                <div className="dictate-input-wrap">
                  <SearchableSelect
                    value={freeFieldForm.equipmentCode || session.equipmentCode}
                    onChange={(value) => updateFreeFieldForm('equipmentCode', value)}
                    options={sortedEquipment.map((item) => ({ value: item.code, label: item.name }))}
                  />
                  <DictateInlineButton
                    ariaLabel="Dictar equipo"
                    onComplete={(text) => {
                      const match = findItemByVoice(text, sortedEquipment)
                      if (match) updateFreeFieldForm('equipmentCode', match.code)
                    }}
                  />
                </div>
              </label>
              <label>
                Operador
                <input value={session.name} disabled />
              </label>
              <label>
                Supervisor
                <div className="dictate-input-wrap">
                  <SearchableSelect
                    value={freeFieldForm.supervisorId}
                    onChange={(value) => updateFreeFieldForm('supervisorId', value)}
                    placeholder="Selecciona el supervisor que aprobará"
                    options={freeFieldSupervisors.map((s) => ({ value: s.id, label: s.name }))}
                  />
                  <DictateInlineButton
                    ariaLabel="Dictar supervisor"
                    onComplete={(text) => {
                      const match = findItemByVoice(
                        text,
                        freeFieldSupervisors.map((s) => ({ code: s.id, name: s.name })),
                      )
                      if (match) updateFreeFieldForm('supervisorId', match.code)
                    }}
                  />
                </div>
              </label>
              <label>
                <div className="dictate-field-header">
                  <span>Observaciones</span>
                  <DictateButton
                    onComplete={(text) => {
                      const prev = freeFieldForm.notes.trimEnd()
                      const next = prev ? `${prev} ${text}` : text
                      updateFreeFieldForm('notes', next)
                    }}
                  />
                </div>
                <textarea
                  rows={3}
                  value={freeFieldForm.notes}
                  onChange={(event) => updateFreeFieldForm('notes', event.target.value)}
                  placeholder="Observaciones de campo"
                />
              </label>
              <button className="primary-button" type="submit" disabled={busy}>
                {busy ? 'Guardando...' : 'Tomar labor'}
              </button>
            </form>
          </div>
        </>
      )}
    </main>
  )
}

export default OperatorView
