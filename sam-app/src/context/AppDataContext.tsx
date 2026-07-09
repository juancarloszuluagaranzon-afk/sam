import { createContext, startTransition, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useSync } from '../hooks/useSync'
import { db } from '../lib/db'
import type { Assignment, Empresa, Ingenio, Equipment, Insumo, Labor, MaestroRow, Tercero, UserProfile, Zona } from '../domain/sam'
import { WORKFLOW } from '../data/constants'
import { INGENIOS as INGENIOS_SEED, setIngenioNamesRuntime } from '../data/ingenios'
import {
  loadAppUsers,
  loadAssignments,
  loadEmpresas,
  loadEquipment,
  loadIngenios,
  loadInsumos,
  loadLabores,
  loadMaestro,
  loadTerceros,
  loadZonas,
  runRetention,
  summarizeAssignments,
} from '../services/samApi'

// Semilla como Ingenio[] activo — fallback si la BD no cargó (dropdowns nunca vacíos).
const INGENIOS_FALLBACK: Ingenio[] = INGENIOS_SEED.map((i) => ({ ...i, activo: true }))

export const SESSION_KEY = 'sam-app-session-v2'

interface AppDataContextValue {
  session: UserProfile | null
  setSession: React.Dispatch<React.SetStateAction<UserProfile | null>>
  maestro: MaestroRow[]
  setMaestro: React.Dispatch<React.SetStateAction<MaestroRow[]>>
  assignments: Assignment[]
  setAssignments: React.Dispatch<React.SetStateAction<Assignment[]>>
  users: UserProfile[]
  setUsers: React.Dispatch<React.SetStateAction<UserProfile[]>>
  equipment: Equipment[]
  setEquipment: React.Dispatch<React.SetStateAction<Equipment[]>>
  // Catálogo de labores (CRUD). `labores` = todas; `activeLabores` = nombres
  // de las activas, ordenados alfabéticamente, para alimentar los selectores.
  labores: Labor[]
  setLabores: React.Dispatch<React.SetStateAction<Labor[]>>
  activeLabores: string[]
  // Solo labores activas Y mecanizadas — para el picker del operario (tractor)
  // al tomar en campo, que no debe ver labores manuales.
  fieldLabores: string[]
  // Catálogo de ingenios/compradores (CRUD desde Catálogos → Ingenios).
  ingenios: Ingenio[]
  setIngenios: React.Dispatch<React.SetStateAction<Ingenio[]>>
  // Catálogos de administración (CRUD): empresas y terceros (clientes).
  empresas: Empresa[]
  setEmpresas: React.Dispatch<React.SetStateAction<Empresa[]>>
  terceros: Tercero[]
  setTerceros: React.Dispatch<React.SetStateAction<Tercero[]>>
  zonas: Zona[]
  setZonas: React.Dispatch<React.SetStateAction<Zona[]>>
  insumos: Insumo[]
  setInsumos: React.Dispatch<React.SetStateAction<Insumo[]>>
  loading: boolean
  setLoading: React.Dispatch<React.SetStateAction<boolean>>
  busy: boolean
  setBusy: React.Dispatch<React.SetStateAction<boolean>>
  error: string
  setError: React.Dispatch<React.SetStateAction<string>>
  info: string
  setInfo: React.Dispatch<React.SetStateAction<string>>
  isOnline: boolean
  outboxCount: number
  setOutboxCount: React.Dispatch<React.SetStateAction<number>>
  // Mensaje no-null cuando un fetch a Supabase fallo estando online. La UI
  // muestra un banner rojo persistente hasta que la siguiente sync exitosa
  // lo limpia.
  syncError: string | null
  retrySync: () => void
  // Borra `assignments_last_sync` y hace full reload de assignments. Misma
  // accion que el boton "Forzar sync ahora" del DiagnosticModal — pero
  // disponible globalmente (la usa el pull-to-refresh tambien).
  forceSync: () => Promise<number>
  supervisors: UserProfile[]
  operators: UserProfile[]
  todayKey: string
  metrics: ReturnType<typeof summarizeAssignments>
  operatorStatusMap: Map<string, 'ocupado' | 'disponible'>
  sortedEquipment: Equipment[]
}

const AppDataContext = createContext<AppDataContextValue | null>(null)

export function AppDataProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<UserProfile | null>(null)
  const [maestro, setMaestro] = useState<MaestroRow[]>([])
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [users, setUsers] = useState<UserProfile[]>([])
  const [equipment, setEquipment] = useState<Equipment[]>([])
  const [labores, setLabores] = useState<Labor[]>([])
  const [ingenios, setIngenios] = useState<Ingenio[]>(INGENIOS_FALLBACK)
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [terceros, setTerceros] = useState<Tercero[]>([])
  const [zonas, setZonas] = useState<Zona[]>([])
  const [insumos, setInsumos] = useState<Insumo[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [syncError, setSyncError] = useState<string | null>(null)

  const { isOnline, outboxCount, setOutboxCount } = useSync({
    onAssignmentsReloaded: setAssignments,
    onMaestroReloaded: setMaestro,
    onInfo: setInfo,
    onSyncError: setSyncError,
  })

  const retrySync = () => {
    void loadAssignments().then((result) => {
      setAssignments(result.data)
      setSyncError(result.error)
    })
  }

  const forceSync = useCallback(async (): Promise<number> => {
    try {
      await db.meta.delete('assignments_last_sync')
    } catch {
      // ignore delete failures — el siguiente load igual fuerza full sync si no encuentra meta
    }
    try {
      const result = await loadAssignments()
      setAssignments(result.data)
      setSyncError(result.error)
      return result.data.length
    } catch {
      return 0
    }
  }, [])

  useEffect(() => {
    const saved = window.localStorage.getItem(SESSION_KEY)
    if (saved) {
      try {
        setSession(JSON.parse(saved) as UserProfile)
      } catch {
        window.localStorage.removeItem(SESSION_KEY)
      }
    }
    void hydrate()
  }, [])

  useEffect(() => {
    if (!info) return
    const timer = setTimeout(() => setInfo(''), 3500)
    return () => clearTimeout(timer)
  }, [info])

  useEffect(() => {
    if (!error) return
    const timer = setTimeout(() => setError(''), 5000)
    return () => clearTimeout(timer)
  }, [error])

  async function hydrate() {
    // Forzamos SIEMPRE full sync de asignaciones al ABRIR/recargar la app (antes
    // solo en reload del navegador). La tabla es chica (~250 KB) y el delta sync
    // dejaba caches incompletas: un operario con sesion persistida que solo
    // REABRIA la PWA (sin reload ni re-login) hacia delta sobre una cache parcial
    // y su Historial salia VACIO aunque el dato existia en el servidor (el
    // propietario, que recarga seguido, si lo veia). Borrar el watermark hace que
    // la fase 2 traiga TODO desde Supabase. Costo: ~250 KB por apertura; beneficio:
    // dataset siempre completo. El delta sync se conserva para los re-syncs en
    // segundo plano de useSync durante la sesion (la tabla ya esta completa ahi).
    try {
      await db.meta.delete('assignments_last_sync')
    } catch {
      // Sin meta el siguiente loadAssignments igual fuerza full sync.
    }

    setLoading(true)

    // Fase 1: pinta UI desde cache local de Dexie de inmediato (< 50ms).
    // Si hay cache, la app se siente instantanea — el refresh va en fase 2.
    let hasCache = false
    try {
      const [maestroCache, assignmentsCache, usersCache, equipmentCache, laboresCache] =
        await Promise.all([
          db.maestro.toArray(),
          db.assignments.toArray(),
          db.users.toArray(),
          db.equipment.toArray(),
          db.labores.toArray(),
        ])
      hasCache =
        maestroCache.length > 0 ||
        assignmentsCache.length > 0 ||
        usersCache.length > 0 ||
        equipmentCache.length > 0
      if (hasCache) {
        startTransition(() => {
          if (maestroCache.length) setMaestro(maestroCache)
          if (assignmentsCache.length) {
            assignmentsCache.sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1))
            setAssignments(assignmentsCache)
          }
          if (usersCache.length) setUsers(usersCache)
          if (equipmentCache.length) setEquipment(equipmentCache)
          if (laboresCache.length) setLabores(laboresCache)
        })
        setLoading(false)
      }
    } catch {
      // Sin cache utilizable: seguimos al fetch sincrono.
    }

    // Fase 2: refresh desde Supabase. Si habia cache, esto corre en background
    // sin bloquear el render — la UI ya esta visible. Si no habia cache, esta
    // fase actua como el load original (espera a que termine).
    try {
      const [maestroResult, assignmentResult, userResult, equipmentResult, laboresResult, ingeniosResult, empresasResult, tercerosResult, zonasResult, insumosResult] =
        await Promise.all([
          loadMaestro(),
          loadAssignments(),
          loadAppUsers(),
          loadEquipment(),
          loadLabores(),
          loadIngenios(),
          loadEmpresas(),
          loadTerceros(),
          loadZonas(),
          loadInsumos(),
        ])
      startTransition(() => {
        setMaestro(maestroResult.data)
        setAssignments(assignmentResult.data)
        setUsers(userResult.data)
        setEquipment(equipmentResult.data)
        setLabores(laboresResult.data)
        // Si la BD trajo ingenios, esos mandan; si cayó a fallback, conservamos
        // la semilla ya puesta en el estado inicial (dropdowns nunca vacíos).
        if (ingeniosResult.data.length > 0) setIngenios(ingeniosResult.data)
        setEmpresas(empresasResult.data)
        setTerceros(tercerosResult.data)
        setZonas(zonasResult.data)
        setInsumos(insumosResult.data)
        // Si el resync de asignaciones cayo en fallback con error, exponemos
        // el mensaje para que la UI muestre banner. El catch externo solo
        // dispara si Promise.all rechaza, lo cual no sucede aqui porque
        // loadAssignments captura sus propios errores.
        setSyncError(assignmentResult.error)
      })
    } catch {
      if (!hasCache) setError('No pudimos cargar toda la informacion operativa.')
    } finally {
      setLoading(false)
    }
  }

  // Inyecta los nombres de ingenio al resolvedor (getIngenioName usa este
  // registro para mostrar el nombre de un ingenio creado por el usuario).
  useEffect(() => {
    setIngenioNamesRuntime(ingenios)
  }, [ingenios])

  // Limpieza automática (política de ciclo de vida): la dispara owner/admin
  // 1 vez al día. Cancela pendientes viejas y purga canceladas sin trabajo. Es
  // silenciosa; si algo falla no molesta al usuario (reintenta al día siguiente,
  // y pg_cron —si está— la respalda). Ver migración 20260708130000.
  useEffect(() => {
    const role = session?.role
    if (role !== 'owner' && role !== 'administracion') return
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return
    const KEY = 'sam-retention-last'
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' })
    let last: string | null = null
    try { last = window.localStorage.getItem(KEY) } catch { /* sin localStorage */ }
    if (last === today) return
    try { window.localStorage.setItem(KEY, today) } catch { /* sin localStorage */ }
    void runRetention()
      .then((r) => {
        // Si limpió algo, refrescar asignaciones para reflejarlo en la app.
        if (r.canceladas > 0 || r.borradas > 0) {
          void loadAssignments().then((res) => startTransition(() => setAssignments(res.data)))
        }
      })
      .catch(() => { /* silencioso */ })
  }, [session?.role])

  // Selectores y asignación solo usan usuarios ACTIVOS (loadAppUsers ahora trae
  // todos, incluidos los inactivos, para que la gestión de Usuarios los liste).
  const supervisors = useMemo(() => users.filter((u) => u.role === 'supervisor' && u.active !== false), [users])
  const operators = useMemo(() => users.filter((u) => u.role === 'operador' && u.active !== false), [users])
  const todayKey = useMemo(
    () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' }),
    [],
  )
  const metrics = useMemo(() => summarizeAssignments(assignments, todayKey), [assignments, todayKey])

  // Nombres de labores ACTIVAS, alfabético. Si el catálogo aún no cargó (primer
  // arranque sin caché, o antes de correr la migración), cae a WORKFLOW para no
  // dejar los selectores vacíos.
  const activeLabores = useMemo(() => {
    const names = labores.filter((l) => l.activa).map((l) => l.nombre)
    const base = names.length ? names : [...WORKFLOW]
    return base.sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }))
  }, [labores])

  // Activas Y mecanizadas, para el operario de tractor. Si el catálogo aún no
  // cargó cae a WORKFLOW (que es todo mecanizado salvo REPIQUE; aceptable como
  // fallback transitorio hasta el primer sync).
  const fieldLabores = useMemo(() => {
    // tipo ausente (caché vieja) se trata como mecanizada → no se oculta por error.
    const loaded = labores.filter((l) => l.activa && l.tipo !== 'MANUAL').map((l) => l.nombre)
    const base = labores.length ? loaded : [...WORKFLOW]
    return base.sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }))
  }, [labores])

  const operatorStatusMap = useMemo(() => {
    const map = new Map<string, 'ocupado' | 'disponible'>()
    users
      .filter((u) => u.role === 'operador')
      .forEach((u) => {
        const isBusy = assignments.some((a) => a.operatorId === u.id && a.status === 'EN_PROCESO')
        map.set(u.id, isBusy ? 'ocupado' : 'disponible')
      })
    return map
  }, [users, assignments])

  const sortedEquipment = useMemo(() => {
    const brandOrder: Record<string, number> = { CASE: 0, VALTRA: 1, PUMA: 2, FIAT: 3 }
    return [...equipment].sort((a, b) => {
      const brandA = a.name.split(' ')[0].toUpperCase()
      const brandB = b.name.split(' ')[0].toUpperCase()
      const pa = brandOrder[brandA] ?? 99
      const pb = brandOrder[brandB] ?? 99
      if (pa !== pb) return pa - pb
      const numA = parseInt(a.name.replace(/\D/g, ''), 10) || 0
      const numB = parseInt(b.name.replace(/\D/g, ''), 10) || 0
      return numA - numB
    })
  }, [equipment])

  return (
    <AppDataContext.Provider
      value={{
        session, setSession,
        maestro, setMaestro,
        assignments, setAssignments,
        users, setUsers,
        equipment, setEquipment,
        labores, setLabores, activeLabores, fieldLabores,
        ingenios, setIngenios,
        empresas, setEmpresas, terceros, setTerceros,
        zonas, setZonas,
        insumos, setInsumos,
        loading, setLoading,
        busy, setBusy,
        error, setError,
        info, setInfo,
        isOnline, outboxCount, setOutboxCount,
        syncError, retrySync, forceSync,
        supervisors, operators, todayKey, metrics, operatorStatusMap, sortedEquipment,
      }}
    >
      {children}
    </AppDataContext.Provider>
  )
}

export function useAppData() {
  const ctx = useContext(AppDataContext)
  if (!ctx) throw new Error('useAppData must be used within AppDataProvider')
  return ctx
}
