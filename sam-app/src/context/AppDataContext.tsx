import { createContext, startTransition, useContext, useEffect, useMemo, useState } from 'react'
import { useSync } from '../hooks/useSync'
import type { Assignment, Equipment, MaestroRow, UserProfile } from '../domain/sam'
import {
  loadAppUsers,
  loadAssignments,
  loadEquipment,
  loadMaestro,
  summarizeAssignments,
} from '../services/samApi'

export const SESSION_KEY = 'sam-app-session-v1'

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

  const { isOnline, outboxCount, setOutboxCount } = useSync({
    onAssignmentsReloaded: setAssignments,
    onMaestroReloaded: setMaestro,
    onInfo: setInfo,
  })

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
