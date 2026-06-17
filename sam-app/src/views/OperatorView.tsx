import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useAppData } from '../context/AppDataContext'
import { useAssignmentActions } from '../hooks/useAssignmentActions'
import { useFreeFieldForm } from '../hooks/useFreeFieldForm'
import { usePhotoUpload } from '../hooks/usePhotoUpload'
import logoAgromorales from '../assets/logo-agromorales.jpeg'
import SearchableSelect from '../components/SearchableSelect'
import { DictateButton } from '../components/DictateButton'
import { DictateInlineButton } from '../components/DictateInlineButton'
import { dictationErrorMessage } from '../hooks/useDictation'
import { DiagnosticModal } from '../components/DiagnosticModal'
import { ThemeToggle } from '../components/ThemeToggle'
import { NewSuerteModal } from '../components/NewSuerteModal'
import { parseSpokenNumber, findItemByVoice } from '../utils/voiceParser'
import { isSameCycle } from '../utils/suerteCycle'
import { WORKFLOW } from '../data/constants'
import type { Assignment, UserProfile } from '../domain/sam'
import { formatTime, executionDateKey, formatExecutionDate, setOperarioNovedades, NOVEDAD_TIPOS, NOVEDAD_LABEL, type NovedadTipo } from '../services/samApi'

type OperatorTab = 'activas' | 'campo' | 'historial'

// Lista de fechas 'YYYY-MM-DD' entre desde y hasta (inclusive). Para reportar
// novedades (vacaciones/taller) por rango. Guard de 400 días por seguridad.
function datesInRange(desde: string, hasta: string): string[] {
  if (!desde || !hasta || desde > hasta) return []
  const [y1, m1, d1] = desde.split('-').map(Number)
  const [y2, m2, d2] = hasta.split('-').map(Number)
  const out: string[] = []
  let cur = new Date(y1, m1 - 1, d1)
  const end = new Date(y2, m2 - 1, d2)
  let guard = 0
  while (cur <= end && guard < 400) {
    out.push(
      `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`,
    )
    cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 1)
    guard++
  }
  return out
}

const NOV_ICON: Record<NovedadTipo, string> = {
  V: '🏖️',
  T: '🔧',
  NP: '⛔',
  D: '😴',
  P: '📄',
  C: '🚚',
}

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

function getRemainingArea(
  assignments: Assignment[],
  suerteCode: string,
  labor: string,
  totalArea: number,
  todayKey: string,
): number {
  const executed = assignments
    .filter(
      (a) =>
        a.suerteCode === suerteCode &&
        normalizeText(a.labor) === normalizeText(labor) &&
        // Solo descontar avance del CICLO ACTUAL (ventana de dias respecto a
        // hoy). Asi un re-laboreo meses despues arranca con el area completa
        // disponible, pero un avance reciente (mismo ciclo) si se descuenta.
        isSameCycle(a.dateKey, todayKey) &&
        // PARCIAL aporta tambien al area ejecutada de la suerte
        (a.status === 'COMPLETADA' || a.status === 'PARCIAL'),
    )
    .reduce((sum, a) => sum + (a.executedArea ?? 0), 0)
  return Math.max(0, totalArea - executed)
}

/**
 * Calcula el avance "a nivel de suerte+labor" para una asignacion del
 * operario en su CICLO ACTUAL. Si varios operarios estan trabajando la
 * misma suerte+labor en el MISMO CICLO, comparten un mismo "remaining" —
 * lo hecho por el companero consume el area planificada del ciclo.
 *
 * El ciclo se agrupa con `isSameCycle` (ventana tolerante en dias), NO con
 * `dateKey` exacto. Esto es clave para labores TOMADAS EN CAMPO: dos
 * operarios que toman la misma suerte en dias distintos pertenecen al mismo
 * ciclo y su avance se suma para cerrar la labor (antes, con dateKey exacto,
 * cada uno veia solo su parte y la labor nunca cerraba). Un re-laboreo meses
 * despues (ej: DESPEJE en marzo y otro en mayo) queda FUERA de la ventana y
 * sigue siendo un CICLO DISTINTO — el viejo no consume area del nuevo.
 *
 * Sincronizado en tiempo real via Realtime: cuando otro operario notifica
 * 5 ha y la suerte total son 10, este operario ve "Falta 5 ha" sin recargar.
 */
function getSuerteProgress(assignment: Assignment, allAssignments: Assignment[]) {
  const sameSuerteLabor = allAssignments.filter(
    (a) =>
      a.suerteCode === assignment.suerteCode &&
      normalizeText(a.labor) === normalizeText(assignment.labor) &&
      isSameCycle(a.dateKey, assignment.dateKey) &&
      // EN_PROCESO también cuenta su `executedArea`: una PARCIAL re-iniciada
      // (el operario vuelve a poner horómetro inicial para retomar) pasa a
      // EN_PROCESO conservando su avance previo; si no se contara, su área ya
      // hecha "desaparecería" del cálculo del restante mientras la retoma. Un
      // EN_PROCESO recién iniciado tiene executedArea=0, así que suma 0 (inocuo).
      (a.status === 'COMPLETADA' || a.status === 'PARCIAL' || a.status === 'EN_PROCESO'),
  )
  const executedTotal = sameSuerteLabor.reduce((sum, a) => sum + (a.executedArea ?? 0), 0)
  const ownExecuted = assignment.executedArea ?? 0
  const sharedExecuted = Math.max(0, executedTotal - ownExecuted)
  // Area TOTAL de la suerte en el ciclo = el MAX de las areas del ciclo. La
  // primera toma (o la ASIGNADA) lleva el area completa; una RE-TOMA del
  // restante (tras liberar un parcial) lleva solo lo que faltaba. Usar
  // `assignment.area` directo en una re-toma restaria dos veces lo ya hecho
  // y dejaria remaining=0 (la card desapareceria como "zombie" al instante).
  const suerteTotalArea = Math.max(
    assignment.area,
    ...allAssignments
      .filter(
        (a) =>
          a.suerteCode === assignment.suerteCode &&
          normalizeText(a.labor) === normalizeText(assignment.labor) &&
          isSameCycle(a.dateKey, assignment.dateKey) &&
          a.status !== 'CANCELADA',
      )
      .map((a) => a.area),
  )
  const remaining = Math.max(0, suerteTotalArea - executedTotal)
  return {
    executedTotal,
    sharedExecuted,
    ownExecuted,
    remaining,
    hasProgress: executedTotal > 0,
    hasSharedProgress: sharedExecuted > 0,
  }
}

function getSuggestedLabor(assignments: Assignment[], suerteCode: string) {
  // Solo COMPLETADA cuenta como "labor cerrada" para sugerir la siguiente.
  // Una PARCIAL todavia esta abierta y deberia ser la sugerida si existe.
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
  if (assignment.status === 'PARCIAL') {
    return { label: 'Parcial', tone: 'progress' as const }
  }
  if (assignment.status === 'COMPLETADA') {
    // Compatibilidad: filas historicas que se cerraron como COMPLETADA
    // antes de la migracion a status PARCIAL siguen mostrandose con su
    // label correcto.
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
  const { session, assignments, setAssignments, sortedEquipment, isOnline, outboxCount, busy, error, info, todayKey, setError, maestro, setMaestro, setInfo, fieldLabores } = useAppData()
  const [isNewSuerteOpen, setIsNewSuerteOpen] = useState(false)
  const [isDiagOpen, setIsDiagOpen] = useState(false)

  // Novedades del operario: reportar Vacaciones (V) o Taller (T) por rango de
  // fechas → se marcan en la Planilla.
  const [novedadModal, setNovedadModal] = useState<NovedadTipo | null>(null)
  const [novDesde, setNovDesde] = useState('')
  const [novHasta, setNovHasta] = useState('')
  const [savingNov, setSavingNov] = useState(false)

  async function submitNovedad() {
    if (!session || !novedadModal) return
    const fechas = datesInRange(novDesde, novHasta)
    if (fechas.length === 0) {
      setError('Selecciona una fecha de inicio y fin válidas.')
      return
    }
    setSavingNov(true)
    setError('')
    try {
      await setOperarioNovedades(session.id, fechas, novedadModal)
      setInfo(
        `${NOVEDAD_LABEL[novedadModal]} reportado (${fechas.length} día${fechas.length === 1 ? '' : 's'}).`,
      )
      setNovedadModal(null)
      setNovDesde('')
      setNovHasta('')
    } catch {
      setError('No se pudo reportar la novedad. Revisa la conexión.')
    } finally {
      setSavingNov(false)
    }
  }

  function openNovedad(tipo: NovedadTipo) {
    setNovDesde(todayKey)
    setNovHasta(todayKey)
    setError('')
    setNovedadModal(tipo)
  }

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
    releaseAssignment: onReleaseAssignment,
  } = useAssignmentActions()

  // Labor que el operario esta a punto de liberar (rechazar): dispara el
  // modal de confirmacion para evitar soltarla por un toque accidental.
  const [releaseTarget, setReleaseTarget] = useState<Assignment | null>(null)

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
        (a.dateKey === todayKey ||
          ((a.status === 'COMPLETADA' || a.status === 'PARCIAL') &&
            todayBogota(a.finishedAt) === todayKey)),
    )
    const todayPlanned = relevant.reduce((sum, a) => sum + a.area, 0)
    // Las PARCIAL siguen activas pero el area que ya se hizo cuenta como
    // ejecutada — el supervisor quiere ver el avance real, no solo lo cerrado.
    const todayExecuted = relevant
      .filter((a) => a.status === 'COMPLETADA' || a.status === 'PARCIAL')
      .reduce((sum, a) => sum + a.executedArea, 0)
    const completion = todayPlanned ? Math.round((todayExecuted / todayPlanned) * 100) : 0
    const inProgress = relevant.filter((a) => a.status === 'EN_PROCESO').length
    const pending = relevant.filter((a) => a.status === 'PENDIENTE').length
    return { todayPlanned, todayExecuted, completion, inProgress, pending }
  }, [operatorAssignments, todayKey])

  const activeAssignments = useMemo(
    () =>
      operatorAssignments
        .filter(
          (a) =>
            (a.status === 'PENDIENTE' || a.status === 'EN_PROCESO' || a.status === 'PARCIAL') &&
            // Liberada por el operario: no la mostramos en SUS Activas (sigue
            // abierta para el supervisor / re-toma en campo).
            !a.liberada,
        )
        // Si la suerte ya esta completa por trabajo conjunto en el mismo ciclo
        // (remaining = 0 a nivel global de la suerte), no hay nada que el
        // operario pueda hacer aqui — la asignacion sigue en DB con su
        // executedArea propio pero no debe aparecer en Activas. El operario
        // la vera en Historial con su aporte (5.00 ha) y el sistema preserva
        // la atribucion. Aplica tanto a PARCIAL propia como a PENDIENTE puras
        // (operario asignado que no aporto pero la suerte ya cerro).
        .filter((a) => {
          const progress = getSuerteProgress(a, assignments)
          // Si la propia esta EN_PROCESO la dejamos siempre (operario adentro)
          if (a.status === 'EN_PROCESO') return true
          return progress.remaining > 0
        }),
    [operatorAssignments, assignments],
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

  // Cuando el operario abre una labor con avance (propio O compartido con
  // otro operario), pre-llenar el input con el AREA RESTANTE de la suerte.
  // El operario ingresa "cuanto hizo en esta sesion". Al finalizar el valor
  // se SUMA al executedArea previo (logica en finishAssignment).
  useEffect(() => {
    if (!selectedActiveAssignment) return
    const progress = getSuerteProgress(selectedActiveAssignment, assignments)
    if (!progress.hasProgress) return
    setFinishDrafts((current) => {
      const existing = current[selectedActiveAssignment.id]
      if (existing && existing.area !== '') return current
      return {
        ...current,
        [selectedActiveAssignment.id]: {
          area: progress.remaining.toFixed(2),
          notes: existing?.notes ?? '',
          horometroFinal: existing?.horometroFinal ?? '',
          isComplete: existing?.isComplete ?? false,
        },
      }
    })
  }, [selectedActiveAssignment, assignments, setFinishDrafts])


  // Historial incluye COMPLETADA + CANCELADA + PARCIAL. Las PARCIAL aparecen
  // tambien en "Activas" (siguen abiertas), pero el operario necesita ver
  // su avance en el historial para entender cuanto lleva hecho del mes.
  // Los KPIs (ha ejecutadas, eficiencia) suman PARCIAL; el conteo
  // "completadas" sigue contando solo cierres definitivos.
  const historyAssignments = useMemo(
    () =>
      operatorAssignments.filter(
        (a) => a.status === 'COMPLETADA' || a.status === 'CANCELADA' || a.status === 'PARCIAL',
      ),
    [operatorAssignments],
  )

  // "Tu quincena": acumulado de la QUINCENA EN CURSO (1-15 o 16-fin del mes
  // actual), alineado con como se paga/reporta. Antes la tarjeta sumaba TODO el
  // historial (mislabel "Tu jornada"). Usa executionDateKey igual que el resto:
  // una labor cuenta el dia en que se ejecuto (fin/inicio segun estado).
  const quincenaHistory = useMemo(() => {
    const month = todayKey.slice(0, 7)
    const day = Number(todayKey.slice(8, 10))
    const start = day >= 16 ? 16 : 1
    const end = day >= 16 ? 31 : 15
    return historyAssignments.filter((a) => {
      const k = executionDateKey(a)
      if (!k.startsWith(month)) return false
      const d = Number(k.slice(8, 10))
      return d >= start && d <= end
    })
  }, [historyAssignments, todayKey])

  const quincenaLabel = useMemo(() => {
    const day = Number(todayKey.slice(8, 10))
    const monthName = new Date(
      Number(todayKey.slice(0, 4)),
      Number(todayKey.slice(5, 7)) - 1,
      1,
    ).toLocaleDateString('es-CO', { month: 'long' })
    return `${day >= 16 ? '2da' : '1ra'} quincena de ${monthName}`
  }, [todayKey])

  const historyMonths = useMemo(() => {
    const set = new Set<string>()
    // Usar la fecha de EJECUCIÓN (igual que filteredHistory), NO la de creación.
    // Una labor creada el 31-may pero finalizada el 1-jun se EJECUTA en junio:
    // si el desplegable se armara por `dateKey` (creación = mayo), junio nunca
    // saldría como opción y la labor quedaba invisible (no está en mayo porque
    // su ejecución es junio, y junio no era seleccionable). Deben coincidir.
    historyAssignments.forEach((a) => {
      const k = executionDateKey(a)
      if (k) set.add(k.slice(0, 7))
    })
    return Array.from(set).sort((a, b) => b.localeCompare(a))
  }, [historyAssignments])

  // El Historial arranca en el MES ACTUAL (default en App.tsx). Al cambiar de
  // mes (ej. 1-jun) ese mes nuevo esta vacio y "desaparece" el historial de la
  // quincena pasada aunque el dato siga en la base. Si el mes seleccionado NO
  // tiene labores del operario pero SI hay historial en otros meses, saltamos
  // automaticamente al mes mas reciente con datos.
  useEffect(() => {
    if (historyMonths.length > 0 && !historyMonths.includes(historyMonth)) {
      setHistoryMonth(historyMonths[0])
    }
  }, [historyMonths, historyMonth, setHistoryMonth])

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

  // Callback compartido para todos los botones de dictado: muestra al
  // operario un mensaje en español si el dictado falla (permiso denegado,
  // sin microfono, etc) en lugar de fallar en silencio.
  const handleDictateError = (err: string) => {
    setError(dictationErrorMessage(err))
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

      {novedadModal && (
        <div className="modal-overlay open" onClick={() => { if (!savingNov) setNovedadModal(null) }}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 'min(420px, calc(100vw - 32px))' }}>
            <div className="labor-detail-header">
              <div>
                <p className="eyebrow">Novedad</p>
                <h3>{NOV_ICON[novedadModal]} Reportar {NOVEDAD_LABEL[novedadModal].toLowerCase()}</h3>
              </div>
              <button type="button" className="modal-close-btn" onClick={() => setNovedadModal(null)} disabled={savingNov} aria-label="Cerrar">&#x2715;</button>
            </div>
            <p className="subtle-copy" style={{ marginTop: 0 }}>
              Los días seleccionados quedarán marcados como <strong>{novedadModal}</strong> en la planilla.
              {novedadModal === 'T' ? ' Si es solo hoy, deja las dos fechas iguales.' : ''}
            </p>
            <div className="novedad-fields">
              <label>
                <span>Desde</span>
                <input type="date" value={novDesde} max={novHasta || undefined} onChange={(e) => setNovDesde(e.target.value)} disabled={savingNov} />
              </label>
              <label>
                <span>Hasta</span>
                <input type="date" value={novHasta} min={novDesde || undefined} onChange={(e) => setNovHasta(e.target.value)} disabled={savingNov} />
              </label>
            </div>
            <div className="modal-footer">
              <button type="button" className="inline-button" onClick={() => setNovedadModal(null)} disabled={savingNov}>Cancelar</button>
              <button type="button" className="primary-button" onClick={() => void submitNovedad()} disabled={savingNov || !novDesde || !novHasta}>
                {savingNov ? 'Guardando…' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}

      <NewSuerteModal
        open={isNewSuerteOpen}
        onClose={() => setIsNewSuerteOpen(false)}
        createdBy={session.id}
        haciendas={Array.from(
          new Map(
            maestro
              .filter((row) => !freeFieldForm.ingenioId || row.ingenio_id === freeFieldForm.ingenioId)
              .map((row) => [row.haciendaCode, { code: row.haciendaCode, name: row.haciendaName }]),
          ).values(),
        )}
        ingenios={INGENIOS.map((ing) => ({ id: ing.id, nombre: ing.nombre }))}
        maestro={maestro}
        prefillHaciendaCode={freeFieldForm.haciendaCode}
        prefillIngenioId={freeFieldForm.ingenioId}
        onCreated={(row) => {
          // Sumar la nueva fila al estado del maestro: aparece en el
          // checklist del form al instante. Auto-seleccionarla en el
          // ingenio + hacienda + suertesList para minimizar tecleo.
          setMaestro((prev) => [...prev, row])
          updateFreeFieldForm('haciendaCode', row.haciendaCode)
          updateFreeFieldForm('ingenioId', row.ingenio_id)
          if (!freeFieldSuertesList.includes(row.suerte)) {
            toggleFreeFieldSuerte(row.suerte)
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

            <div className="operator-novedades">
              {NOVEDAD_TIPOS.map((t) => (
                <button
                  key={t}
                  type="button"
                  className={`operator-novedad-btn nov-${t.toLowerCase()}`}
                  onClick={() => openNovedad(t)}
                >
                  {NOV_ICON[t]} {NOVEDAD_LABEL[t]}
                </button>
              ))}
            </div>

            {activeAssignments.map((assignment) => {
              const progress = getSuerteProgress(assignment, assignments)
              // Status derivado: si DB dice PENDIENTE pero otro operario ya
              // avanzo en la suerte+labor, el operario lo ve como Parcial
              // (refleja la realidad del campo aunque su row siga PENDIENTE).
              const derivedStatus =
                assignment.status === 'PENDIENTE' && progress.hasSharedProgress
                  ? 'PARCIAL'
                  : assignment.status
              const meta = getStatusMeta({ ...assignment, status: derivedStatus })
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
                      {progress.hasProgress && (
                        <>
                          {' · '}
                          <span className="partial-inline">
                            {formatArea(progress.executedTotal)} realizadas · Falta {formatArea(progress.remaining)}
                          </span>
                        </>
                      )}
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
                        <span className="subtle-copy">
                          {a.labor} - {formatArea(a.area)}
                          {getSuerteProgress(a, assignments).hasProgress && (
                            <> · <strong style={{ color: 'var(--color-status-progress)' }}>
                              Falta {formatArea(getSuerteProgress(a, assignments).remaining)}
                            </strong></>
                          )}
                        </span>
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

                    {(a.status === 'PENDIENTE' || a.status === 'PARCIAL') ? (() => {
                      const startProgress = getSuerteProgress(a, assignments)
                      const isResumingPartial = a.status === 'PARCIAL' && startProgress.hasProgress
                      return (
                      <div className="start-grid">
                        {isResumingPartial && (
                          <div className="partial-progress-banner">
                            <strong>Retomar labor parcial</strong>
                            <span>
                              Acumulado previo: {formatArea(a.executedArea)} de {formatArea(a.area)}. Faltan {formatArea(startProgress.remaining)}. Pon el horómetro inicial de esta sesión para retomar; al terminar registras el horómetro final.
                            </span>
                          </div>
                        )}
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
                          {isResumingPartial ? 'Horometro inicial (nueva sesión)' : 'Horometro inicial'}
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
                              onError={handleDictateError}
                            />
                          </div>
                        </label>
                        <button
                          className="primary-button"
                          onClick={() => void onStartAssignment(a)}
                          disabled={busy}
                        >
                          {isResumingPartial ? 'Continuar labor' : 'Iniciar labor'}
                        </button>
                      </div>
                      )
                    })() : (() => {
                      const progress = getSuerteProgress(a, assignments)
                      const isPartialContinuation = progress.hasProgress
                      const remainingArea = progress.remaining
                      const sessionMax = isPartialContinuation ? remainingArea : a.area
                      const completeRegistraStr = isPartialContinuation
                        ? `Se registra el faltante (${formatArea(remainingArea)})`
                        : `Se registran ${formatArea(a.area)}`
                      const bannerText = progress.hasSharedProgress
                        ? `Otro operario ya realizó ${formatArea(progress.sharedExecuted)}${progress.ownExecuted > 0 ? ` y tú ${formatArea(progress.ownExecuted)}` : ''}. Faltan ${formatArea(remainingArea)} de ${formatArea(a.area)}. Ingresa cuánto hiciste en esta sesión.`
                        : `Acumulado previo: ${formatArea(a.executedArea)} de ${formatArea(a.area)}. Faltan ${formatArea(remainingArea)}. Ingresa cuánto hiciste en esta sesión.`
                      const bannerTitle = progress.hasSharedProgress
                        ? 'Labor compartida con otro operario'
                        : 'Continuando labor parcial'
                      return (
                      <div className="finish-grid">
                        {isPartialContinuation && (
                          <div className="partial-progress-banner">
                            <strong>{bannerTitle}</strong>
                            <span>{bannerText}</span>
                          </div>
                        )}
                        <div className="complete-toggle-row">
                          <div>
                            <span className="complete-toggle-label">Labor completada al 100%</span>
                            <span className="complete-toggle-hint">
                              {draft?.isComplete
                                ? completeRegistraStr
                                : isPartialContinuation
                                  ? 'Ingresa lo ejecutado en esta sesión'
                                  : 'Ingresa el área ejecutada'}
                            </span>
                          </div>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={draft?.isComplete ?? false}
                            className={`toggle-switch ${(draft?.isComplete ?? false) ? 'on' : ''}`}
                            onClick={() => setFinishDraftComplete(a.id, !(draft?.isComplete ?? false), sessionMax)}
                          >
                            <span className="toggle-thumb" />
                          </button>
                        </div>

                        {!(draft?.isComplete ?? false) && (
                          <label>
                            {isPartialContinuation ? 'Ha ejecutadas en esta sesión' : 'Ha ejecutadas'}
                            <div className="dictate-input-wrap">
                              <input
                                type="number"
                                min={0.1}
                                step={0.1}
                                max={sessionMax}
                                value={draft?.area ?? ''}
                                onChange={(event) =>
                                  updateFinishDraft(a.id, 'area', event.target.value)
                                }
                                placeholder={`máx. ${sessionMax.toFixed(2)}`}
                              />
                              <DictateInlineButton
                                ariaLabel="Dictar hectáreas ejecutadas"
                                onComplete={(text) => {
                                  const num = parseSpokenNumber(text)
                                  if (num !== null) updateFinishDraft(a.id, 'area', String(num))
                                }}
                                onError={handleDictateError}
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
                              onError={handleDictateError}
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
                              onError={handleDictateError}
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
                      )
                    })()}

                    {/* Liberar/rechazar: el operario suelta una labor que no
                        va a poder terminar. Confirmacion para evitar accidentes.
                        Cerramos el sheet al abrir la confirmacion para que el
                        modal quede limpio encima del panel (sin el sheet
                        asomandose atras). El draft persiste por assignment.id,
                        asi que si pulsa "No, volver" no pierde lo escrito. */}
                    <button
                      type="button"
                      className="release-labor-btn"
                      onClick={() => {
                        setReleaseTarget(a)
                        setSelectedActiveAssignment(null)
                      }}
                      disabled={busy}
                    >
                      No puedo continuar — liberar esta labor
                    </button>
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
                <h2>Tu quincena</h2>
                <span className="subtle-copy">{quincenaLabel}</span>
              </div>
              <div className="journey-stats">
                <div>
                  <strong>{activeAssignments.length}</strong>
                  <span>activas</span>
                </div>
                <div>
                  <strong>
                    {
                      quincenaHistory.filter(
                        (a) => a.status === 'COMPLETADA' || a.status === 'CANCELADA',
                      ).length
                    }
                  </strong>
                  <span>cerradas</span>
                </div>
                <div>
                  <strong>
                    {quincenaHistory
                      .filter((item) => item.status === 'COMPLETADA' || item.status === 'PARCIAL')
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
              // Para los KPIs del Historial:
              //   - "ha planificadas" y "ha ejecutadas" suman COMPLETADA + PARCIAL
              //     (la PARCIAL ya tiene area trabajada que cuenta para el avance).
              //   - "completadas" (count) cuenta solo COMPLETADA (cierres definitivos).
              //   - "en curso" (count) cuenta PARCIAL (visibilidad de lo que falta).
              //   - "eficiencia" = ejecutadas / planificadas sobre el mismo set.
              const conAvance = filteredHistory.filter(
                (a) => a.status === 'COMPLETADA' || a.status === 'PARCIAL',
              )
              const completadas = filteredHistory.filter((a) => a.status === 'COMPLETADA')
              const parciales = filteredHistory.filter((a) => a.status === 'PARCIAL')
              const haPlaneadas = conAvance.reduce((sum, a) => sum + a.area, 0)
              const haEjecutadas = conAvance.reduce((sum, a) => sum + a.executedArea, 0)
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
                    <span>
                      {completadas.length === 1 ? 'completada' : 'completadas'}
                      {parciales.length > 0 ? ` (+${parciales.length} parcial${parciales.length > 1 ? 'es' : ''})` : ''}
                    </span>
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
                      <small>{formatExecutionDate(assignment)}</small>
                      {assignment.finishedAt && <small>{formatTime(assignment.finishedAt)}</small>}
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

        {releaseTarget && (() => {
          const prog = getSuerteProgress(releaseTarget, assignments)
          return (
            <div className="modal-overlay release-confirm-overlay open" onClick={() => setReleaseTarget(null)}>
              <div className="modal-card release-confirm-card" onClick={(e) => e.stopPropagation()}>
                <h3>¿Liberar esta labor?</h3>
                <p className="subtle-copy" style={{ marginTop: 0 }}>
                  <strong>{releaseTarget.haciendaName} - {releaseTarget.suerte}</strong>{' · '}{releaseTarget.labor}
                </p>
                <p className="subtle-copy">
                  {prog.ownExecuted > 0 ? (
                    <>
                      Tu avance de <strong>{formatArea(prog.ownExecuted)}</strong> queda guardado.
                      La labor saldrá de tus <strong>Activas</strong>; el supervisor podrá
                      reasignarla o cancelarla, y tú puedes retomar el restante
                      ({formatArea(prog.remaining)}) desde <strong>Campo</strong>.
                    </>
                  ) : (
                    <>
                      La labor saldrá de tus <strong>Activas</strong>. El supervisor podrá
                      reasignarla a otro operario o cancelarla.
                    </>
                  )}
                </p>
                <div className="modal-footer">
                  <button
                    type="button"
                    className="inline-button"
                    onClick={() => setReleaseTarget(null)}
                    disabled={busy}
                  >
                    No, volver
                  </button>
                  <button
                    type="button"
                    className="release-confirm-btn"
                    disabled={busy}
                    onClick={() => {
                      const target = releaseTarget
                      setReleaseTarget(null)
                      setSelectedActiveAssignment(null)
                      void onReleaseAssignment(target)
                    }}
                  >
                    {busy ? 'Liberando...' : 'Sí, liberar'}
                  </button>
                </div>
              </div>
            </div>
          )
        })()}

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
              {/* Cliente y Zona los diligencia el supervisor al aprobar (campo simplificado). */}
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
                <div className="field-label-row">
                  <span className="field-label">Suertes</span>
                  {freeFieldForm.ingenioId && (
                    <button
                      type="button"
                      className="inline-button new-suerte-btn"
                      onClick={() => setIsNewSuerteOpen(true)}
                      title="Crear una suerte que aun no este en el maestro del ingenio"
                    >
                      + Nueva suerte
                    </button>
                  )}
                </div>
                {freeFieldForm.haciendaCode ? (
                  <ul className="suertes-checklist">
                    {freeFieldSuertes.map((row) => {
                      const suerteCode = `${freeFieldForm.haciendaCode}-${row.suerte}`
                      const remaining = freeFieldForm.labor
                        ? getRemainingArea(assignments, suerteCode, freeFieldForm.labor, row.area, todayKey)
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
                    options={fieldLabores.map((labor) => {
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
                        fieldLabores.map((labor) => ({ code: labor, name: labor })),
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
                    onError={handleDictateError}
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
