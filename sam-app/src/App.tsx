import { useMemo, useState, type FormEvent } from 'react'
import { AppDataProvider, SESSION_KEY, useAppData } from './context/AppDataContext'
import { LoginView } from './views/LoginView'
import { SupervisorView, type SupervisorTab } from './views/SupervisorView'
import { OperatorView } from './views/OperatorView'
import './App.css'
import type { Assignment, UserProfile } from './domain/sam'
import { appLogin, appChangePin } from './services/samApi'

type OperatorTab = 'activas' | 'campo' | 'historial'

function isSupervisorOrOwner(role: UserProfile['role'] | undefined): boolean {
  return role === 'supervisor' || role === 'owner' || role === 'administracion'
}

function AppContent() {
  const {
    session, setSession,
    maestro,
    assignments,
    users,
    loading, busy, setBusy,
    error, setError,
    setInfo,
    todayKey,
  } = useAppData()

  const [isSideMenuOpen, setIsSideMenuOpen] = useState(false)
  const [isPinModalOpen, setIsPinModalOpen] = useState(false)
  const [pinForm, setPinForm] = useState({ current: '', newPin: '', confirm: '', error: '', loading: false })
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)
  const [supervisorTab, setSupervisorTab] = useState<SupervisorTab>(() => {
    const tab = new URLSearchParams(window.location.search).get('tab')
    const valid: SupervisorTab[] = ['resumen', 'asignar', 'labores', 'equipos', 'tablero', 'reporte', 'usuarios']
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
  const [selectedLabor, setSelectedLabor] = useState<Assignment | null>(null)
  const [reportFilters, setReportFilters] = useState({
    desde: '',
    hasta: '',
    estado: 'TODAS',
    haciendaCode: '',
    operatorId: 'TODOS',
  })
  const [tableroMonth, setTableroMonth] = useState(() =>
    new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' }).slice(0, 7)
  )
  const [tableroZone, setTableroZone] = useState<'TODAS' | 'NORTE' | 'SUR'>('TODAS')

  function saveSession(user: UserProfile | null) {
    setSession(user ? { ...user } : null)
    setIsSideMenuOpen(false)
    if (user) {
      window.localStorage.setItem(SESSION_KEY, JSON.stringify(user))
    } else {
      window.localStorage.removeItem(SESSION_KEY)
    }
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
      return true
    })
  }, [assignments, operatorFilter, statusFilter, haciendaFilter, ingenioFilter, maestro, todayKey, session])

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
      .sort(
        (a, b) =>
          String(a.haciendaCode).localeCompare(String(b.haciendaCode)) ||
          a.suerte.localeCompare(b.suerte),
      )
  }, [tableroAssignments, maestro])

  const filteredReport = useMemo(() => {
    return assignments
      .filter((a) => {
        if (reportFilters.desde && a.dateKey < reportFilters.desde) return false
        if (reportFilters.hasta && a.dateKey > reportFilters.hasta) return false
        if (reportFilters.estado !== 'TODAS' && a.status !== reportFilters.estado) return false
        if (reportFilters.haciendaCode && a.haciendaCode !== reportFilters.haciendaCode) return false
        if (reportFilters.operatorId !== 'TODOS' && a.operatorId !== reportFilters.operatorId) return false
        return true
      })
      .sort((a, b) => b.dateKey.localeCompare(a.dateKey))
  }, [assignments, reportFilters])

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

  if (isSupervisorOrOwner(session.role)) {
    return (
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
        reportFilters={reportFilters}
        setReportFilters={setReportFilters}
        onSaveSession={saveSession}
        handleChangePin={handleChangePin}
        handleDownloadReport={handleDownloadReport}
      />
    )
  }

  return (
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
  )
}

function App() {
  return (
    <AppDataProvider>
      <AppContent />
    </AppDataProvider>
  )
}

export default App
