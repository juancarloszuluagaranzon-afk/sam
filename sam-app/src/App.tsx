import { useMemo, useState, type FormEvent } from 'react'
import { AppDataProvider, SESSION_KEY, useAppData } from './context/AppDataContext'
import { LoginView } from './views/LoginView'
import { SupervisorView, type SupervisorTab } from './views/SupervisorView'
import { OperatorView } from './views/OperatorView'
import { SupportSwitcher } from './views/SupportSwitcher'
import { ImpersonationBar } from './components/ImpersonationBar'
import { UpdateBanner } from './components/UpdateBanner'
import { PullToRefresh } from './components/PullToRefresh'
import { matchesSummaryFilter, type SummaryQuincena } from './components/EntityHistoryModal'
import './App.css'
import type { Assignment, UserProfile } from './domain/sam'
import { appLogin, appChangePin, loadAssignments, executionDateKey, getIngenioName, getAssignmentIngenioId } from './services/samApi'
import { db } from './lib/db'

export type ReportPeriod = 'CUSTOM' | 'HOY' | 'AYER' | 'PRIMERA' | 'SEGUNDA' | 'MES'

type OperatorTab = 'activas' | 'campo' | 'historial'

// Guarda la sesión real del usuario de SOPORTE mientras impersona a otro rol,
// para poder volver. Separado de SESSION_KEY (que es la sesión EFECTIVA).
const SUPPORT_ORIGIN_KEY = 'sam:support-origin'

function isSupervisorOrOwner(role: UserProfile['role'] | undefined): boolean {
  return role === 'supervisor' || role === 'owner' || role === 'administracion'
}

function AppContent() {
  const {
    session, setSession,
    maestro,
    assignments, setAssignments,
    users,
    loading, busy, setBusy,
    error, setError,
    setInfo,
    todayKey,
    syncError, retrySync, isOnline,
  } = useAppData()

  const [isSideMenuOpen, setIsSideMenuOpen] = useState(false)
  const [isPinModalOpen, setIsPinModalOpen] = useState(false)
  const [pinForm, setPinForm] = useState({ current: '', newPin: '', confirm: '', error: '', loading: false })
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)
  // Sesión real de soporte mientras impersona (null = no está impersonando).
  const [supportOrigin, setSupportOrigin] = useState<UserProfile | null>(() => {
    try {
      const raw = window.localStorage.getItem(SUPPORT_ORIGIN_KEY)
      return raw ? (JSON.parse(raw) as UserProfile) : null
    } catch {
      return null
    }
  })
  const [supervisorTab, setSupervisorTab] = useState<SupervisorTab>(() => {
    const tab = new URLSearchParams(window.location.search).get('tab')
    const valid: SupervisorTab[] = ['resumen', 'asignar', 'labores', 'equipos', 'tablero', 'reporte', 'usuarios', 'validacion', 'maestros']
    return valid.includes(tab as SupervisorTab) ? (tab as SupervisorTab) : 'labores'
  })
  const [operatorTab, setOperatorTab] = useState<OperatorTab>(() => {
    const tab = new URLSearchParams(window.location.search).get('tab')
    const valid: OperatorTab[] = ['activas', 'campo', 'historial']
    return valid.includes(tab as OperatorTab) ? (tab as OperatorTab) : 'activas'
  })
  const [historyMonth, setHistoryMonth] = useState(() =>
    new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' }).slice(0, 7)
  )
  const [historyPeriod, setHistoryPeriod] = useState<'Q1' | 'Q2' | 'MES'>('MES')
  const [statusFilter, setStatusFilter] = useState('TODAS')
  const [operatorFilter, setOperatorFilter] = useState('TODOS')
  const [ingenioFilter, setIngenioFilter] = useState('TODOS')
  const [haciendaFilter, setHaciendaFilter] = useState('TODAS')
  // Texto de la barra de busqueda de la pestana Labores. Busca de forma
  // libre en hacienda, suerte, labor y operario (ver filteredAssignments).
  const [laborSearch, setLaborSearch] = useState('')
  const [selectedLabor, setSelectedLabor] = useState<Assignment | null>(null)
  const [reportFilters, setReportFilters] = useState({
    period: 'MES' as ReportPeriod,
    view: 'labor' as 'labor' | 'maquina',
    // Mes (YYYY-MM) al que aplican los períodos PRIMERA/SEGUNDA/MES. Default =
    // mes actual; permite filtrar el mes anterior o cualquier otro.
    mes: new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' }).slice(0, 7),
    desde: '',
    hasta: '',
    // sentinels vacíos = "todos"; con SearchableSelect el placeholder item
    // borra a ''. Las comparaciones en filteredReport usan truthy check.
    estado: '',
    haciendaCode: '',
    suerte: '',
    operatorId: '',
    ingenioId: '',
  })
  const [tableroMonth, setTableroMonth] = useState(() =>
    new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' }).slice(0, 7)
  )
  const [tableroZone, setTableroZone] = useState<'TODAS' | 'NORTE' | 'SUR'>('TODAS')
  const [tableroIngenio, setTableroIngenio] = useState<string>('TODOS')

  function saveSession(user: UserProfile | null) {
    setSession(user ? { ...user } : null)
    setIsSideMenuOpen(false)
    if (user) {
      window.localStorage.setItem(SESSION_KEY, JSON.stringify(user))
    } else {
      window.localStorage.removeItem(SESSION_KEY)
    }
  }

  // Soporte entra a la app COMO otro usuario (impersonación). Guarda su sesión
  // real para poder volver, e intercambia la sesión efectiva por la del usuario.
  function enterImpersonation(profile: UserProfile) {
    if (session) {
      setSupportOrigin(session)
      try {
        window.localStorage.setItem(SUPPORT_ORIGIN_KEY, JSON.stringify(session))
      } catch {
        /* localStorage bloqueado: la barra flotante igual permite volver en esta sesión */
      }
    }
    saveSession(profile)
  }

  // Cambia la vista a otro usuario SIN salir del modo soporte: solo intercambia
  // la sesión efectiva; supportOrigin (el soporte real) se mantiene intacto.
  function switchImpersonation(profile: UserProfile) {
    saveSession(profile)
  }

  // Vuelve del modo impersonación a la pantalla de soporte.
  function exitImpersonation() {
    const origin = supportOrigin
    setSupportOrigin(null)
    try {
      window.localStorage.removeItem(SUPPORT_ORIGIN_KEY)
    } catch {
      /* ignore */
    }
    if (origin) saveSession(origin)
  }

  const filteredAssignments = useMemo(() => {
    return assignments.filter((assignment) => {
      if (statusFilter === 'POR_APROBAR') {
        if (assignment.approval !== 'PENDIENTE') return false
        if (session && assignment.supervisorId !== session.id) return false
      } else if (statusFilter === 'TODAS') {
        // Cada día arranca limpio: solo sobreviven las EN_PROCESO (siguen "en uso").
        // El resto solo se ve si es del día actual.
        if (assignment.status !== 'EN_PROCESO' && assignment.dateKey !== todayKey) return false
      } else if (assignment.status !== statusFilter) {
        return false
      }
      if (operatorFilter !== 'TODOS' && assignment.operatorId !== operatorFilter) return false
      if (haciendaFilter !== 'TODAS' && assignment.haciendaCode !== haciendaFilter) return false
      if (ingenioFilter !== 'TODOS') {
        const row = maestro.find(
          (r) => r.haciendaCode === assignment.haciendaCode && r.suerte === assignment.suerte,
        )
        if (!row || row.ingenio_id !== ingenioFilter) return false
      }
      // Busqueda libre por hacienda, suerte, labor u operario. Se aplica
      // de ultimo para acotar el resultado ya filtrado por los selects.
      if (laborSearch.trim()) {
        const q = laborSearch.trim().toLowerCase()
        const haystack = `${assignment.haciendaName} ${assignment.suerte} ${assignment.labor} ${assignment.operatorName}`.toLowerCase()
        if (!haystack.includes(q)) return false
      }
      return true
    })
  }, [assignments, operatorFilter, statusFilter, haciendaFilter, ingenioFilter, laborSearch, maestro, todayKey, session])

  const haciendaFilterOptions = useMemo(() => {
    const codes = new Map<string, string>()
    assignments.forEach((a) => {
      if (ingenioFilter !== 'TODOS') {
        const row = maestro.find((r) => r.haciendaCode === a.haciendaCode)
        if (!row || row.ingenio_id !== ingenioFilter) return
      }
      if (!codes.has(a.haciendaCode)) codes.set(a.haciendaCode, a.haciendaName)
    })
    return Array.from(codes.entries()).map(([code, name]) => ({ code, name }))
  }, [assignments, ingenioFilter, maestro])

  const recentAssignments = useMemo(() => assignments.slice(0, 8), [assignments])

  const tableroAssignments = useMemo(() => {
    return assignments.filter((a) => {
      if (a.status === 'CANCELADA') return false
      if (session?.role === 'supervisor' && a.supervisorId !== session.id) return false
      if (tableroMonth && !a.dateKey.startsWith(tableroMonth)) return false
      if (tableroZone !== 'TODAS' && a.zone !== tableroZone) return false
      return true
    })
  }, [assignments, session, tableroMonth, tableroZone])

  const programmedSuerteRows = useMemo(() => {
    const programmedKeys = new Set(
      tableroAssignments.map((a) => `${a.haciendaCode}-${a.suerte}`),
    )
    return maestro
      .filter((row) => programmedKeys.has(`${row.haciendaCode}-${row.suerte}`))
      .filter((row) => tableroIngenio === 'TODOS' || row.ingenio_id === tableroIngenio)
      .sort(
        (a, b) =>
          String(a.haciendaCode).localeCompare(String(b.haciendaCode)) ||
          a.suerte.localeCompare(b.suerte),
      )
  }, [tableroAssignments, maestro, tableroIngenio])

  const filteredReport = useMemo(() => {
    // El reporte agrupa por fecha de EJECUCIÓN (fecha_fin para COMPLETADA,
    // fecha_inicio para EN_PROCESO, created_at como fallback). Ver executionDateKey.
    const currentMonth = todayKey.slice(0, 7)
    // El mes seleccionado aplica a PRIMERA/SEGUNDA/MES (permite mes anterior y
    // cualquier mes). HOY ignora el mes (usa todayKey vía matchesSummaryFilter).
    const periodMonth = reportFilters.mes || currentMonth
    // "Ayer" = todayKey - 1 día (aritmética sobre la fecha de Bogotá; maneja
    // bien el cambio de mes/año).
    const [ty, tm, td] = todayKey.split('-').map(Number)
    const yDate = new Date(ty, tm - 1, td - 1)
    const yesterdayKey = `${yDate.getFullYear()}-${String(yDate.getMonth() + 1).padStart(2, '0')}-${String(yDate.getDate()).padStart(2, '0')}`
    return assignments
      .filter((a) => {
        const execDate = executionDateKey(a)
        // Filtro de período: CUSTOM usa desde/hasta manuales, AYER compara contra
        // ayer, los demás usan matchesSummaryFilter (misma lógica que el Resumen).
        if (reportFilters.period === 'CUSTOM') {
          if (reportFilters.desde && execDate < reportFilters.desde) return false
          if (reportFilters.hasta && execDate > reportFilters.hasta) return false
        } else if (reportFilters.period === 'AYER') {
          if (execDate !== yesterdayKey) return false
        } else {
          const quincena: SummaryQuincena =
            reportFilters.period === 'HOY' ? 'HOY' :
            reportFilters.period === 'PRIMERA' ? 'PRIMERA' :
            reportFilters.period === 'SEGUNDA' ? 'SEGUNDA' :
            'TODO' // MES = todo el mes seleccionado
          if (!matchesSummaryFilter(execDate, periodMonth, quincena, todayKey)) return false
        }
        if (reportFilters.estado && a.status !== reportFilters.estado) return false
        if (reportFilters.haciendaCode && a.haciendaCode !== reportFilters.haciendaCode) return false
        if (reportFilters.suerte && a.suerte !== reportFilters.suerte) return false
        if (reportFilters.operatorId && a.operatorId !== reportFilters.operatorId) return false
        if (reportFilters.ingenioId) {
          const ingId = getAssignmentIngenioId(a, maestro)
          if (ingId !== reportFilters.ingenioId) return false
        }
        return true
      })
      .sort((a, b) => executionDateKey(b).localeCompare(executionDateKey(a)))
  }, [assignments, reportFilters, todayKey, maestro])

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

  async function handleLogin(userId: string, pin: string) {
    setBusy(true)
    setError('')
    try {
      const user = await appLogin(userId, pin)

      // Al loguear un usuario, invalidamos el cache local de asignaciones y
      // forzamos full sync desde Supabase. Sin esto un device con cache stale
      // (de otra sesion previa o de un bundle anterior) puede ocultarle al
      // operario asignaciones que el supervisor acaba de crearle.
      try {
        await db.assignments.clear()
        await db.meta.delete('assignments_last_sync')
        const fresh = await loadAssignments()
        setAssignments(fresh.data)
      } catch {
        // Si falla el resync (offline, etc.) seguimos: el useSync hara
        // delta sync apenas vuelva la conexion.
      }

      saveSession(user)
      setInfo(`Sesion iniciada para ${user.name}.`)
      if (isSupervisorOrOwner(user.role)) {
        setSupervisorTab('labores')
      } else {
        setOperatorTab('activas')
      }
    } catch (err) {
      // Distinguir "credenciales malas" (BD respondio, hash no coincide) de
      // "no se pudo contactar al servidor" (timeout, DNS, VPS caido). Antes
      // mostrabamos "credenciales invalidas" para CUALQUIER error y eso hacia
      // que un VPS caido pareciera un problema de PIN — los operadores se
      // confundian y reportaban "no funciona mi clave" cuando el servidor
      // estaba muerto.
      const msg = err instanceof Error ? err.message.toLowerCase() : ''
      const isNetworkError =
        msg.includes('fetch') ||
        msg.includes('network') ||
        msg.includes('timeout') ||
        msg.includes('failed to fetch') ||
        msg.includes('load failed')
      if (isNetworkError || !navigator.onLine) {
        setError(
          'No pudimos contactar al servidor. Revisa tu conexion e intenta de nuevo en un momento.',
        )
      } else {
        setError('Credenciales invalidas. Revisa el usuario y el PIN.')
      }
    } finally {
      setBusy(false)
    }
  }

  async function handleDownloadReport() {
    if (filteredReport.length === 0) return
    setBusy(true)
    setError('')
    try {
      const { utils, writeFile } = await import('xlsx')
      const rows = filteredReport.map((a) => ({
        'Fecha (ejecución)': executionDateKey(a),
        'Fecha asignación': a.dateKey,
        'Hacienda': a.haciendaName,
        'Suerte': a.suerte,
        'Código Suerte': a.suerteCode,
        'Labor': a.labor,
        'Área Plan. (ha)': a.area,
        'Área Ejec. (ha)': a.executedArea > 0 ? a.executedArea : '',
        'Estado': a.status,
        'Cliente': a.cliente === 'ingenios' ? 'Ingenio' : a.cliente === 'proveedores' ? 'Proveedor' : '—',
        'Ingenio': getIngenioName(a, maestro) ?? '—',
        'Operador': a.operatorName,
        'Supervisor': a.supervisorId,
        'Equipo': a.equipmentName,
        'Inicio': a.startedAt ?? '',
        'Fin': a.finishedAt ?? '',
        'Horometro Ini': a.horometroInicial ?? '',
        'Horometro Fin': a.horometroFinal ?? '',
        'Zona': a.zone ?? '',
        'Tipo': a.kind,
        'Aprobación': a.approval,
        'Aprobado por': a.approvedBy ?? '',
        'Aprobado en': a.approvedAt ?? '',
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

  if (loading) {
    return (
      <main className="app-shell loading-shell">
        <div className="loading-card">
          <p className="eyebrow">ASM Control</p>
          <h1>Cargando operacion...</h1>
          <p>Estamos leyendo maestro, asignaciones y catalogos desde la base.</p>
        </div>
      </main>
    )
  }

  if (!session) {
    return (
      <LoginView
        users={users}
        onLogin={handleLogin}
        loading={busy}
        error={error}
      />
    )
  }

  // Rol SOPORTE sin impersonar → pantalla "Ver como" para elegir a quién ver.
  if (session.role === 'soporte') {
    return (
      <SupportSwitcher
        me={session}
        users={users}
        onView={enterImpersonation}
        onLogout={() => saveSession(null)}
      />
    )
  }

  const syncErrorBanner = syncError && isOnline ? (
    <div className="sync-error-banner" role="alert">
      <span>
        <strong>No pudimos cargar tus asignaciones.</strong>{' '}
        Estás viendo el cache local. {syncError}
      </span>
      <button
        type="button"
        className="sync-error-retry"
        onClick={retrySync}
      >
        Reintentar
      </button>
    </div>
  ) : null

  // Barra flotante cuando soporte está impersonando: indica el modo, permite
  // SALTAR a otra vista/rol al vuelo y volver a soporte.
  const impersonationBar = supportOrigin ? (
    <ImpersonationBar
      current={session}
      users={users}
      onSwitch={switchImpersonation}
      onExit={exitImpersonation}
    />
  ) : null

  if (isSupervisorOrOwner(session.role)) {
    return (
      <>
        {impersonationBar}
        {syncErrorBanner}
        <SupervisorView
        isSideMenuOpen={isSideMenuOpen}
        setIsSideMenuOpen={setIsSideMenuOpen}
        isPinModalOpen={isPinModalOpen}
        setIsPinModalOpen={setIsPinModalOpen}
        pinForm={pinForm}
        setPinForm={setPinForm}
        recentAssignments={recentAssignments}
        programmedSuerteRows={programmedSuerteRows}
        tableroAssignments={tableroAssignments}
        tableroMonth={tableroMonth}
        setTableroMonth={setTableroMonth}
        tableroZone={tableroZone}
        setTableroZone={setTableroZone}
        tableroIngenio={tableroIngenio}
        setTableroIngenio={setTableroIngenio}
        filteredAssignments={filteredAssignments}
        filteredReport={filteredReport}
        haciendaFilterOptions={haciendaFilterOptions}
        supervisorTab={supervisorTab}
        setSupervisorTab={setSupervisorTab}
        moreMenuOpen={moreMenuOpen}
        setMoreMenuOpen={setMoreMenuOpen}
        selectedLabor={selectedLabor}
        setSelectedLabor={setSelectedLabor}
        statusFilter={statusFilter}
        setStatusFilter={setStatusFilter}
        operatorFilter={operatorFilter}
        setOperatorFilter={setOperatorFilter}
        ingenioFilter={ingenioFilter}
        setIngenioFilter={setIngenioFilter}
        haciendaFilter={haciendaFilter}
        setHaciendaFilter={setHaciendaFilter}
        laborSearch={laborSearch}
        setLaborSearch={setLaborSearch}
        reportFilters={reportFilters}
        setReportFilters={setReportFilters}
        onSaveSession={saveSession}
        handleChangePin={handleChangePin}
        handleDownloadReport={handleDownloadReport}
      />
      </>
    )
  }

  return (
    <>
      {impersonationBar}
      {syncErrorBanner}
      <OperatorView
      operatorTab={operatorTab}
      setOperatorTab={setOperatorTab}
      isSideMenuOpen={isSideMenuOpen}
      setIsSideMenuOpen={setIsSideMenuOpen}
      isPinModalOpen={isPinModalOpen}
      setIsPinModalOpen={setIsPinModalOpen}
      historyMonth={historyMonth}
      setHistoryMonth={setHistoryMonth}
      historyPeriod={historyPeriod}
      setHistoryPeriod={setHistoryPeriod}
      pinForm={pinForm}
      setPinForm={setPinForm}
      handleChangePin={handleChangePin}
      onSaveSession={saveSession}
    />
    </>
  )
}

function App() {
  return (
    <AppDataProvider>
      <AppContent />
      <UpdateBanner />
      <PullToRefresh />
    </AppDataProvider>
  )
}

export default App
