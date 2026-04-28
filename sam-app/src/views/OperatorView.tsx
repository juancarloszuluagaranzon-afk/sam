import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useAppData } from '../context/AppDataContext'
import { useAssignmentActions } from '../hooks/useAssignmentActions'
import { useFreeFieldForm } from '../hooks/useFreeFieldForm'
import { usePhotoUpload } from '../hooks/usePhotoUpload'
import logoAgromorales from '../assets/logo-agromorales.jpeg'
import SearchableSelect from '../components/SearchableSelect'
import { WORKFLOW } from '../data/constants'
import type { Assignment, UserProfile } from '../domain/sam'
import { formatTime } from '../services/samApi'

type OperatorTab = 'activas' | 'campo' | 'historial'

const INGENIOS = [
  { id: 'risaralda', nombre: 'Ingenio Risaralda' },
  { id: 'pichichi', nombre: 'Ingenio Pichichi' },
  { id: 'mayaguez', nombre: 'Ingenio Mayaguez' },
  { id: 'san_carlos', nombre: 'Ingenio San Carlos' },
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

function getStatusMeta(status: Assignment['status']) {
  if (status === 'COMPLETADA') return { label: 'Completada', tone: 'done' as const }
  if (status === 'EN_PROCESO') return { label: 'En uso', tone: 'progress' as const }
  if (status === 'CANCELADA') return { label: 'Cancelada', tone: 'cancel' as const }
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
  const { session, assignments, sortedEquipment, isOnline, outboxCount, busy, error, info, todayKey } = useAppData()

  const {
    freeFieldForm, updateFreeFieldForm,
    freeFieldSuertesList, toggleFreeFieldSuerte,
    freeFieldHaciendas, freeFieldSuertes,
    supervisors: freeFieldSupervisors,
    takeFreeField: onCreateFreeField,
  } = useFreeFieldForm({ onFreeFieldTaken: () => setOperatorTab('activas') })

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

  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set())

  useEffect(() => {
    setExpandedCards((prev) => {
      const next = new Set(prev)
      activeAssignments.forEach((a) => {
        if (a.status === 'PENDIENTE' && !next.has(a.id)) next.add(a.id)
      })
      return next
    })
  }, [activeAssignments])

  function toggleCard(id: string) {
    setExpandedCards((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

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
      const [y, m, d] = a.dateKey.split('-').map(Number)
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
        area: isComplete ? fullArea.toFixed(1) : (current[assignmentId]?.area ?? ''),
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
        <button className="primary-button" onClick={() => onSaveSession(null)}>
          Salir
        </button>
      </aside>

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
                <strong>{operatorMetrics.todayPlanned.toFixed(1)}</strong>
                <span>ha planificadas hoy</span>
              </article>
              <article className="operator-kpi-card operator-kpi-card--green">
                <strong>{operatorMetrics.todayExecuted.toFixed(1)}</strong>
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
              const meta = getStatusMeta(assignment.status)
              const draft = finishDrafts[assignment.id]
              const isExpanded = expandedCards.has(assignment.id)
              return (
                <article key={assignment.id} className="panel-card active-card operator-work-card">
                  <button
                    type="button"
                    className="card-collapse-header"
                    onClick={() => toggleCard(assignment.id)}
                  >
                    <div>
                      <h2>
                        {assignment.haciendaName} - {assignment.suerte}
                      </h2>
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
                    <div className="card-collapse-right">
                      <span className={`status-pill ${meta.tone}`}>{meta.label}</span>
                      <span className="card-collapse-chevron">{isExpanded ? '▲' : '▼'}</span>
                    </div>
                  </button>
                  {isExpanded && (
                  <><div className="active-meta">
                    <span>Equipo: {assignment.equipmentName || '-'}</span>
                    <span>Inicio: {formatTime(assignment.startedAt)}</span>
                    {assignment.horometroInicial != null && (
                      <span>Horometro inicial: {assignment.horometroInicial}</span>
                    )}
                  </div>
                  {assignment.status === 'PENDIENTE' ? (
                    <div className="start-grid">
                      <label>
                        Equipo para ejecutar
                        <select
                          value={
                            startEquipmentDrafts[assignment.id] ||
                            assignment.equipmentCode ||
                            session.equipmentCode
                          }
                          onChange={(event) =>
                            updateStartEquipmentDraft(assignment.id, event.target.value)
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
                        <input
                          type="number"
                          min={0}
                          step={0.1}
                          value={startHorometroDrafts[assignment.id] ?? ''}
                          onChange={(event) =>
                            updateStartHorometroDraft(assignment.id, event.target.value)
                          }
                          placeholder="Ej: 4523.5"
                        />
                      </label>
                      <button
                        className="primary-button"
                        onClick={() => void onStartAssignment(assignment)}
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
                              ? `Se registran ${formatArea(assignment.area)}`
                              : 'Ingresa el área ejecutada'}
                          </span>
                        </div>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={draft?.isComplete ?? false}
                          className={`toggle-switch ${(draft?.isComplete ?? false) ? 'on' : ''}`}
                          onClick={() => setFinishDraftComplete(assignment.id, !(draft?.isComplete ?? false), assignment.area)}
                        >
                          <span className="toggle-thumb" />
                        </button>
                      </div>

                      {!(draft?.isComplete ?? false) && (
                        <label>
                          Ha ejecutadas
                          <input
                            type="number"
                            min={0.1}
                            step={0.1}
                            max={assignment.area}
                            value={draft?.area ?? ''}
                            onChange={(event) =>
                              updateFinishDraft(assignment.id, 'area', event.target.value)
                            }
                            placeholder={`máx. ${assignment.area.toFixed(1)}`}
                          />
                        </label>
                      )}

                      <label>
                        Horometro final
                        <input
                          type="number"
                          min={0}
                          step={0.1}
                          value={draft?.horometroFinal ?? ''}
                          onChange={(event) =>
                            updateFinishDraft(assignment.id, 'horometroFinal', event.target.value)
                          }
                          placeholder="Ej: 4541.2"
                        />
                      </label>
                      <label className="finish-notes">
                        Observaciones
                        <textarea
                          rows={3}
                          value={draft?.notes ?? ''}
                          onChange={(event) =>
                            updateFinishDraft(assignment.id, 'notes', event.target.value)
                          }
                          placeholder="Notas de cierre"
                        />
                      </label>
                      <button
                        className="primary-button"
                        onClick={() => void onFinishAssignment(assignment)}
                        disabled={busy}
                      >
                        Finalizar
                      </button>
                    </div>
                  )}
                  </>)}
                </article>
              )
            })}
            {!activeAssignments.length ? (
              <section className="panel-card empty-card">
                <h2>Sin labores activas</h2>
                <p>Puedes tomar una suerte desde la pestana Campo libre.</p>
              </section>
            ) : null}
          </section>
        ) : null}

        {operatorTab === 'campo' ? (
          <section className="dashboard-grid two-up operator-field-layout">
            <article className="panel-card operator-form-card">
              <div className="panel-title">
                <h2>Tomar suerte en campo</h2>
              </div>
              <form className="form-grid-block" onSubmit={onCreateFreeField}>
                <label>
                  Zona
                  <SearchableSelect
                    value={freeFieldForm.zone}
                    onChange={(value) => updateFreeFieldForm('zone', value)}
                    placeholder="Selecciona la zona"
                    options={[
                      { value: 'NORTE', label: 'Zona Norte' },
                      { value: 'SUR', label: 'Zona Sur' },
                    ]}
                  />
                </label>
                <label>
                  Cliente
                  <SearchableSelect
                    value={freeFieldForm.cliente}
                    onChange={(value) => updateFreeFieldForm('cliente', value)}
                    options={[
                      { value: 'ingenios', label: 'Ingenios' },
                      { value: 'proveedores', label: 'Proveedores' },
                    ]}
                  />
                </label>
                <label>
                  Ingenio
                  <SearchableSelect
                    value={freeFieldForm.ingenioId}
                    onChange={(value) => updateFreeFieldForm('ingenioId', value)}
                    placeholder="Selecciona un ingenio"
                    options={INGENIOS.map((ing) => ({ value: ing.id, label: ing.nombre }))}
                  />
                </label>
                <label>
                  Hacienda
                  <SearchableSelect
                    value={freeFieldForm.haciendaCode}
                    onChange={(value) => updateFreeFieldForm('haciendaCode', value)}
                    placeholder={!freeFieldForm.ingenioId ? 'Selecciona un ingenio primero' : 'Hacienda'}
                    options={freeFieldHaciendas.map((item) => ({
                      value: item.code,
                      label: `${item.code} - ${item.name}`,
                    }))}
                  />
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
                </label>
                <label>
                  Equipo
                  <SearchableSelect
                    value={freeFieldForm.equipmentCode || session.equipmentCode}
                    onChange={(value) => updateFreeFieldForm('equipmentCode', value)}
                    options={sortedEquipment.map((item) => ({ value: item.code, label: item.name }))}
                  />
                </label>
                <label>
                  Operador
                  <input value={session.name} disabled />
                </label>
                <label>
                  Supervisor
                  <SearchableSelect
                    value={freeFieldForm.supervisorId}
                    onChange={(value) => updateFreeFieldForm('supervisorId', value)}
                    placeholder="Selecciona el supervisor que aprobará"
                    options={freeFieldSupervisors.map((s) => ({ value: s.id, label: s.name }))}
                  />
                </label>
                <label>
                  Observaciones
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
            </article>

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
                      .toFixed(1)}
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
                    <strong>{haPlaneadas.toFixed(1)}</strong>
                    <span>ha planificadas</span>
                  </article>
                  <article className="operator-kpi-card operator-kpi-card--green">
                    <strong>{haEjecutadas.toFixed(1)}</strong>
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
                const meta = getStatusMeta(assignment.status)
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
                        - {assignment.executedArea.toFixed(1)} ha
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
    </main>
  )
}

export default OperatorView
