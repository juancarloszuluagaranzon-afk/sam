import { useMemo, useState, type FormEvent } from 'react'
import { useAppData } from '../context/AppDataContext'

// Visor y gestión de mapas offline. Imports ESTÁTICOS a propósito (NO lazy):
// el chunk aparte rompió el build de Vercel en producción (17-jul-2026).
import { MapaView } from './MapaView'
import { MapasTab } from './MapasTab'
import { FlotaTab } from './FlotaTab'
import { BodegasTab } from './BodegasTab'
import { InsumosResumenTab } from './InsumosResumenTab'
import { NAV_OPCIONES, MAX_NAV, NAV_DEFECTO, leerNav, guardarNav, restaurarNav } from '../lib/navPrefs'
import { useAssignmentActions } from '../hooks/useAssignmentActions'
import { useAssignmentForm } from '../hooks/useAssignmentForm'
import { useEquipmentForm } from '../hooks/useEquipmentForm'
import { usePhotoUpload } from '../hooks/usePhotoUpload'
import { useUserForm } from '../hooks/useUserForm'
import { createAppUser, updateAppUser, deleteAppUser, setAppUserActivo, loadAppUsers, summarizeAssignments, getIngenioName, executionDateKey, cancelAssignmentsBulk, deleteAssignment, loadKardexDeEquipo, loadAuditoria, type AsignacionAuditoria } from '../services/samApi'
import { db } from '../lib/db'
import logoAgromorales from '../assets/logo-agromorales.jpeg'
import SearchableSelect from '../components/SearchableSelect'
import { DiagnosticModal } from '../components/DiagnosticModal'
import { ThemeToggle } from '../components/ThemeToggle'
import { MapButton } from '../components/MapButton'
import { NewSuerteModal } from '../components/NewSuerteModal'
import { RegistrarLaborModal } from '../components/RegistrarLaborModal'
import { AreaDetailModal, type AreaDetailRow } from '../components/AreaDetailModal'
import {
  EntityHistoryModal,
  matchesSummaryFilter,
  buildMonthOptions,
  currentQuincena,
  type SummaryEntity,
  type SummaryQuincena,
} from '../components/EntityHistoryModal'
import { WORKFLOW } from '../data/constants'
import type { Assignment, Equipment, InsumoKardex, MaestroRow, UserProfile } from '../domain/sam'
import { formatTime } from '../services/samApi'
import { isSameCycle, areaEjecutadaVisible } from '../utils/suerteCycle'
import { MaestrosTab } from './MaestrosTab'
import { FacturacionTab } from './FacturacionTab'
import { PlanillaTab } from './PlanillaTab'
import { RealizadasTab } from './RealizadasTab'
import { LaboresTab } from './LaboresTab'
import { IngeniosTab } from './IngeniosTab'
import { MotivacionTab } from './MotivacionTab'
import { EmpresasTab } from './EmpresasTab'
import { TercerosTab } from './TercerosTab'
import { ZonasTab } from './ZonasTab'
import { InsumosModule } from './InsumosModule'
import { LaborFilterDrawer } from '../components/LaborFilterDrawer'

export type SupervisorTab = 'resumen' | 'asignar' | 'labores' | 'equipos' | 'tablero' | 'reporte' | 'usuarios' | 'maestros' | 'planilla' | 'realizadas' | 'catalogo' | 'aprobaciones' | 'ingenios' | 'empresas' | 'terceros' | 'zonas' | 'insumos' | 'facturacion' | 'motivacion' | 'mapa' | 'mapascat' | 'flota' | 'bodegas' | 'insumosresumen'

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


function getRoleLabel(role: UserProfile['role'] | undefined): string {
  if (role === 'owner') return 'Propietario'
  if (role === 'supervisor') return 'Supervisor'
  if (role === 'administracion') return 'Administración'
  if (role === 'soporte') return 'Soporte'
  if (role === 'supervisor_insumos') return 'Supervisor de insumos'
  if (role === 'conductor') return 'Conductor de escolta'
  return 'Operador'
}

function isSupervisorOrOwner(role: UserProfile['role'] | undefined): boolean {
  return role === 'supervisor' || role === 'owner' || role === 'administracion'
}

function formatArea(value: number) {
  return `${value.toFixed(2)} ha`
}

// VENTANA DE APROBACIÓN del supervisor: tiene 36 h desde que la labor se CERRÓ
// (momento en que entra a "A facturar") para aprobarla. Pasado ese plazo la
// decisión escala: solo administración/dueño puede aprobarla. Decisión del dueño
// para que las aprobaciones no se queden colgadas indefinidamente.
const APROBACION_HORAS = 36
function horasDesdeCierre(a: Assignment): number {
  const ref = a.finishedAt ?? a.updatedAt ?? a.createdAt
  if (!ref) return 0
  const t = new Date(ref).getTime()
  if (Number.isNaN(t)) return 0
  return (Date.now() - t) / 3_600_000
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

function getRemainingArea(assignments: Assignment[], suerteCode: string, labor: string, totalArea: number, todayKey: string): number {
  const executed = assignments
    .filter(
      (a) =>
        a.suerteCode === suerteCode &&
        normalizeText(a.labor) === normalizeText(labor) &&
        // Solo el CICLO ACTUAL (ventana de dias respecto a hoy), consistente
        // con la vista del operario: un re-laboreo meses despues vuelve a
        // mostrar el area completa; el avance reciente del ciclo si se descuenta.
        isSameCycle(a.dateKey, todayKey) &&
        (a.status === 'COMPLETADA' || a.status === 'PARCIAL'),
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

function getStatusMeta(assignment: Pick<Assignment, 'status' | 'executedArea' | 'area' | 'approval'>) {
  // Una CANCELADA que fue RECHAZADA en aprobación se muestra como "Rechazada"
  // (auditoría): no cuenta como área, pero se ve distinto de una cancelación normal.
  if (assignment.status === 'CANCELADA' && assignment.approval === 'RECHAZADA') {
    return { label: 'Rechazada', tone: 'cancel' as const }
  }
  if (assignment.status === 'PARCIAL') {
    return { label: 'Parcial', tone: 'progress' as const }
  }
  if (assignment.status === 'COMPLETADA') {
    // Compatibilidad con filas legacy: una COMPLETADA con executedArea
    // menor al area planificada se etiqueta "Parcial" (antes era el
    // unico mecanismo, ahora coexiste con el status real PARCIAL).
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
  laborSearch: string
  setLaborSearch: (v: string) => void
  reportFilters: { period: 'CUSTOM' | 'HOY' | 'AYER' | 'PRIMERA' | 'SEGUNDA' | 'MES'; view: 'labor' | 'maquina'; mes: string; desde: string; hasta: string; estado: string; haciendaCode: string; suerte: string; operatorId: string; ingenioId: string }
  setReportFilters: React.Dispatch<React.SetStateAction<{ period: 'CUSTOM' | 'HOY' | 'AYER' | 'PRIMERA' | 'SEGUNDA' | 'MES'; view: 'labor' | 'maquina'; mes: string; desde: string; hasta: string; estado: string; haciendaCode: string; suerte: string; operatorId: string; ingenioId: string }>>
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
  laborSearch,
  setLaborSearch,
  reportFilters,
  setReportFilters,
  onSaveSession,
  handleChangePin,
  handleDownloadReport,
}: Props) {
  const {
    session,
    isOnline, outboxCount, busy, error, info,
    operators, users, setUsers, assignments, setAssignments, maestro, setMaestro, todayKey, sortedEquipment, operatorStatusMap,
    setError, setBusy, setInfo,
    activeLabores, labores, zonas, insumos, ingenios,
  } = useAppData()
  // Ingenios activos para los selectores (el catálogo completo se edita en su pestaña).
  const ingeniosOpts = useMemo(() => ingenios.filter((i) => i.activo), [ingenios])

  // Consumo de insumos cargado a un equipo (modal al tocar una tarjeta de equipo).
  const [equipoConsumo, setEquipoConsumo] = useState<Equipment | null>(null)
  const [equipoConsumoRows, setEquipoConsumoRows] = useState<InsumoKardex[]>([])
  const [equipoConsumoLoading, setEquipoConsumoLoading] = useState(false)
  const insumoInfoMap = useMemo(() => {
    const m = new Map<string, { nombre: string; unidad: string }>()
    insumos.forEach((i) => m.set(i.id, { nombre: i.nombre, unidad: i.unidad }))
    return m
  }, [insumos])

  async function openEquipoConsumo(item: Equipment) {
    setEquipoConsumo(item)
    setEquipoConsumoRows([])
    setEquipoConsumoLoading(true)
    try {
      setEquipoConsumoRows(await loadKardexDeEquipo(item.code))
    } finally {
      setEquipoConsumoLoading(false)
    }
  }

  // Activar / desactivar un usuario (lo usa la pestaña Usuarios).
  async function toggleUserActivo(u: UserProfile) {
    const isActive = u.active !== false
    setBusy(true)
    setError('')
    try {
      await setAppUserActivo(u.id, !isActive)
      const refreshed = await loadAppUsers()
      setUsers(refreshed.data)
      setInfo(isActive ? `${u.name} desactivado.` : `${u.name} activado.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cambiar el estado del usuario.')
    } finally {
      setBusy(false)
    }
  }

  // Zonas activas para el selector del formulario de usuario (solo supervisores).
  const zonasActivas = useMemo(
    () => [...zonas].filter((z) => z.activo).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' })),
    [zonas],
  )
  // Zona del supervisor logueado, para auto-llenar al aprobar. Owner/admin no
  // tienen zona → cae a la zona ya registrada en la labor (o vacía).
  const miZona = useMemo(() => users.find((u) => u.id === session?.id)?.zona ?? '', [users, session?.id])

  // Nombres (en mayúsculas) de labores MANUALES, para advertir si se asignan a
  // un operador (que en este negocio es de tractor).
  const manualLaborSet = useMemo(
    () => new Set(labores.filter((l) => l.tipo === 'MANUAL').map((l) => l.nombre.toUpperCase())),
    [labores],
  )

  const [isCreateAssignmentOpen, setIsCreateAssignmentOpen] = useState(false)
  const [isDiagOpen, setIsDiagOpen] = useState(false)
  // Submenú "Catálogos" del more-sheet (Maestros, Labores, Empresas, Terceros).
  const [catalogosOpen, setCatalogosOpen] = useState(false)
  // Accesos de la barra que el dueño eligió (Más → Personalizar barra).
  const [navBarra, setNavBarra] = useState<string[]>(() => leerNav(session?.id ?? ''))
  const [navConfigOpen, setNavConfigOpen] = useState(false)
  const [navDraft, setNavDraft] = useState<string[]>([])
  const [isNewSuerteOpen, setIsNewSuerteOpen] = useState(false)
  const [isRegistrarLaborOpen, setIsRegistrarLaborOpen] = useState(false)
  // Texto para filtrar el listado de suertes del formulario de asignar
  // (escribir en vez de solo hacer scroll, como en Hacienda). Se limpia al
  // cambiar de hacienda/ingenio para no arrastrar un filtro de otra lista.
  const [suerteSearch, setSuerteSearch] = useState('')
  // Panel emergente de filtros de la pestana Labores (drawer lateral).
  const [filterPanelOpen, setFilterPanelOpen] = useState(false)

  // Cuantos filtros (no la busqueda de texto) estan activos. Alimenta el
  // badge del boton "Filtros" para que el supervisor sepa que hay filtros
  // aplicados aunque el panel este cerrado.
  const activeFilterCount =
    (statusFilter !== 'TODAS' ? 1 : 0) +
    (operatorFilter !== 'TODOS' ? 1 : 0) +
    (ingenioFilter !== 'TODOS' ? 1 : 0) +
    (haciendaFilter !== 'TODAS' ? 1 : 0)

  // Restablece todos los filtros del panel a su valor "todos".
  function clearLaborFilters() {
    setStatusFilter('TODAS')
    setOperatorFilter('TODOS')
    setIngenioFilter('TODOS')
    setHaciendaFilter('TODAS')
  }

  // Opciones de Estado para el drawer de filtros. Labores incluye "Por aprobar"
  // (con el conteo de pendientes del supervisor); el Resumen incluye "Parcial".
  const laborStatusOptions = useMemo(() => {
    const n = assignments.filter(
      (a) => a.approval === 'PENDIENTE' && a.supervisorId === session?.id,
    ).length
    return [
      { value: 'TODAS', label: 'Todos los estados' },
      { value: 'POR_APROBAR', label: `Por aprobar${n > 0 ? ` (${n})` : ''}` },
      { value: 'PENDIENTE', label: 'Pendiente' },
      { value: 'EN_PROCESO', label: 'En proceso' },
      { value: 'COMPLETADA', label: 'Completada' },
      { value: 'CANCELADA', label: 'Cancelada' },
    ]
  }, [assignments, session])

  const summaryStatusOptions = [
    { value: 'TODAS', label: 'Todos los estados' },
    { value: 'PENDIENTE', label: 'Pendiente' },
    { value: 'EN_PROCESO', label: 'En proceso' },
    { value: 'COMPLETADA', label: 'Completada' },
    { value: 'PARCIAL', label: 'Parcial' },
  ]

  const {
    assignmentForm, updateAssignmentForm,
    assignmentSuertesList, toggleAssignmentSuerte,
    assignmentHaciendas, assignmentSuertes,
    prefillAssignmentForm: prefillFormState,
    createAssignment: handleCreateAssignment,
    reusableMatches, reuseExisting,
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

  // Bandeja de aprobaciones: labores YA FINALIZADAS (parcial o completa, asignada
  // o de campo) que esperan el visto bueno del supervisor antes de facturarse.
  // Supervisor ve las suyas (scopedAssignments); owner/admin ven todas.
  const pendingApprovals = useMemo(
    () =>
      scopedAssignments
        .filter(
          (a) =>
            a.approval === 'PENDIENTE' &&
            (a.status === 'COMPLETADA' || a.status === 'PARCIAL'),
        )
        .sort((a, b) => (b.finishedAt ?? '').localeCompare(a.finishedAt ?? '')),
    [scopedAssignments],
  )

  // Pendientes "colgadas": asignadas, NUNCA iniciadas, sin avance, de hace +N
  // días. El filtro diario las esconde y se acumulan inflando el área asignada.
  // Se pueden cancelar en bloque (CANCELADA = reversible, no borra).
  const STALE_DAYS = 3
  const stalePendientes = useMemo(() => {
    const [y, m, d] = todayKey.split('-').map(Number)
    const cut = new Date(y, m - 1, d - STALE_DAYS)
    const cutoff = `${cut.getFullYear()}-${String(cut.getMonth() + 1).padStart(2, '0')}-${String(cut.getDate()).padStart(2, '0')}`
    const list = scopedAssignments.filter(
      (a) =>
        a.status === 'PENDIENTE' &&
        !a.startedAt &&
        (a.executedArea ?? 0) === 0 &&
        a.dateKey < cutoff,
    )
    return {
      list,
      count: list.length,
      area: list.reduce((s, a) => s + a.area, 0),
      ids: list.map((a) => a.id),
    }
  }, [scopedAssignments, todayKey])

  const [showStaleConfirm, setShowStaleConfirm] = useState(false)
  const [cleaningStale, setCleaningStale] = useState(false)

  // Días transcurridos desde el dateKey de la labor hasta hoy (para el detalle).
  function diasDesde(dateKey: string): number {
    const [y, m, d] = dateKey.split('-').map(Number)
    const [ty, tm, td] = todayKey.split('-').map(Number)
    const then = new Date(y, m - 1, d).getTime()
    const today = new Date(ty, tm - 1, td).getTime()
    return Math.max(0, Math.round((today - then) / 86400000))
  }

  async function handleCleanStale() {
    const ids = stalePendientes.ids
    if (ids.length === 0) return
    setCleaningStale(true)
    setError('')
    try {
      await cancelAssignmentsBulk(ids)
      const idSet = new Set(ids)
      setAssignments((cur) => cur.map((a) => (idSet.has(a.id) ? { ...a, status: 'CANCELADA' } : a)))
      setInfo(`${ids.length} labores pendientes viejas canceladas (reversibles).`)
      setShowStaleConfirm(false)
    } catch {
      setError('No se pudieron cancelar las pendientes. Reintenta.')
    } finally {
      setCleaningStale(false)
    }
  }

  // Cancela UNA pendiente vieja (desde el detalle). Reversible (CANCELADA).
  async function handleCleanOneStale(id: string) {
    setCleaningStale(true)
    setError('')
    try {
      await cancelAssignmentsBulk([id])
      setAssignments((cur) => cur.map((a) => (a.id === id ? { ...a, status: 'CANCELADA' } : a)))
      setInfo('Labor pendiente cancelada (reversible).')
    } catch {
      setError('No se pudo cancelar la labor. Reintenta.')
    } finally {
      setCleaningStale(false)
    }
  }

  // Edición/eliminación de líneas del Reporte (ajuste de liquidación por dueño/admin).
  const [deleteReportTarget, setDeleteReportTarget] = useState<Assignment | null>(null)
  const [deletingReport, setDeletingReport] = useState(false)

  async function handleDeleteReportRow() {
    const target = deleteReportTarget
    if (!target) return
    setDeletingReport(true)
    setError('')
    try {
      await deleteAssignment(target.id)
      setAssignments((cur) => cur.filter((a) => a.id !== target.id))
      void db.assignments.delete(target.id)
      setInfo(`Línea eliminada del reporte: ${target.haciendaName} · ${target.suerte} · ${target.labor}.`)
      setDeleteReportTarget(null)
    } catch {
      setError('No se pudo eliminar la línea. Revisa la conexión e inténtalo de nuevo.')
    } finally {
      setDeletingReport(false)
    }
  }

  const [summaryMonth, setSummaryMonth] = useState(() => todayKey.slice(0, 7))
  // Default = quincena EN CURSO (no "todo el mes"): el dashboard siempre abre
  // mostrando los KPIs de la quincena del corte actual.
  const [summaryQuincena, setSummaryQuincena] = useState<SummaryQuincena>(() => currentQuincena(todayKey))
  const [selectedEntity, setSelectedEntity] = useState<SummaryEntity | null>(null)
  const [summaryOperatorSearch, setSummaryOperatorSearch] = useState('')
  const [summaryEquipmentSearch, setSummaryEquipmentSearch] = useState('')

  // Búsqueda libre de "Últimos movimientos" (pestaña Asignar): filtra por
  // hacienda, suerte, labor, operario o equipo.
  const [movSearch, setMovSearch] = useState('')
  const visibleRecent = useMemo(() => {
    const q = movSearch.trim().toLowerCase()
    if (!q) return recentAssignments
    return recentAssignments.filter(
      (a) =>
        a.haciendaName.toLowerCase().includes(q) ||
        a.suerte.toLowerCase().includes(q) ||
        a.labor.toLowerCase().includes(q) ||
        (a.operatorName ?? '').toLowerCase().includes(q) ||
        (a.equipmentName ?? '').toLowerCase().includes(q) ||
        (a.equipmentCode ?? '').toLowerCase().includes(q),
    )
  }, [recentAssignments, movSearch])

  // Aprobación de labor de campo: si le faltan cliente/zona, el supervisor los
  // diligencia OBLIGATORIamente en este modal antes de aprobar.
  const [approveTarget, setApproveTarget] = useState<Assignment | null>(null)
  const [approveCliente, setApproveCliente] = useState('')
  const [approveZona, setApproveZona] = useState('')

  // Confirmacion de borrado de usuario (CRUD admin/owner). Guarda el usuario
  // a eliminar para mostrar el modal de confirmacion superpuesto.
  const [confirmDeleteUser, setConfirmDeleteUser] = useState<{ id: string; nombre: string } | null>(null)

  const [editingLabor, setEditingLabor] = useState(false)
  const [editLaborDraft, setEditLaborDraft] = useState({
    executedArea: '',
    horometroInicial: '',
    horometroFinal: '',
    notes: '',
    equipmentCode: '',
    operatorId: '',
    fechaEjec: '',
    status: 'PENDIENTE' as Assignment['status'],
    facturaNumero: '',
  })

  // Auditoría de ediciones (historial de cambios de una labor).
  const [auditFor, setAuditFor] = useState<Assignment | null>(null)
  const [auditRows, setAuditRows] = useState<AsignacionAuditoria[]>([])
  const [auditLoading, setAuditLoading] = useState(false)
  async function openAudit(labor: Assignment) {
    setAuditFor(labor)
    setAuditRows([])
    setAuditLoading(true)
    try {
      setAuditRows(await loadAuditoria(labor.id))
    } finally {
      setAuditLoading(false)
    }
  }
  const fmtEditFecha = (iso: string) =>
    iso ? new Date(iso).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''
  const nombreUsuario = (id: string | null | undefined) =>
    id ? users.find((u) => u.id === id)?.name ?? id : 'sistema'
  const renderCambios = (c: Record<string, unknown> | null): string => {
    if (!c) return ''
    const fmt = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : String(v))
    return Object.entries(c)
      .map(([k, v]) => (Array.isArray(v) && v.length === 2 ? `${k}: ${fmt(v[0])} → ${fmt(v[1])}` : `${k}: ${fmt(v)}`))
      .join(' · ')
  }

  const summaryMonthOptions = useMemo(() => buildMonthOptions(todayKey.slice(0, 7)), [todayKey])

  // Suertes que tienen labores (para el filtro del Reporte). Si hay una hacienda
  // elegida, solo las de esa hacienda — así la lista no se vuelve enorme.
  const reportSuerteOptions = useMemo(() => {
    const set = new Set<string>()
    for (const a of assignments) {
      if (reportFilters.haciendaCode && a.haciendaCode !== reportFilters.haciendaCode) continue
      if (a.suerte) set.add(a.suerte)
    }
    return Array.from(set).sort((x, y) => x.localeCompare(y, undefined, { numeric: true }))
  }, [assignments, reportFilters.haciendaCode])

  // Base del Resumen con los MISMOS filtros/búsqueda de Labores (compartidos),
  // PERO sin el "reset diario" del statusFilter 'TODAS' (eso es propio de la
  // lista de Labores; el Resumen tiene su propio Mes/Periodo). Así KPIs, cards
  // y el modal reflejan lo mismo que se filtró en la barra de búsqueda.
  const summaryBaseAssignments = useMemo(() => {
    const q = laborSearch.trim().toLowerCase()
    // statusFilter solo aplica si es un estado real (no 'TODAS' ni 'POR_APROBAR').
    const concreteStatus =
      statusFilter !== 'TODAS' && statusFilter !== 'POR_APROBAR' ? statusFilter : ''
    return scopedAssignments.filter((a) => {
      if (concreteStatus && a.status !== concreteStatus) return false
      if (operatorFilter !== 'TODOS' && a.operatorId !== operatorFilter) return false
      if (haciendaFilter !== 'TODAS' && a.haciendaCode !== haciendaFilter) return false
      if (ingenioFilter !== 'TODOS') {
        const row = maestro.find((r) => r.haciendaCode === a.haciendaCode && r.suerte === a.suerte)
        if (!row || row.ingenio_id !== ingenioFilter) return false
      }
      if (q) {
        const haystack = `${a.haciendaName} ${a.suerte} ${a.labor} ${a.operatorName}`.toLowerCase()
        if (!haystack.includes(q)) return false
      }
      return true
    })
  }, [scopedAssignments, statusFilter, operatorFilter, haciendaFilter, ingenioFilter, laborSearch, maestro])

  const summaryAssignments = useMemo(
    () =>
      summaryBaseAssignments.filter((a) => {
        if (a.status === 'CANCELADA') return false
        if (summaryQuincena === 'HOY') {
          // Match summarizeAssignments carry-over logic: include labors created today
          // OR completed today even if scheduled earlier.
          if (a.dateKey === todayKey) return true
          if ((a.status === 'COMPLETADA' || a.status === 'PARCIAL') && a.finishedAt) {
            const finDay = new Date(a.finishedAt).toLocaleDateString('en-CA', {
              timeZone: 'America/Bogota',
            })
            if (finDay === todayKey) return true
          }
          return false
        }
        // Para PRIMERA/SEGUNDA quincena, agrupar por fecha de EJECUCIÓN, no de asignación:
        // una labor asignada el 14-may pero terminada el 16-may cuenta para la 2da quincena.
        return matchesSummaryFilter(executionDateKey(a), summaryMonth, summaryQuincena, todayKey)
      }),
    [summaryBaseAssignments, summaryMonth, summaryQuincena, todayKey],
  )

  const summaryMetrics = useMemo(() => {
    // plannedArea DEDUP por suerte+labor: el split de cruce-de-día y el
    // multi-operario crean varias filas con el área completa de la misma suerte;
    // sumarlas inflaba el planificado (bug de facturación). MAX por suerte+labor.
    const plannedBySuerte = new Map<string, number>()
    for (const a of summaryAssignments) {
      const key = `${a.suerteCode}|${a.labor.trim().toUpperCase()}`
      plannedBySuerte.set(key, Math.max(plannedBySuerte.get(key) ?? 0, a.area))
    }
    const planned = [...plannedBySuerte.values()].reduce((s, v) => s + v, 0)
    // PARCIAL aporta a executed igual que COMPLETADA — refleja lo
    // realmente hecho en el periodo.
    const executed = summaryAssignments
      .filter((a) => a.status === 'COMPLETADA' || a.status === 'PARCIAL')
      .reduce((s, a) => s + (a.executedArea > 0 ? a.executedArea : a.area), 0)
    const inProgress = summaryAssignments.filter((a) => a.status === 'EN_PROCESO').length
    return {
      plannedArea: planned,
      executedArea: executed,
      completion: planned ? Math.round((executed / planned) * 100) : 0,
      inProgress,
    }
  }, [summaryAssignments])

  // Detalle de los KPIs de área (modal). Deben COMPONER exactamente el número:
  // - Planificadas: dedup por suerte+labor tomando el MAX área (misma lógica que
  //   summaryMetrics.plannedArea) → una línea por suerte+labor.
  // - Ejecutadas: cada COMPLETADA/PARCIAL con su área ejecutada (fallback al plan).
  const [areaDetail, setAreaDetail] = useState<'PLANIFICADAS' | 'EJECUTADAS' | null>(null)
  const plannedDetailRows = useMemo<AreaDetailRow[]>(() => {
    const best = new Map<string, { a: Assignment; area: number }>()
    for (const a of summaryAssignments) {
      const key = `${a.suerteCode}|${a.labor.trim().toUpperCase()}`
      const prev = best.get(key)
      if (!prev || a.area > prev.area) best.set(key, { a, area: a.area })
    }
    return [...best.values()].map(({ a, area }) => ({
      id: a.id, haciendaName: a.haciendaName, suerte: a.suerte, labor: a.labor,
      operatorName: a.operatorName, status: a.status, area,
    }))
  }, [summaryAssignments])
  const executedDetailRows = useMemo<AreaDetailRow[]>(() =>
    summaryAssignments
      .filter((a) => a.status === 'COMPLETADA' || a.status === 'PARCIAL')
      .map((a) => ({
        id: a.id, haciendaName: a.haciendaName, suerte: a.suerte, labor: a.labor,
        operatorName: a.operatorName, status: a.status,
        area: a.executedArea > 0 ? a.executedArea : a.area,
      })),
  [summaryAssignments])

  const summaryLabor = useMemo(() => {
    const groups = new Map<string, { planned: number; executed: number; count: number }>()
    for (const a of summaryAssignments) {
      const current = groups.get(a.labor) ?? { planned: 0, executed: 0, count: 0 }
      current.planned += a.area
      current.count += 1
      if (a.status === 'COMPLETADA' || a.status === 'PARCIAL') current.executed += (a.executedArea > 0 ? a.executedArea : a.area)
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
      const name = a.operatorName || 'Sin operador'
      const id = a.operatorId || ''
      // Clave: por id si existe, si no por nombre (filas históricas sin
      // operador_id). El modal de detalle reconstruye esta MISMA clave.
      const key = id || `name:${name.trim().toUpperCase()}`
      const current = groups.get(key) ?? { id, name, planned: 0, executed: 0, count: 0 }
      current.planned += a.area
      // Misma fórmula que el Reporte: una COMPLETADA/PARCIAL sin área ejecutada
      // registrada cuenta su área planificada (consistencia Resumen↔Reporte).
      if (a.status === 'COMPLETADA' || a.status === 'PARCIAL') current.executed += (a.executedArea > 0 ? a.executedArea : a.area)
      current.count += 1
      groups.set(key, current)
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
      const name = a.equipmentName || a.equipmentCode || 'Sin equipo'
      const code = a.equipmentCode || ''
      const key = code || `name:${name.trim().toUpperCase()}`
      const current = groups.get(key) ?? { code, name, planned: 0, executed: 0, count: 0 }
      current.planned += a.area
      if (a.status === 'COMPLETADA' || a.status === 'PARCIAL') current.executed += a.executedArea
      current.count += 1
      groups.set(key, current)
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
        <div className="topbar-actions">
          <MapButton onClick={() => setSupervisorTab('mapa')} />
          <ThemeToggle />
        </div>
      </header>

      <div
        className={`side-overlay ${isSideMenuOpen ? 'open' : ''}`}
        onClick={() => setIsSideMenuOpen(false)}
      />

      {(session.role === 'owner' || session.role === 'supervisor' || session.role === 'administracion') && moreMenuOpen && (
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
                {!navBarra.includes('tablero') && (
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
                )}
                <button
                  className={`more-sheet__item ${supervisorTab === 'maestros' ? 'more-sheet__item--active' : ''}`}
                  onClick={() => { setSupervisorTab('maestros'); setMoreMenuOpen(false) }}
                >
                  <span className="more-sheet__icon">▤</span>
                  <div>
                    <div className="more-sheet__label">Maestros</div>
                    <div className="more-sheet__desc">Catálogo de suertes — editar área neta</div>
                  </div>
                </button>
                <button
                  className={`more-sheet__item ${supervisorTab === 'realizadas' ? 'more-sheet__item--active' : ''}`}
                  onClick={() => { setSupervisorTab('realizadas'); setMoreMenuOpen(false) }}
                >
                  <span className="more-sheet__icon">☑</span>
                  <div>
                    <div className="more-sheet__label">Realizadas</div>
                    <div className="more-sheet__desc">Labores ejecutadas, filtra por hacienda y labor</div>
                  </div>
                </button>
                {!navBarra.includes('reporte') && (
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
                )}
                <button
                  className={`more-sheet__item ${supervisorTab === 'facturacion' ? 'more-sheet__item--active' : ''}`}
                  onClick={() => { setSupervisorTab('facturacion'); setMoreMenuOpen(false) }}
                >
                  <span className="more-sheet__icon">🧾</span>
                  <div>
                    <div className="more-sheet__label">Facturación</div>
                    <div className="more-sheet__desc">Asigna N° de factura a las labores realizadas (en lote)</div>
                  </div>
                </button>
              </>
            ) : (
              <>
                {/* Del dueño: lo que NO está fijado en su barra. */}
                {session.role === 'owner' && (
                  <>
                    {/* Solo los que no tienen su propia entrada más abajo
                        (Tablero, Reporte, Planilla, Mapa y Flota ya la tienen). */}
                    {NAV_OPCIONES
                      .filter((op) => !navBarra.includes(op.id))
                      .filter((op) => ['labores', 'realizadas', 'equipos', 'insumosresumen', 'aprobaciones', 'asignar', 'resumen'].includes(op.id))
                      .map((op) => (
                      <button
                        key={op.id}
                        className={`more-sheet__item ${supervisorTab === op.id ? 'more-sheet__item--active' : ''}`}
                        onClick={() => { setSupervisorTab(op.id as SupervisorTab); setMoreMenuOpen(false) }}
                      >
                        <span className="more-sheet__icon">{op.icon}</span>
                        <div>
                          <div className="more-sheet__label">
                            {op.label}
                            {op.id === 'aprobaciones' && pendingApprovals.length > 0 ? ` (${pendingApprovals.length})` : ''}
                          </div>
                          <div className="more-sheet__desc">{op.desc}</div>
                        </div>
                      </button>
                    ))}
                    <button
                      className="more-sheet__item"
                      onClick={() => { setNavDraft([...navBarra]); setNavConfigOpen(true); setMoreMenuOpen(false) }}
                    >
                      <span className="more-sheet__icon">⚙</span>
                      <div>
                        <div className="more-sheet__label">Personalizar barra</div>
                        <div className="more-sheet__desc">Elige qué {MAX_NAV} accesos quieres abajo</div>
                      </div>
                    </button>
                  </>
                )}
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
                {session.role === 'administracion' && (
                  <button
                    className={`more-sheet__item ${supervisorTab === 'realizadas' ? 'more-sheet__item--active' : ''}`}
                    onClick={() => { setSupervisorTab('realizadas'); setMoreMenuOpen(false) }}
                  >
                    <span className="more-sheet__icon">☑</span>
                    <div>
                      <div className="more-sheet__label">Realizadas</div>
                      <div className="more-sheet__desc">Labores ejecutadas, filtra por hacienda y labor</div>
                    </div>
                  </button>
                )}
                {session.role === 'administracion' && (
                  <button
                    className={`more-sheet__item ${supervisorTab === 'facturacion' ? 'more-sheet__item--active' : ''}`}
                    onClick={() => { setSupervisorTab('facturacion'); setMoreMenuOpen(false) }}
                  >
                    <span className="more-sheet__icon">🧾</span>
                    <div>
                      <div className="more-sheet__label">Facturación</div>
                      <div className="more-sheet__desc">Asigna N° de factura a las labores realizadas (en lote)</div>
                    </div>
                  </button>
                )}
                <button
                  className={`more-sheet__item ${supervisorTab === 'planilla' ? 'more-sheet__item--active' : ''}`}
                  onClick={() => { setSupervisorTab('planilla'); setMoreMenuOpen(false) }}
                >
                  <span className="more-sheet__icon">▦</span>
                  <div>
                    <div className="more-sheet__label">Planilla</div>
                    <div className="more-sheet__desc">Ha por operario y día de la quincena</div>
                  </div>
                </button>
                {/* Catálogos: submenú que agrupa Maestros, Labores, Empresas y Terceros */}
                <button
                  className={`more-sheet__item ${['maestros', 'catalogo', 'ingenios', 'empresas', 'terceros', 'zonas', 'motivacion', 'mapascat'].includes(supervisorTab) ? 'more-sheet__item--active' : ''}`}
                  onClick={() => setCatalogosOpen((v) => !v)}
                  aria-expanded={catalogosOpen}
                >
                  <span className="more-sheet__icon">▤</span>
                  <div>
                    <div className="more-sheet__label">Catálogos {catalogosOpen ? '▾' : '▸'}</div>
                    <div className="more-sheet__desc">Maestros, Labores, Empresas y Terceros</div>
                  </div>
                </button>
                {catalogosOpen && (
                  <div style={{ borderLeft: '2px solid var(--color-border)', marginLeft: 18 }}>
                    <button
                      className={`more-sheet__item ${supervisorTab === 'maestros' ? 'more-sheet__item--active' : ''}`}
                      onClick={() => { setSupervisorTab('maestros'); setMoreMenuOpen(false) }}
                    >
                      <span className="more-sheet__icon">▤</span>
                      <div>
                        <div className="more-sheet__label">Maestros</div>
                        <div className="more-sheet__desc">Suertes — área neta y tercero</div>
                      </div>
                    </button>
                    <button
                      className={`more-sheet__item ${supervisorTab === 'catalogo' ? 'more-sheet__item--active' : ''}`}
                      onClick={() => { setSupervisorTab('catalogo'); setMoreMenuOpen(false) }}
                    >
                      <span className="more-sheet__icon">🏷</span>
                      <div>
                        <div className="more-sheet__label">Labores</div>
                        <div className="more-sheet__desc">Catálogo de labores — activar / desactivar</div>
                      </div>
                    </button>
                    <button
                      className={`more-sheet__item ${supervisorTab === 'ingenios' ? 'more-sheet__item--active' : ''}`}
                      onClick={() => { setSupervisorTab('ingenios'); setMoreMenuOpen(false) }}
                    >
                      <span className="more-sheet__icon">🏭</span>
                      <div>
                        <div className="more-sheet__label">Ingenios</div>
                        <div className="more-sheet__desc">Compradores — crear / activar / desactivar</div>
                      </div>
                    </button>
                    <button
                      className={`more-sheet__item ${supervisorTab === 'empresas' ? 'more-sheet__item--active' : ''}`}
                      onClick={() => { setSupervisorTab('empresas'); setMoreMenuOpen(false) }}
                    >
                      <span className="more-sheet__icon">🏢</span>
                      <div>
                        <div className="more-sheet__label">Empresas</div>
                        <div className="more-sheet__desc">Compañías operadas (ej. Agroservicios Morales)</div>
                      </div>
                    </button>
                    <button
                      className={`more-sheet__item ${supervisorTab === 'terceros' ? 'more-sheet__item--active' : ''}`}
                      onClick={() => { setSupervisorTab('terceros'); setMoreMenuOpen(false) }}
                    >
                      <span className="more-sheet__icon">🤝</span>
                      <div>
                        <div className="more-sheet__label">Terceros</div>
                        <div className="more-sheet__desc">Clientes a los que se presta la labor</div>
                      </div>
                    </button>
                    <button
                      className={`more-sheet__item ${supervisorTab === 'zonas' ? 'more-sheet__item--active' : ''}`}
                      onClick={() => { setSupervisorTab('zonas'); setMoreMenuOpen(false) }}
                    >
                      <span className="more-sheet__icon">🗺️</span>
                      <div>
                        <div className="more-sheet__label">Zonas</div>
                        <div className="more-sheet__desc">Zonas de trabajo (se asignan a supervisores)</div>
                      </div>
                    </button>
                    <button
                      className={`more-sheet__item ${supervisorTab === 'motivacion' ? 'more-sheet__item--active' : ''}`}
                      onClick={() => { setSupervisorTab('motivacion'); setMoreMenuOpen(false) }}
                    >
                      <span className="more-sheet__icon">🏆</span>
                      <div>
                        <div className="more-sheet__label">Motivación</div>
                        <div className="more-sheet__desc">Mensaje/GIF de felicitación por rendimiento</div>
                      </div>
                    </button>
                    {/* Gestión de mapas: SOLO administración y jefe (propietario).
                        Los demás roles solo VEN el visor (Más → Mapa). */}
                    {(session.role === 'owner' || session.role === 'administracion') && (
                      <button
                        className={`more-sheet__item ${supervisorTab === 'mapascat' ? 'more-sheet__item--active' : ''}`}
                        onClick={() => { setSupervisorTab('mapascat'); setMoreMenuOpen(false) }}
                      >
                        <span className="more-sheet__icon">🗺️</span>
                        <div>
                          <div className="more-sheet__label">Mapas</div>
                          <div className="more-sheet__desc">Agregar / reemplazar cartografía del visor</div>
                        </div>
                      </button>
                    )}
                  </div>
                )}
                <button
                  className={`more-sheet__item ${supervisorTab === 'insumos' ? 'more-sheet__item--active' : ''}`}
                  onClick={() => { setSupervisorTab('insumos'); setMoreMenuOpen(false) }}
                >
                  <span className="more-sheet__icon">🛢️</span>
                  <div>
                    <div className="more-sheet__label">Insumos</div>
                    <div className="more-sheet__desc">Inventario de insumos y combustible (kardex)</div>
                  </div>
                </button>
                {(session.role === 'administracion' || session.role === 'owner') && (
                  <button
                    className={`more-sheet__item ${supervisorTab === 'bodegas' ? 'more-sheet__item--active' : ''}`}
                    onClick={() => { setSupervisorTab('bodegas'); setMoreMenuOpen(false) }}
                  >
                    <span className="more-sheet__icon">🏢</span>
                    <div>
                      <div className="more-sheet__label">Bodegas</div>
                      <div className="more-sheet__desc">Principal y satélites · surtir los carros</div>
                    </div>
                  </button>
                )}
                <button
                  className={`more-sheet__item ${supervisorTab === 'mapa' ? 'more-sheet__item--active' : ''}`}
                  onClick={() => { setSupervisorTab('mapa'); setMoreMenuOpen(false) }}
                >
                  <span className="more-sheet__icon">🗺️</span>
                  <div>
                    <div className="more-sheet__label">Mapa</div>
                    <div className="more-sheet__desc">Plano de las haciendas · funciona sin señal</div>
                  </div>
                </button>
                {(session.role === 'administracion' || session.role === 'owner') && (
                  <button
                    className={`more-sheet__item ${supervisorTab === 'flota' ? 'more-sheet__item--active' : ''}`}
                    onClick={() => { setSupervisorTab('flota'); setMoreMenuOpen(false) }}
                  >
                    <span className="more-sheet__icon">🚙</span>
                    <div>
                      <div className="more-sheet__label">Flota / Escolta</div>
                      <div className="more-sheet__desc">Servicios de camionetas (CDA-F-68) · firma y evidencia · Excel</div>
                    </div>
                  </button>
                )}
                {(session.role === 'administracion' || session.role === 'owner') && (
                  <button
                    className={`more-sheet__item ${supervisorTab === 'usuarios' ? 'more-sheet__item--active' : ''}`}
                    onClick={() => { setSupervisorTab('usuarios'); setMoreMenuOpen(false) }}
                  >
                    <span className="more-sheet__icon">👤</span>
                    <div>
                      <div className="more-sheet__label">Usuarios</div>
                      <div className="more-sheet__desc">Crear, editar y eliminar usuarios</div>
                    </div>
                  </button>
                )}
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

      {/* Personalizar la barra inferior: el dueño elige sus accesos. */}
      {navConfigOpen && (
        <div className="modal-overlay open" onClick={() => setNavConfigOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 'min(440px, calc(100vw - 32px))' }}>
            <div className="labor-detail-header">
              <div><p className="eyebrow">Barra inferior</p><h3>⚙ Personalizar barra</h3></div>
              <button type="button" className="modal-close-btn" onClick={() => setNavConfigOpen(false)} aria-label="Cerrar">&#x2715;</button>
            </div>
            <p className="subtle-copy" style={{ marginTop: 0 }}>
              Elige hasta <strong>{MAX_NAV}</strong> accesos para tenerlos abajo siempre.
              Lo que no elijas queda dentro de <strong>Más</strong>. ({navDraft.length}/{MAX_NAV})
            </p>
            <div className="nav-cfg">
              {NAV_OPCIONES.map((op) => {
                const marcado = navDraft.includes(op.id)
                const lleno = navDraft.length >= MAX_NAV && !marcado
                return (
                  <label key={op.id} className={`nav-cfg__row${marcado ? ' is-on' : ''}${lleno ? ' is-off' : ''}`}>
                    <input
                      type="checkbox"
                      checked={marcado}
                      disabled={lleno}
                      onChange={() => setNavDraft((prev) => marcado ? prev.filter((x) => x !== op.id) : [...prev, op.id])}
                    />
                    <span className="nav-cfg__ico" aria-hidden>{op.icon}</span>
                    <span className="nav-cfg__txt">
                      <strong>{op.label}</strong>
                      <small>{op.desc}</small>
                    </span>
                  </label>
                )
              })}
            </div>
            <div className="modal-footer" style={{ flexWrap: 'wrap', gap: 8 }}>
              <button
                type="button"
                className="inline-button"
                onClick={() => { restaurarNav(session.id); setNavBarra([...NAV_DEFECTO]); setNavConfigOpen(false); setInfo('Barra restaurada.') }}
              >
                Restaurar
              </button>
              <button type="button" className="inline-button" onClick={() => setNavConfigOpen(false)}>Cancelar</button>
              <button
                type="button"
                className="primary-button"
                disabled={navDraft.length === 0}
                onClick={() => { guardarNav(session.id, navDraft); setNavBarra([...navDraft]); setNavConfigOpen(false); setInfo('Barra actualizada.') }}
              >
                Guardar
              </button>
            </div>
          </div>
        </div>
      )}

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

      <RegistrarLaborModal
        open={isRegistrarLaborOpen}
        onClose={() => setIsRegistrarLaborOpen(false)}
      />

      {auditFor && (
        <div className="modal-overlay open" onClick={() => setAuditFor(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 'min(560px, calc(100vw - 32px))' }}>
            <div className="labor-detail-header">
              <div><p className="eyebrow">Auditoría</p><h3>Historial de cambios</h3></div>
              <button type="button" className="modal-close-btn" onClick={() => setAuditFor(null)} aria-label="Cerrar">&#x2715;</button>
            </div>
            <p className="subtle-copy" style={{ marginTop: 0 }}>
              {auditFor.haciendaName} · Suerte {auditFor.suerte} · {auditFor.labor}
            </p>
            <div className="list-rows" style={{ maxHeight: '55vh', overflowY: 'auto' }}>
              {auditLoading ? (
                <p className="muted-text">Cargando…</p>
              ) : auditRows.length === 0 ? (
                <p className="muted-text">Sin cambios registrados (o la migración de auditoría aún no está aplicada).</p>
              ) : (
                auditRows.map((r) => (
                  <div key={r.id} className="movement-row">
                    <div>
                      <strong>{r.accion === 'INSERT' ? 'Creación' : 'Edición'}</strong>
                      <span>{renderCambios(r.cambios)}</span>
                    </div>
                    <div className="movement-side">
                      <span className="status-pill">{nombreUsuario(r.editadoPor)}</span>
                      <small>{fmtEditFecha(r.editadoEn)}</small>
                    </div>
                  </div>
                ))
              )}
            </div>
            <div className="modal-footer">
              <button type="button" className="primary-button" onClick={() => setAuditFor(null)}>Cerrar</button>
            </div>
          </div>
        </div>
      )}

      <NewSuerteModal
        open={isNewSuerteOpen}
        onClose={() => setIsNewSuerteOpen(false)}
        createdBy={session.id}
        haciendas={Array.from(
          // Lista de haciendas conocidas para auto-completar codigo y nombre.
          // Se construye desde el maestro filtrado al ingenio actual para
          // sugerir solo haciendas del mismo ingenio (consistencia visual).
          new Map(
            maestro
              .filter((row) => !assignmentForm.ingenioId || row.ingenio_id === assignmentForm.ingenioId)
              .map((row) => [row.haciendaCode, { code: row.haciendaCode, name: row.haciendaName }]),
          ).values(),
        )}
        ingenios={ingeniosOpts}
        maestro={maestro}
        prefillHaciendaCode={assignmentForm.haciendaCode}
        prefillIngenioId={assignmentForm.ingenioId}
        onCreated={(row) => {
          // 1. Sumar la nueva fila al estado global del maestro: aparece
          //    de inmediato en el dropdown y la lista de haciendas.
          setMaestro((prev) => [...prev, row])
          // 2. Auto-seleccionar para minimizar el tecleo del supervisor:
          //    setea hacienda + ingenio + agrega la suerte al checklist.
          updateAssignmentForm('haciendaCode', row.haciendaCode)
          updateAssignmentForm('ingenioId', row.ingenio_id)
          if (!assignmentSuertesList.includes(row.suerte)) {
            toggleAssignmentSuerte(row.suerte)
          }
          setInfo(`Suerte ${row.suerte} creada en ${row.haciendaName}.`)
        }}
      />

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
            {/* En el dueño, Labores también sale de SU configuración. */}
            {session.role !== 'owner' && (
              <button
                className={supervisorTab === 'labores' ? 'active' : ''}
                onClick={() => setSupervisorTab('labores')}
              >
                <span className="nav-item">
                  <span className="nav-icon">✓</span>
                  <span className="nav-label">Labores</span>
                </span>
              </button>
            )}

            {/* El dueño la tiene dentro de "Más" (su barra queda con lo del día
                a día: Labores, Realizadas, Máquinas e Insumos). */}
            {session.role !== 'owner' && (
              <button
                className={`nav-aprobaciones${supervisorTab === 'aprobaciones' ? ' active' : ''}${pendingApprovals.length > 0 ? ' has-pending' : ''}`}
                onClick={() => setSupervisorTab('aprobaciones')}
              >
                <span className="nav-item">
                  <span className="nav-icon">✔</span>
                  <span className="nav-label">A facturar</span>
                  {pendingApprovals.length > 0 && (
                    <span className="nav-badge">{pendingApprovals.length > 99 ? '99+' : pendingApprovals.length}</span>
                  )}
                </span>
              </button>
            )}

            {session.role === 'owner' ? (
              <>
                {/* Accesos que el propio dueño eligió (Más → Personalizar barra). */}
                {navBarra.map((id) => {
                  const op = NAV_OPCIONES.find((o) => o.id === id)
                  if (!op) return null
                  const esAprob = op.id === 'aprobaciones'
                  return (
                    <button
                      key={op.id}
                      className={`${supervisorTab === op.id ? 'active' : ''}${esAprob && pendingApprovals.length > 0 ? ' nav-aprobaciones has-pending' : ''}`}
                      onClick={() => setSupervisorTab(op.id as SupervisorTab)}
                    >
                      <span className="nav-item">
                        <span className="nav-icon">{op.icon}</span>
                        <span className="nav-label">{op.label}</span>
                        {esAprob && pendingApprovals.length > 0 && (
                          <span className="nav-badge">{pendingApprovals.length > 99 ? '99+' : pendingApprovals.length}</span>
                        )}
                      </span>
                    </button>
                  )
                })}
                <button
                  className={`${moreMenuOpen || supervisorTab === 'tablero' || supervisorTab === 'reporte' || supervisorTab === 'maestros' || supervisorTab === 'planilla' || supervisorTab === 'usuarios' || supervisorTab === 'catalogo' || supervisorTab === 'ingenios' || supervisorTab === 'empresas' || supervisorTab === 'terceros' || supervisorTab === 'zonas' || supervisorTab === 'insumos' || supervisorTab === 'facturacion' || supervisorTab === 'motivacion' || supervisorTab === 'aprobaciones' || supervisorTab === 'asignar' || supervisorTab === 'resumen' || supervisorTab === 'bodegas' || supervisorTab === 'flota' ? 'active' : ''}${pendingApprovals.length > 0 ? ' has-pending' : ''}`}
                  onClick={() => setMoreMenuOpen((v) => !v)}
                  aria-haspopup="true"
                  aria-expanded={moreMenuOpen}
                >
                  <span className="nav-item">
                    <span className="nav-icon">⋯</span>
                    <span className="nav-label">Más</span>
                    {/* Alerta de labores por facturar: la opción vive dentro de
                        "Más", así que el aviso sube al botón para no perderlo. */}
                    {pendingApprovals.length > 0 && (
                      <span className="nav-badge">{pendingApprovals.length > 99 ? '99+' : pendingApprovals.length}</span>
                    )}
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
                  className={moreMenuOpen || supervisorTab === 'equipos' || supervisorTab === 'tablero' || supervisorTab === 'maestros' || supervisorTab === 'realizadas' || supervisorTab === 'reporte' ? 'active' : ''}
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
                  className={moreMenuOpen || supervisorTab === 'tablero' || supervisorTab === 'reporte' || supervisorTab === 'planilla' || supervisorTab === 'realizadas' || supervisorTab === 'maestros' || supervisorTab === 'usuarios' || supervisorTab === 'catalogo' || supervisorTab === 'ingenios' || supervisorTab === 'empresas' || supervisorTab === 'terceros' || supervisorTab === 'zonas' || supervisorTab === 'insumos' || supervisorTab === 'facturacion' || supervisorTab === 'motivacion' ? 'active' : ''}
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
            )}
          </nav>

          {/* Franja de metricas "Hoy": solo en la pestana Labores (antes
              se mostraba en todas). En Resumen y Reporte hay sus propios
              KPIs, asi que aqui se omite para no duplicar. */}
          {supervisorTab === 'labores' && (
          <div className="day-status-bar day-status-bar--large">
            <div className="day-status-bar__heading">Hoy</div>
            <div className="day-status-bar__items">
              <div className="day-status-item">
                <strong>{scopedMetrics.plannedArea.toFixed(2)}</strong>
                <span>Ha planif.</span>
              </div>
              <div className="day-status-item day-status-item--green day-status-item--emph">
                <strong>{scopedMetrics.executedArea.toFixed(2)}</strong>
                <span>Ha ejecut.</span>
              </div>
              {(session.role === 'owner' || session.role === 'administracion') && (
                <div className="day-status-item day-status-item--emph day-status-item--billed">
                  <strong>{scopedMetrics.billedArea.toFixed(2)}</strong>
                  <span>Área facturada</span>
                </div>
              )}
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
          )}
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
          <section className="summary-search-bar">
            <div className="labores-search-row">
              <div className="labores-search-input-wrap">
                <svg className="labores-search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input
                  type="search"
                  className="labores-search-input"
                  placeholder="Buscar hacienda, suerte, labor u operario..."
                  value={laborSearch}
                  onChange={(event) => setLaborSearch(event.target.value)}
                />
                {laborSearch && (
                  <button
                    type="button"
                    className="labores-search-clear"
                    onClick={() => setLaborSearch('')}
                    aria-label="Limpiar busqueda"
                  >
                    &#x2715;
                  </button>
                )}
              </div>
              <button
                type="button"
                className={`filtros-toggle-btn${activeFilterCount > 0 ? ' filtros-toggle-btn--active' : ''}`}
                onClick={() => setFilterPanelOpen(true)}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
                </svg>
                Filtros
                {activeFilterCount > 0 && (
                  <span className="filtros-badge">{activeFilterCount}</span>
                )}
              </button>
            </div>

            {/* Drawer de filtros: componente compartido con Labores (mismo
                estado). No coexiste con el de Labores: son pestañas distintas. */}
            <LaborFilterDrawer
              open={filterPanelOpen}
              onClose={() => setFilterPanelOpen(false)}
              activeFilterCount={activeFilterCount}
              onClear={clearLaborFilters}
              statusFilter={statusFilter}
              setStatusFilter={setStatusFilter}
              statusOptions={summaryStatusOptions}
              operatorFilter={operatorFilter}
              setOperatorFilter={setOperatorFilter}
              ingenioFilter={ingenioFilter}
              setIngenioFilter={setIngenioFilter}
              ingenios={ingeniosOpts}
              haciendaFilter={haciendaFilter}
              setHaciendaFilter={setHaciendaFilter}
              haciendaFilterOptions={haciendaFilterOptions}
              resultCount={summaryBaseAssignments.length}
            />
          </section>
        ) : null}

        {supervisorTab === 'resumen' ? (
          <section className="kpi-grid">
            <article
              className="metric-panel metric-panel--clickable"
              onClick={() => setAreaDetail('PLANIFICADAS')}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setAreaDetail('PLANIFICADAS') }}
              title="Ver el detalle de las suertes que componen esta área"
            >
              <p>HA PLANIFICADAS</p>
              <strong>{summaryMetrics.plannedArea.toFixed(2)}</strong>
              <span>hectareas · ver detalle</span>
            </article>
            <article
              className="metric-panel metric-panel--clickable"
              onClick={() => setAreaDetail('EJECUTADAS')}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setAreaDetail('EJECUTADAS') }}
              title="Ver el detalle de las labores que componen esta área"
            >
              <p>HA EJECUTADAS</p>
              <strong>{summaryMetrics.executedArea.toFixed(2)}</strong>
              <span>hectareas · ver detalle</span>
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

        <AreaDetailModal
          open={areaDetail === 'PLANIFICADAS'}
          onClose={() => setAreaDetail(null)}
          title="Hectáreas planificadas"
          areaLabel="planificadas"
          rows={plannedDetailRows}
        />
        <AreaDetailModal
          open={areaDetail === 'EJECUTADAS'}
          onClose={() => setAreaDetail(null)}
          title="Hectáreas ejecutadas"
          areaLabel="ejecutadas"
          rows={executedDetailRows}
          showStatus
        />

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
          key={
            selectedEntity
              ? `${selectedEntity.type}:${
                  selectedEntity.type === 'operator'
                    ? selectedEntity.id || selectedEntity.name
                    : selectedEntity.code || selectedEntity.name
                }`
              : 'none'
          }
          entity={selectedEntity}
          assignments={summaryBaseAssignments}
          defaultMonth={summaryMonth}
          defaultQuincena={summaryQuincena}
          todayKey={todayKey}
          onClose={() => setSelectedEntity(null)}
          canEdit={canEditAssignments}
          equipment={sortedEquipment}
          maestro={maestro}
          onSaveAssignment={handleEditAssignment}
          busy={busy}
        />

        {supervisorTab === 'asignar' ? (
          <section className="assign-tab-stack">
            <div className="assign-cta-row">
              <button
                type="button"
                className="primary-button assign-cta"
                onClick={() => setIsCreateAssignmentOpen(true)}
              >
                + Crear asignación
              </button>
              {/* Crear suertes toca el MAESTRO: solo administración/dueño. */}
              {(session.role === 'administracion' || session.role === 'owner') && (
                <button
                  type="button"
                  className="primary-button outline assign-cta-secondary"
                  onClick={() => setIsNewSuerteOpen(true)}
                  title="Crear una suerte que aun no este en el maestro del ingenio"
                >
                  + Nueva suerte
                </button>
              )}
              <button
                type="button"
                className="primary-button outline assign-cta-secondary"
                onClick={() => setIsRegistrarLaborOpen(true)}
                title="Anotar una labor YA realizada por un operario (registro rápido)"
              >
                ✓ Registrar labor realizada
              </button>
            </div>

            <article className="panel-card">
              <div className="panel-title">
                <h2>Ultimos movimientos</h2>
              </div>
              <input
                className="user-search-input"
                type="search"
                placeholder="Buscar por hacienda, suerte, labor, operario o equipo…"
                value={movSearch}
                onChange={(e) => setMovSearch(e.target.value)}
                style={{ marginBottom: 10 }}
              />
              <ul className="movement-list">
                {visibleRecent.map((assignment) => {
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
                {visibleRecent.length === 0 && (
                  <li className="movement-empty">
                    {movSearch.trim() ? 'Sin coincidencias para la búsqueda.' : 'Sin movimientos recientes.'}
                  </li>
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
                  {ingeniosOpts.map((ing) => (
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
                    {activeLabores.map((labor) => (
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
                        {activeLabores.map((labor) => {
                          const assignment = rowAssignments.find(
                            (item) => item.labor.toUpperCase() === labor.toUpperCase(),
                          )
                          const status = assignment?.status ?? 'PENDIENTE'
                          const isPartial =
                            status === 'PARCIAL' ||
                            (status === 'COMPLETADA' &&
                              !!assignment &&
                              assignment.executedArea > 0 &&
                              assignment.executedArea < assignment.area)
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
                                {(status === 'COMPLETADA' || status === 'PARCIAL') && assignment && (
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

        {(session.role === 'owner' || session.role === 'administracion' || session.role === 'supervisor') && supervisorTab === 'maestros' ? (
          <MaestrosTab />
        ) : null}

        {(session.role === 'owner' || session.role === 'administracion') && supervisorTab === 'facturacion' ? (
          <FacturacionTab />
        ) : null}

        {(session.role === 'owner' || session.role === 'administracion') && supervisorTab === 'planilla' ? (
          <PlanillaTab onEditLabor={setSelectedLabor} />
        ) : null}

        {(session.role === 'owner' || session.role === 'administracion' || session.role === 'supervisor') && supervisorTab === 'realizadas' ? (
          <RealizadasTab />
        ) : null}

        {(session.role === 'owner' || session.role === 'administracion') && supervisorTab === 'catalogo' ? (
          <LaboresTab />
        ) : null}

        {(session.role === 'owner' || session.role === 'administracion') && supervisorTab === 'ingenios' ? (
          <IngeniosTab />
        ) : null}

        {(session.role === 'owner' || session.role === 'administracion') && supervisorTab === 'motivacion' ? (
          <MotivacionTab />
        ) : null}

        {supervisorTab === 'mapa' ? <MapaView onBack={() => setSupervisorTab('labores')} /> : null}

        {(session.role === 'owner' || session.role === 'administracion') && supervisorTab === 'mapascat' ? (
          <MapasTab />
        ) : null}

        {supervisorTab === 'flota' ? <FlotaTab /> : null}

        {(session.role === 'owner' || session.role === 'administracion') && supervisorTab === 'insumosresumen' ? (
          <InsumosResumenTab />
        ) : null}

        {(session.role === 'owner' || session.role === 'administracion') && supervisorTab === 'bodegas' ? (
          <BodegasTab />
        ) : null}

        {(session.role === 'owner' || session.role === 'administracion') && supervisorTab === 'empresas' ? (
          <EmpresasTab />
        ) : null}

        {(session.role === 'owner' || session.role === 'administracion') && supervisorTab === 'terceros' ? (
          <TercerosTab />
        ) : null}

        {(session.role === 'owner' || session.role === 'administracion') && supervisorTab === 'zonas' ? (
          <ZonasTab />
        ) : null}

        {(session.role === 'owner' || session.role === 'administracion') && supervisorTab === 'insumos' ? (
          <InsumosModule />
        ) : null}

        {(session.role === 'administracion' || session.role === 'owner' || session.role === 'supervisor') && supervisorTab === 'reporte' ? (
          <section className="panel-card">
            <div className="panel-title">
              <h2>Reporte de Labores</h2>
            </div>

            <div className="report-filters">
              <div className="report-filter-row">
                <label className="report-filter-label">
                  Período
                  <select
                    value={reportFilters.period}
                    onChange={(e) => setReportFilters((f) => ({ ...f, period: e.target.value as 'CUSTOM' | 'HOY' | 'AYER' | 'PRIMERA' | 'SEGUNDA' | 'MES' }))}
                  >
                    <option value="HOY">Hoy</option>
                    <option value="AYER">Ayer</option>
                    <option value="PRIMERA">1ra quincena (1-15)</option>
                    <option value="SEGUNDA">2da quincena (16-fin)</option>
                    <option value="MES">Mes completo</option>
                    <option value="CUSTOM">Personalizado</option>
                  </select>
                </label>
                {(reportFilters.period === 'PRIMERA' || reportFilters.period === 'SEGUNDA' || reportFilters.period === 'MES') && (
                  <label className="report-filter-label">
                    Mes
                    <select
                      value={reportFilters.mes}
                      onChange={(e) => setReportFilters((f) => ({ ...f, mes: e.target.value }))}
                    >
                      {summaryMonthOptions.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </label>
                )}
                <label className="report-filter-label">
                  Vista
                  <select
                    value={reportFilters.view}
                    onChange={(e) => setReportFilters((f) => ({ ...f, view: e.target.value as 'labor' | 'maquina' }))}
                  >
                    <option value="labor">Por labor</option>
                    <option value="maquina">Por máquina</option>
                  </select>
                </label>
                {reportFilters.period === 'CUSTOM' && (
                  <>
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
                  </>
                )}
              </div>
              <div className="report-filter-row">
                <SearchableSelect
                  value={reportFilters.estado}
                  onChange={(v) => setReportFilters((f) => ({ ...f, estado: v }))}
                  placeholder="Todos los estados"
                  options={[
                    { value: 'CERRADAS', label: 'Cerradas (Parcial + Completada)' },
                    { value: 'COMPLETADA', label: 'Completada' },
                    { value: 'PARCIAL', label: 'Parcial' },
                    { value: 'PENDIENTE', label: 'Pendiente' },
                    { value: 'EN_PROCESO', label: 'En proceso' },
                    { value: 'CANCELADA', label: 'Cancelada' },
                  ]}
                />
                <SearchableSelect
                  value={reportFilters.ingenioId}
                  onChange={(v) => setReportFilters((f) => ({ ...f, ingenioId: v }))}
                  placeholder="Todos los ingenios"
                  options={ingeniosOpts.map((ing) => ({ value: ing.id, label: ing.nombre }))}
                />
                <SearchableSelect
                  value={reportFilters.haciendaCode}
                  onChange={(v) => setReportFilters((f) => ({ ...f, haciendaCode: v, suerte: '' }))}
                  placeholder="Todas las haciendas"
                  options={haciendaFilterOptions.map((h) => ({ value: h.code, label: h.name }))}
                />
                <SearchableSelect
                  value={reportFilters.suerte}
                  onChange={(v) => setReportFilters((f) => ({ ...f, suerte: v }))}
                  placeholder="Todas las suertes"
                  options={reportSuerteOptions.map((s) => ({ value: s, label: s }))}
                />
                <SearchableSelect
                  value={reportFilters.operatorId}
                  onChange={(v) => setReportFilters((f) => ({ ...f, operatorId: v }))}
                  placeholder="Todos los operadores"
                  options={operators.map((op) => ({ value: op.id, label: op.name, rightLabel: op.id }))}
                />
              </div>
            </div>

            {(() => {
              // KPIs del reporte segmentados por los filtros activos (período +
              // estado + ingenio + hacienda + operador). Misma fórmula que la
              // franja "Hoy" del toolbar: excluye CANCELADA del planificado,
              // toma executedArea (con fallback a area) para los COMPLETADA.
              const activos = filteredReport.filter((a) => a.status !== 'CANCELADA')
              const planif = activos.reduce((s, a) => s + a.area, 0)
              const ejec = activos
                .filter((a) => a.status === 'COMPLETADA' || a.status === 'PARCIAL')
                .reduce((s, a) => s + (a.executedArea > 0 ? a.executedArea : a.area), 0)
              const cumpl = planif ? Math.round((ejec / planif) * 100) : 0
              const enProc = activos.filter((a) => a.status === 'EN_PROCESO').length
              const facturada = activos
                .filter((a) => (a.status === 'COMPLETADA' || a.status === 'PARCIAL') && !!(a.facturaNumero && a.facturaNumero.trim()))
                .reduce((s, a) => s + (a.executedArea > 0 ? a.executedArea : a.area), 0)
              const mesLabel = summaryMonthOptions.find((o) => o.value === reportFilters.mes)?.label ?? reportFilters.mes
              const periodLabel =
                reportFilters.period === 'HOY' ? 'Hoy' :
                reportFilters.period === 'AYER' ? 'Ayer' :
                reportFilters.period === 'PRIMERA' ? `1ra quincena · ${mesLabel}` :
                reportFilters.period === 'SEGUNDA' ? `2da quincena · ${mesLabel}` :
                reportFilters.period === 'MES' ? mesLabel :
                'Personalizado'
              return (
                <div className="day-status-bar day-status-bar--large">
                  <div className="day-status-bar__heading">{periodLabel} · {filteredReport.length} registros</div>
                  <div className="day-status-bar__items">
                    <div className="day-status-item">
                      <strong>{planif.toFixed(2)}</strong>
                      <span>Ha planif.</span>
                    </div>
                    <div className="day-status-item day-status-item--green day-status-item--emph">
                      <strong>{ejec.toFixed(2)}</strong>
                      <span>Ha ejecut.</span>
                    </div>
                    {(session.role === 'owner' || session.role === 'administracion') && (
                      <div className="day-status-item day-status-item--emph day-status-item--billed">
                        <strong>{facturada.toFixed(2)}</strong>
                        <span>Área facturada</span>
                      </div>
                    )}
                    <div className={`day-status-item ${cumpl >= 70 ? 'day-status-item--green' : cumpl >= 30 ? 'day-status-item--amber' : 'day-status-item--red'}`}>
                      <strong>{cumpl}%</strong>
                      <span>Cumplimiento</span>
                    </div>
                    <div className={`day-status-item ${enProc > 0 ? 'day-status-item--amber' : ''}`}>
                      <strong>{enProc}</strong>
                      <span>En proceso</span>
                    </div>
                  </div>
                </div>
              )
            })()}

            {reportFilters.view === 'labor' ? (
              <div className="report-table-wrap">
                <table className="report-table">
                  <thead>
                    <tr>
                      <th>Fecha ejec.</th>
                      <th>Hacienda</th>
                      <th>Suerte</th>
                      <th>Labor</th>
                      <th>Ha plan.</th>
                      <th>Ha ejec.</th>
                      <th>Cliente</th>
                      <th>Ingenio</th>
                      <th>Estado</th>
                      <th>Operador</th>
                      {canEditAssignments && <th>Acciones</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredReport.slice(0, 30).map((a) => {
                      const meta = getStatusMeta(a)
                      const clienteLabel =
                        a.cliente === 'ingenios' ? 'Ingenio' :
                        a.cliente === 'proveedores' ? 'Proveedor' : '—'
                      const ingenioLabel = getIngenioName(a, maestro) ?? '—'
                      return (
                        <tr key={a.id}>
                          <td>{executionDateKey(a)}</td>
                          <td>{a.haciendaName}</td>
                          <td>{a.suerte}</td>
                          <td>{a.labor}</td>
                          <td className="num-cell">{formatArea(a.area)}</td>
                          <td className="num-cell">
                            {a.status === 'COMPLETADA' || a.status === 'PARCIAL'
                              ? formatArea(a.executedArea > 0 ? a.executedArea : a.area)
                              : '—'}
                          </td>
                          <td>{clienteLabel}</td>
                          <td>{ingenioLabel}</td>
                          <td><span className={`status-chip ${meta.tone}`}>{meta.label}</span></td>
                          <td>{a.operatorName}</td>
                          {canEditAssignments && (
                            <td>
                              <div className="report-row-actions">
                                <button
                                  type="button"
                                  className="inline-button"
                                  onClick={() => setSelectedLabor(a)}
                                  title="Editar área, operario u otros datos"
                                >
                                  Editar
                                </button>
                                <button
                                  type="button"
                                  className="inline-button maestro-delete-btn"
                                  onClick={() => { setDeleteReportTarget(a); setError('') }}
                                  title="Eliminar esta línea (permanente)"
                                >
                                  Eliminar
                                </button>
                              </div>
                            </td>
                          )}
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
            ) : (
              // Vista "Por máquina": agrupa filteredReport por equipo y muestra
              // un bloque por máquina con horómetros y horas trabajadas.
              (() => {
                type MachineGroup = {
                  code: string
                  name: string
                  labors: Assignment[]
                  totalHoras: number
                  totalAreaPlan: number
                  totalAreaEjec: number
                }
                const groups = new Map<string, MachineGroup>()
                for (const a of filteredReport) {
                  const code = a.equipmentCode || '(sin equipo)'
                  const name = a.equipmentName || code
                  let g = groups.get(code)
                  if (!g) {
                    g = { code, name, labors: [], totalHoras: 0, totalAreaPlan: 0, totalAreaEjec: 0 }
                    groups.set(code, g)
                  }
                  g.labors.push(a)
                  if (a.status !== 'CANCELADA') {
                    g.totalAreaPlan += a.area
                    if (a.status === 'COMPLETADA' || a.status === 'PARCIAL') {
                      g.totalAreaEjec += a.executedArea > 0 ? a.executedArea : a.area
                    }
                  }
                  if (a.horometroInicial != null && a.horometroFinal != null && a.horometroFinal > a.horometroInicial) {
                    g.totalHoras += a.horometroFinal - a.horometroInicial
                  }
                }
                const list = Array.from(groups.values()).sort((x, y) => x.name.localeCompare(y.name))
                if (list.length === 0) {
                  return <p className="report-empty">Sin registros para los filtros seleccionados.</p>
                }
                return (
                  <div className="report-by-machine">
                    {list.map((g) => (
                      <section key={g.code} className="machine-group" style={{ marginBottom: 18, border: '1px solid #d9dbd0', borderRadius: 8, overflow: 'hidden' }}>
                        <header style={{ background: '#1a6b3a', color: '#fff', padding: '10px 14px', display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between', alignItems: 'baseline' }}>
                          <strong style={{ fontSize: 15 }}>{g.name}</strong>
                          <span style={{ fontSize: 13, opacity: 0.95 }}>
                            {g.totalHoras.toFixed(1)} h trabajadas · {g.totalAreaPlan.toFixed(2)} ha plan. · {g.totalAreaEjec.toFixed(2)} ha ejec. · {g.labors.length} labor{g.labors.length !== 1 ? 'es' : ''}
                          </span>
                        </header>
                        <div className="report-table-wrap" style={{ background: '#fff' }}>
                          <table className="report-table">
                            <thead>
                              <tr>
                                <th>Fecha ejec.</th>
                                <th>Hacienda</th>
                                <th>Suerte</th>
                                <th>Labor</th>
                                <th>Hor. Ini</th>
                                <th>Hor. Fin</th>
                                <th>Horas</th>
                                <th>Área</th>
                                <th>Cliente</th>
                                <th>Ingenio</th>
                                <th>Estado</th>
                                <th>Operador</th>
                              </tr>
                            </thead>
                            <tbody>
                              {g.labors.map((a) => {
                                const meta = getStatusMeta(a)
                                const clienteLabel =
                                  a.cliente === 'ingenios' ? 'Ingenio' :
                                  a.cliente === 'proveedores' ? 'Proveedor' : '—'
                                const ingenioLabel = getIngenioName(a, maestro) ?? '—'
                                const hi = a.horometroInicial
                                const hf = a.horometroFinal
                                const hrsRaw = (hi != null && hf != null && hf > hi) ? (hf - hi) : null
                                const hrs = hrsRaw != null ? hrsRaw.toFixed(1) : '—'
                                return (
                                  <tr key={a.id}>
                                    <td>{executionDateKey(a)}</td>
                                    <td>{a.haciendaName}</td>
                                    <td>{a.suerte}</td>
                                    <td>{a.labor}</td>
                                    <td className="num-cell">{hi != null ? hi.toFixed(1) : '—'}</td>
                                    <td className="num-cell">{hf != null ? hf.toFixed(1) : '—'}</td>
                                    <td className="num-cell">{hrs}</td>
                                    <td className="num-cell">
                                      {a.status === 'COMPLETADA' || a.status === 'PARCIAL'
                                        ? formatArea(a.executedArea > 0 ? a.executedArea : a.area)
                                        : formatArea(a.area)}
                                    </td>
                                    <td>{clienteLabel}</td>
                                    <td>{ingenioLabel}</td>
                                    <td><span className={`status-chip ${meta.tone}`}>{meta.label}</span></td>
                                    <td>{a.operatorName}</td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                      </section>
                    ))}
                  </div>
                )
              })()
            )}

            <button
              className="btn-primary report-download-btn"
              onClick={handleDownloadReport}
              disabled={busy || filteredReport.length === 0}
            >
              {busy ? 'Generando...' : `Descargar Excel (${filteredReport.length} registros)`}
            </button>
          </section>
        ) : null}

        {(session.role === 'owner' || session.role === 'administracion') && supervisorTab === 'usuarios' ? (
          <section className="panel-card">
            <div className="panel-title users-panel-title">
              <h2>Usuarios</h2>
              <button
                type="button"
                className="primary-button users-new-btn"
                onClick={() => {
                  setEditingUserId(null)
                  setUserForm({ id: nextUserId, nombreCompleto: '', rol: '', pin: '', equipoCodigo: '', zona: '' })
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
                  // Activos primero; entre activos, ocupados primero.
                  const aAct = a.active !== false ? 0 : 1
                  const bAct = b.active !== false ? 0 : 1
                  if (aAct !== bAct) return aAct - bAct
                  const aOcupado = operatorStatusMap.get(a.id) === 'ocupado' ? 0 : 1
                  const bOcupado = operatorStatusMap.get(b.id) === 'ocupado' ? 0 : 1
                  return aOcupado - bOcupado
                })
                .map((u) => {
                  const isActive = u.active !== false
                  const status = operatorStatusMap.get(u.id) ?? 'disponible'
                  const rolLabels: Record<string, string> = { operador: 'Operador', supervisor: 'Supervisor', administracion: 'Admin', owner: 'Propietario', soporte: 'Soporte' }
                  const openEdit = () => {
                    setEditingUserId(u.id)
                    setUserForm({ id: u.id, nombreCompleto: u.name, rol: u.role, pin: '', equipoCodigo: u.equipmentCode, zona: u.zona ?? '' })
                    setIsUserFormOpen(true)
                  }
                  return (
                    <li key={u.id} className="user-card" onClick={openEdit} style={{ cursor: 'pointer', opacity: isActive ? 1 : 0.55 }}>
                      <span className="user-card__name">{u.name}</span>
                      <span className="user-card__role">{rolLabels[u.role] ?? u.role}</span>
                      {!isActive ? (
                        <span className="user-status-badge" style={{ background: 'var(--color-bg-soft)', color: 'var(--color-ink-mid)' }}>Inactivo</span>
                      ) : (u.role === 'operador' || u.role === 'supervisor') ? (
                        <span className={`user-status-badge user-status-badge--${status}`}>
                          {status === 'ocupado' ? 'Ocupado' : 'Libre'}
                        </span>
                      ) : null}
                      {u.equipmentCode && (
                        <div className="user-card__meta">Equipo: {u.equipmentCode}</div>
                      )}
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <button
                          className="user-card__edit-btn"
                          onClick={(e) => { e.stopPropagation(); openEdit() }}
                        >
                          Editar
                        </button>
                        <button
                          className="user-card__edit-btn"
                          disabled={busy || u.id === session.id}
                          title={u.id === session.id ? 'No puedes desactivar tu propio usuario' : undefined}
                          onClick={(e) => { e.stopPropagation(); void toggleUserActivo(u) }}
                        >
                          {isActive ? 'Desactivar' : 'Activar'}
                        </button>
                      </div>
                    </li>
                  )
                })}
            </ul>
          </section>
        ) : null}

        {(session.role === 'owner' || session.role === 'administracion') && isUserFormOpen && (() => {
          const closeUserModal = () => {
            setIsUserFormOpen(false)
            setEditingUserId(null)
            setUserForm({ id: nextUserId, nombreCompleto: '', rol: '', pin: '', equipoCodigo: '', zona: '' })
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
                    // Anti-duplicados: no permitir dos usuarios (activos) con el mismo
                    // nombre. Evita el caso de "JULIO CESAR NIÑO" repetido con ids
                    // distintos, que descuadraba el Resumen (filtra por id de sesión).
                    {
                      const nombreNorm = userForm.nombreCompleto.trim().toLowerCase()
                      const dup = users.find(
                        (u) => u.id !== userForm.id && u.active !== false && u.name.trim().toLowerCase() === nombreNorm,
                      )
                      if (dup) {
                        setError(`Ya existe un usuario llamado "${userForm.nombreCompleto.trim()}" (${dup.id}). No se permiten nombres duplicados.`)
                        return
                      }
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
                      // Refresca la lista para reflejar el alta/cambio al instante.
                      const refreshed = await loadAppUsers()
                      setUsers(refreshed.data)
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
                      <option value="supervisor_insumos">Supervisor de insumos</option>
                      <option value="conductor">Conductor de escolta</option>
                      <option value="administracion">Administración</option>
                      <option value="owner">Propietario</option>
                      <option value="soporte">Soporte</option>
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
                  {userForm.rol === 'supervisor' && (
                    <label>
                      Zona del supervisor <span className="field-optional">(se auto-llena al aprobar)</span>
                      <select
                        value={userForm.zona}
                        onChange={(e) => setUserForm((f) => ({ ...f, zona: e.target.value }))}
                      >
                        <option value="">— Sin zona —</option>
                        {userForm.zona && !zonasActivas.some((z) => z.codigo === userForm.zona) && (
                          <option value={userForm.zona}>
                            {zonas.find((z) => z.codigo === userForm.zona)?.nombre ?? userForm.zona}
                          </option>
                        )}
                        {zonasActivas.map((z) => (
                          <option key={z.id} value={z.codigo}>{z.nombre}</option>
                        ))}
                      </select>
                    </label>
                  )}
                  <div className="modal-footer user-form__actions">
                    {editingUserId && (
                      <button
                        type="button"
                        className="danger-button"
                        style={{ marginRight: 'auto' }}
                        disabled={busy || editingUserId === session.id}
                        title={editingUserId === session.id ? 'No puedes eliminar tu propio usuario' : undefined}
                        onClick={() => setConfirmDeleteUser({ id: userForm.id, nombre: userForm.nombreCompleto })}
                      >
                        Eliminar
                      </button>
                    )}
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

        {/* Confirmacion de borrado de usuario. Se renderiza despues del modal de
            usuario para quedar SIEMPRE por encima (mismo z-index, orden DOM). */}
        {confirmDeleteUser && (
          <div className="modal-overlay open" style={{ zIndex: 2000 }} onClick={() => setConfirmDeleteUser(null)}>
            <div className="modal-card" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
              <div className="labor-detail-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                <h3 style={{ margin: 0 }}>Eliminar usuario</h3>
                <button type="button" className="modal-close-btn" onClick={() => setConfirmDeleteUser(null)} aria-label="Cerrar">×</button>
              </div>
              <p style={{ margin: '4px 0 18px', lineHeight: 1.5 }}>
                ¿Seguro que deseas eliminar a <strong>{confirmDeleteUser.nombre}</strong> ({confirmDeleteUser.id})?
                <br />
                El usuario dejará de aparecer y no podrá iniciar sesión. Su historial de labores se conserva.
              </p>
              <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button type="button" className="inline-button" onClick={() => setConfirmDeleteUser(null)} disabled={busy}>
                  Cancelar
                </button>
                <button
                  type="button"
                  className="danger-button"
                  disabled={busy}
                  onClick={async () => {
                    const target = confirmDeleteUser
                    setBusy(true)
                    setError('')
                    try {
                      await deleteAppUser(target.id)
                      const refreshed = await loadAppUsers()
                      setUsers(refreshed.data)
                      setInfo(`Usuario ${target.nombre} eliminado.`)
                      setConfirmDeleteUser(null)
                      setIsUserFormOpen(false)
                      setEditingUserId(null)
                      setUserForm({ id: nextUserId, nombreCompleto: '', rol: '', pin: '', equipoCodigo: '', zona: '' })
                    } catch (err: unknown) {
                      setError(err instanceof Error ? err.message : 'Error al eliminar usuario')
                    } finally {
                      setBusy(false)
                    }
                  }}
                >
                  {busy ? 'Eliminando...' : 'Sí, eliminar'}
                </button>
              </div>
            </div>
          </div>
        )}

        {supervisorTab === 'labores' ? (
          <section className="panel-card">
            <div className="labores-header">
              <div className="labores-title-row">
                <h2>Labores</h2>
                <span className="labores-count">{filteredAssignments.length}</span>
              </div>
              {/* Barra de busqueda libre + boton de filtros emergentes.
                  Reemplaza los 4 dropdowns apilados por una UI mas limpia:
                  la busqueda acota por hacienda/suerte/labor/operario y el
                  resto de filtros viven en el panel deslizable lateral. */}
              <div className="labores-search-row">
                <div className="labores-search-input-wrap">
                  <svg className="labores-search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle cx="11" cy="11" r="8" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                  <input
                    type="search"
                    className="labores-search-input"
                    placeholder="Buscar hacienda, suerte, labor u operario..."
                    value={laborSearch}
                    onChange={(event) => setLaborSearch(event.target.value)}
                  />
                  {laborSearch && (
                    <button
                      type="button"
                      className="labores-search-clear"
                      onClick={() => setLaborSearch('')}
                      aria-label="Limpiar busqueda"
                    >
                      &#x2715;
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  className={`filtros-toggle-btn${activeFilterCount > 0 ? ' filtros-toggle-btn--active' : ''}`}
                  onClick={() => setFilterPanelOpen(true)}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
                  </svg>
                  Filtros
                  {activeFilterCount > 0 && (
                    <span className="filtros-badge">{activeFilterCount}</span>
                  )}
                </button>
              </div>
            </div>

            {/* Drawer de filtros: componente compartido con el Resumen (mismo estado). */}
            <LaborFilterDrawer
              open={filterPanelOpen}
              onClose={() => setFilterPanelOpen(false)}
              activeFilterCount={activeFilterCount}
              onClear={clearLaborFilters}
              statusFilter={statusFilter}
              setStatusFilter={setStatusFilter}
              statusOptions={laborStatusOptions}
              operatorFilter={operatorFilter}
              setOperatorFilter={setOperatorFilter}
              ingenioFilter={ingenioFilter}
              setIngenioFilter={setIngenioFilter}
              ingenios={ingeniosOpts}
              haciendaFilter={haciendaFilter}
              setHaciendaFilter={setHaciendaFilter}
              haciendaFilterOptions={haciendaFilterOptions}
              resultCount={filteredAssignments.length}
            />

            {(pendingApprovals.length > 0 || (canEditAssignments && stalePendientes.count > 0)) && (
              <div className="mini-banner-row">
                {pendingApprovals.length > 0 && (
                  <button
                    type="button"
                    className="mini-banner mini-banner--approve"
                    onClick={() => setSupervisorTab('aprobaciones')}
                  >
                    <span className="mini-banner__dot" />
                    <span className="mini-banner__text">
                      <strong>{pendingApprovals.length}</strong> por facturar
                    </span>
                    <span className="mini-banner__cta">Revisar →</span>
                  </button>
                )}

                {canEditAssignments && stalePendientes.count > 0 && (
                  <div className="mini-banner mini-banner--stale">
                    <span className="mini-banner__text">
                      <strong>{stalePendientes.count}</strong> sin iniciar +{STALE_DAYS}d · {stalePendientes.area.toFixed(2)} ha
                    </span>
                    <button
                      type="button"
                      className="mini-banner__btn"
                      onClick={() => setShowStaleConfirm(true)}
                      disabled={cleaningStale}
                    >
                      Limpiar
                    </button>
                  </div>
                )}
              </div>
            )}

            {showStaleConfirm && (
              <div className="modal-overlay open" onClick={() => { if (!cleaningStale) setShowStaleConfirm(false) }}>
                <div className="modal-card" style={{ maxWidth: 'min(560px, calc(100vw - 32px))' }} onClick={(e) => e.stopPropagation()}>
                  <div className="labor-detail-header">
                    <div>
                      <p className="eyebrow">Pendientes viejas</p>
                      <h3>Pendientes sin iniciar ({stalePendientes.count})</h3>
                    </div>
                    <button type="button" className="modal-close-btn" onClick={() => setShowStaleConfirm(false)} disabled={cleaningStale} aria-label="Cerrar">
                      &#x2715;
                    </button>
                  </div>
                  <p className="subtle-copy" style={{ marginTop: 0 }}>
                    Llevan <strong>+{STALE_DAYS} días</strong> asignadas y nunca se iniciaron ({stalePendientes.area.toFixed(2)} ha en total).
                    Limpiar las deja como <strong>CANCELADA</strong> — no se borran, es reversible.
                  </p>

                  {stalePendientes.count === 0 ? (
                    <p className="subtle-copy">No quedan pendientes viejas. ✓</p>
                  ) : (
                    <>
                      <ul className="revisadas-list">
                        {stalePendientes.list.map((a) => (
                          <li key={a.id} className="revisadas-item">
                            <div className="revisadas-item__main">
                              <strong>{a.haciendaName} · {a.suerte}</strong>
                              <span>
                                {a.labor} — {a.operatorName || 'Sin operario'} · {a.area.toFixed(2)} ha · hace {diasDesde(a.dateKey)} días
                              </span>
                            </div>
                            <button
                              type="button"
                              className="inline-button revisadas-clear-one"
                              onClick={() => void handleCleanOneStale(a.id)}
                              disabled={cleaningStale}
                              title="Cancelar solo esta"
                            >
                              ✕ Limpiar
                            </button>
                          </li>
                        ))}
                      </ul>
                      <div className="modal-footer">
                        <button type="button" className="inline-button" onClick={() => setShowStaleConfirm(false)} disabled={cleaningStale}>
                          Cerrar
                        </button>
                        <button type="button" className="danger-button" onClick={() => void handleCleanStale()} disabled={cleaningStale}>
                          {cleaningStale ? 'Limpiando…' : `Limpiar todas (${stalePendientes.count})`}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

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
                      {assignment.liberada && (
                        <span
                          className="liberada-badge"
                          title="El operario liberó esta labor. Reasígnala a otro operario o cancélala."
                        >
                          Liberada
                        </span>
                      )}
                      {assignment.zone && (
                        <span className={`zone-badge zone-${assignment.zone.toLowerCase()}`}>
                          {assignment.zone === 'NORTE' ? 'Norte' : 'Sur'}
                        </span>
                      )}
                      <span className="labor-area">
                        {(() => {
                          const maestroRow = maestro.find((r) => r.haciendaCode === assignment.haciendaCode && r.suerte === assignment.suerte)
                          // ejec / asignada. La "ejec" solo tiene valor si la labor
                          // está CERRADA; una PENDIENTE/EN_PROCESO muestra 0.00 (no
                          // el planificado) para que NO parezca ejecutada.
                          const ejec = areaEjecutadaVisible(assignment)
                          const asignada = maestroRow?.area ?? assignment.area
                          return `${formatArea(ejec)} / ${formatArea(asignada)}`
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
                            onClick={() => {
                              // Labor de campo sin cliente/zona → obligar a diligenciarlos.
                              if (assignment.kind === 'LIBRE' && (!assignment.cliente || !assignment.zone)) {
                                setApproveTarget(assignment)
                                setApproveCliente(assignment.cliente ?? '')
                                setApproveZona(assignment.zone ?? miZona ?? '')
                              } else {
                                void handleApproveAssignment(assignment)
                              }
                            }}
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

        {supervisorTab === 'aprobaciones' ? (
          <section className="panel-card">
            <div className="labores-header">
              <div className="labores-title-row">
                <h2>Labores a facturar</h2>
                <span className="labores-count">{pendingApprovals.length}</span>
              </div>
            </div>
            <p className="subtle-copy" style={{ marginTop: 0 }}>
              Labores <strong>cerradas</strong> (parciales o completas) que esperan tu visto bueno. Revisa el área
              antes de aprobar — una vez aprobadas quedan listas para facturación.
              {session.role === 'supervisor' && (
                <> Tienes <strong>{APROBACION_HORAS} horas</strong> desde el cierre para aprobarlas; pasado ese plazo
                solo administración puede hacerlo.</>
              )}
            </p>
            {pendingApprovals.length === 0 ? (
              <div className="empty-card" style={{ marginTop: 12 }}>
                <h2>Todo al día ✓</h2>
                <p>No hay labores pendientes por facturar.</p>
              </div>
            ) : (
              <ul className="labores-list">
                {pendingApprovals.map((assignment) => {
                  const meta = getStatusMeta(assignment)
                  // Ventana de 36 h: vencida → solo administración/dueño aprueba.
                  const vencidaAprob = horasDesdeCierre(assignment) > APROBACION_HORAS
                  const puedeAprobar =
                    !vencidaAprob || session.role === 'owner' || session.role === 'administracion'
                  return (
                    <li key={assignment.id} className="labor-item labor-item--tappable" onClick={() => setSelectedLabor(assignment)}>
                      <span className="labor-title">
                        {assignment.haciendaName}{' '}
                        <span style={{ color: 'var(--color-ink-light)', fontWeight: 400 }}>·</span>{' '}
                        {assignment.suerte}
                      </span>
                      <span className={`status-chip ${meta.tone}`}>{meta.label}</span>
                      <span className="labor-name">
                        {assignment.labor} — {assignment.operatorName || 'Sin operario'}
                      </span>
                      <div className="labor-meta">
                        {assignment.kind === 'ASIGNADA' ? (
                          <span className="kind-badge asignada">Prog.</span>
                        ) : (
                          <span className="kind-badge libre">Campo</span>
                        )}
                        <span className="labor-area">
                          {(() => {
                            const m = maestro.find(
                              (r) => r.haciendaCode === assignment.haciendaCode && r.suerte === assignment.suerte,
                            )
                            const exec = areaEjecutadaVisible(assignment)
                            return `${formatArea(exec)} / ${formatArea(m?.area ?? assignment.area)}`
                          })()}
                        </span>
                        <span className="subtle-copy">{executionDateKey(assignment)}</span>
                      </div>
                      {vencidaAprob && (
                        <span className="aprob-vencida-badge" title={`Pasaron más de ${APROBACION_HORAS} h desde el cierre`}>
                          ⏳ Vencida · solo administración
                        </span>
                      )}
                      <div className="labor-actions" onClick={(e) => e.stopPropagation()}>
                        <button
                          className="approve-btn"
                          disabled={!puedeAprobar}
                          title={
                            puedeAprobar
                              ? undefined
                              : `Venció el plazo de ${APROBACION_HORAS} h desde el cierre. Solo administración puede aprobarla.`
                          }
                          onClick={() => {
                            if (!puedeAprobar) {
                              setError(`Esta labor lleva más de ${APROBACION_HORAS} h cerrada: solo administración puede aprobarla.`)
                              return
                            }
                            if (assignment.kind === 'LIBRE' && (!assignment.cliente || !assignment.zone)) {
                              setApproveTarget(assignment)
                              setApproveCliente(assignment.cliente ?? '')
                              setApproveZona(assignment.zone ?? miZona ?? '')
                            } else {
                              void handleApproveAssignment(assignment)
                            }
                          }}
                        >
                          Aprobar
                        </button>
                        <button
                          className="cancel-btn"
                          disabled={!puedeAprobar}
                          title={
                            puedeAprobar
                              ? undefined
                              : `Venció el plazo de ${APROBACION_HORAS} h desde el cierre. Solo administración puede decidir.`
                          }
                          onClick={() => {
                            if (!puedeAprobar) {
                              setError(`Esta labor lleva más de ${APROBACION_HORAS} h cerrada: solo administración puede decidirla.`)
                              return
                            }
                            void handleRejectAssignment(assignment)
                          }}
                        >
                          Rechazar
                        </button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
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
                    <article
                      key={item.code}
                      className="equipment-card"
                      style={{ cursor: 'pointer' }}
                      role="button"
                      tabIndex={0}
                      onClick={() => void openEquipoConsumo(item)}
                      title="Ver materiales cargados a esta máquina"
                    >
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

        {equipoConsumo && (
          <div className="modal-overlay open" onClick={() => setEquipoConsumo(null)}>
            <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 'min(520px, calc(100vw - 32px))' }}>
              <div className="labor-detail-header">
                <div><p className="eyebrow">Máquina</p><h3>🚜 {equipoConsumo.name}</h3></div>
                <button type="button" className="modal-close-btn" onClick={() => setEquipoConsumo(null)} aria-label="Cerrar">&#x2715;</button>
              </div>
              <p className="subtle-copy" style={{ marginTop: 0 }}>Materiales y combustible cargados a esta máquina.</p>
              {(() => {
                const salidas = equipoConsumoRows.filter((m) => m.tipo === 'SALIDA')
                const totales = new Map<string, number>()
                salidas.forEach((m) => totales.set(m.insumoId, (totales.get(m.insumoId) ?? 0) + m.cantidad))
                if (equipoConsumoLoading) return <p className="muted-text">Cargando…</p>
                if (salidas.length === 0) return <p className="muted-text">A esta máquina aún no se le ha cargado material.</p>
                return (
                  <>
                    <strong style={{ fontSize: '0.9rem' }}>Total cargado</strong>
                    <ul style={{ listStyle: 'none', margin: '6px 0 12px', padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {Array.from(totales.entries()).map(([insumoId, total]) => {
                        const info = insumoInfoMap.get(insumoId)
                        return (
                          <li key={insumoId} style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span>{info?.nombre ?? insumoId}</span>
                            <strong>{total} {info?.unidad ?? ''}</strong>
                          </li>
                        )
                      })}
                    </ul>
                    <strong style={{ fontSize: '0.9rem' }}>Despachos ({salidas.length})</strong>
                    <div className="list-rows" style={{ marginTop: 6, maxHeight: '40vh', overflowY: 'auto' }}>
                      {salidas.map((m) => {
                        const info = insumoInfoMap.get(m.insumoId)
                        const fecha = m.createdAt ? new Date(m.createdAt).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''
                        return (
                          <div key={m.id} className="movement-row">
                            <div>
                              <strong>{m.cantidad} {info?.unidad ?? ''} {info?.nombre ?? ''}</strong>
                              <span>{m.motivo ?? ''}</span>
                            </div>
                            <div className="movement-side"><small>{fecha}</small></div>
                          </div>
                        )
                      })}
                    </div>
                  </>
                )
              })()}
              <div className="modal-footer">
                <button type="button" className="primary-button" onClick={() => setEquipoConsumo(null)}>Cerrar</button>
              </div>
            </div>
          </div>
        )}

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
                    {selectedLabor.liberada && (
                      <span
                        className="liberada-badge"
                        title="El operario liberó esta labor. Reasígnala (cambia el operador en Editar) o cancélala."
                        style={{ marginLeft: 6 }}
                      >
                        Liberada
                      </span>
                    )}
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
                            operatorId: selectedLabor.operatorId ?? '',
                            fechaEjec: executionDateKey(selectedLabor),
                            status: selectedLabor.status,
                            facturaNumero: selectedLabor.facturaNumero ?? '',
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

                    <span className="labor-label">Ingenio</span>
                    <span className="labor-value">{getIngenioName(selectedLabor, maestro) ?? '—'}</span>

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

                    {(selectedLabor.updatedAt || selectedLabor.editadoPor) && (
                      <>
                        <span className="labor-label">Última edición</span>
                        <span className="labor-value">
                          {nombreUsuario(selectedLabor.editadoPor)}
                          {selectedLabor.updatedAt ? ` · ${fmtEditFecha(selectedLabor.updatedAt)}` : ''}
                          {' '}
                          <button
                            type="button"
                            className="inline-button"
                            style={{ marginLeft: 6, padding: '2px 8px' }}
                            onClick={() => void openAudit(selectedLabor)}
                          >
                            Ver historial
                          </button>
                        </span>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="labor-detail-edit">
                    <label className="assignment-detail-field">
                      <span>Estado</span>
                      <select
                        value={editLaborDraft.status}
                        onChange={(e) => setEditLaborDraft((d) => ({ ...d, status: e.target.value as Assignment['status'] }))}
                      >
                        <option value="PENDIENTE">Programada / Pendiente</option>
                        <option value="EN_PROCESO">Laborando (en proceso)</option>
                        <option value="PARCIAL">Parcial</option>
                        <option value="COMPLETADA">Terminada</option>
                      </select>
                      {editLaborDraft.status !== selectedLabor.status && (
                        (editLaborDraft.status === 'COMPLETADA' || editLaborDraft.status === 'PARCIAL') ? (
                          <small style={{ color: 'var(--color-status-progress)', marginTop: 4 }}>
                            Quedará <strong>pendiente de aprobación</strong> del supervisor.
                          </small>
                        ) : (
                          <small style={{ marginTop: 4 }}>
                            Vuelve a las Activas del operario (sin avance) y queda aprobada.
                          </small>
                        )
                      )}
                    </label>

                    <label className="assignment-detail-field">
                      <span>Fecha de ejecución</span>
                      <input
                        type="date"
                        value={editLaborDraft.fechaEjec}
                        onChange={(e) => setEditLaborDraft((d) => ({ ...d, fechaEjec: e.target.value }))}
                      />
                      <small>Corrige el día si el operario registró tarde (mueve la labor en la planilla).</small>
                    </label>

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
                      <span>Operador (reasignar)</span>
                      <SearchableSelect
                        value={editLaborDraft.operatorId}
                        onChange={(value) => setEditLaborDraft((d) => ({ ...d, operatorId: value }))}
                        options={operators.map((op) => ({ value: op.id, label: op.name, rightLabel: op.id }))}
                        placeholder="Buscar operador..."
                      />
                      {selectedLabor.status === 'PARCIAL' && editLaborDraft.operatorId !== (selectedLabor.operatorId ?? '') && (
                        <small style={{ color: 'var(--color-status-progress)', marginTop: 4 }}>
                          El nuevo operario verá esta labor como parcial con {selectedLabor.executedArea.toFixed(2)} ha ya hechas. Podrá continuarla desde "Activas".
                        </small>
                      )}
                    </label>

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

                    {(session.role === 'owner' || session.role === 'administracion') && (
                      <label className="assignment-detail-field">
                        <span>N° de factura <span className="field-optional">(facturación)</span></span>
                        <input
                          type="text"
                          value={editLaborDraft.facturaNumero}
                          onChange={(e) => setEditLaborDraft((d) => ({ ...d, facturaNumero: e.target.value }))}
                          placeholder="Sin facturar"
                        />
                        <small>Al asignar un N°, esta labor cuenta en el KPI "Área facturada". Déjalo vacío para desfacturar.</small>
                      </label>
                    )}
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
                        const execEntered = isNaN(execNum) ? selectedLabor.executedArea : execNum
                        const hiNum = editLaborDraft.horometroInicial.trim() === '' ? null : Number(editLaborDraft.horometroInicial)
                        const hfNum = editLaborDraft.horometroFinal.trim() === '' ? null : Number(editLaborDraft.horometroFinal)
                        // Si el operador cambia, resolvemos su nombre desde el catalogo
                        // para mantener operador_id y operador_nombre consistentes.
                        const newOperatorId = editLaborDraft.operatorId
                        const operatorChanged = newOperatorId !== (selectedLabor.operatorId ?? '')
                        const newOperatorName = operatorChanged
                          ? (operators.find((op) => op.id === newOperatorId)?.name ?? '')
                          : undefined

                        const newStatus = editLaborDraft.status
                        const statusChanged = newStatus !== selectedLabor.status
                        const nowIso = new Date().toISOString()
                        // Fecha de ejecución elegida → 11:00/12:00 hora Colombia (para que
                        // el dayKey en America/Bogota caiga en ese día exacto).
                        const dayAt = (h: number) =>
                          editLaborDraft.fechaEjec
                            ? new Date(`${editLaborDraft.fechaEjec}T${String(h).padStart(2, '0')}:00:00-05:00`).toISOString()
                            : null

                        // El ESTADO define fechas, área ejecutada y aprobación.
                        const isDone = newStatus === 'COMPLETADA' || newStatus === 'PARCIAL'
                        const startedAt = isDone || newStatus === 'EN_PROCESO'
                          ? (dayAt(11) ?? selectedLabor.startedAt ?? nowIso)
                          : null
                        const finishedAt = isDone ? (dayAt(12) ?? selectedLabor.finishedAt ?? nowIso) : null
                        const executedArea = isDone
                          ? (execEntered > 0 ? execEntered : selectedLabor.area)
                          : newStatus === 'EN_PROCESO' ? execEntered : 0
                        // Aprobación: solo se toca si el estado CAMBIÓ. Terminada/Parcial →
                        // PENDIENTE (cae en la bandeja del supervisor); Programada/En
                        // proceso → APROBADA (sale de la bandeja).
                        const approvalPatch = !statusChanged
                          ? {}
                          : isDone
                            ? { approval: 'PENDIENTE' as const, approvedBy: null, approvedAt: null }
                            : { approval: 'APROBADA' as const, approvedBy: session?.id ?? null, approvedAt: nowIso }

                        const ok = await handleEditAssignment(selectedLabor, {
                          status: newStatus,
                          startedAt,
                          finishedAt,
                          executedArea,
                          horometroInicial: hiNum,
                          horometroFinal: hfNum,
                          notes: editLaborDraft.notes,
                          equipmentCode: editLaborDraft.equipmentCode,
                          // Solo se manda factura_numero si (a) es dueño/admin Y
                          // (b) REALMENTE cambió. Así una edición normal (estado/
                          // área) NO depende de esa columna y no se rompe si la
                          // migración de factura aún no se corrió.
                          ...((session.role === 'owner' || session.role === 'administracion')
                            && editLaborDraft.facturaNumero.trim() !== (selectedLabor.facturaNumero ?? '')
                            ? { facturaNumero: editLaborDraft.facturaNumero.trim() || null }
                            : {}),
                          ...approvalPatch,
                          ...(operatorChanged ? {
                            operatorId: newOperatorId,
                            operatorName: newOperatorName,
                          } : {}),
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
                ) : selectedLabor.status === 'PENDIENTE' || selectedLabor.status === 'PARCIAL' ? (
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

        {/* Confirmar eliminación de una línea del Reporte (ajuste de liquidación) */}
        {deleteReportTarget && (
          <div className="modal-overlay open" onClick={() => { if (!deletingReport) setDeleteReportTarget(null) }}>
            <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 'min(460px, calc(100vw - 32px))' }}>
              <div className="labor-detail-header">
                <div>
                  <p className="eyebrow">Reporte · liquidación</p>
                  <h3>¿Eliminar esta línea?</h3>
                </div>
                <button type="button" className="modal-close-btn" onClick={() => setDeleteReportTarget(null)} disabled={deletingReport} aria-label="Cerrar">&#x2715;</button>
              </div>
              <p className="subtle-copy" style={{ marginTop: 0 }}>
                <strong>{deleteReportTarget.haciendaName} · {deleteReportTarget.suerte}</strong> — {deleteReportTarget.labor}
                {' · '}{deleteReportTarget.operatorName || 'Sin operario'}
                {' · '}{executionDateKey(deleteReportTarget)}
              </p>
              <p className="subtle-copy">
                Se borra <strong>de forma permanente</strong> (no se puede deshacer) y deja de contar en la liquidación.
                Si solo quieres corregir datos, usa <strong>Editar</strong> en su lugar.
              </p>
              <div className="modal-footer">
                <button type="button" className="inline-button" onClick={() => setDeleteReportTarget(null)} disabled={deletingReport}>
                  Cancelar
                </button>
                <button type="button" className="release-confirm-btn" onClick={() => void handleDeleteReportRow()} disabled={deletingReport}>
                  {deletingReport ? 'Eliminando…' : 'Sí, eliminar'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Aprobar labor de campo: obliga a diligenciar cliente + zona faltantes */}
        {approveTarget && (
          <div className="modal-overlay open" onClick={() => { if (!busy) setApproveTarget(null) }}>
            <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 'min(420px, calc(100vw - 32px))' }}>
              <div className="labor-detail-header">
                <div>
                  <p className="eyebrow">Aprobar labor de campo</p>
                  <h3>{approveTarget.labor}</h3>
                </div>
                <button type="button" className="modal-close-btn" onClick={() => setApproveTarget(null)} disabled={busy} aria-label="Cerrar">&#x2715;</button>
              </div>
              <p className="subtle-copy" style={{ marginTop: 0 }}>
                {approveTarget.haciendaName} · Suerte {approveTarget.suerte} · {approveTarget.operatorName || '—'}
              </p>
              <p className="subtle-copy">Completa los datos que faltan antes de aprobar:</p>
              <label className="assignment-detail-field">
                <span>Cliente</span>
                <select value={approveCliente} onChange={(e) => setApproveCliente(e.target.value)} disabled={busy}>
                  <option value="">Seleccionar…</option>
                  <option value="ingenios">Ingenios</option>
                  <option value="proveedores">Proveedores</option>
                </select>
              </label>
              <label className="assignment-detail-field">
                <span>Zona</span>
                <select value={approveZona} onChange={(e) => setApproveZona(e.target.value)} disabled={busy}>
                  <option value="">Seleccionar…</option>
                  {approveZona && !zonasActivas.some((z) => z.codigo === approveZona) && (
                    <option value={approveZona}>{zonas.find((z) => z.codigo === approveZona)?.nombre ?? approveZona}</option>
                  )}
                  {zonasActivas.map((z) => (
                    <option key={z.id} value={z.codigo}>{z.nombre}</option>
                  ))}
                </select>
              </label>
              <div className="modal-footer">
                <button type="button" className="inline-button" onClick={() => setApproveTarget(null)} disabled={busy}>Cancelar</button>
                <button
                  type="button"
                  className="primary-button"
                  disabled={busy || !approveCliente || !approveZona}
                  onClick={async () => {
                    const target = approveTarget
                    await handleApproveAssignment(target, {
                      cliente: approveCliente as 'ingenios' | 'proveedores',
                      zone: approveZona as 'NORTE' | 'SUR',
                    })
                    setApproveTarget(null)
                  }}
                >
                  {busy ? 'Aprobando…' : 'Aprobar labor'}
                </button>
              </div>
            </div>
          </div>
        )}

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
              {reusableMatches.length > 0 && (
                <div className="reuse-alert" style={{ gridColumn: '1 / -1' }}>
                  <div className="reuse-alert__text">
                    <strong>
                      ⚠️ Ya existe{reusableMatches.length > 1 ? 'n' : ''} {reusableMatches.length} asignación
                      {reusableMatches.length > 1 ? 'es' : ''} pendiente{reusableMatches.length > 1 ? 's' : ''} sin iniciar
                    </strong>
                    <span>
                      En {reusableMatches.map((m) => m.suerte).join(', ')} con esta labor
                      {reusableMatches[0]?.existing.operatorName ? ` (asignada a ${reusableMatches[0].existing.operatorName})` : ''}.
                      Llena operario/equipo y <strong>reúsala</strong> (la reasigna) en vez de crear un duplicado.
                    </span>
                  </div>
                  <button
                    type="button"
                    className="primary-button reuse-alert__btn"
                    onClick={() => void reuseExisting()}
                    disabled={busy}
                  >
                    Reusar {reusableMatches.length > 1 ? `las ${reusableMatches.length}` : 'esta'}
                  </button>
                </div>
              )}
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
                  onChange={(value) => { updateAssignmentForm('ingenioId', value); setSuerteSearch('') }}
                  placeholder="Selecciona un ingenio"
                  options={ingeniosOpts.map((ing) => ({ value: ing.id, label: ing.nombre }))}
                />
              </label>
              <label>
                Hacienda
                <SearchableSelect
                  value={assignmentForm.haciendaCode}
                  onChange={(value) => { updateAssignmentForm('haciendaCode', value); setSuerteSearch('') }}
                  placeholder={!assignmentForm.ingenioId ? 'Selecciona un ingenio primero' : 'Hacienda'}
                  options={assignmentHaciendas.map((item) => ({
                    value: item.code,
                    label: `${item.code} - ${item.name}`,
                  }))}
                />
              </label>
              <div>
                <span className="field-label">Suertes</span>
                {assignmentForm.haciendaCode && (
                  <input
                    type="search"
                    className="suerte-search-input"
                    value={suerteSearch}
                    onChange={(e) => setSuerteSearch(e.target.value)}
                    placeholder="Escribe para filtrar suertes…"
                    aria-label="Filtrar suertes"
                  />
                )}
                {assignmentForm.haciendaCode ? (() => {
                  const term = suerteSearch.trim().toLowerCase()
                  const filteredSuertes = term
                    ? assignmentSuertes.filter((row) => row.suerte.toLowerCase().includes(term))
                    : assignmentSuertes
                  if (filteredSuertes.length === 0) {
                    return (
                      <p className="field-hint">
                        Ninguna suerte coincide con “{suerteSearch.trim()}”. Si no existe, usa “+ Nueva suerte”.
                      </p>
                    )
                  }
                  return (
                  <ul className="suertes-checklist">
                    {filteredSuertes.map((row) => {
                      const suerteCode = `${assignmentForm.haciendaCode}-${row.suerte}`
                      const remaining = assignmentForm.labor
                        ? getRemainingArea(assignments, suerteCode, assignmentForm.labor, row.area, todayKey)
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
                            {row.creadoManual && (
                              <span className="suerte-manual-tag" title="Suerte creada manualmente, aun no en el catalogo oficial del ingenio">manual</span>
                            )}
                            {isCompleted
                              ? <span className="suerte-check-done">Completa</span>
                              : <span className="suerte-check-area">{formatArea(remaining)}</span>
                            }
                          </label>
                        </li>
                      )
                    })}
                  </ul>
                  )
                })() : (
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
                  options={activeLabores.map((labor) => {
                    const firstSuerte = assignmentSuertesList[0]
                    const isSuggested =
                      assignmentForm.haciendaCode && firstSuerte
                        ? labor === getSuggestedLabor(assignments, `${assignmentForm.haciendaCode}-${firstSuerte}`)
                        : false
                    return { value: labor, label: labor, rightLabel: isSuggested ? '<- sugerida' : undefined }
                  })}
                />
                {assignmentForm.labor && manualLaborSet.has(assignmentForm.labor.toUpperCase()) && (
                  <p className="field-warning">
                    ⚠ «{assignmentForm.labor}» es una labor <strong>manual</strong>. Verifica: los operadores
                    son de tractor. Para una labor manual usa el registro que corresponda, no una asignación a máquina.
                  </p>
                )}
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
