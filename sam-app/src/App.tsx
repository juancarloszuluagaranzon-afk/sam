import { startTransition, useEffect, useMemo, useState, type FormEvent } from 'react'
import './App.css'
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
  createAssignment,
  formatTime,
  loadAppUsers,
  loadAssignments,
  loadEquipment,
  loadMaestro,
  summarizeAssignments,
  updateAssignment,
} from './services/samApi'

const SESSION_KEY = 'sam-app-session-v1'

type SupervisorTab = 'resumen' | 'asignar' | 'labores' | 'equipos' | 'tablero'
type OperatorTab = 'activas' | 'campo' | 'historial'

type SessionUser = UserProfile

interface AssignmentFormState {
  haciendaCode: string
  suerte: string
  labor: string
  operatorId: string
  equipmentCode: string
  notes: string
}

const EMPTY_FORM: AssignmentFormState = {
  haciendaCode: '',
  suerte: '',
  labor: '',
  operatorId: '',
  equipmentCode: '',
  notes: '',
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

function App() {
  const [session, setSession] = useState<SessionUser | null>(null)
  const [isSideMenuOpen, setIsSideMenuOpen] = useState(false)
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
  const [freeFieldForm, setFreeFieldForm] = useState<AssignmentFormState>(EMPTY_FORM)
  const [supervisorTab, setSupervisorTab] = useState<SupervisorTab>('resumen')
  const [operatorTab, setOperatorTab] = useState<OperatorTab>('activas')
  const [statusFilter, setStatusFilter] = useState('TODAS')
  const [operatorFilter, setOperatorFilter] = useState('TODOS')
  const [finishDrafts, setFinishDrafts] = useState<Record<string, { area: string; notes: string }>>({})
  const [startEquipmentDrafts, setStartEquipmentDrafts] = useState<Record<string, string>>({})

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

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')

    try {
      const user = await appLogin(loginUserId, loginPin)
      saveSession(user)
      setInfo(`Sesion iniciada para ${user.name}.`)
      if (user.role === 'supervisor') {
        setSupervisorTab('resumen')
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

  async function handleCreateAssignment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!session || session.role !== 'supervisor') return

    const maestroRow = maestro.find(
      (row) =>
        row.haciendaCode === Number(assignmentForm.haciendaCode) &&
        row.suerte === assignmentForm.suerte,
    )
    const operator = operators.find((item) => item.id === assignmentForm.operatorId)
    const equipmentItem = equipment.find((item) => item.code === assignmentForm.equipmentCode)

    if (!maestroRow || !operator || !equipmentItem || !assignmentForm.labor) {
      setError('Completa hacienda, suerte, labor, operador y equipo.')
      return
    }

    setBusy(true)
    setError('')

    try {
      await createAssignment({
        haciendaCode: maestroRow.haciendaCode,
        haciendaName: maestroRow.haciendaName,
        suerte: maestroRow.suerte,
        labor: assignmentForm.labor,
        area: maestroRow.area,
        supervisorId: session.id,
        supervisorName: session.name,
        operatorId: operator.id,
        operatorName: operator.name,
        equipmentCode: equipmentItem.code,
        equipmentName: equipmentItem.name,
        notes: assignmentForm.notes,
        kind: 'ASIGNADA',
        initialStatus: 'PENDIENTE',
      })

      setAssignmentForm(EMPTY_FORM)
      setInfo('Asignacion creada en Supabase.')
      await refreshAssignments()
      setSupervisorTab('labores')
    } catch {
      setError('No se pudo crear la asignacion.')
    } finally {
      setBusy(false)
    }
  }

  async function handleTakeFreeField(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!session || session.role !== 'operador') return

    const maestroRow = maestro.find(
      (row) =>
        row.haciendaCode === Number(freeFieldForm.haciendaCode) &&
        row.suerte === freeFieldForm.suerte,
    )
    const operator = operators.find((item) => item.id === session.id)
    const equipmentItem = equipment.find(
      (item) => item.code === (freeFieldForm.equipmentCode || session.equipmentCode),
    )

    if (!maestroRow || !operator || !equipmentItem || !freeFieldForm.labor) {
      setError('Completa hacienda, suerte, labor y equipo para tomar campo libre.')
      return
    }

    setBusy(true)
    setError('')

    try {
      await createAssignment({
        haciendaCode: maestroRow.haciendaCode,
        haciendaName: maestroRow.haciendaName,
        suerte: maestroRow.suerte,
        labor: freeFieldForm.labor,
        area: maestroRow.area,
        supervisorId: supervisors[0]?.id ?? 'U002',
        supervisorName: supervisors[0]?.name ?? 'Supervisor',
        operatorId: operator.id,
        operatorName: operator.name,
        equipmentCode: equipmentItem.code,
        equipmentName: equipmentItem.name,
        notes: freeFieldForm.notes,
        kind: 'LIBRE',
        initialStatus: 'PENDIENTE',
      })

      setFreeFieldForm((current) => ({
        ...EMPTY_FORM,
        equipmentCode: current.equipmentCode || session.equipmentCode,
      }))
      setInfo('Labor tomada en campo libre.')
      await refreshAssignments()
      setOperatorTab('activas')
    } catch {
      setError('No se pudo registrar la labor en campo libre.')
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

    setBusy(true)
    setError('')

    try {
      await updateAssignment(assignment.id, {
        status: 'EN_PROCESO',
        startedAt: new Date().toISOString(),
        equipmentCode: selectedEquipment.code,
        equipmentName: selectedEquipment.name,
      })
      setStartEquipmentDrafts((current) => {
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
    const executedArea = Number(draft?.area ?? assignment.area)

    if (!executedArea) {
      setError('Ingresa las hectareas ejecutadas antes de finalizar.')
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
        return { ...current, haciendaCode: value, suerte: '' }
      }
      return { ...current, [field]: value }
    })
  }

  function updateFreeFieldForm(field: keyof AssignmentFormState, value: string) {
    setFreeFieldForm((current) => {
      if (field === 'haciendaCode') {
        return { ...current, haciendaCode: value, suerte: '' }
      }
      return { ...current, [field]: value }
    })
  }

  function updateFinishDraft(assignmentId: string, field: 'area' | 'notes', value: string) {
    setFinishDrafts((current) => ({
      ...current,
      [assignmentId]: {
        area: current[assignmentId]?.area ?? '',
        notes: current[assignmentId]?.notes ?? '',
        [field]: value,
      },
    }))
  }

  function updateStartEquipmentDraft(assignmentId: string, equipmentCode: string) {
    setStartEquipmentDrafts((current) => ({
      ...current,
      [assignmentId]: equipmentCode,
    }))
  }

  const loginOptions = useMemo(
    () =>
      [
        { id: 'U002', label: 'Alfredo Uran Â· Supervisor' },
        { id: 'U003', label: 'William Ortiz Â· Operador' },
        { id: 'U004', label: 'Ismael Reyes Â· Operador' },
      ] as const,
    [],
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
            <p className="eyebrow">SAM Control</p>
            <h1>Control operativo para Servicios Agricolas Morales</h1>
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
            ≡
          </button>
          <div>
            <strong>SAM Control</strong>
            <span>{session.role === 'supervisor' ? 'Supervisor' : 'Operador'}</span>
          </div>
        </div>

        <div className="topbar-actions">
          <button className="top-icon-btn" aria-label="Buscar">
            ⌕
          </button>
          <button className="top-icon-btn" aria-label="Verificar">
            ☑
          </button>
          <button className="top-icon-btn" aria-label="Refrescar" onClick={() => void hydrate()}>
            ↻
          </button>
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
          <p>{session.role === 'supervisor' ? 'Supervisor' : 'Operador'}</p>
        </div>
        <button className="primary-button" onClick={() => saveSession(null)}>
          Salir
        </button>
      </aside>

      <div className="dashboard-shell">
        <section className="toolbar-card">
          <nav
            className={
              session.role === 'operador'
                ? 'tab-nav operator-tab-nav floating-nav'
                : 'tab-nav floating-nav'
            }
            aria-label="Navegacion principal"
          >
            {session.role === 'supervisor' ? (
              <>
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
                  className={supervisorTab === 'labores' ? 'active' : ''}
                  onClick={() => setSupervisorTab('labores')}
                >
                  <span className="nav-item">
                    <span className="nav-icon">✓</span>
                    <span className="nav-label">Labores</span>
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

        {session.role === 'supervisor' && supervisorTab === 'resumen' ? (
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

        {session.role === 'supervisor' && supervisorTab === 'resumen' ? (
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
                      / {item.planned.toFixed(1)} ha Â· {item.count} labores
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

        {session.role === 'supervisor' && supervisorTab === 'asignar' ? (
          <section className="dashboard-grid two-up">
            <article className="panel-card">
              <div className="panel-title">
                <h2>Crear asignacion</h2>
              </div>
              <form className="form-grid-block" onSubmit={handleCreateAssignment}>
                <div className="form-grid">
                  <label>
                    Hacienda
                    <select
                      value={assignmentForm.haciendaCode}
                      onChange={(event) => updateAssignmentForm('haciendaCode', event.target.value)}
                    >
                      <option value="">Seleccionar</option>
                      {haciendas.map((item) => (
                        <option key={item.code} value={item.code}>
                          {item.code} - {item.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Suerte
                    <select
                      value={assignmentForm.suerte}
                      onChange={(event) => updateAssignmentForm('suerte', event.target.value)}
                    >
                      <option value="">Seleccionar</option>
                      {assignmentSuertes.map((row) => (
                        <option key={`${row.haciendaCode}-${row.suerte}`} value={row.suerte}>
                          {row.suerte} Â· {formatArea(row.area)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label>
                  Labor
                  <select
                    value={assignmentForm.labor}
                    onChange={(event) => updateAssignmentForm('labor', event.target.value)}
                  >
                    <option value="">Seleccionar</option>
                    {WORKFLOW.map((labor) => (
                      <option key={labor} value={labor}>
                        {labor}
                        {assignmentForm.haciendaCode && assignmentForm.suerte
                          ? labor ===
                            getSuggestedLabor(
                              assignments,
                              `${assignmentForm.haciendaCode}-${assignmentForm.suerte}`,
                            )
                            ? ' â† sugerida'
                            : ''
                          : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="form-grid">
                  <label>
                    Operador
                    <select
                      value={assignmentForm.operatorId}
                      onChange={(event) => updateAssignmentForm('operatorId', event.target.value)}
                    >
                      <option value="">Seleccionar</option>
                      {operators.map((operator) => (
                        <option key={operator.id} value={operator.id}>
                          {operator.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Equipo
                    <select
                      value={assignmentForm.equipmentCode}
                      onChange={(event) =>
                        updateAssignmentForm('equipmentCode', event.target.value)
                      }
                    >
                      <option value="">Seleccionar</option>
                      {equipment.map((item) => (
                        <option key={item.code} value={item.code}>
                          {item.name}
                        </option>
                      ))}
                    </select>
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
                          {assignment.labor} · {assignment.operatorName || 'Sin operador'} · {assignment.equipmentName || assignment.equipmentCode || 'Sin equipo'}
                        </span>
                      </div>
                      <div className="movement-side">
                        <span className={`status-pill ${meta.tone}`}>{meta.label}</span>
                        <small>{formatArea(assignment.area)}</small>
                      </div>
                    </div>
                  )
                })}
              </div>
            </article>
          </section>
        ) : null}

        {session.role === 'supervisor' && supervisorTab === 'tablero' ? (
          <section className="panel-card tablero-section">
            <div className="panel-title">
              <div>
                <h2>Tablero de Cumplimiento de Labores</h2>
                <p className="subtle-copy">
                  La secuencia de labores es DESPEJE-REPIQUE-RENCALLE-V-SUBSUELO-TRIPLE-FERTILIZACION-ZANJAS.
                </p>
              </div>
            </div>
            <div className="tablero-wrap">
              <table className="tablero-table">
                <thead>
                  <tr>
                    <th className="tab-sticky-col">SUERTE</th>
                    <th className="tab-meta-col">HA TOTAL</th>
                    <th className="tab-meta-col">INICIO</th>
                    <th className="tab-meta-col">DIAS</th>
                    <th className="tab-meta-col">ROT.</th>
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
                        <td className="center-cell">{row.area.toFixed(2)}</td>
                        <td className="center-cell">{firstDate}</td>
                        <td className="center-cell">1</td>
                        <td className="center-cell">DOBLE</td>
                        {WORKFLOW.map((labor) => {
                          const assignment = rowAssignments.find(
                            (item) => item.labor.toUpperCase() === labor.toUpperCase(),
                          )
                          const status = assignment?.status ?? 'PENDIENTE'
                          const cellClass =
                            status === 'COMPLETADA'
                              ? 'labor-cell-box completada'
                              : status === 'EN_PROCESO'
                                ? 'labor-cell-box en_proceso'
                                : 'labor-cell-box pendiente'

                          return (
                            <td key={labor} className="labor-cell-td">
                              <div className={cellClass}>
                                {status === 'COMPLETADA' && <span className="check">OK</span>}
                                {status === 'EN_PROCESO' && <span className="spinner">RUN</span>}
                                {(status === 'PENDIENTE' || !assignment) && (
                                  <span className="warn">NO</span>
                                )}
                                <span>
                                  {assignment
                                    ? `${assignment.area.toFixed(2)} ha`
                                    : 'No ejecutada'}
                                </span>
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
              <span className="tablero-legend-item completada"><span className="check">OK</span> Ejecutada</span>
              <span className="tablero-legend-item en_proceso"><span className="spinner">RUN</span> En ejecucion</span>
              <span className="tablero-legend-item pendiente"><span className="warn">NO</span> No ejecutada</span>
            </div>
          </section>
        ) : null}

        {session.role === 'supervisor' && supervisorTab === 'labores' ? (
          <section className="panel-card">
            <div className="panel-title split">
              <h2>Labores</h2>
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
                  <option value="TODOS">Todos los operadores</option>
                  {operators.map((operator) => (
                    <option key={operator.id} value={operator.id}>
                      {operator.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Hacienda</th>
                    <th>Suerte</th>
                    <th>Labor</th>
                    <th>Operador</th>
                    <th>Equipo</th>
                    <th>Estado</th>
                    <th>Area</th>
                    <th>Accion</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAssignments.map((assignment) => {
                    const meta = getStatusMeta(assignment.status)
                    return (
                      <tr key={assignment.id}>
                        <td>{assignment.haciendaName}</td>
                        <td>{assignment.suerte}</td>
                        <td>{assignment.labor}</td>
                        <td>{assignment.operatorName || 'Sin operador'}</td>
                        <td>{assignment.equipmentName || '-'}</td>
                        <td>
                          <span className={`status-pill ${meta.tone}`}>{meta.label}</span>
                        </td>
                        <td>{formatArea(assignment.area)}</td>
                        <td>
                          {assignment.status === 'PENDIENTE' ? (
                            <button
                              className="inline-button danger-button"
                              onClick={() => void handleCancelAssignment(assignment)}
                            >
                              Cancelar
                            </button>
                          ) : (
                            <span className="muted-text">Sin accion</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        {session.role === 'supervisor' && supervisorTab === 'equipos' ? (
          <section className="panel-card">
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
                        {assignment.labor} Â· {formatArea(assignment.area)}
                      </p>
                    </div>
                    <span className={`status-pill ${meta.tone}`}>{meta.label}</span>
                  </div>
                  <div className="active-meta">
                    <span>Equipo: {assignment.equipmentName || '-'}</span>
                    <span>Inicio: {formatTime(assignment.startedAt)}</span>
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
                      <label>
                        Ha ejecutadas
                        <input
                          value={draft?.area ?? ''}
                          onChange={(event) =>
                            updateFinishDraft(assignment.id, 'area', event.target.value)
                          }
                          placeholder={assignment.area.toFixed(1)}
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
                    <select
                      value={freeFieldForm.haciendaCode}
                      onChange={(event) => updateFreeFieldForm('haciendaCode', event.target.value)}
                    >
                      <option value="">Seleccionar</option>
                      {haciendas.map((item) => (
                        <option key={item.code} value={item.code}>
                          {item.code} - {item.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Suerte
                    <select
                      value={freeFieldForm.suerte}
                      onChange={(event) => updateFreeFieldForm('suerte', event.target.value)}
                    >
                      <option value="">Seleccionar</option>
                      {freeFieldSuertes.map((row) => (
                        <option key={`${row.haciendaCode}-${row.suerte}`} value={row.suerte}>
                          {row.suerte} Â· {formatArea(row.area)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label>
                  Labor
                  <select
                    value={freeFieldForm.labor}
                    onChange={(event) => updateFreeFieldForm('labor', event.target.value)}
                  >
                    <option value="">Seleccionar</option>
                    {WORKFLOW.map((labor) => (
                      <option key={labor} value={labor}>
                        {labor}
                        {freeFieldForm.haciendaCode && freeFieldForm.suerte
                          ? labor ===
                            getSuggestedLabor(
                              assignments,
                              `${freeFieldForm.haciendaCode}-${freeFieldForm.suerte}`,
                            )
                            ? ' â† sugerida'
                            : ''
                          : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="form-grid">
                  <label>
                    Equipo
                    <select
                      value={freeFieldForm.equipmentCode || session.equipmentCode}
                      onChange={(event) =>
                        updateFreeFieldForm('equipmentCode', event.target.value)
                      }
                    >
                      <option value="">Seleccionar</option>
                      {equipment.map((item) => (
                        <option key={item.code} value={item.code}>
                          {item.name}
                        </option>
                      ))}
                    </select>
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
            <div className="panel-title">
              <h2>Historial</h2>
            </div>
            <div className="list-rows">
              {historyAssignments.map((assignment) => {
                const meta = getStatusMeta(assignment.status)
                return (
                  <div key={assignment.id} className="movement-row">
                    <div>
                      <strong>
                        {assignment.haciendaName} - {assignment.suerte}
                      </strong>
                      <span>
                        {assignment.labor} Â· {assignment.executedArea.toFixed(1)} ha
                      </span>
                    </div>
                    <div className="movement-side">
                      <span className={`status-pill ${meta.tone}`}>{meta.label}</span>
                      <small>{formatTime(assignment.finishedAt)}</small>
                    </div>
                  </div>
                )
              })}
              {!historyAssignments.length ? (
                <p className="muted-text">Aun no hay labores cerradas.</p>
              ) : null}
            </div>
          </section>
        ) : null}

      </div>
    </main>
  )
}

export default App
