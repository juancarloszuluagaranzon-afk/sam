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

type SupervisorTab = 'resumen' | 'asignar' | 'labores' | 'equipos'
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
  const [maestroSource, setMaestroSource] = useState('fallback')
  const [assignmentsSource, setAssignmentsSource] = useState('fallback')
  const [assignmentForm, setAssignmentForm] = useState<AssignmentFormState>(EMPTY_FORM)
  const [freeFieldForm, setFreeFieldForm] = useState<AssignmentFormState>(EMPTY_FORM)
  const [supervisorTab, setSupervisorTab] = useState<SupervisorTab>('resumen')
  const [operatorTab, setOperatorTab] = useState<OperatorTab>('activas')
  const [statusFilter, setStatusFilter] = useState('TODAS')
  const [operatorFilter, setOperatorFilter] = useState('TODOS')
  const [finishDrafts, setFinishDrafts] = useState<Record<string, { area: string; notes: string }>>({})

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
        setMaestroSource(maestroResult.source)
        setAssignmentsSource(assignmentResult.source)
      })
    } catch {
      setError('No pudimos cargar toda la informacion operativa.')
    } finally {
      setLoading(false)
    }
  }

  function saveSession(user: SessionUser | null) {
    setSession(user)

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
    return assignments.filter((assignment) => assignment.operatorId === session.id)
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
    setAssignmentsSource(result.source)
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
    setBusy(true)
    setError('')

    try {
      await updateAssignment(assignment.id, {
        status: 'EN_PROCESO',
        startedAt: new Date().toISOString(),
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

  const loginOptions = useMemo(
    () =>
      [
        { id: 'U002', label: 'Alfredo Uran · Supervisor' },
        { id: 'U003', label: 'William Ortiz · Operador' },
        { id: 'U004', label: 'Ismael Reyes · Operador' },
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
            <p>
              Entramos por el panel de piloto, pero el tablero interior conserva la
              logica del MVP aprobado.
            </p>
            <ul className="auth-bullets">
              <li>Maestro: {maestroSource}</li>
              <li>Asignaciones: {assignmentsSource}</li>
              <li>Usuarios: {users.length}</li>
            </ul>
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

  const visibleAssignments =
    session.role === 'supervisor' ? filteredAssignments : operatorAssignments

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-logo">SF</div>
          <div>
            <strong>SAM Control</strong>
            <span>{session.role === 'supervisor' ? 'Supervisor' : 'Operador'}</span>
          </div>
        </div>

        <div className="topbar-actions">
          <span className="user-pill">{session.name}</span>
          <button className="ghost-button" onClick={() => saveSession(null)}>
            Salir
          </button>
        </div>
      </header>

      <div className="dashboard-shell">
        <section className="toolbar-card">
          <nav className="tab-nav" aria-label="Navegacion principal">
            {session.role === 'supervisor' ? (
              <>
                <button
                  className={supervisorTab === 'resumen' ? 'active' : ''}
                  onClick={() => setSupervisorTab('resumen')}
                >
                  Resumen
                </button>
                <button
                  className={supervisorTab === 'asignar' ? 'active' : ''}
                  onClick={() => setSupervisorTab('asignar')}
                >
                  + Asignar
                </button>
                <button
                  className={supervisorTab === 'labores' ? 'active' : ''}
                  onClick={() => setSupervisorTab('labores')}
                >
                  Labores
                </button>
                <button
                  className={supervisorTab === 'equipos' ? 'active' : ''}
                  onClick={() => setSupervisorTab('equipos')}
                >
                  Equipos
                </button>
              </>
            ) : (
              <>
                <button
                  className={operatorTab === 'activas' ? 'active' : ''}
                  onClick={() => setOperatorTab('activas')}
                >
                  Activas
                </button>
                <button
                  className={operatorTab === 'campo' ? 'active' : ''}
                  onClick={() => setOperatorTab('campo')}
                >
                  Campo libre
                </button>
                <button
                  className={operatorTab === 'historial' ? 'active' : ''}
                  onClick={() => setOperatorTab('historial')}
                >
                  Historial
                </button>
              </>
            )}
          </nav>

          <div className="toolbar-meta">
            <span className="soft-pill">Maestro: {maestroSource}</span>
            <span className="soft-pill">Asignaciones: {assignmentsSource}</span>
          </div>
        </section>

        {(error || info) && (
          <section className="message-stack">
            {error ? <div className="feedback error">{error}</div> : null}
            {info ? <div className="feedback success">{info}</div> : null}
          </section>
        )}

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
                      / {item.planned.toFixed(1)} ha · {item.count} labores
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
                          {row.suerte} · {formatArea(row.area)}
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
                            ? ' ← sugerida'
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
                          {assignment.labor} · {assignment.operatorName || 'Sin operador'}
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
                          ? `${active.operatorName} · ${active.haciendaName} ${active.suerte}`
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
          <section className="operator-stack">
            {activeAssignments.map((assignment) => {
              const meta = getStatusMeta(assignment.status)
              const draft = finishDrafts[assignment.id]
              return (
                <article key={assignment.id} className="panel-card active-card">
                  <div className="panel-title split">
                    <div>
                      <h2>
                        {assignment.haciendaName} - {assignment.suerte}
                      </h2>
                      <p className="subtle-copy">
                        {assignment.labor} · {formatArea(assignment.area)}
                      </p>
                    </div>
                    <span className={`status-pill ${meta.tone}`}>{meta.label}</span>
                  </div>
                  <div className="active-meta">
                    <span>Equipo: {assignment.equipmentName || '-'}</span>
                    <span>Inicio: {formatTime(assignment.startedAt)}</span>
                  </div>
                  {assignment.status === 'PENDIENTE' ? (
                    <button
                      className="primary-button"
                      onClick={() => void handleStartAssignment(assignment)}
                      disabled={busy}
                    >
                      Iniciar labor
                    </button>
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
          <section className="dashboard-grid two-up">
            <article className="panel-card">
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
                          {row.suerte} · {formatArea(row.area)}
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
                            ? ' ← sugerida'
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

            <article className="panel-card">
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
          <section className="panel-card">
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
                        {assignment.labor} · {assignment.executedArea.toFixed(1)} ha
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

        <section className="panel-card compact-panel">
          <div className="panel-title split">
            <h2>Lectura operativa</h2>
            <span className="muted-text">{visibleAssignments.length} registros visibles</span>
          </div>
          <div className="summary-chips">
            <span className="soft-chip">Haciendas cargadas: {haciendas.length}</span>
            <span className="soft-chip">Suertes: {maestro.length}</span>
            <span className="soft-chip">Secuencia base: {WORKFLOW.length} pasos</span>
          </div>
        </section>
      </div>
    </main>
  )
}

export default App
