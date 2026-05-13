import { useCallback, useEffect, useState } from 'react'
import type { Assignment, MaestroRow } from '../domain/sam'
import { db } from '../lib/db'
import {
  createAssignment,
  loadAssignments,
  loadMaestro,
  updateAssignment,
} from '../services/samApi'

interface UseSyncParams {
  onAssignmentsReloaded: (data: Assignment[]) => void
  onMaestroReloaded: (data: MaestroRow[]) => void
  onInfo: (message: string) => void
}

interface UseSyncResult {
  isOnline: boolean
  outboxCount: number
  setOutboxCount: React.Dispatch<React.SetStateAction<number>>
  syncOutbox: () => Promise<void>
}

export function useSync({
  onAssignmentsReloaded,
  onMaestroReloaded,
  onInfo,
}: UseSyncParams): UseSyncResult {
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [outboxCount, setOutboxCount] = useState(0)

  const syncOutbox = useCallback(async () => {
    const pending = await db.outbox.where('status').equals('pending').toArray()
    if (pending.length === 0) return

    // tempId → realId map built from CREATE results
    const tempIdMap: Record<string, string> = {}
    let synced = 0

    // Pass 1: CREATE items first so temp IDs can be resolved for subsequent UPDATEs
    for (const item of pending.filter((i) => i.type === 'CREATE')) {
      try {
        const real = await createAssignment(item.createInput!)
        tempIdMap[item.tempId!] = real.id
        await db.outbox.delete(item.id!)
        await db.assignments.delete(item.tempId!)
        synced++
      } catch {
        await db.outbox.update(item.id!, { status: 'error' })
      }
    }

    // Pass 2: UPDATE items (START, FINISH, CANCEL) — resolve temp IDs if needed
    for (const item of pending.filter((i) => i.type === 'UPDATE')) {
      const realId = tempIdMap[item.assignmentId!] ?? item.assignmentId!
      try {
        await updateAssignment(realId, item.updatePayload!)
        await db.outbox.delete(item.id!)
        synced++
      } catch {
        await db.outbox.update(item.id!, { status: 'error' })
      }
    }

    if (synced > 0) {
      setOutboxCount(0)
      const result = await loadAssignments()
      onAssignmentsReloaded(result.data)
      onInfo(`${synced} accion${synced !== 1 ? 'es sincronizadas' : ' sincronizada'} con el servidor.`)
    }
  }, [onAssignmentsReloaded, onInfo])

  useEffect(() => {
    // Check pending outbox on startup
    void db.outbox.where('status').equals('pending').count().then((count) => {
      setOutboxCount(count)
    })

    const onOnline = () => {
      setIsOnline(true)
      void syncOutbox()
      // Refrescar maestro al recuperar señal (puede haber nuevas haciendas/suertes)
      void loadMaestro().then((result) => onMaestroReloaded(result.data))
    }
    const onOffline = () => setIsOnline(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)

    const onVisible = () => {
      if (document.visibilityState === 'visible' && navigator.onLine) {
        void loadAssignments().then((r) => onAssignmentsReloaded(r.data))
      }
    }
    document.addEventListener('visibilitychange', onVisible)

    // Poll periodico de asignaciones mientras la app esta visible. Mantiene
    // sincronizado lo que hace el supervisor desde otro dispositivo (PC vs
    // movil) sin que el usuario tenga que cerrar y abrir la app. Es barato:
    // delta sync solo trae las filas tocadas desde el ultimo sync.
    const POLL_INTERVAL_MS = 30000
    const pollId = window.setInterval(() => {
      if (document.visibilityState !== 'visible' || !navigator.onLine) return
      void loadAssignments().then((r) => onAssignmentsReloaded(r.data))
    }, POLL_INTERVAL_MS)

    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      document.removeEventListener('visibilitychange', onVisible)
      window.clearInterval(pollId)
    }
  }, [syncOutbox, onAssignmentsReloaded, onMaestroReloaded])

  return { isOnline, outboxCount, setOutboxCount, syncOutbox }
}
