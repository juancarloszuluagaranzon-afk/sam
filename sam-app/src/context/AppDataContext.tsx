import { createContext, startTransition, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useSync } from '../hooks/useSync'
import { db } from '../lib/db'
import type { Assignment, Equipment, MaestroRow, UserProfile } from '../domain/sam'
import {
  loadAppUsers,
  loadAssignments,
  loadEquipment,
  loadMaestro,
  summarizeAssignments,
} from '../services/samApi'

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
      const [maestroCache, assignmentsCache, usersCache, equipmentCache] = await Promise.all([
        db.maestro.toArray(),
        db.assignments.toArray(),
        db.users.toArray(),
        db.equipment.toArray(),
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

  const supervisors = useMemo(() => users.filter((u) => u.role === 'supervisor'), [users])
  const operators = useMemo(() => users.filter((u) => u.role === 'operador'), [users])
  const todayKey = useMemo(
    () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' }),
    [],
  )
  const metrics = useMemo(() => summarizeAssignments(assignments, todayKey), [assignments, todayKey])

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
