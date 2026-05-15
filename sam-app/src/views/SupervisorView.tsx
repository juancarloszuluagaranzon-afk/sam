import { useMemo, useState, type FormEvent } from 'react'
import { useAppData } from '../context/AppDataContext'
import { useAssignmentActions } from '../hooks/useAssignmentActions'
import { useAssignmentForm } from '../hooks/useAssignmentForm'
import { useEquipmentForm } from '../hooks/useEquipmentForm'
import { usePhotoUpload } from '../hooks/usePhotoUpload'
import { useUserForm } from '../hooks/useUserForm'
import { createAppUser, updateAppUser, summarizeAssignments } from '../services/samApi'
import logoAgromorales from '../assets/logo-agromorales.jpeg'
import SearchableSelect from '../components/SearchableSelect'
import { DiagnosticModal } from '../components/DiagnosticModal'
import {
  EntityHistoryModal,
  matchesSummaryFilter,
  buildMonthOptions,
  type SummaryEntity,
  type SummaryQuincena,
} from '../components/EntityHistoryModal'
import { WORKFLOW } from '../data/constants'
import type { Assignment, MaestroRow, UserProfile } from '../domain/sam'
import { formatTime } from '../services/samApi'

export type SupervisorTab = 'resumen' | 'asignar' | 'labores' | 'equipos' | 'tablero' | 'reporte' | 'usuarios'

export interface AssignmentFormState {
  haciendaCode: string
  suerte: string
  labor: string
  operatorId: string
  equipmentCode: string
  operatorId2: string
  equipmentCode2: string
  notes: string
  cliente: string
  ingenioId: string
  supervisorId: string
  zone: string
}

export interface EquipmentFormState {
  code: string
  name: string
  type: 'tractor' | 'implemento' | 'vehiculo' | 'otro'
  state: 'activo' | 'en_mantenimiento' | 'inactivo'
  brand: string
  model: string
  year: string
  plate: string
  serialNumber: string
  notes: string
  active: boolean
}

const INGENIOS = [
  { id: 'risaralda', nombre: 'Ingenio Risaralda' },
  { id: 'pichichi', nombre: 'Ingenio Pichichi' },
  { id: 'mayaguez', nombre: 'Ingenio Mayaguez' },
  { id: 'san_carlos', nombre: 'Ingenio San Carlos' },
  { id: 'riopaila', nombre: 'Ingenio Riopaila' },
]

function getRoleLabel(role: UserProfile['role'] | undefined): string {
  if (role === 'owner') return 'Propietario'
  if (role === 'supervisor') return 'Supervisor'
  if (role === 'administracion') return 'Administración'
  return 'Operador'
}

function isSupervisorOrOwner(role: UserProfile['role'] | undefined): boolean {
  return role === 'supervisor' || role === 'owner' || role === 'administracion'
}

function formatArea(value: number) {
  return `${value.toFixed(2)} ha`
}

function initials(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
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
      (assignment) =>
        assignment.suerteCode === suerteCode &&
        assignment.status === 'COMPLETADA' &&
        WORKFLOW.includes(normalizeText(assignment.labor)),
    )
    .map((assignment) => normalizeText(assignment.labor))

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

interface Props {
  isSideMenuOpen: boolean
  setIsSideMenuOpen: (open: boolean) => void
  isPinModalOpen: boolean
  setIsPinModalOpen: (open: boolean) => void
  pinForm: { current: string; newPin: string; confirm: string; error: string; loading: boolean }
  setPinForm: React.Dispatch<React.SetStateAction<{ current: string; newPin: string; confirm: string; error: string; loading: boolean }>>
  recentAssignments: Assignment[]
  programmedSuerteRows: MaestroRow[]
  tableroAssignments: Assignment[]
  tableroMonth: string
  setTableroMonth: React.Dispatch<React.SetStateAction<string>>
  tableroZone: 'TODAS' | 'NORTE' | 'SUR'
  setTableroZone: React.Dispatch<React.SetStateAction<'TODAS' | 'NORTE' | 'SUR'>>
  tableroIngenio: string
  setTableroIngenio: React.Dispatch<React.SetStateAction<string>>
  filteredAssignments: Assignment[]
  filteredReport: Assignment[]
  haciendaFilterOptions: Array<{ code: string; name: string }>
  supervisorTab: SupervisorTab
  setSupervisorTab: (tab: SupervisorTab) => void
  moreMenuOpen: boolean
  setMoreMenuOpen: React.Dispatch<React.SetStateAction<boolean>>
  selectedLabor: Assignment | null
  setSelectedLabor: (labor: Assignment | null) => void
  statusFilter: string
  setStatusFilter: (v: string) => void
  operatorFilter: string
  setOperatorFilter: (v: string) => void
  ingenioFilter: string
  setIngenioFilter: (v: string) => void
  haciendaFilter: string
  setHaciendaFilter: (v: string) => void
  reportFilters: { desde: string; hasta: string; estado: string; haciendaCode: string; operatorId: string }
  setReportFilters: React.Dispatch<React.SetStateAction<{ desde: string; hasta: string; estado: string; haciendaCode: string; operatorId: string }>>
  onSaveSession: (user: UserProfile | null) => void
  handleChangePin: (e: FormEvent) => Promise<void>
  handleDownloadReport: () => Promise<void>
}

export function SupervisorView({
  isSideMenuOpen,
  setIsSideMenuOpen,
  isPinModalOpen,
  setIsPinModalOpen,
  pinForm,
  setPinForm,
  recentAssignments,
  programmedSuerteRows,
  tableroAssignments,
  tableroMonth,
  setTableroMonth,
  tableroZone,
  setTableroZone,
  tableroIngenio,
  setTableroIngenio,
  filteredAssignments,
  filteredReport,
  haciendaFilterOptions,
  supervisorTab,
  setSupervisorTab,
  moreMenuOpen,
  setMoreMenuOpen,
  selectedLabor,
  setSelectedLabor,
  statusFilter,
  setStatusFilter,
  operatorFilter,
  setOperatorFilter,
  ingenioFilter,
  setIngenioFilter,
  haciendaFilter,
  setHaciendaFilter,
  reportFilters,
  setReportFilters,
  onSaveSession,
  handleChangePin,
  handleDownloadReport,
}: Props) {
  const {
    session,
    isOnline, outboxCount, busy, error, info,
    operators, users, assignments, setAssignments, maestro, todayKey, sortedEquipment, operatorStatusMap,
    setError, setBusy, setInfo,
  } = useAppData()

  const [isCreateAssignmentOpen, setIsCreateAssignmentOpen] = useState(false)
  const [isDiagOpen, setIsDiagOpen] = useState(false)

  const {
    assignmentForm, updateAssignmentForm,
    assignmentSuertesList, toggleAssignmentSuerte,
    assignmentHaciendas, assignmentSuertes,
    prefillAssignmentForm: prefillFormState,
    createAssignment: handleCreateAssignment,
  } = useAssignmentForm({
    onAssignmentCreated: () => {
      setIsCreateAssignmentOpen(false)
      setSupervisorTab('labores')
    },
  })

  const {
    cancelAssignment: handleCancelAssignment,
    approveAssignment: handleApproveAssignment,
    rejectAssignment: handleRejectAssignment,
    editAssignment: handleEditAssignment,
  } = useAssignmentActions()

  const canEditAssignments =
    session?.role === 'supervisor' || session?.role === 'owner' || session?.role === 'administracion'

  const {
    equipmentForm, updateEquipmentForm, isEquipmentFormOpen, setIsEquipmentFormOpen,
    handleCreateEquipment,
  } = useEquipmentForm()

  const {
    userForm, setUserForm, isUserFormOpen, setIsUserFormOpen,
    editingUserId, setEditingUserId, userSearch, setUserSearch,
    nextUserId,
  } = useUserForm()

  const { fileInputRef: photoInputRef, triggerUpload: triggerPhotoUpload, handleFileChange: handlePhotoChange, uploading: photoUploading } = usePhotoUpload()

  const scopedAssignments = useMemo(() => {
    if (session?.role === 'supervisor') {
      return assignments.filter((a) => a.supervisorId === session.id)
    }
    return assignments
  }, [assignments, session])

  const scopedMetrics = useMemo(
    () => summarizeAssignments(scopedAssignments, todayKey),
    [scopedAssignments, todayKey],
  )

  const [summaryMonth, setSummaryMonth] = useState(() => todayKey.slice(0, 7))
  const [summaryQuincena, setSummaryQuincena] = useState<SummaryQuincena>('TODO')
  const [selectedEntity, setSelectedEntity] = useState<SummaryEntity | null>(null)
  const [summaryOperatorSearch, setSummaryOperatorSearch] = useState('')
  const [summaryEquipmentSearch, setSummaryEquipmentSearch] = useState('')

  const [editingLabor, setEditingLabor] = useState(false)
  const [editLaborDraft, setEditLaborDraft] = useState({
    executedArea: '',
    horometroInicial: '',
    horometroFinal: '',
    notes: '',
    equipmentCode: '',
  })

  const summaryMonthOptions = useMemo(() => buildMonthOptions(todayKey.slice(0, 7)), [todayKey])

  const summaryAssignments = useMemo(
    () =>
      scopedAssignments.filter((a) => {
        if (a.status === 'CANCELADA') return false
        if (summaryQuincena === 'HOY') {
          // Match summarizeAssignments carry-over logic: include labors created today
          // OR completed today even if scheduled earlier.
          if (a.dateKey === todayKey) return true
          if (a.status === 'COMPLETADA' && a.finishedAt) {
            const finDay = new Date(a.finishedAt).toLocaleDateString('en-CA', {
              timeZone: 'America/Bogota',
            })
            if (finDay === todayKey) return true
          }
          return false
        }
        return matchesSummaryFilter(a.dateKey, summaryMonth, summaryQuincena, todayKey)
      }),
    [scopedAssignments, summaryMonth, summaryQuincena, todayKey],
  )

  const summaryMetrics = useMemo(() => {
    const planned = summaryAssignments.reduce((s, a) => s + a.area, 0)
    const executed = summaryAssignments
      .filter((a) => a.status === 'COMPLETADA')
      .reduce((s, a) => s + a.executedArea, 0)
    const inProgress = summaryAssignments.filter((a) => a.status === 'EN_PROCESO').length
    return {
      plannedArea: planned,
      executedArea: executed,
      completion: planned ? Math.round((executed / planned) * 100) : 0,
      inProgress,
    }
  }, [summaryAssignments])

  const summaryLabor = useMemo(() => {
    const groups = new Map<string, { planned: number; executed: number; count: number }>()
    for (const a of summaryAssignments) {
      const current = groups.get(a.labor) ?? { planned: 0, executed: 0, count: 0 }
      current.planned += a.area
      current.count += 1
      if (a.status === 'COMPLETADA') current.executed += a.executedArea
      groups.set(a.labor, current)
    }
    return Array.from(groups.entries())
      .map(([labor, value]) => ({ labor, ...value }))
      .sort((a, b) => b.planned - a.planned)
  }, [summaryAssignments])

  const summaryPeriodLabel = useMemo(() => {
    if (summaryQuincena === 'HOY') return 'Hoy'
    const monthLabel = summaryMonthOptions.find((opt) => opt.value === summaryMonth)?.label ?? summaryMonth
    if (summaryQuincena === 'PRIMERA') return `${monthLabel} - 1ra quincena`
    if (summaryQuincena === 'SEGUNDA') return `${monthLabel} - 2da quincena`
    return monthLabel
  }, [summaryQuincena, summaryMonth, summaryMonthOptions])

  const summaryByOperator = useMemo(() => {
    const groups = new Map<
      string,
      { id: string; name: string; planned: number; executed: number; count: number }
    >()
    for (const a of summaryAssignments) {
      const id = a.operatorId || 'sin-operador'
      const name = a.operatorName || 'Sin operador'
      const current = groups.get(id) ?? { id, name, planned: 0, executed: 0, count: 0 }
      current.planned += a.area
      if (a.status === 'COMPLETADA') current.executed += a.executedArea
      current.count += 1
      groups.set(id, current)
    }
    return Array.from(groups.values()).sort((a, b) => b.executed - a.executed)
  }, [summaryAssignments])

  const filteredOperators = useMemo(() => {
    const q = summaryOperatorSearch.trim().toLowerCase()
    if (!q) return summaryByOperator
    return summaryByOperator.filter((op) => op.name.toLowerCase().includes(q))
  }, [summaryByOperator, summaryOperatorSearch])

  const summaryByEquipment = useMemo(() => {
    const groups = new Map<
      string,
      { code: string; name: string; planned: number; executed: number; count: number }
    >()
    for (const a of summaryAssignments) {
      const code = a.equipmentCode || 'sin-equipo'
      const name = a.equipmentName || a.equipmentCode || 'Sin equipo'
      const current = groups.get(code) ?? { code, name, planned: 0, executed: 0, count: 0 }
      current.planned += a.area
      if (a.status === 'COMPLETADA') current.executed += a.executedArea
      current.count += 1
      groups.set(code, current)
    }
    return Array.from(groups.values()).sort((a, b) => b.executed - a.executed)
  }, [summaryAssignments])

  const filteredEquipment = useMemo(() => {
    const q = summaryEquipmentSearch.trim().toLowerCase()
    if (!q) return summaryByEquipment
    return summaryByEquipment.filter((eq) => eq.name.toLowerCase().includes(q))
  }, [summaryByEquipment, summaryEquipmentSearch])

  if (!session) return null

  function prefillAssignmentForm(haciendaCode: string, suerte: string, labor: string) {
    prefillFormState(haciendaCode, suerte, labor)
    setSupervisorTab('asignar')
    setIsCreateAssignmentOpen(true)
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

      {(session.role === 'owner' || session.role === 'supervisor') && moreMenuOpen && (
        <>
          <div className="more-sheet-overlay" onClick={() => setMoreMenuOpen(false)} />
          <div className="more-sheet" role="dialog" aria-label="Más opciones">
            <div className="more-sheet__handle" />
            {session.role === 'supervisor' ? (
              <>
                <button
                  className={`more-sheet__item ${supervisorTab === 'equipos' ? 'more-sheet__item--active' : ''}`}
                  onClick={() => { setSupervisorTab('equipos'); setMoreMenuOpen(false) }}
                >
                  <span className="more-sheet__icon">▣</span>
                  <div>
                    <div className="more-sheet__label">Equipos</div>
                    <div className="more-sheet__desc">Estado y registro de equipos</div>
                  </div>
                </button>
                <button
                  className={`more-sheet__item ${supervisorTab === 'tablero' ? 'more-sheet__item--active' : ''}`}
                  onClick={() => { setSupervisorTab('tablero'); setMoreMenuOpen(false) }}
                >
                  <span className="more-sheet__icon">◫</span>
                  <div>
                    <div className="more-sheet__label">Tablero</div>
                    <div className="more-sheet__desc">Vista de programación por suerte y labor</div>
                  </div>
                </button>
              </>
            ) : (
              <>
                <button
                  className={`more-sheet__item ${supervisorTab === 'tablero' ? 'more-sheet__item--active' : ''}`}
                  onClick={() => { setSupervisorTab('tablero'); setMoreMenuOpen(false) }}
                >
                  <span className="more-sheet__icon">◫</span>
                  <div>
                    <div className="more-sheet__label">Tablero</div>
                    <div className="more-sheet__desc">Vista de programación por suerte y labor</div>
                  </div>
                </button>
                <button
                  className={`more-sheet__item ${supervisorTab === 'reporte' ? 'more-sheet__item--active' : ''}`}
                  onClick={() => { setSupervisorTab('reporte'); setMoreMenuOpen(false) }}
                >
                  <span className="more-sheet__icon">⬦</span>
                  <div>
                    <div className="more-sheet__label">Reporte</div>
                    <div className="more-sheet__desc">Historial completo con filtros y descarga Excel</div>
                  </div>
                </button>
              </>
            )}
          </div>
        </>
      )}

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

      {isDiagOpen && (
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
          <nav
            className={[
              'tab-nav floating-nav',
              session.role === 'administracion' ? 'admin-nav' : '',
              session.role === 'owner' ? 'admin-nav' : '',
              session.role === 'supervisor' ? 'supervisor-nav' : '',
            ].filter(Boolean).join(' ')}
            aria-label="Navegacion principal"
          >
            <button
              className={supervisorTab === 'labores' ? 'active' : ''}
              onClick={() => setSupervisorTab('labores')}
            >
              <span className="nav-item">
                <span className="nav-icon">✓</span>
                <span className="nav-label">Labores</span>
              </span>
            </button>

            {session.role === 'owner' ? (
              <>
                <button
                  className={supervisorTab === 'usuarios' ? 'active' : ''}
                  onClick={() => setSupervisorTab('usuarios')}
                >
                  <span className="nav-item">
                    <span className="nav-icon">👤</span>
                    <span className="nav-label">Usuarios</span>
                  </span>
                </button>
                <button
                  className={supervisorTab === 'equipos' ? 'active' : ''}
                  onClick={() => setSupervisorTab('equipos')}
                >
                  <span className="nav-item">
                    <span className="nav-icon">▣</span>
                    <span className="nav-label">Equipos</span>
                  </span>
                </button>
                <button
                  className={supervisorTab === 'resumen' ? 'active' : ''}
                  onClick={() => setSupervisorTab('resumen')}
                >
                  <span className="nav-item">
                    <span className="nav-icon">⌂</span>
                    <span className="nav-label">Resumen</span>
                  </span>
                </button>
                <button
                  className={supervisorTab === 'asignar' ? 'active' : ''}
                  onClick={() => setSupervisorTab('asignar')}
                >
                  <span className="nav-item">
                    <span className="nav-icon">＋</span>
                    <span className="nav-label">Asignar</span>
                  </span>
                </button>
                <button
                  className={moreMenuOpen || supervisorTab === 'tablero' || supervisorTab === 'reporte' ? 'active' : ''}
                  onClick={() => setMoreMenuOpen((v) => !v)}
                  aria-haspopup="true"
                  aria-expanded={moreMenuOpen}
                >
                  <span className="nav-item">
                    <span className="nav-icon">⋯</span>
                    <span className="nav-label">Más</span>
                  </span>
                </button>
              </>
            ) : session.role === 'supervisor' ? (
              <>
                <button
                  className={supervisorTab === 'asignar' ? 'active' : ''}
                  onClick={() => setSupervisorTab('asignar')}
                >
                  <span className="nav-item">
                    <span className="nav-icon">＋</span>
                    <span className="nav-label">Asignar</span>
                  </span>
                </button>
                <button
                  className={supervisorTab === 'resumen' ? 'active' : ''}
                  onClick={() => setSupervisorTab('resumen')}
                >
                  <span className="nav-item">
                    <span className="nav-icon">⌂</span>
                    <span className="nav-label">Resumen</span>
                  </span>
                </button>
                <button
                  className={moreMenuOpen || supervisorTab === 'equipos' || supervisorTab === 'tablero' ? 'active' : ''}
                  onClick={() => setMoreMenuOpen((v) => !v)}
                  aria-haspopup="true"
                  aria-expanded={moreMenuOpen}
                >
                  <span className="nav-item">
                    <span className="nav-icon">⋯</span>
                    <span className="nav-label">Más</span>
                  </span>
                </button>
              </>
            ) : (
              <>
                <button
                  className={supervisorTab === 'asignar' ? 'active' : ''}
                  onClick={() => setSupervisorTab('asignar')}
                >
                  <span className="nav-item">
                    <span className="nav-icon">＋</span>
                    <span className="nav-label">Asignar</span>
                  </span>
                </button>
                <button
                  className={supervisorTab === 'resumen' ? 'active' : ''}
                  onClick={() => setSupervisorTab('resumen')}
                >
                  <span className="nav-item">
                    <span className="nav-icon">⌂</span>
                    <span className="nav-label">Resumen</span>
                  </span>
                </button>
                <button
                  className={supervisorTab === 'equipos' ? 'active' : ''}
                  onClick={() => setSupervisorTab('equipos')}
                >
                  <span className="nav-item">
                    <span className="nav-icon">▣</span>
                    <span className="nav-label">Equipos</span>
                  </span>
                </button>
                <button
                  className={supervisorTab === 'tablero' ? 'active' : ''}
                  onClick={() => setSupervisorTab('tablero')}
                >
                  <span className="nav-item">
                    <span className="nav-icon">◫</span>
                    <span className="nav-label">Tablero</span>
                  </span>
                </button>
                <button
                  className={supervisorTab === 'reporte' ? 'active' : ''}
                  onClick={() => setSupervisorTab('reporte')}
                >
                  <span className="nav-item">
                    <span className="nav-icon">⬦</span>
                    <span className="nav-label">Reporte</span>
                  </span>
                </button>
              </>
            )}
          </nav>

          <div className="day-status-bar day-status-bar--large">
            <div className="day-status-bar__heading">Hoy</div>
            <div className="day-status-bar__items">
              <div className="day-status-item">
                <strong>{scopedMetrics.plannedArea.toFixed(2)}</strong>
                <span>Ha planif.</span>
              </div>
              <div className="day-status-item day-status-item--green">
                <strong>{scopedMetrics.executedArea.toFixed(2)}</strong>
                <span>Ha ejecut.</span>
              </div>
              <div className={`day-status-item ${scopedMetrics.completion >= 70 ? 'day-status-item--green' : scopedMetrics.completion >= 30 ? 'day-status-item--amber' : 'day-status-item--red'}`}>
                <strong>{scopedMetrics.completion}%</strong>
                <span>Cumplimiento</span>
              </div>
              <div className={`day-status-item ${scopedMetrics.inProgress > 0 ? 'day-status-item--amber' : ''}`}>
                <strong>{scopedMetrics.inProgress}</strong>
                <span>En progreso</span>
              </div>
            </div>
          </div>
        </section>

        {(error || info) && (
          <section className="message-stack">
            {error ? <div className="feedback error">{error}</div> : null}
            {info ? <div className="feedback success">{info}</div> : null}
          </section>
        )}

        {supervisorTab === 'resumen' ? (
          <section className="summary-filters-bar">
            <label>
              Mes
              <select
                value={summaryMonth}
                onChange={(e) => setSummaryMonth(e.target.value)}
              >
                {summaryMonthOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </label>
            <label>
              Periodo
              <select
                value={summaryQuincena}
                onChange={(e) => setSummaryQuincena(e.target.value as SummaryQuincena)}
              >
                <option value="HOY">Solo hoy</option>
                <option value="TODO">Todo el mes</option>
                <option value="PRIMERA">1ra quincena (1-15)</option>
                <option value="SEGUNDA">2da quincena (16-fin)</option>
              </select>
            </label>
          </section>
        ) : null}

        {supervisorTab === 'resumen' ? (
          <section className="kpi-grid">
            <article className="metric-panel">
              <p>HA PLANIFICADAS</p>
              <strong>{summaryMetrics.plannedArea.toFixed(2)}</strong>
              <span>hectareas</span>
            </article>
            <article className="metric-panel">
              <p>HA EJECUTADAS</p>
              <strong>{summaryMetrics.executedArea.toFixed(2)}</strong>
              <span>hectareas</span>
            </article>
            <article className="metric-panel">
              <p>CUMPLIMIENTO</p>
              <strong className={summaryMetrics.completion < 30 ? 'danger' : ''}>
                {summaryMetrics.completion}%
              </strong>
              <div className="progress-track">
                <span style={{ width: `${Math.min(summaryMetrics.completion, 100)}%` }} />
              </div>
            </article>
            <article className="metric-panel">
              <p>EN PROCESO</p>
              <strong>{summaryMetrics.inProgress}</strong>
              <span>labores activas</span>
            </article>
          </section>
        ) : null}

        {supervisorTab === 'resumen' ? (
          <section className="panel-card">
            <div className="panel-title">
              <h2>Por Operador</h2>
              <span className="subtle-copy">Toca un operador para ver el histórico</span>
            </div>
            <input
              className="user-search-input"
              type="search"
              placeholder="Buscar operador..."
              value={summaryOperatorSearch}
              onChange={(e) => setSummaryOperatorSearch(e.target.value)}
            />
            <div className="entity-grid">
              {filteredOperators.map((op) => (
                <button
                  key={op.id}
                  type="button"
                  className="entity-card"
                  onClick={() => setSelectedEntity({ type: 'operator', id: op.id, name: op.name })}
                >
                  <p className="entity-card__name">{op.name}</p>
                  <strong>{op.executed.toFixed(2)}</strong>
                  <span>
                    / {op.planned.toFixed(2)} ha - {op.count} {op.count === 1 ? 'labor' : 'labores'}
                  </span>
                  <div className="progress-track">
                    <span
                      style={{
                        width: `${op.planned ? Math.min((op.executed / op.planned) * 100, 100) : 0}%`,
                      }}
                    />
                  </div>
                </button>
              ))}
              {filteredOperators.length === 0 && (
                <p className="muted-text" style={{ gridColumn: '1 / -1' }}>
                  {summaryOperatorSearch.trim()
                    ? 'Sin coincidencias.'
                    : 'Sin labores en el periodo seleccionado.'}
                </p>
              )}
            </div>
          </section>
        ) : null}

        {supervisorTab === 'resumen' ? (
          <section className="panel-card">
            <div className="panel-title">
              <h2>Por Equipo</h2>
              <span className="subtle-copy">Toca un equipo para ver el histórico</span>
            </div>
            <input
              className="user-search-input"
              type="search"
              placeholder="Buscar equipo..."
              value={summaryEquipmentSearch}
              onChange={(e) => setSummaryEquipmentSearch(e.target.value)}
            />
            <div className="entity-grid">
              {filteredEquipment.map((eq) => (
                <button
                  key={eq.code}
                  type="button"
                  className="entity-card"
                  onClick={() => setSelectedEntity({ type: 'equipment', code: eq.code, name: eq.name })}
                >
                  <p className="entity-card__name">{eq.name}</p>
                  <strong>{eq.executed.toFixed(2)}</strong>
                  <span>
                    / {eq.planned.toFixed(2)} ha - {eq.count} {eq.count === 1 ? 'labor' : 'labores'}
                  </span>
                  <div className="progress-track">
                    <span
                      style={{
                        width: `${eq.planned ? Math.min((eq.executed / eq.planned) * 100, 100) : 0}%`,
                      }}
                    />
                  </div>
                </button>
              ))}
              {filteredEquipment.length === 0 && (
                <p className="muted-text" style={{ gridColumn: '1 / -1' }}>
                  {summaryEquipmentSearch.trim()
                    ? 'Sin coincidencias.'
                    : 'Sin labores en el periodo seleccionado.'}
                </p>
              )}
            </div>
          </section>
        ) : null}

        {supervisorTab === 'resumen' ? (
          <section className="panel-card">
            <div className="panel-title">
              <h2>Por Labor</h2>
              <span className="subtle-copy">{summaryPeriodLabel}</span>
            </div>
            <div className="labor-grid">
              {summaryLabor.map((item) => (
                <article key={item.labor} className="labor-card">
                  <p>{item.labor}</p>
                  <strong>{item.executed.toFixed(2)}</strong>
                  <span>
                    / {item.planned.toFixed(2)} ha - {item.count} labores
                  </span>
                  <div className="progress-track">
                    <span
                      style={{
                        width: `${item.planned ? Math.min((item.executed / item.planned) * 100, 100) : 0}%`,
                      }}
                    />
                  </div>
                </article>
              ))}
              {summaryLabor.length === 0 && (
                <p className="muted-text" style={{ gridColumn: '1 / -1' }}>
                  Sin labores en el periodo seleccionado.
                </p>
              )}
            </div>
          </section>
        ) : null}

        <EntityHistoryModal
          entity={selectedEntity}
          assignments={scopedAssignments}
          defaultMonth={summaryMonth}
          defaultQuincena={summaryQuincena}
          onClose={() => setSelectedEntity(null)}
          canEdit={canEditAssignments}
          equipment={sortedEquipment}
          onSaveAssignment={handleEditAssignment}
          busy={busy}
        />

        {supervisorTab === 'asignar' ? (
          <section className="assign-tab-stack">
            <button
              type="button"
              className="primary-button assign-cta"
              onClick={() => setIsCreateAssignmentOpen(true)}
            >
              + Crear asignación
            </button>

            <article className="panel-card">
              <div className="panel-title">
                <h2>Ultimos movimientos</h2>
              </div>
              <ul className="movement-list">
                {recentAssignments.map((assignment) => {
                  const meta = getStatusMeta(assignment)
                  return (
                    <li key={assignment.id}>
                      <button
                        type="button"
                        className="movement-card"
                        onClick={() => setSelectedLabor(assignment)}
                      >
                        <div className="movement-card__top">
                          <strong className="movement-card__title">
                            {assignment.haciendaName} · {assignment.suerte}
                          </strong>
                          <span className={`status-chip ${meta.tone}`}>{meta.label}</span>
                        </div>
                        <div className="movement-card__meta">
                          <span className="movement-card__labor">{assignment.labor}</span>
                          {assignment.kind === 'ASIGNADA' ? (
                            <span className="kind-badge asignada">Prog.</span>
                          ) : (
                            <span className="kind-badge libre">Campo</span>
                          )}
                          {assignment.zone && (
                            <span className={`zone-badge zone-${assignment.zone.toLowerCase()}`}>
                              {assignment.zone === 'NORTE' ? 'Norte' : 'Sur'}
                            </span>
                          )}
                          <span className="movement-card__area">{formatArea(assignment.area)}</span>
                        </div>
                        <div className="movement-card__footer">
                          <span>{assignment.operatorName || 'Sin operador'}</span>
                          <span className="movement-card__sep">·</span>
                          <span>{assignment.equipmentName || assignment.equipmentCode || 'Sin equipo'}</span>
                          <span className="movement-card__sep">·</span>
                          <span>{assignment.dateKey}</span>
                        </div>
                      </button>
                    </li>
                  )
                })}
                {recentAssignments.length === 0 && (
                  <li className="movement-empty">Sin movimientos recientes.</li>
                )}
              </ul>
            </article>
          </section>
        ) : null}

        {supervisorTab === 'tablero' ? (
          <section className="panel-card tablero-section">
            <div className="panel-title split">
              <h2>Tablero</h2>
              <div className="tablero-filters">
                <input
                  type="month"
                  value={tableroMonth}
                  onChange={(e) => setTableroMonth(e.target.value)}
                  className="base-input"
                  aria-label="Mes"
                />
                <select
                  value={tableroZone}
                  onChange={(e) => setTableroZone(e.target.value as 'TODAS' | 'NORTE' | 'SUR')}
                  aria-label="Zona"
                >
                  <option value="TODAS">Todas las zonas</option>
                  <option value="NORTE">Zona Norte</option>
                  <option value="SUR">Zona Sur</option>
                </select>
                <select
                  value={tableroIngenio}
                  onChange={(e) => setTableroIngenio(e.target.value)}
                  aria-label="Ingenio"
                >
                  <option value="TODOS">Todos los ingenios</option>
                  {INGENIOS.map((ing) => (
                    <option key={ing.id} value={ing.id}>{ing.nombre}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="tablero-wrap">
              <table className="tablero-table">
                <thead>
                  <tr>
                    <th className="tab-sticky-col">SUERTE</th>
                    <th className="tab-meta-col">HA</th>
                    <th className="tab-meta-col">INICIO</th>
                    <th className="tab-meta-col tab-hide-mobile">DIAS</th>
                    <th className="tab-meta-col tab-hide-mobile">ROT.</th>
                    {WORKFLOW.map((labor) => (
                      <th key={labor} className="tab-labor-col">{labor}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {programmedSuerteRows.map((row) => {
                    const suerteKey = `${row.haciendaCode}-${row.suerte}`
                    const rowAssignments = tableroAssignments.filter(
                      (assignment) =>
                        assignment.suerteCode === suerteKey ||
                        (assignment.suerte === row.suerte &&
                          assignment.haciendaCode === row.haciendaCode),
                    )
                    const firstDate =
                      rowAssignments
                        .slice()
                        .sort((a, b) => a.dateKey.localeCompare(b.dateKey))[0]
                        ?.dateKey ?? '-'

                    return (
                      <tr key={suerteKey} className="tablero-row">
                        <td className="tab-sticky-col">
                          <strong>{row.haciendaCode}-{row.suerte}</strong>
                          <small>{row.haciendaName}</small>
                        </td>
                        <td className="center-cell">{row.area.toFixed(2)}</td>
                        <td className="center-cell">{firstDate}</td>
                        <td className="center-cell tab-hide-mobile">1</td>
                        <td className="center-cell tab-hide-mobile">DOBLE</td>
                        {WORKFLOW.map((labor) => {
                          const assignment = rowAssignments.find(
                            (item) => item.labor.toUpperCase() === labor.toUpperCase(),
                          )
                          const status = assignment?.status ?? 'PENDIENTE'
                          const isPartial =
                            status === 'COMPLETADA' &&
                            !!assignment &&
                            assignment.executedArea > 0 &&
                            assignment.executedArea < assignment.area
                          const isAssignable = status === 'PENDIENTE' && isSupervisorOrOwner(session.role)
                          const cellClass = [
                            'labor-cell-box',
                            isPartial
                              ? 'parcial'
                              : status === 'COMPLETADA'
                                ? 'completada'
                                : status === 'EN_PROCESO'
                                  ? 'en_proceso'
                                  : 'pendiente',
                            isAssignable ? 'tab-cell-assignable' : '',
                          ].join(' ').trim()

                          return (
                            <td key={labor} className="labor-cell-td">
                              <div
                                className={cellClass}
                                onClick={isAssignable ? () => prefillAssignmentForm(row.haciendaCode, row.suerte, labor) : undefined}
                                title={isAssignable ? `Asignar ${labor}` : undefined}
                              >
                                {status === 'EN_PROCESO' && <span className="spinner">RUN</span>}
                                {status === 'COMPLETADA' && assignment && (
                                  <span>
                                    {assignment.executedArea > 0
                                      ? `${assignment.executedArea.toFixed(2)} ha`
                                      : `${assignment.area.toFixed(2)} ha`}
                                  </span>
                                )}
                                {status === 'PENDIENTE' && (
                                  <span>{(assignment?.area ?? row.area).toFixed(2)} ha</span>
                                )}
                              </div>
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="tablero-legend">
              <span className="tablero-legend-item completada">Ejecutada</span>
              <span className="tablero-legend-item parcial">Parcial</span>
              <span className="tablero-legend-item en_proceso"><span className="spinner">RUN</span> En ejecucion</span>
              <span className="tablero-legend-item pendiente">Pendiente</span>
            </div>
          </section>
        ) : null}

        {(session.role === 'administracion' || session.role === 'owner') && supervisorTab === 'reporte' ? (
          <section className="panel-card">
            <div className="panel-title">
              <h2>Reporte de Labores</h2>
            </div>

            <div className="report-filters">
              <div className="report-filter-row">
                <label className="report-filter-label">
                  Desde
                  <input
                    type="date"
                    value={reportFilters.desde}
                    onChange={(e) => setReportFilters((f) => ({ ...f, desde: e.target.value }))}
                  />
                </label>
                <label className="report-filter-label">
                  Hasta
                  <input
                    type="date"
                    value={reportFilters.hasta}
                    onChange={(e) => setReportFilters((f) => ({ ...f, hasta: e.target.value }))}
                  />
                </label>
              </div>
              <div className="report-filter-row">
                <select
                  value={reportFilters.estado}
                  onChange={(e) => setReportFilters((f) => ({ ...f, estado: e.target.value }))}
                >
                  <option value="TODAS">Todos los estados</option>
                  <option value="PENDIENTE">Pendiente</option>
                  <option value="EN_PROCESO">En proceso</option>
                  <option value="COMPLETADA">Completada</option>
                  <option value="CANCELADA">Cancelada</option>
                </select>
                <select
                  value={reportFilters.haciendaCode}
                  onChange={(e) => setReportFilters((f) => ({ ...f, haciendaCode: e.target.value }))}
                >
                  <option value="">Todas las haciendas</option>
                  {haciendaFilterOptions.map((h) => (
                    <option key={h.code} value={h.code}>{h.name}</option>
                  ))}
                </select>
                <select
                  value={reportFilters.operatorId}
                  onChange={(e) => setReportFilters((f) => ({ ...f, operatorId: e.target.value }))}
                >
                  <option value="TODOS">Todos los operadores</option>
                  {operators.map((op) => (
                    <option key={op.id} value={op.id}>{op.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="report-summary-bar">
              <span>{filteredReport.length} registros</span>
              <span>{filteredReport.reduce((s, a) => s + a.area, 0).toFixed(2)} ha plan.</span>
              <span>{filteredReport.filter(a => a.status === 'COMPLETADA').reduce((s, a) => s + (a.executedArea || a.area), 0).toFixed(2)} ha ejec.</span>
            </div>

            <div className="report-table-wrap">
              <table className="report-table">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Hacienda</th>
                    <th>Suerte</th>
                    <th>Labor</th>
                    <th>Área</th>
                    <th>Estado</th>
                    <th>Operador</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredReport.slice(0, 30).map((a) => {
                    const meta = getStatusMeta(a)
                    return (
                      <tr key={a.id}>
                        <td>{a.dateKey}</td>
                        <td>{a.haciendaName}</td>
                        <td>{a.suerte}</td>
                        <td>{a.labor}</td>
                        <td className="num-cell">
                          {a.status === 'COMPLETADA'
                            ? formatArea(a.executedArea > 0 ? a.executedArea : a.area)
                            : formatArea(a.area)}
                        </td>
                        <td><span className={`status-chip ${meta.tone}`}>{meta.label}</span></td>
                        <td>{a.operatorName}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {filteredReport.length > 30 && (
                <p className="report-overflow-note">
                  Mostrando 30 de {filteredReport.length}. Descarga el Excel para el listado completo.
                </p>
              )}
              {filteredReport.length === 0 && (
                <p className="report-empty">Sin registros para los filtros seleccionados.</p>
              )}
            </div>

            <button
              className="btn-primary report-download-btn"
              onClick={handleDownloadReport}
              disabled={busy || filteredReport.length === 0}
            >
              {busy ? 'Generando...' : `Descargar Excel (${filteredReport.length} registros)`}
            </button>
          </section>
        ) : null}

        {session.role === 'owner' && supervisorTab === 'usuarios' ? (
          <section className="panel-card">
            <div className="panel-title users-panel-title">
              <h2>Usuarios</h2>
              <button
                type="button"
                className="primary-button users-new-btn"
                onClick={() => {
                  setEditingUserId(null)
                  setUserForm({ id: nextUserId, nombreCompleto: '', rol: '', pin: '', equipoCodigo: '' })
                  setIsUserFormOpen(true)
                }}
              >
                + Nuevo usuario
              </button>
            </div>

            <input
              className="user-search-input"
              type="search"
              placeholder="Buscar por nombre..."
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
            />

            <ul className="user-cards-list">
              {users
                .filter((u) => u.name.toLowerCase().includes(userSearch.toLowerCase()))
                .sort((a, b) => {
                  const aOcupado = operatorStatusMap.get(a.id) === 'ocupado' ? 0 : 1
                  const bOcupado = operatorStatusMap.get(b.id) === 'ocupado' ? 0 : 1
                  return aOcupado - bOcupado
                })
                .map((u) => {
                  const status = operatorStatusMap.get(u.id) ?? 'disponible'
                  const rolLabels: Record<string, string> = { operador: 'Operador', supervisor: 'Supervisor', administracion: 'Admin', owner: 'Propietario' }
                  const openEdit = () => {
                    setEditingUserId(u.id)
                    setUserForm({ id: u.id, nombreCompleto: u.name, rol: u.role, pin: '', equipoCodigo: u.equipmentCode })
                    setIsUserFormOpen(true)
                  }
                  return (
                    <li key={u.id} className="user-card" onClick={openEdit} style={{ cursor: 'pointer' }}>
                      <span className="user-card__name">{u.name}</span>
                      <span className="user-card__role">{rolLabels[u.role] ?? u.role}</span>
                      {(u.role === 'operador' || u.role === 'supervisor') && (
                        <span className={`user-status-badge user-status-badge--${status}`}>
                          {status === 'ocupado' ? 'Ocupado' : 'Libre'}
                        </span>
                      )}
                      {u.equipmentCode && (
                        <div className="user-card__meta">Equipo: {u.equipmentCode}</div>
                      )}
                      <button
                        className="user-card__edit-btn"
                        onClick={(e) => {
                          e.stopPropagation()
                          openEdit()
                        }}
                      >
                        Editar
                      </button>
                    </li>
                  )
                })}
            </ul>
          </section>
        ) : null}

        {session.role === 'owner' && isUserFormOpen && (() => {
          const closeUserModal = () => {
            setIsUserFormOpen(false)
            setEditingUserId(null)
            setUserForm({ id: nextUserId, nombreCompleto: '', rol: '', pin: '', equipoCodigo: '' })
          }
          return (
            <div className="modal-overlay open" onClick={closeUserModal}>
              <div className="modal-card user-modal-card" onClick={(e) => e.stopPropagation()}>
                <div className="labor-detail-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                  <h3 style={{ margin: 0 }}>{editingUserId ? 'Editar usuario' : 'Nuevo usuario'}</h3>
                  <button
                    type="button"
                    className="modal-close-btn"
                    onClick={closeUserModal}
                    aria-label="Cerrar"
                  >
                    ×
                  </button>
                </div>
                <form
                  className="user-form"
                  onSubmit={async (e) => {
                    e.preventDefault()
                    const isEditing = !!editingUserId
                    if (!userForm.nombreCompleto || !userForm.rol) {
                      setError('Completa nombre y rol.')
                      return
                    }
                    if (!isEditing && !userForm.pin) {
                      setError('El PIN es obligatorio al crear un usuario.')
                      return
                    }
                    setBusy(true)
                    setError('')
                    try {
                      if (isEditing) {
                        await updateAppUser(userForm)
                        setInfo(`Usuario ${userForm.nombreCompleto} actualizado.`)
                      } else {
                        await createAppUser({ ...userForm, id: userForm.id || nextUserId })
                        setInfo(`Usuario ${userForm.nombreCompleto} creado.`)
                      }
                      closeUserModal()
                    } catch (err: unknown) {
                      setError(err instanceof Error ? err.message : 'Error al guardar usuario')
                    } finally {
                      setBusy(false)
                    }
                  }}
                >
                  <label>
                    ID de usuario
                    <input
                      value={userForm.id || nextUserId}
                      onChange={(e) => setUserForm((f) => ({ ...f, id: e.target.value }))}
                      disabled={!!editingUserId}
                    />
                  </label>
                  <label>
                    Nombre completo
                    <input
                      value={userForm.nombreCompleto}
                      onChange={(e) => setUserForm((f) => ({ ...f, nombreCompleto: e.target.value }))}
                      placeholder="Nombre y apellido"
                      required
                      autoFocus
                    />
                  </label>
                  <label>
                    Rol
                    <select
                      value={userForm.rol}
                      onChange={(e) => setUserForm((f) => ({ ...f, rol: e.target.value }))}
                      required
                    >
                      <option value="">Seleccionar</option>
                      <option value="operador">Operador</option>
                      <option value="supervisor">Supervisor</option>
                      <option value="administracion">Administración</option>
                      <option value="owner">Propietario</option>
                    </select>
                  </label>
                  <label>
                    {editingUserId ? 'Nuevo PIN' : 'PIN inicial'}
                    {editingUserId && <span className="field-optional"> (vacío = sin cambio)</span>}
                    <input
                      type="password"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={userForm.pin}
                      onChange={(e) => setUserForm((f) => ({ ...f, pin: e.target.value }))}
                      placeholder="Solo números"
                      required={!editingUserId}
                    />
                  </label>
                  <label>
                    Equipo asignado <span className="field-optional">(opcional)</span>
                    <SearchableSelect
                      value={userForm.equipoCodigo}
                      onChange={(value) => setUserForm((f) => ({ ...f, equipoCodigo: value }))}
                      options={sortedEquipment.map((item) => ({ value: item.code, label: item.name }))}
                    />
                  </label>
                  <div className="modal-footer user-form__actions">
                    <button
                      type="button"
                      className="inline-button"
                      onClick={closeUserModal}
                    >
                      Cancelar
                    </button>
                    <button className="primary-button" type="submit" disabled={busy}>
                      {busy ? 'Guardando...' : editingUserId ? 'Guardar cambios' : 'Crear usuario'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )
        })()}

        {supervisorTab === 'labores' ? (
          <section className="panel-card">
            <div className="labores-header">
              <div className="labores-title-row">
                <h2>Labores</h2>
                <span className="labores-count">{filteredAssignments.length}</span>
              </div>
              <div className="filter-row">
                <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                  <option value="TODAS">Todos los estados</option>
                  <option value="POR_APROBAR">
                    Por aprobar{(() => {
                      const n = assignments.filter(
                        (a) => a.approval === 'PENDIENTE' && a.supervisorId === session.id,
                      ).length
                      return n > 0 ? ` (${n})` : ''
                    })()}
                  </option>
                  <option value="PENDIENTE">Pendiente</option>
                  <option value="EN_PROCESO">En proceso</option>
                  <option value="COMPLETADA">Completada</option>
                  <option value="CANCELADA">Cancelada</option>
                </select>
                <select value={operatorFilter} onChange={(event) => setOperatorFilter(event.target.value)}>
                  <option value="TODOS">Todos los op.</option>
                  {operators.map((operator) => (
                    <option key={operator.id} value={operator.id}>{operator.name}</option>
                  ))}
                </select>
                <select
                  value={ingenioFilter}
                  onChange={(event) => {
                    setIngenioFilter(event.target.value)
                    setHaciendaFilter('TODAS')
                  }}
                >
                  <option value="TODOS">Todos los ingenios</option>
                  {INGENIOS.map((ing) => (
                    <option key={ing.id} value={ing.id}>{ing.nombre}</option>
                  ))}
                </select>
                <select value={haciendaFilter} onChange={(event) => setHaciendaFilter(event.target.value)}>
                  <option value="TODAS">Todas las haciendas</option>
                  {haciendaFilterOptions.map(({ code, name }) => (
                    <option key={code} value={code}>{name}</option>
                  ))}
                </select>
              </div>
            </div>

            <ul className="labores-list">
              {filteredAssignments.map((assignment) => {
                const meta = getStatusMeta(assignment)
                return (
                  <li key={assignment.id} className="labor-item labor-item--tappable" onClick={() => setSelectedLabor(assignment)}>
                    <span className="labor-title">
                      {assignment.haciendaName}{' '}
                      <span style={{ color: 'var(--color-ink-light)', fontWeight: 400 }}>·</span>{' '}
                      {assignment.suerte}
                    </span>

                    <span className={`status-chip ${meta.tone}`}>{meta.label}</span>

                    <span className="labor-name">{assignment.labor}</span>

                    <div className="labor-meta">
                      {assignment.kind === 'ASIGNADA' ? (
                        <span className="kind-badge asignada">Prog.</span>
                      ) : (
                        <span className="kind-badge libre">Campo</span>
                      )}
                      {assignment.zone && (
                        <span className={`zone-badge zone-${assignment.zone.toLowerCase()}`}>
                          {assignment.zone === 'NORTE' ? 'Norte' : 'Sur'}
                        </span>
                      )}
                      <span className="labor-area">
                        {(() => {
                          const maestroRow = maestro.find((r) => r.haciendaCode === assignment.haciendaCode && r.suerte === assignment.suerte)
                          const displayed = assignment.status === 'COMPLETADA' && assignment.executedArea > 0
                            ? assignment.executedArea
                            : assignment.area
                          return maestroRow
                            ? `${formatArea(displayed)} / ${formatArea(maestroRow.area)}`
                            : formatArea(displayed)
                        })()}
                      </span>
                    </div>

                    {assignment.approval !== 'APROBADA' && (
                      <span className={`approval-chip approval-${assignment.approval.toLowerCase()}`}>
                        {assignment.approval === 'PENDIENTE' ? 'Por aprobar' : 'Rechazada'}
                      </span>
                    )}

                    {assignment.approval === 'PENDIENTE' &&
                      assignment.supervisorId === session.id && (
                        <div className="labor-actions" onClick={(e) => e.stopPropagation()}>
                          <button
                            className="approve-btn"
                            onClick={() => void handleApproveAssignment(assignment)}
                          >
                            Aprobar
                          </button>
                          <button
                            className="cancel-btn"
                            onClick={() => void handleRejectAssignment(assignment)}
                          >
                            Rechazar
                          </button>
                        </div>
                      )}

                    {assignment.status === 'PENDIENTE' && assignment.approval !== 'PENDIENTE' && (
                      <div className="labor-actions" onClick={(e) => e.stopPropagation()}>
                        <button
                          className="cancel-btn"
                          onClick={() => void handleCancelAssignment(assignment)}
                        >
                          Cancelar
                        </button>
                      </div>
                    )}
                  </li>
                )
              })}
              {filteredAssignments.length === 0 && (
                <li className="labores-empty">Sin labores para los filtros seleccionados.</li>
              )}
            </ul>
          </section>
        ) : null}

        {supervisorTab === 'equipos' ? (
          <section className="dashboard-grid two-up">
            <article className="panel-card">
              <div className="usuarios-form-collapsible" style={{ borderTop: 'none', paddingTop: 0 }}>
                <button
                  className="usuarios-form-toggle"
                  type="button"
                  onClick={() => setIsEquipmentFormOpen((v) => !v)}
                >
                  <span>+ Crear equipo</span>
                  <span className={`chevron ${isEquipmentFormOpen ? 'chevron--up' : ''}`}>▾</span>
                </button>
              </div>
              {isEquipmentFormOpen && <form className="form-grid-block" style={{ marginTop: '1rem' }} onSubmit={handleCreateEquipment}>
                <div className="form-grid">
                  <label>
                    Codigo
                    <input
                      value={equipmentForm.code}
                      onChange={(event) => updateEquipmentForm('code', event.target.value)}
                      placeholder="TRC-001"
                    />
                  </label>
                  <label>
                    Nombre
                    <input
                      value={equipmentForm.name}
                      onChange={(event) => updateEquipmentForm('name', event.target.value)}
                      placeholder="Case 1304"
                    />
                  </label>
                </div>
                <div className="form-grid">
                  <label>
                    Tipo
                    <select
                      value={equipmentForm.type}
                      onChange={(event) => updateEquipmentForm('type', event.target.value as EquipmentFormState['type'])}
                    >
                      <option value="tractor">tractor</option>
                      <option value="implemento">implemento</option>
                      <option value="vehiculo">vehiculo</option>
                      <option value="otro">otro</option>
                    </select>
                  </label>
                  <label>
                    Estado
                    <select
                      value={equipmentForm.state}
                      onChange={(event) => updateEquipmentForm('state', event.target.value as EquipmentFormState['state'])}
                    >
                      <option value="activo">activo</option>
                      <option value="en_mantenimiento">en_mantenimiento</option>
                      <option value="inactivo">inactivo</option>
                    </select>
                  </label>
                </div>
                <div className="form-grid">
                  <label>
                    Marca
                    <input value={equipmentForm.brand} onChange={(event) => updateEquipmentForm('brand', event.target.value)} />
                  </label>
                  <label>
                    Modelo
                    <input value={equipmentForm.model} onChange={(event) => updateEquipmentForm('model', event.target.value)} />
                  </label>
                </div>
                <div className="form-grid">
                  <label>
                    Ano
                    <input value={equipmentForm.year} onChange={(event) => updateEquipmentForm('year', event.target.value)} placeholder="2024" />
                  </label>
                  <label>
                    Placa
                    <input value={equipmentForm.plate} onChange={(event) => updateEquipmentForm('plate', event.target.value)} />
                  </label>
                </div>
                <label>
                  Numero de serie
                  <input value={equipmentForm.serialNumber} onChange={(event) => updateEquipmentForm('serialNumber', event.target.value)} />
                </label>
                <label>
                  Observaciones
                  <textarea rows={3} value={equipmentForm.notes} onChange={(event) => updateEquipmentForm('notes', event.target.value)} />
                </label>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={equipmentForm.active}
                    onChange={(event) => updateEquipmentForm('active', event.target.checked)}
                  />
                  Equipo activo
                </label>
                <button className="primary-button" type="submit" disabled={busy}>
                  {busy ? 'Guardando...' : 'Crear equipo'}
                </button>
              </form>}
            </article>

            <article className="panel-card">
              <div className="panel-title">
                <h2>Estado de equipos</h2>
              </div>
              <div className="equipment-grid">
                {[...sortedEquipment].sort((a, b) => {
                  const aActive = assignments.some(x => x.equipmentCode === a.code && x.status === 'EN_PROCESO') ? 0 : 1
                  const bActive = assignments.some(x => x.equipmentCode === b.code && x.status === 'EN_PROCESO') ? 0 : 1
                  return aActive - bActive
                }).map((item) => {
                  const active = assignments.find(
                    (assignment) =>
                      assignment.equipmentCode === item.code &&
                      assignment.status === 'EN_PROCESO',
                  )
                  const planned = assignments
                    .filter(
                      (assignment) =>
                        assignment.equipmentCode === item.code &&
                        assignment.dateKey === todayKey &&
                        assignment.status !== 'CANCELADA',
                    )
                    .reduce((sum, assignment) => sum + assignment.area, 0)

                  return (
                    <article key={item.code} className="equipment-card">
                      <div className="equipment-card-head">
                        <div>
                          <h3>{item.name}</h3>
                          <p>{item.code}</p>
                        </div>
                        <span className={`status-pill ${active ? 'progress' : 'done'}`}>
                          {active ? 'Laborando' : 'Disponible'}
                        </span>
                      </div>
                      <div className="equipment-card-body">
                        <strong>{planned.toFixed(2)} ha</strong>
                        <span>
                          {active
                            ? `${active.operatorName} - ${active.haciendaName} ${active.suerte}`
                            : 'Sin labor activa'}
                        </span>
                      </div>
                    </article>
                  )
                })}
              </div>
            </article>
          </section>
        ) : null}

        {selectedLabor && (() => {
          const meta = getStatusMeta(selectedLabor)
          const closeModal = () => {
            setEditingLabor(false)
            setSelectedLabor(null)
          }
          return (
            <div className="modal-overlay open" onClick={closeModal}>
              <div className="modal-card labor-detail-card" onClick={(e) => e.stopPropagation()}>
                <div className="labor-detail-header">
                  <div>
                    <h3>{selectedLabor.labor}</h3>
                    <span className={`status-chip ${meta.tone}`}>{meta.label}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {canEditAssignments && !editingLabor && (
                      <button
                        type="button"
                        className="inline-button"
                        onClick={() => {
                          setEditLaborDraft({
                            executedArea: selectedLabor.executedArea ? String(selectedLabor.executedArea) : '',
                            horometroInicial: selectedLabor.horometroInicial != null ? String(selectedLabor.horometroInicial) : '',
                            horometroFinal: selectedLabor.horometroFinal != null ? String(selectedLabor.horometroFinal) : '',
                            notes: selectedLabor.notes ?? '',
                            equipmentCode: selectedLabor.equipmentCode ?? '',
                          })
                          setEditingLabor(true)
                        }}
                      >
                        Editar
                      </button>
                    )}
                    <button className="modal-close-btn" onClick={closeModal} aria-label="Cerrar">✕</button>
                  </div>
                </div>

                {!editingLabor ? (
                  <div className="labor-detail-grid">
                    <span className="labor-label">Fecha</span>
                    <span className="labor-value">{selectedLabor.dateKey || '—'}</span>

                    <span className="labor-label">Hacienda</span>
                    <span className="labor-value">{selectedLabor.haciendaName}</span>

                    <span className="labor-label">Suerte</span>
                    <span className="labor-value">{selectedLabor.suerte}</span>

                    <span className="labor-label">Zona</span>
                    <span className="labor-value">
                      {selectedLabor.zone ? (
                        <span className={`zone-badge zone-${selectedLabor.zone.toLowerCase()}`}>
                          {selectedLabor.zone === 'NORTE' ? 'Norte' : 'Sur'}
                        </span>
                      ) : '—'}
                    </span>

                    <span className="labor-label">Tipo</span>
                    <span className="labor-value">
                      {selectedLabor.kind === 'ASIGNADA' ? (
                        <span className="kind-badge asignada">Programada</span>
                      ) : (
                        <span className="kind-badge libre">Campo libre</span>
                      )}
                    </span>

                    <span className="labor-label">Aprobación</span>
                    <span className="labor-value">
                      {selectedLabor.approval === 'APROBADA' && '✓ Aprobada'}
                      {selectedLabor.approval === 'PENDIENTE' && (
                        <span className="approval-chip approval-pendiente">Por aprobar</span>
                      )}
                      {selectedLabor.approval === 'RECHAZADA' && (
                        <span className="approval-chip approval-rechazada">Rechazada</span>
                      )}
                    </span>

                    <span className="labor-label">Operador</span>
                    <span className="labor-value">{selectedLabor.operatorName || '—'}</span>

                    <span className="labor-label">Equipo</span>
                    <span className="labor-value">{selectedLabor.equipmentName || '—'}</span>

                    <span className="labor-label">Área plan.</span>
                    <span className="labor-area">{formatArea(selectedLabor.area)}</span>

                    {selectedLabor.executedArea > 0 && (
                      <>
                        <span className="labor-label">Área ejec.</span>
                        <span className="labor-area">{formatArea(selectedLabor.executedArea)}</span>
                      </>
                    )}

                    <span className="labor-label">Inicio</span>
                    <span className="labor-value">{formatTime(selectedLabor.startedAt)}</span>

                    <span className="labor-label">Fin</span>
                    <span className="labor-value">{formatTime(selectedLabor.finishedAt)}</span>

                    {selectedLabor.horometroInicial !== null && (
                      <>
                        <span className="labor-label">Horóm. ini.</span>
                        <span className="labor-value">{selectedLabor.horometroInicial} h</span>
                      </>
                    )}

                    {selectedLabor.horometroFinal !== null && (
                      <>
                        <span className="labor-label">Horóm. fin.</span>
                        <span className="labor-value">{selectedLabor.horometroFinal} h</span>
                      </>
                    )}

                    {selectedLabor.notes && (
                      <>
                        <span className="labor-label">Notas</span>
                        <span className="labor-value">{selectedLabor.notes}</span>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="labor-detail-edit">
                    <label className="assignment-detail-field">
                      <span>Hectáreas ejecutadas</span>
                      <input
                        type="number"
                        min={0}
                        step={0.01}
                        value={editLaborDraft.executedArea}
                        onChange={(e) => setEditLaborDraft((d) => ({ ...d, executedArea: e.target.value }))}
                      />
                      <small>Planificadas: {selectedLabor.area.toFixed(2)} ha</small>
                    </label>

                    <div className="assignment-detail-field-grid">
                      <label className="assignment-detail-field">
                        <span>Horómetro inicial</span>
                        <input
                          type="number"
                          min={0}
                          step={0.1}
                          value={editLaborDraft.horometroInicial}
                          onChange={(e) => setEditLaborDraft((d) => ({ ...d, horometroInicial: e.target.value }))}
                        />
                      </label>
                      <label className="assignment-detail-field">
                        <span>Horómetro final</span>
                        <input
                          type="number"
                          min={0}
                          step={0.1}
                          value={editLaborDraft.horometroFinal}
                          onChange={(e) => setEditLaborDraft((d) => ({ ...d, horometroFinal: e.target.value }))}
                        />
                      </label>
                    </div>

                    <label className="assignment-detail-field">
                      <span>Equipo</span>
                      <select
                        value={editLaborDraft.equipmentCode}
                        onChange={(e) => setEditLaborDraft((d) => ({ ...d, equipmentCode: e.target.value }))}
                      >
                        <option value="">Sin equipo</option>
                        {sortedEquipment.map((eq) => (
                          <option key={eq.code} value={eq.code}>{eq.name}</option>
                        ))}
                      </select>
                    </label>

                    <label className="assignment-detail-field">
                      <span>Observaciones</span>
                      <textarea
                        rows={3}
                        value={editLaborDraft.notes}
                        onChange={(e) => setEditLaborDraft((d) => ({ ...d, notes: e.target.value }))}
                        className="assignment-detail-notes-input"
                        placeholder="Notas / observaciones"
                      />
                    </label>
                  </div>
                )}

                {editingLabor ? (
                  <div className="modal-footer">
                    <button
                      type="button"
                      className="inline-button"
                      onClick={() => setEditingLabor(false)}
                      disabled={busy}
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      className="primary-button"
                      disabled={busy}
                      onClick={async () => {
                        const execNum = Number(editLaborDraft.executedArea)
                        const hiNum = editLaborDraft.horometroInicial.trim() === '' ? null : Number(editLaborDraft.horometroInicial)
                        const hfNum = editLaborDraft.horometroFinal.trim() === '' ? null : Number(editLaborDraft.horometroFinal)
                        const ok = await handleEditAssignment(selectedLabor, {
                          executedArea: isNaN(execNum) ? selectedLabor.executedArea : execNum,
                          horometroInicial: hiNum,
                          horometroFinal: hfNum,
                          notes: editLaborDraft.notes,
                          equipmentCode: editLaborDraft.equipmentCode,
                        })
                        if (ok) {
                          setEditingLabor(false)
                          setSelectedLabor(null)
                        }
                      }}
                    >
                      {busy ? 'Guardando...' : 'Guardar cambios'}
                    </button>
                  </div>
                ) : selectedLabor.status === 'PENDIENTE' ? (
                  <div className="modal-footer">
                    <button
                      className="cancel-btn"
                      onClick={() => {
                        void handleCancelAssignment(selectedLabor)
                        closeModal()
                      }}
                    >
                      Cancelar labor
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          )
        })()}

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

      {isCreateAssignmentOpen && (
        <>
          <div className="more-sheet-overlay" onClick={() => setIsCreateAssignmentOpen(false)} />
          <div className="more-sheet assign-sheet" role="dialog" aria-label="Crear asignación">
            <div className="more-sheet__handle" />
            <div className="active-sheet__header">
              <div>
                <strong>Crear asignación</strong>
                <span className="subtle-copy">Programa una labor para un operador</span>
              </div>
              <button
                type="button"
                className="active-sheet__close"
                onClick={() => setIsCreateAssignmentOpen(false)}
                aria-label="Cerrar"
              >
                ✕
              </button>
            </div>

            <form className="form-grid-block" onSubmit={handleCreateAssignment}>
              <label>
                Zona
                <SearchableSelect
                  value={assignmentForm.zone}
                  onChange={(value) => updateAssignmentForm('zone', value)}
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
                  value={assignmentForm.cliente}
                  onChange={(value) => updateAssignmentForm('cliente', value)}
                  options={[
                    { value: 'ingenios', label: 'Ingenios' },
                    { value: 'proveedores', label: 'Proveedores' },
                  ]}
                />
              </label>
              <label>
                Ingenio
                <SearchableSelect
                  value={assignmentForm.ingenioId}
                  onChange={(value) => updateAssignmentForm('ingenioId', value)}
                  placeholder="Selecciona un ingenio"
                  options={INGENIOS.map((ing) => ({ value: ing.id, label: ing.nombre }))}
                />
              </label>
              <label>
                Hacienda
                <SearchableSelect
                  value={assignmentForm.haciendaCode}
                  onChange={(value) => updateAssignmentForm('haciendaCode', value)}
                  placeholder={!assignmentForm.ingenioId ? 'Selecciona un ingenio primero' : 'Hacienda'}
                  options={assignmentHaciendas.map((item) => ({
                    value: item.code,
                    label: `${item.code} - ${item.name}`,
                  }))}
                />
              </label>
              <div>
                <span className="field-label">Suertes</span>
                {assignmentForm.haciendaCode ? (
                  <ul className="suertes-checklist">
                    {assignmentSuertes.map((row) => {
                      const suerteCode = `${assignmentForm.haciendaCode}-${row.suerte}`
                      const remaining = assignmentForm.labor
                        ? getRemainingArea(assignments, suerteCode, assignmentForm.labor, row.area)
                        : row.area
                      const isCompleted = assignmentForm.labor && remaining === 0
                      return (
                        <li key={row.suerte}>
                          <label className={`suerte-check-item${isCompleted ? ' suerte-check-item--done' : ''}`}>
                            <input
                              type="checkbox"
                              checked={assignmentSuertesList.includes(row.suerte)}
                              onChange={() => !isCompleted && toggleAssignmentSuerte(row.suerte)}
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
                {assignmentSuertesList.length > 0 && (
                  <p className="suertes-count">{assignmentSuertesList.length} suerte(s) seleccionada(s)</p>
                )}
              </div>
              <label>
                Labor
                <SearchableSelect
                  value={assignmentForm.labor}
                  onChange={(value) => updateAssignmentForm('labor', value)}
                  options={WORKFLOW.map((labor) => {
                    const firstSuerte = assignmentSuertesList[0]
                    const isSuggested =
                      assignmentForm.haciendaCode && firstSuerte
                        ? labor === getSuggestedLabor(assignments, `${assignmentForm.haciendaCode}-${firstSuerte}`)
                        : false
                    return { value: labor, label: labor, rightLabel: isSuggested ? '<- sugerida' : undefined }
                  })}
                />
              </label>
              <label>
                Operador
                <SearchableSelect
                  value={assignmentForm.operatorId}
                  onChange={(value) => updateAssignmentForm('operatorId', value)}
                  options={operators.map((op) => ({ value: op.id, label: op.name }))}
                />
              </label>
              <label>
                Equipo
                <SearchableSelect
                  value={assignmentForm.equipmentCode}
                  onChange={(value) => updateAssignmentForm('equipmentCode', value)}
                  options={sortedEquipment.map((item) => ({ value: item.code, label: item.name }))}
                />
              </label>
              <label>
                Operador 2 <span className="field-optional">(opcional)</span>
                <SearchableSelect
                  value={assignmentForm.operatorId2}
                  onChange={(value) => updateAssignmentForm('operatorId2', value)}
                  options={operators.map((op) => ({ value: op.id, label: op.name }))}
                />
              </label>
              <label>
                Equipo 2 <span className="field-optional">(opcional)</span>
                <SearchableSelect
                  value={assignmentForm.equipmentCode2}
                  onChange={(value) => updateAssignmentForm('equipmentCode2', value)}
                  options={sortedEquipment.map((item) => ({ value: item.code, label: item.name }))}
                />
              </label>
              <label>
                Observaciones
                <textarea
                  rows={3}
                  value={assignmentForm.notes}
                  onChange={(event) => updateAssignmentForm('notes', event.target.value)}
                  placeholder="Indicaciones para la labor"
                />
              </label>
              <button className="primary-button" type="submit" disabled={busy}>
                {busy ? 'Guardando...' : 'Crear asignacion'}
              </button>
            </form>
          </div>
        </>
      )}
    </main>
  )
}

export default SupervisorView
