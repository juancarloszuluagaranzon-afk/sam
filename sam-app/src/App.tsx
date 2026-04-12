import { startTransition, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import './App.css'
import logoAgromorales from './assets/logo-agromorales.jpeg'
import { WORKFLOW } from './data/constants'
import type {
  Assignment,
  AssignmentStatus,
  Equipment,
  MaestroRow,
  UserProfile,
} from './domain/sam'
import {
  appLogin,
  createEquipment,
  createAssignment,
  formatTime,
  loadAppUsers,
  loadAssignments,
  loadEquipment,
  loadMaestro,
  summarizeAssignments,
  updateAssignment,
  appChangePin,
} from './services/samApi'

const SESSION_KEY = 'sam-app-session-v1'

type SupervisorTab = 'resumen' | 'asignar' | 'labores' | 'equipos' | 'tablero' | 'reporte'
type OperatorTab = 'activas' | 'campo' | 'historial'

type SessionUser = UserProfile

function isSupervisorOrOwner(role: SessionUser['role'] | undefined): boolean {
  return role === 'supervisor' || role === 'owner' || role === 'administracion'
}

function getRoleLabel(role: SessionUser['role'] | undefined): string {
  if (role === 'owner') return 'Propietario'
  if (role === 'supervisor') return 'Supervisor'
  if (role === 'administracion') return 'Administración'
  return 'Operador'
}

interface AssignmentFormState {
  haciendaCode: string
  suerte: string
  labor: string
  operatorId: string
  equipmentCode: string
  notes: string
  cliente: string
}

interface EquipmentFormState {
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

const EMPTY_FORM: AssignmentFormState = {
  haciendaCode: '',
  suerte: '',
  labor: '',
  operatorId: '',
  equipmentCode: '',
  notes: '',
  cliente: '',
}

const EMPTY_EQUIPMENT_FORM: EquipmentFormState = {
  code: '',
  name: '',
  type: 'tractor',
  state: 'activo',
  brand: '',
  model: '',
  year: '',
  plate: '',
  serialNumber: '',
  notes: '',
  active: true,
}

function getTodayKey() {
  return new Date().toLocaleDateString('en-CA', {
    timeZone: 'America/Bogota',
  })
}

function formatArea(value: number) {
  return `${value.toFixed(1)} ha`
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

function normalizeIdentity(value: string | null | undefined) {
  return String(value ?? '').trim().toUpperCase()
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

function getStatusMeta(status: AssignmentStatus) {
  if (status === 'COMPLETADA') {
    return { label: 'Completada', tone: 'done' as const }
  }
  if (status === 'EN_PROCESO') {
    return { label: 'En uso', tone: 'progress' as const }
  }
  if (status === 'CANCELADA') {
    return { label: 'Cancelada', tone: 'cancel' as const }
  }
  return { label: 'Pendiente', tone: 'pending' as const }
}

function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = 'Seleccionar',
}: {
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string; rightLabel?: string }[]
  placeholder?: string
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [query, setQuery] = useState('')
  const wrapperRef = useRef<HTMLDivElement>(null)

  const selectedOption = options.find((opt) => opt.value === String(value))
  const displayValue = isOpen ? query : selectedOption ? selectedOption.label : ''

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const filteredOptions = options.filter((opt) =>
    opt.label.toLowerCase().includes(query.toLowerCase()) ||
    (opt.rightLabel && opt.rightLabel.toLowerCase().includes(query.toLowerCase())),
  )

  return (
    <div className="searchable-select" ref={wrapperRef}>
      <input
        className="searchable-select-input"
        type="text"
        placeholder={placeholder}
        value={displayValue}
        onChange={(e) => {
          setQuery(e.target.value)
          if (!isOpen) setIsOpen(true)
        }}
        onFocus={() => {
          setIsOpen(true)
          setQuery('')
        }}
        autoComplete="off"
      />
      <div
        className="searchable-select-arrow"
        onClick={() => {
          setIsOpen(!isOpen)
          if (!isOpen) setQuery('')
        }}
      >
        <span>&#x25BC;</span>
      </div>
      {isOpen && (
        <ul className="searchable-select-options">
          <li
            className={`searchable-select-item ${!value ? 'selected' : ''}`}
            onMouseDown={(e) => {
              e.preventDefault();
              onChange('')
              setIsOpen(false)
              setQuery('')
            }}
          >
            {placeholder}
          </li>
          {filteredOptions.length > 0 ? (
            filteredOptions.map((opt) => (
              <li
                key={opt.value}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onChange(opt.value)
                  setIsOpen(false)
                  setQuery('')
                }}
                className={`searchable-select-item ${opt.value === String(value) ? 'selected' : ''}`}
              >
                <span>{opt.label}</span>
                {opt.rightLabel && <span className="searchable-select-item-right">{opt.rightLabel}</span>}
              </li>
            ))
          ) : (
            <li className="searchable-select-item searchable-select-empty">Sin resultados</li>
          )}
        </ul>
      )}
    </div>
  )
}

function App() {
  const [session, setSession] = useState<SessionUser | null>(null)
  const [isSideMenuOpen, setIsSideMenuOpen] = useState(false)
  const [isPinModalOpen, setIsPinModalOpen] = useState(false)
  const [pinForm, setPinForm] = useState({ current: '', newPin: '', confirm: '', error: '', loading: false })
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [loginUserId, setLoginUserId] = useState('U002')
  const [loginPin, setLoginPin] = useState('2402')
  const [maestro, setMaestro] = useState<MaestroRow[]>([])
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [users, setUsers] = useState<UserProfile[]>([])
  const [equipment, setEquipment] = useState<Equipment[]>([])
  const [assignmentForm, setAssignmentForm] = useState<AssignmentFormState>(EMPTY_FORM)
  const [assignmentSuertesList, setAssignmentSuertesList] = useState<string[]>([])
  const [freeFieldForm, setFreeFieldForm] = useState<AssignmentFormState>(EMPTY_FORM)
  const [freeFieldSuertesList, setFreeFieldSuertesList] = useState<string[]>([])
  const [equipmentForm, setEquipmentForm] = useState<EquipmentFormState>(EMPTY_EQUIPMENT_FORM)
  const [supervisorTab, setSupervisorTab] = useState<SupervisorTab>('labores')
  const [operatorTab, setOperatorTab] = useState<OperatorTab>('activas')
  const [operatorHistoryPeriod, setOperatorHistoryPeriod] = useState<'HOY' | 'ESTA_SEMANA' | 'ESTE_MES' | 'TODO'>('HOY')
  const [statusFilter, setStatusFilter] = useState('TODAS')
  const [operatorFilter, setOperatorFilter] = useState('TODOS')
  const [selectedLabor, setSelectedLabor] = useState<Assignment | null>(null)
  const [finishDrafts, setFinishDrafts] = useState<Record<string, { area: string; notes: string; horometroFinal: string; isComplete: boolean }>>({})
  const [startEquipmentDrafts, setStartEquipmentDrafts] = useState<Record<string, string>>({})
  const [startHorometroDrafts, setStartHorometroDrafts] = useState<Record<string, string>>({})
  const [reportFilters, setReportFilters] = useState({
    desde: '',
    hasta: '',
    estado: 'TODAS',
    haciendaCode: '',
    operatorId: 'TODOS',
  })

  useEffect(() => {
    const saved = window.localStorage.getItem(SESSION_KEY)
    if (saved) {
      try {
        setSession(JSON.parse(saved) as SessionUser)
      } catch {
        window.localStorage.removeItem(SESSION_KEY)
      }
    }

    void hydrate()
  }, [])

  async function hydrate() {
    setLoading(true)

    try {
      const [maestroResult, assignmentResult, userResult, equipmentResult] = await Promise.all([
        loadMaestro(),
        loadAssignments(),
        loadAppUsers(),
        loadEquipment(),
      ])

      startTransition(() => {
        setMaestro(maestroResult.data)
        setAssignments(assignmentResult.data)
        setUsers(userResult.data)
        if (userResult.data.length > 0) {
          setLoginUserId((prev) => prev || userResult.data[0].id)
        }
        setEquipment(equipmentResult.data)
      })
    } catch {
      setError('No pudimos cargar toda la informacion operativa.')
    } finally {
      setLoading(false)
    }
  }

  function saveSession(user: SessionUser | null) {
    setSession(user)
    setIsSideMenuOpen(false)

    if (user) {
      window.localStorage.setItem(SESSION_KEY, JSON.stringify(user))
    } else {
      window.localStorage.removeItem(SESSION_KEY)
    }
  }

  const supervisors = useMemo(
    () => users.filter((user) => user.role === 'supervisor'),
    [users],
  )
  const operators = useMemo(
    () => users.filter((user) => user.role === 'operador'),
    [users],
  )
  const todayKey = useMemo(() => getTodayKey(), [])
  const metrics = useMemo(
    () => summarizeAssignments(assignments, todayKey),
    [assignments, todayKey],
  )

  const haciendas = useMemo(() => {
    const map = new Map<number, string>()
    maestro.forEach((row) => {
      if (!map.has(row.haciendaCode)) {
        map.set(row.haciendaCode, row.haciendaName)
      }
    })
    return Array.from(map.entries()).map(([code, name]) => ({ code, name }))
  }, [maestro])

  const assignmentSuertes = useMemo(() => {
    const code = Number(assignmentForm.haciendaCode)
    return maestro.filter((row) => row.haciendaCode === code)
  }, [assignmentForm.haciendaCode, maestro])

  const freeFieldSuertes = useMemo(() => {
    const code = Number(freeFieldForm.haciendaCode)
    return maestro.filter((row) => row.haciendaCode === code)
  }, [freeFieldForm.haciendaCode, maestro])

  const filteredAssignments = useMemo(() => {
    return assignments.filter((assignment) => {
      if (statusFilter !== 'TODAS' && assignment.status !== statusFilter) return false
      if (operatorFilter !== 'TODOS' && assignment.operatorId !== operatorFilter) return false
      return true
    })
  }, [assignments, operatorFilter, statusFilter])

  const handleChangePin = async (e: FormEvent) => {
    e.preventDefault()
    if (!session) return

    if (pinForm.newPin !== pinForm.confirm) {
      setPinForm(prev => ({ ...prev, error: 'El PIN nuevo y la confirmacion no coinciden' }))
      return
    }

    if (pinForm.newPin.length < 4) {
      setPinForm(prev => ({ ...prev, error: 'El nuevo PIN debe tener al menos 4 caracteres' }))
      return
    }

    setPinForm(prev => ({ ...prev, loading: true, error: '' }))
    try {
      await appChangePin(session.id, pinForm.current, pinForm.newPin)
      setInfo('PIN actualizado exitosamente.')
      setIsPinModalOpen(false)
      setPinForm({ current: '', newPin: '', confirm: '', error: '', loading: false })
      setIsSideMenuOpen(false)
    } catch (err: any) {
      setPinForm(prev => ({ ...prev, error: err.message || 'Error al cambiar el PIN', loading: false }))
    }
  }

  const operatorAssignments = useMemo(() => {
    if (!session || session.role !== 'operador') return []

    const sessionId = normalizeIdentity(session.id)
    const sessionName = normalizeIdentity(session.name)

    return assignments.filter((assignment) => {
      const assignmentOperatorId = normalizeIdentity(assignment.operatorId)
      const assignmentOperatorName = normalizeIdentity(assignment.operatorName)

      // Robust matching for historical rows where operator_id may be missing or inconsistent.
      return (
        assignmentOperatorId === sessionId ||
        (assignmentOperatorId === '' && assignmentOperatorName === sessionName) ||
        assignmentOperatorName === sessionName
      )
    })
  }, [assignments, session])

  const activeAssignments = useMemo(
    () =>
      operatorAssignments.filter(
        (assignment) =>
          assignment.status === 'PENDIENTE' || assignment.status === 'EN_PROCESO',
      ),
    [operatorAssignments],
  )

  const historyAssignments = useMemo(
    () =>
      operatorAssignments.filter(
        (assignment) =>
          assignment.status === 'COMPLETADA' || assignment.status === 'CANCELADA',
      ),
    [operatorAssignments],
  )

  const filteredHistory = useMemo(() => {
    if (operatorHistoryPeriod === 'TODO') return historyAssignments

    const [year, month, day] = todayKey.split('-').map(Number)
    const baseDate = new Date(year, month - 1, day)
    
    let startLimit: Date
    if (operatorHistoryPeriod === 'HOY') {
      startLimit = baseDate
    } else if (operatorHistoryPeriod === 'ESTA_SEMANA') {
      startLimit = new Date(baseDate)
      const dayOfWeek = startLimit.getDay()
      const diff = startLimit.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1)
      startLimit.setDate(diff)
    } else {
      // ESTE_MES
      startLimit = new Date(baseDate)
      startLimit.setDate(1)
    }

    return historyAssignments.filter((assignment) => {
      const [y, m, d] = assignment.dateKey.split('-').map(Number)
      const itemDate = new Date(y, m - 1, d)
      return itemDate >= startLimit
    })
  }, [historyAssignments, operatorHistoryPeriod, todayKey])

  const laborToday = useMemo(() => {
    const groups = new Map<
      string,
      { planned: number; executed: number; count: number }
    >()

    assignments
      .filter((assignment) => assignment.dateKey === todayKey && assignment.status !== 'CANCELADA')
      .forEach((assignment) => {
        const current = groups.get(assignment.labor) ?? {
          planned: 0,
          executed: 0,
          count: 0,
        }

        current.planned += assignment.area
        current.count += 1
        if (assignment.status === 'COMPLETADA') {
          current.executed += assignment.executedArea
        }

        groups.set(assignment.labor, current)
      })

    return Array.from(groups.entries())
      .map(([labor, value]) => ({ labor, ...value }))
      .sort((a, b) => b.planned - a.planned)
  }, [assignments, todayKey])

  const recentAssignments = useMemo(
    () => assignments.slice(0, 8),
    [assignments],
  )

  const programmedSuerteRows = useMemo(() => {
    const programmedKeys = new Set(
      assignments
        .filter(
          (assignment) =>
            assignment.kind === 'ASIGNADA' && assignment.status !== 'CANCELADA',
        )
        .map((assignment) => `${assignment.haciendaCode}-${assignment.suerte}`),
    )

    return maestro
      .filter((row) => programmedKeys.has(`${row.haciendaCode}-${row.suerte}`))
      .sort(
        (a, b) =>
          a.haciendaCode - b.haciendaCode ||
          a.suerte.localeCompare(b.suerte),
      )
  }, [assignments, maestro])

  const filteredReport = useMemo(() => {
    return assignments
      .filter((a) => {
        if (reportFilters.desde && a.dateKey < reportFilters.desde) return false
        if (reportFilters.hasta && a.dateKey > reportFilters.hasta) return false
        if (reportFilters.estado !== 'TODAS' && a.status !== reportFilters.estado) return false
        if (reportFilters.haciendaCode && String(a.haciendaCode) !== reportFilters.haciendaCode) return false
        if (reportFilters.operatorId !== 'TODOS' && a.operatorId !== reportFilters.operatorId) return false
        return true
      })
      .sort((a, b) => b.dateKey.localeCompare(a.dateKey))
  }, [assignments, reportFilters])

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')

    try {
      const user = await appLogin(loginUserId, loginPin)
      saveSession(user)
      setInfo(`Sesion iniciada para ${user.name}.`)
      if (isSupervisorOrOwner(user.role)) {
        setSupervisorTab('labores')
      } else {
        setOperatorTab('activas')
      }
    } catch {
      setError('Credenciales invalidas. Revisa el usuario y el PIN.')
    } finally {
      setBusy(false)
    }
  }

  async function refreshAssignments() {
    const result = await loadAssignments()
    setAssignments(result.data)
  }

  async function refreshEquipment() {
    const result = await loadEquipment()
    setEquipment(result.data)
  }

  async function handleCreateEquipment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!equipmentForm.code.trim() || !equipmentForm.name.trim()) {
      setError('Codigo y nombre son obligatorios para crear el equipo.')
      return
    }

    setBusy(true)
    setError('')

    try {
      await createEquipment({
        code: equipmentForm.code.trim().toUpperCase(),
        name: equipmentForm.name.trim(),
        type: equipmentForm.type,
        state: equipmentForm.state,
        brand: equipmentForm.brand.trim(),
        model: equipmentForm.model.trim(),
        year: equipmentForm.year ? Number(equipmentForm.year) : null,
        plate: equipmentForm.plate.trim(),
        serialNumber: equipmentForm.serialNumber.trim(),
        notes: equipmentForm.notes.trim(),
        active: equipmentForm.active,
      })

      setEquipmentForm(EMPTY_EQUIPMENT_FORM)
      await refreshEquipment()
      setInfo('Equipo creado correctamente.')
    } catch {
      setError('No se pudo crear el equipo. Revisa codigo unico y campos.')
    } finally {
      setBusy(false)
    }
  }

  async function handleCreateAssignment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!session || !isSupervisorOrOwner(session.role)) return

    if (assignmentSuertesList.length === 0) {
      setError('Selecciona al menos una suerte.')
      return
    }

    const operator = operators.find((item) => item.id === assignmentForm.operatorId)
    const equipmentItem = equipment.find((item) => item.code === assignmentForm.equipmentCode)

    if (!operator || !equipmentItem || !assignmentForm.labor || !assignmentForm.cliente) {
      setError('Completa labor, operador, equipo y cliente.')
      return
    }

    const maestroRows = assignmentSuertesList
      .map((suerte) =>
        maestro.find(
          (row) => row.haciendaCode === Number(assignmentForm.haciendaCode) && row.suerte === suerte,
        ),
      )
      .filter((row): row is NonNullable<typeof row> => row !== undefined)

    // Regla de negocio: no se puede programar una labor ya completada totalmente
    const suertesCompletas = maestroRows.filter(
      (row) => getRemainingArea(assignments, `${row.haciendaCode}-${row.suerte}`, assignmentForm.labor, row.area) === 0,
    )
    if (suertesCompletas.length > 0) {
      setError(
        `La labor "${assignmentForm.labor}" ya está completamente ejecutada en: ${suertesCompletas.map((r) => r.suerte).join(', ')}. Solo se puede programar si hay área pendiente.`,
      )
      return
    }

    setBusy(true)
    setError('')

    try {
      await Promise.all(
        maestroRows.map((maestroRow) =>
          createAssignment({
            haciendaCode: maestroRow.haciendaCode,
            haciendaName: maestroRow.haciendaName,
            suerte: maestroRow.suerte,
            labor: assignmentForm.labor,
            area: getRemainingArea(assignments, `${maestroRow.haciendaCode}-${maestroRow.suerte}`, assignmentForm.labor, maestroRow.area),
            supervisorId: session.id,
            supervisorName: session.name,
            operatorId: operator.id,
            operatorName: operator.name,
            equipmentCode: equipmentItem.code,
            equipmentName: equipmentItem.name,
            notes: assignmentForm.notes,
            cliente: assignmentForm.cliente as 'ingenios' | 'proveedores',
            kind: 'ASIGNADA',
            initialStatus: 'PENDIENTE',
          }),
        ),
      )

      setAssignmentForm(EMPTY_FORM)
      setAssignmentSuertesList([])
      setInfo(`${maestroRows.length} asignacion(es) creadas.`)
      await refreshAssignments()
      setSupervisorTab('labores')
    } catch {
      setError('No se pudo crear las asignaciones.')
    } finally {
      setBusy(false)
    }
  }

  async function handleTakeFreeField(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!session || session.role !== 'operador') return

    if (freeFieldSuertesList.length === 0) {
      setError('Selecciona al menos una suerte.')
      return
    }

    const operator = operators.find((item) => item.id === session.id)
    const equipmentItem = equipment.find(
      (item) => item.code === (freeFieldForm.equipmentCode || session.equipmentCode),
    )

    if (!operator || !equipmentItem || !freeFieldForm.labor || !freeFieldForm.cliente) {
      setError('Completa labor, equipo y cliente para tomar campo libre.')
      return
    }

    const maestroRows = freeFieldSuertesList
      .map((suerte) =>
        maestro.find(
          (row) => row.haciendaCode === Number(freeFieldForm.haciendaCode) && row.suerte === suerte,
        ),
      )
      .filter((row): row is NonNullable<typeof row> => row !== undefined)

    // Regla de negocio: no se puede tomar campo en una labor ya completada totalmente
    const suertesCompletas = maestroRows.filter(
      (row) => getRemainingArea(assignments, `${row.haciendaCode}-${row.suerte}`, freeFieldForm.labor, row.area) === 0,
    )
    if (suertesCompletas.length > 0) {
      setError(
        `La labor "${freeFieldForm.labor}" ya está completamente ejecutada en: ${suertesCompletas.map((r) => r.suerte).join(', ')}. No hay área pendiente.`,
      )
      return
    }

    setBusy(true)
    setError('')

    try {
      await Promise.all(
        maestroRows.map((maestroRow) =>
          createAssignment({
            haciendaCode: maestroRow.haciendaCode,
            haciendaName: maestroRow.haciendaName,
            suerte: maestroRow.suerte,
            labor: freeFieldForm.labor,
            area: getRemainingArea(assignments, `${maestroRow.haciendaCode}-${maestroRow.suerte}`, freeFieldForm.labor, maestroRow.area),
            supervisorId: supervisors[0]?.id ?? 'U002',
            supervisorName: supervisors[0]?.name ?? 'Supervisor',
            operatorId: operator.id,
            operatorName: operator.name,
            equipmentCode: equipmentItem.code,
            equipmentName: equipmentItem.name,
            notes: freeFieldForm.notes,
            cliente: freeFieldForm.cliente as 'ingenios' | 'proveedores',
            kind: 'LIBRE',
            initialStatus: 'PENDIENTE',
          }),
        ),
      )

      const savedEquipment = freeFieldForm.equipmentCode || session.equipmentCode
      setFreeFieldForm({ ...EMPTY_FORM, equipmentCode: savedEquipment })
      setFreeFieldSuertesList([])
      setInfo(`${maestroRows.length} labor(es) tomadas en campo libre.`)
      await refreshAssignments()
      setOperatorTab('activas')
    } catch {
      setError('No se pudo registrar las labores en campo libre.')
    } finally {
      setBusy(false)
    }
  }

  async function handleStartAssignment(assignment: Assignment) {
    const equipmentCode =
      startEquipmentDrafts[assignment.id] || assignment.equipmentCode || session?.equipmentCode || ''
    const selectedEquipment = equipment.find((item) => item.code === equipmentCode)

    if (!selectedEquipment) {
      setError('Selecciona un equipo valido antes de iniciar la labor.')
      return
    }

    const horometroInicialRaw = startHorometroDrafts[assignment.id] ?? ''
    if (!horometroInicialRaw.trim()) {
      setError('Ingresa el horometro inicial antes de iniciar la labor.')
      return
    }
    const horometroInicial = Number(horometroInicialRaw)
    if (isNaN(horometroInicial) || horometroInicial < 0) {
      setError('El horometro inicial debe ser un numero valido.')
      return
    }

    setBusy(true)
    setError('')

    try {
      await updateAssignment(assignment.id, {
        status: 'EN_PROCESO',
        startedAt: new Date().toISOString(),
        equipmentCode: selectedEquipment.code,
        equipmentName: selectedEquipment.name,
        horometroInicial,
      })
      setStartEquipmentDrafts((current) => {
        const next = { ...current }
        delete next[assignment.id]
        return next
      })
      setStartHorometroDrafts((current) => {
        const next = { ...current }
        delete next[assignment.id]
        return next
      })
      setInfo(`Labor iniciada: ${assignment.labor}.`)
      await refreshAssignments()
    } catch {
      setError('No se pudo iniciar la labor.')
    } finally {
      setBusy(false)
    }
  }

  async function handleFinishAssignment(assignment: Assignment) {
    const draft = finishDrafts[assignment.id]
    const isComplete = draft?.isComplete ?? false
    const executedArea = isComplete ? assignment.area : Number(draft?.area ?? '')

    if (!executedArea || executedArea <= 0) {
      setError('Ingresa las hectareas ejecutadas antes de finalizar.')
      return
    }
    if (!isComplete && executedArea > assignment.area) {
      setError(`El area ejecutada no puede superar el area de la suerte (${formatArea(assignment.area)}).`)
      return
    }

    const horometroFinalRaw = draft?.horometroFinal ?? ''
    if (!horometroFinalRaw.trim()) {
      setError('Ingresa el horometro final antes de finalizar la labor.')
      return
    }
    const horometroFinal = Number(horometroFinalRaw)
    if (isNaN(horometroFinal) || horometroFinal < 0) {
      setError('El horometro final debe ser un numero valido.')
      return
    }

    setBusy(true)
    setError('')

    try {
      await updateAssignment(assignment.id, {
        status: 'COMPLETADA',
        finishedAt: new Date().toISOString(),
        executedArea,
        notes: draft?.notes ?? assignment.notes,
        horometroFinal,
      })
      setFinishDrafts((current) => {
        const next = { ...current }
        delete next[assignment.id]
        return next
      })
      setInfo(`Labor finalizada: ${assignment.labor}.`)
      await refreshAssignments()
    } catch {
      setError('No se pudo finalizar la labor.')
    } finally {
      setBusy(false)
    }
  }

  async function handleCancelAssignment(assignment: Assignment) {
    setBusy(true)
    setError('')

    try {
      await updateAssignment(assignment.id, {
        status: 'CANCELADA',
      })
      setInfo(`Asignacion cancelada: ${assignment.labor}.`)
      await refreshAssignments()
    } catch {
      setError('No se pudo cancelar la asignacion.')
    } finally {
      setBusy(false)
    }
  }

  function updateAssignmentForm(field: keyof AssignmentFormState, value: string) {
    setAssignmentForm((current) => {
      if (field === 'haciendaCode') {
        setAssignmentSuertesList([])
        return { ...current, haciendaCode: value, suerte: '' }
      }
      return { ...current, [field]: value }
    })
  }

  function toggleAssignmentSuerte(suerte: string) {
    setAssignmentSuertesList((current) =>
      current.includes(suerte)
        ? current.filter((s) => s !== suerte)
        : [...current, suerte],
    )
  }

  function updateFreeFieldForm(field: keyof AssignmentFormState, value: string) {
    setFreeFieldForm((current) => {
      if (field === 'haciendaCode') {
        setFreeFieldSuertesList([])
        return { ...current, haciendaCode: value, suerte: '' }
      }
      return { ...current, [field]: value }
    })
  }

  function toggleFreeFieldSuerte(suerte: string) {
    setFreeFieldSuertesList((current) =>
      current.includes(suerte)
        ? current.filter((s) => s !== suerte)
        : [...current, suerte],
    )
  }

  function prefillAssignmentForm(haciendaCode: number, suerte: string, labor: string) {
    setAssignmentForm({ ...EMPTY_FORM, haciendaCode: String(haciendaCode), labor })
    setAssignmentSuertesList([suerte])
    setSupervisorTab('asignar')
  }

  async function handleDownloadReport() {
    if (filteredReport.length === 0) return
    setBusy(true)
    setError('')
    try {
      const { utils, writeFile } = await import('xlsx')
      const rows = filteredReport.map((a) => ({
        'Fecha': a.dateKey,
        'Hacienda': a.haciendaName,
        'Suerte': a.suerte,
        'Código Suerte': a.suerteCode,
        'Labor': a.labor,
        'Área Plan. (ha)': a.area,
        'Área Ejec. (ha)': a.executedArea > 0 ? a.executedArea : '',
        'Estado': a.status,
        'Operador': a.operatorName,
        'Supervisor': a.supervisorId,
        'Equipo': a.equipmentName,
        'Inicio': a.startedAt ?? '',
        'Fin': a.finishedAt ?? '',
        'Horometro Ini': a.horometroInicial ?? '',
        'Horometro Fin': a.horometroFinal ?? '',
        'Cliente': a.cliente ?? '',
        'Tipo': a.kind,
        'Notas': a.notes,
      }))
      const ws = utils.json_to_sheet(rows)
      const wb = utils.book_new()
      utils.book_append_sheet(wb, ws, 'Labores')
      const filename = `reporte-${reportFilters.desde || 'inicio'}-${reportFilters.hasta || 'hoy'}.xlsx`
      writeFile(wb, filename)
      setInfo(`Reporte descargado: ${filteredReport.length} registros.`)
    } catch {
      setError('No se pudo generar el reporte.')
    } finally {
      setBusy(false)
    }
  }

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
    setStartHorometroDrafts((current) => ({
      ...current,
      [assignmentId]: value,
    }))
  }

  function updateStartEquipmentDraft(assignmentId: string, equipmentCode: string) {
    setStartEquipmentDrafts((current) => ({
      ...current,
      [assignmentId]: equipmentCode,
    }))
  }

  function updateEquipmentForm<K extends keyof EquipmentFormState>(
    field: K,
    value: EquipmentFormState[K],
  ) {
    setEquipmentForm((current) => ({
      ...current,
      [field]: value,
    }))
  }

  const loginOptions = useMemo(
    () =>
      users.map((u) => ({
        id: u.id,
        label: `${u.name} - ${getRoleLabel(u.role)}`,
      })),
    [users],
  )

  if (loading) {
    return (
      <main className="app-shell loading-shell">
        <div className="loading-card">
          <p className="eyebrow">SAM Control</p>
          <h1>Cargando operacion...</h1>
          <p>Estamos leyendo maestro, asignaciones y catalogos desde la base.</p>
        </div>
      </main>
    )
  }

  if (!session) {
    return (
      <main className="app-shell auth-shell">
        <section className="auth-panel">
          <div className="auth-copy">
            <img src={logoAgromorales} alt="Agroservicios Morales" className="auth-logo" />
            <p className="auth-company-name">Agroindustrial de Servicios Morales S.A.S</p>
          </div>

          <form className="login-card" onSubmit={handleLogin}>
            <p className="eyebrow">Ingreso</p>
            <h2>Acceso de piloto</h2>
            <label>
              Usuario
              <select
                value={loginUserId}
                onChange={(event) => setLoginUserId(event.target.value)}
              >
                {loginOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              PIN
              <input
                value={loginPin}
                onChange={(event) => setLoginPin(event.target.value)}
                placeholder="Ingresa tu PIN"
              />
            </label>
            {error ? <div className="feedback error">{error}</div> : null}
            <button className="primary-button" type="submit" disabled={busy}>
              {busy ? 'Entrando...' : 'Ingresar'}
            </button>
          </form>
        </section>
      </main>
    )
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <button
            className="top-icon-btn menu-left"
            onClick={() => setIsSideMenuOpen((current) => !current)}
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
          <button
            className="inline-button"
            onClick={() => setIsSideMenuOpen(false)}
          >
            Cerrar
          </button>
        </div>
        <div className="side-user-card">
          <span className="user-pill">{session.name}</span>
          <p>{getRoleLabel(session.role)}</p>
        </div>
        <button 
          className="primary-button outline" 
          onClick={() => {
            setIsSideMenuOpen(false)
            setIsPinModalOpen(true)
          }} 
          style={{ marginBottom: '8px' }}
        >
          Cambiar PIN
        </button>
        <button className="primary-button" onClick={() => saveSession(null)}>
          Salir
        </button>
      </aside>

      <div className="dashboard-shell">
        <section className="toolbar-card">
          <nav
            className={[
              'tab-nav floating-nav',
              !isSupervisorOrOwner(session.role) ? 'operator-tab-nav' : '',
              session.role === 'administracion' ? 'admin-nav' : '',
            ].filter(Boolean).join(' ')}
            aria-label="Navegacion principal"
          >
            {isSupervisorOrOwner(session.role) ? (
              <>
                <button
                  className={supervisorTab === 'labores' ? 'active' : ''}
                  onClick={() => setSupervisorTab('labores')}
                >
                  <span className="nav-item">
                    <span className="nav-icon">✓</span>
                    <span className="nav-label">Labores</span>
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
                {session.role === 'administracion' && (
                  <button
                    className={supervisorTab === 'reporte' ? 'active' : ''}
                    onClick={() => setSupervisorTab('reporte')}
                  >
                    <span className="nav-item">
                      <span className="nav-icon">⬦</span>
                      <span className="nav-label">Reporte</span>
                    </span>
                  </button>
                )}
              </>
            ) : (
              <>
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
              </>
            )}
          </nav>

        </section>

        {(error || info) && (
          <section className="message-stack">
            {error ? <div className="feedback error">{error}</div> : null}
            {info ? <div className="feedback success">{info}</div> : null}
          </section>
        )}

        {isSupervisorOrOwner(session.role) && supervisorTab === 'resumen' ? (
          <section className="kpi-grid">
            <article className="metric-panel">
              <p>HA PLANIFICADAS HOY</p>
              <strong>{metrics.plannedArea.toFixed(1)}</strong>
              <span>hectareas</span>
            </article>
            <article className="metric-panel">
              <p>HA EJECUTADAS</p>
              <strong>{metrics.executedArea.toFixed(1)}</strong>
              <span>hectareas</span>
            </article>
            <article className="metric-panel">
              <p>CUMPLIMIENTO</p>
              <strong className={metrics.completion < 30 ? 'danger' : ''}>
                {metrics.completion}%
              </strong>
              <div className="progress-track">
                <span style={{ width: `${Math.min(metrics.completion, 100)}%` }} />
              </div>
            </article>
            <article className="metric-panel">
              <p>EN PROCESO</p>
              <strong>{metrics.inProgress}</strong>
              <span>labores activas</span>
            </article>
          </section>
        ) : null}

        {isSupervisorOrOwner(session.role) && supervisorTab === 'resumen' ? (
          <>
            <section className="dashboard-grid two-up">
              <article className="panel-card">
                <div className="panel-title">
                  <h2>Operadores</h2>
                </div>
                <div className="list-rows">
                  {operators.map((operator) => {
                    const active = assignments.find(
                      (assignment) =>
                        assignment.operatorId === operator.id &&
                        assignment.status === 'EN_PROCESO',
                    )
                    const todayAssignments = assignments.filter(
                      (assignment) =>
                        assignment.operatorId === operator.id &&
                        assignment.dateKey === todayKey &&
                        assignment.status !== 'CANCELADA',
                    )
                    const planned = todayAssignments.reduce((sum, item) => sum + item.area, 0)
                    const executed = todayAssignments
                      .filter((item) => item.status === 'COMPLETADA')
                      .reduce((sum, item) => sum + item.executedArea, 0)

                    return (
                      <div key={operator.id} className="operator-row">
                        <div className="avatar">{initials(operator.name)}</div>
                        <div className="row-main">
                          <strong>{operator.name}</strong>
                          <span>
                            {active
                              ? `${active.labor} - ${active.haciendaName}`
                              : 'Sin labor activa'}
                          </span>
                        </div>
                        <strong className="row-metric">
                          {executed.toFixed(1)}/{planned.toFixed(1)} ha
                        </strong>
                      </div>
                    )
                  })}
                </div>
              </article>

              <article className="panel-card">
                <div className="panel-title">
                  <h2>Equipos</h2>
                </div>
                <div className="list-rows">
                  {equipment.map((item) => {
                    const active = assignments.find(
                      (assignment) =>
                        assignment.equipmentCode === item.code &&
                        assignment.status === 'EN_PROCESO',
                    )
                    return (
                      <div key={item.code} className="equipment-row">
                        <div>
                          <strong>{item.name}</strong>
                          <span>{active ? active.suerteCode : 'Sin labor activa'}</span>
                        </div>
                        <span className={`status-pill ${active ? 'progress' : 'done'}`}>
                          {active ? 'En uso' : 'Disponible'}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </article>
            </section>

            <section className="panel-card">
              <div className="panel-title">
                <h2>Por Labor (Hoy)</h2>
              </div>
              <div className="labor-grid">
                {laborToday.map((item) => (
                  <article key={item.labor} className="labor-card">
                    <p>{item.labor}</p>
                    <strong>{item.executed.toFixed(1)}</strong>
                    <span>
                      / {item.planned.toFixed(1)} ha - {item.count} labores
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
              </div>
            </section>
          </>
        ) : null}

        {isSupervisorOrOwner(session.role) && supervisorTab === 'asignar' ? (
          <section className="dashboard-grid two-up">
            <article className="panel-card">
              <div className="panel-title">
                <h2>Crear asignacion</h2>
              </div>
              <form className="form-grid-block" onSubmit={handleCreateAssignment}>
                <div className="form-grid">
                  <label>
                    Hacienda
                    <SearchableSelect
                      value={assignmentForm.haciendaCode}
                      onChange={(value) => updateAssignmentForm('haciendaCode', value)}
                      options={haciendas.map((item) => ({
                        value: String(item.code),
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
                </div>
                <div className="form-grid">
                  <label>
                    Labor
                    <SearchableSelect
                      value={assignmentForm.labor}
                      onChange={(value) => updateAssignmentForm('labor', value)}
                      options={WORKFLOW.map((labor) => {
                        const firstSuerte = assignmentSuertesList[0]
                        const isSuggested =
                          assignmentForm.haciendaCode && firstSuerte
                            ? labor ===
                              getSuggestedLabor(
                                assignments,
                                `${assignmentForm.haciendaCode}-${firstSuerte}`,
                              )
                            : false
                        return {
                          value: labor,
                          label: labor,
                          rightLabel: isSuggested ? '<- sugerida' : undefined,
                        }
                      })}
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
                </div>
                <div className="form-grid">
                  <label>
                    Operador
                    <SearchableSelect
                      value={assignmentForm.operatorId}
                      onChange={(value) => updateAssignmentForm('operatorId', value)}
                      options={operators.map((operator) => ({
                        value: operator.id,
                        label: operator.name,
                      }))}
                    />
                  </label>
                  <label>
                    Equipo
                    <SearchableSelect
                      value={assignmentForm.equipmentCode}
                      onChange={(value) => updateAssignmentForm('equipmentCode', value)}
                      options={equipment.map((item) => ({
                        value: item.code,
                        label: item.name,
                      }))}
                    />
                  </label>
                </div>
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
            </article>

            <article className="panel-card">
              <div className="panel-title">
                <h2>Ultimos movimientos</h2>
              </div>
              <div className="list-rows">
                {recentAssignments.map((assignment) => {
                  const meta = getStatusMeta(assignment.status)
                  return (
                    <div key={assignment.id} className="movement-row">
                      <div>
                        <strong>
                          {assignment.haciendaName} - {assignment.suerte}
                        </strong>
                        <span>
                          {assignment.labor}
                          {assignment.kind === 'ASIGNADA' ? (
                            <span className="kind-badge asignada">Prog.</span>
                          ) : (
                            <span className="kind-badge libre">Campo</span>
                          )}{' '}
                          Â· {assignment.operatorName || 'Sin operador'} Â· {assignment.equipmentName || assignment.equipmentCode || 'Sin equipo'}
                        </span>
                      </div>
                      <div className="movement-side">
                        <span className={`status-pill ${meta.tone}`}>{formatArea(assignment.area)}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </article>
          </section>
        ) : null}

        {isSupervisorOrOwner(session.role) && supervisorTab === 'tablero' ? (
          <section className="panel-card tablero-section">
            <div className="panel-title">
              <h2>Tablero</h2>
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
                    const rowAssignments = assignments.filter(
                      (assignment) =>
                        assignment.status !== 'CANCELADA' &&
                        (assignment.suerteCode === suerteKey ||
                          (assignment.suerte === row.suerte &&
                            assignment.haciendaCode === row.haciendaCode)),
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
                        <td className="center-cell">{row.area.toFixed(1)}</td>
                        <td className="center-cell">{firstDate}</td>
                        <td className="center-cell tab-hide-mobile">1</td>
                        <td className="center-cell tab-hide-mobile">DOBLE</td>
                        {WORKFLOW.map((labor) => {
                          const assignment = rowAssignments.find(
                            (item) => item.labor.toUpperCase() === labor.toUpperCase(),
                          )
                          const status = assignment?.status ?? 'PENDIENTE'
                          const isAssignable = status === 'PENDIENTE' && isSupervisorOrOwner(session!.role)
                          const cellClass = [
                            'labor-cell-box',
                            status === 'COMPLETADA' ? 'completada' : status === 'EN_PROCESO' ? 'en_proceso' : 'pendiente',
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
                                      ? `${assignment.executedArea.toFixed(1)} ha`
                                      : `${assignment.area.toFixed(1)} ha`}
                                  </span>
                                )}
                                {status === 'PENDIENTE' && (
                                  <span>{(assignment?.area ?? row.area).toFixed(1)} ha</span>
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
              <span className="tablero-legend-item en_proceso"><span className="spinner">RUN</span> En ejecucion</span>
              <span className="tablero-legend-item pendiente">Pendiente</span>
            </div>
          </section>
        ) : null}

        {session.role === 'administracion' && supervisorTab === 'reporte' ? (
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
                  {haciendas.map((h) => (
                    <option key={h.code} value={String(h.code)}>{h.name}</option>
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
              <span>{filteredReport.reduce((s, a) => s + a.area, 0).toFixed(1)} ha plan.</span>
              <span>{filteredReport.filter(a => a.status === 'COMPLETADA').reduce((s, a) => s + (a.executedArea || a.area), 0).toFixed(1)} ha ejec.</span>
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
                    const meta = getStatusMeta(a.status)
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

        {isSupervisorOrOwner(session.role) && supervisorTab === 'labores' ? (
          <section className="panel-card">
            <div className="labores-header">
              <div className="labores-title-row">
                <h2>Labores</h2>
                <span className="labores-count">{filteredAssignments.length}</span>
              </div>
              <div className="filter-row">
                <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                  <option value="TODAS">Todos los estados</option>
                  <option value="PENDIENTE">Pendiente</option>
                  <option value="EN_PROCESO">En proceso</option>
                  <option value="COMPLETADA">Completada</option>
                  <option value="CANCELADA">Cancelada</option>
                </select>
                <select
                  value={operatorFilter}
                  onChange={(event) => setOperatorFilter(event.target.value)}
                >
                  <option value="TODOS">Todos los op.</option>
                  {operators.map((operator) => (
                    <option key={operator.id} value={operator.id}>
                      {operator.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <ul className="labores-list">
              {filteredAssignments.map((assignment) => {
                const meta = getStatusMeta(assignment.status)
                return (
                  <li key={assignment.id} className="labor-item labor-item--tappable" onClick={() => setSelectedLabor(assignment)}>
                    <span className="labor-label">Hacienda</span>
                    <span className="labor-value">{assignment.haciendaName}</span>

                    <span className="labor-label">Suerte</span>
                    <span className="labor-value">{assignment.suerte}</span>

                    <span className="labor-label">Labor</span>
                    <span className="labor-value labor-name">{assignment.labor}</span>

                    <span className="labor-label">Tipo</span>
                    <span className="labor-value">
                      {assignment.kind === 'ASIGNADA' ? (
                        <span className="kind-badge asignada">Prog.</span>
                      ) : (
                        <span className="kind-badge libre">Campo</span>
                      )}
                    </span>

                    <span className="labor-label">Estado</span>
                    <span className={`status-chip status-chip--block ${meta.tone}`}>{meta.label}</span>

                    <span className="labor-label">Area</span>
                    <span className="labor-area">
                      {assignment.status === 'COMPLETADA' && assignment.executedArea > 0
                        ? formatArea(assignment.executedArea)
                        : formatArea(assignment.area)}
                    </span>

                    {assignment.status === 'PENDIENTE' && (
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

        {isSupervisorOrOwner(session.role) && supervisorTab === 'equipos' ? (
          <section className="dashboard-grid two-up">
            <article className="panel-card">
              <div className="panel-title">
                <h2>Crear equipo</h2>
              </div>
              <form className="form-grid-block" onSubmit={handleCreateEquipment}>
                <div className="form-grid">
                  <label>
                    Codigo
                    <input
                      value={equipmentForm.code}
                      onChange={(event) =>
                        updateEquipmentForm('code', event.target.value)
                      }
                      placeholder="TRC-001"
                    />
                  </label>
                  <label>
                    Nombre
                    <input
                      value={equipmentForm.name}
                      onChange={(event) =>
                        updateEquipmentForm('name', event.target.value)
                      }
                      placeholder="Case 1304"
                    />
                  </label>
                </div>
                <div className="form-grid">
                  <label>
                    Tipo
                    <select
                      value={equipmentForm.type}
                      onChange={(event) =>
                        updateEquipmentForm(
                          'type',
                          event.target.value as EquipmentFormState['type'],
                        )
                      }
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
                      onChange={(event) =>
                        updateEquipmentForm(
                          'state',
                          event.target.value as EquipmentFormState['state'],
                        )
                      }
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
                    <input
                      value={equipmentForm.brand}
                      onChange={(event) =>
                        updateEquipmentForm('brand', event.target.value)
                      }
                    />
                  </label>
                  <label>
                    Modelo
                    <input
                      value={equipmentForm.model}
                      onChange={(event) =>
                        updateEquipmentForm('model', event.target.value)
                      }
                    />
                  </label>
                </div>
                <div className="form-grid">
                  <label>
                    Ano
                    <input
                      value={equipmentForm.year}
                      onChange={(event) =>
                        updateEquipmentForm('year', event.target.value)
                      }
                      placeholder="2024"
                    />
                  </label>
                  <label>
                    Placa
                    <input
                      value={equipmentForm.plate}
                      onChange={(event) =>
                        updateEquipmentForm('plate', event.target.value)
                      }
                    />
                  </label>
                </div>
                <label>
                  Numero de serie
                  <input
                    value={equipmentForm.serialNumber}
                    onChange={(event) =>
                      updateEquipmentForm('serialNumber', event.target.value)
                    }
                  />
                </label>
                <label>
                  Observaciones
                  <textarea
                    rows={3}
                    value={equipmentForm.notes}
                    onChange={(event) =>
                      updateEquipmentForm('notes', event.target.value)
                    }
                  />
                </label>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={equipmentForm.active}
                    onChange={(event) =>
                      updateEquipmentForm('active', event.target.checked)
                    }
                  />
                  Equipo activo
                </label>
                <button className="primary-button" type="submit" disabled={busy}>
                  {busy ? 'Guardando...' : 'Crear equipo'}
                </button>
              </form>
            </article>

            <article className="panel-card">
              <div className="panel-title">
                <h2>Estado de equipos</h2>
              </div>
              <div className="equipment-grid">
                {equipment.map((item) => {
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
                          {active ? 'En uso' : 'Disponible'}
                        </span>
                      </div>
                      <div className="equipment-card-body">
                        <strong>{planned.toFixed(1)} ha</strong>
                        <span>
                          {active
                            ? `${active.operatorName} Â· ${active.haciendaName} ${active.suerte}`
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

        {session.role === 'operador' && operatorTab === 'activas' ? (
          <section className="operator-stack operator-mobile-stack">
            {activeAssignments.map((assignment) => {
              const meta = getStatusMeta(assignment.status)
              const draft = finishDrafts[assignment.id]
              return (
                <article key={assignment.id} className="panel-card active-card operator-work-card">
                  <div className="panel-title split">
                    <div>
                      <h2>
                        {assignment.haciendaName} - {assignment.suerte}
                      </h2>
                      <p className="subtle-copy">
                        {assignment.labor} 
                        {assignment.kind === 'ASIGNADA' ? (
                          <span className="kind-badge asignada">Prog.</span>
                        ) : (
                          <span className="kind-badge libre">Campo</span>
                        )}{' '}
                        - {formatArea(assignment.area)}
                      </p>
                    </div>
                    <span className={`status-pill ${meta.tone}`}>{meta.label}</span>
                  </div>
                  <div className="active-meta">
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
                          {equipment.map((item) => (
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
                        onClick={() => void handleStartAssignment(assignment)}
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
                        onClick={() => void handleFinishAssignment(assignment)}
                        disabled={busy}
                      >
                        Finalizar
                      </button>
                    </div>
                  )}
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

        {session.role === 'operador' && operatorTab === 'campo' ? (
          <section className="dashboard-grid two-up operator-field-layout">
            <article className="panel-card operator-form-card">
              <div className="panel-title">
                <h2>Tomar suerte en campo</h2>
              </div>
              <form className="form-grid-block" onSubmit={handleTakeFreeField}>
                <div className="form-grid">
                  <label>
                    Hacienda
                    <SearchableSelect
                      value={freeFieldForm.haciendaCode}
                      onChange={(value) => updateFreeFieldForm('haciendaCode', value)}
                      options={haciendas.map((item) => ({
                        value: String(item.code),
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
                </div>
                <div className="form-grid">
                  <label>
                    Labor
                    <SearchableSelect
                      value={freeFieldForm.labor}
                      onChange={(value) => updateFreeFieldForm('labor', value)}
                      options={WORKFLOW.map((labor) => {
                        const firstSuerte = freeFieldSuertesList[0]
                        const isSuggested =
                          freeFieldForm.haciendaCode && firstSuerte
                            ? labor ===
                              getSuggestedLabor(
                                assignments,
                                `${freeFieldForm.haciendaCode}-${firstSuerte}`,
                              )
                            : false
                        return {
                          value: labor,
                          label: labor,
                          rightLabel: isSuggested ? '<- sugerida' : undefined,
                        }
                      })}
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
                </div>
                <div className="form-grid">
                  <label>
                    Equipo
                    <SearchableSelect
                      value={freeFieldForm.equipmentCode || session.equipmentCode}
                      onChange={(value) => updateFreeFieldForm('equipmentCode', value)}
                      options={equipment.map((item) => ({
                        value: item.code,
                        label: item.name,
                      }))}
                    />
                  </label>
                  <label>
                    Operador
                    <input value={session.name} disabled />
                  </label>
                </div>
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

        {session.role === 'operador' && operatorTab === 'historial' ? (
          <section className="panel-card operator-history-card">
            <div className="panel-title split">
              <h2>Historial</h2>
              <select
                value={operatorHistoryPeriod}
                onChange={(e) => setOperatorHistoryPeriod(e.target.value as any)}
                className="base-input"
                style={{ width: 'auto', margin: 0, padding: '4px 8px', fontSize: '0.85rem' }}
              >
                <option value="HOY">Hoy</option>
                <option value="ESTA_SEMANA">Esta semana</option>
                <option value="ESTE_MES">Este mes</option>
                <option value="TODO">Todo</option>
              </select>
            </div>
            
            <div className="journey-stats" style={{ marginBottom: '1.5rem', marginTop: '1rem', background: '#f8f9fc', padding: '1rem', borderRadius: '8px' }}>
              <div>
                <strong>{filteredHistory.length}</strong>
                <span>cerradas</span>
              </div>
              <div>
                <strong>
                  {filteredHistory
                    .filter((item) => item.status === 'COMPLETADA')
                    .reduce((sum, item) => sum + item.executedArea, 0)
                    .toFixed(1)}
                </strong>
                <span>ha ejecutadas</span>
              </div>
            </div>

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
                        {assignment.labor} 
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

        {selectedLabor && (() => {
          const meta = getStatusMeta(selectedLabor.status)
          return (
            <div className="modal-overlay open" onClick={() => setSelectedLabor(null)}>
              <div className="modal-card labor-detail-card" onClick={(e) => e.stopPropagation()}>
                <div className="labor-detail-header">
                  <div>
                    <h3>{selectedLabor.labor}</h3>
                    <span className={`status-chip ${meta.tone}`}>{meta.label}</span>
                  </div>
                  <button className="modal-close-btn" onClick={() => setSelectedLabor(null)} aria-label="Cerrar">✕</button>
                </div>

                <div className="labor-detail-grid">
                  <span className="labor-label">Hacienda</span>
                  <span className="labor-value">{selectedLabor.haciendaName}</span>

                  <span className="labor-label">Suerte</span>
                  <span className="labor-value">{selectedLabor.suerte}</span>

                  <span className="labor-label">Tipo</span>
                  <span className="labor-value">
                    {selectedLabor.kind === 'ASIGNADA' ? (
                      <span className="kind-badge asignada">Programada</span>
                    ) : (
                      <span className="kind-badge libre">Campo libre</span>
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

                {selectedLabor.status === 'PENDIENTE' && (
                  <div className="modal-footer">
                    <button
                      className="cancel-btn"
                      onClick={() => {
                        void handleCancelAssignment(selectedLabor)
                        setSelectedLabor(null)
                      }}
                    >
                      Cancelar labor
                    </button>
                  </div>
                )}
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
    </main>
  )
}

export default App
