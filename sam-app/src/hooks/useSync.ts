import { useCallback, useEffect, useState } from 'react'
import type { Assignment, MaestroRow } from '../domain/sam'
import { db } from '../lib/db'
import {
  createAssignment,
  loadAssignments,
  loadMaestro,
  updateAssignment,
} from '../services/samApi'
import { supabase } from '../lib/supabase'

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

    // Realtime: cuando cualquier cliente toca la tabla asignaciones, el
    // servidor empuja el evento via websocket a todos los conectados. Cada
    // cliente recarga sus asignaciones de inmediato. Reemplaza el feedback
    // perezoso del poll cada 30s cuando hay multiples dispositivos abiertos.
    //
    // El delta sync de loadAssignments hace que la recarga sea barata
    // (solo trae las filas tocadas en los ultimos segundos).
    let realtimeDebounce: number | null = null
    const channel = supabase
      .channel('asignaciones-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'asignaciones' },
        () => {
          // Debounce: si llegan varios eventos en rafaga (sync de outbox que
          // dispara 5 INSERTs por ejemplo), agrupamos en un solo refresh.
          if (realtimeDebounce !== null) window.clearTimeout(realtimeDebounce)
          realtimeDebounce = window.setTimeout(() => {
            realtimeDebounce = null
            if (!navigator.onLine) return
            void loadAssignments().then((r) => onAssignmentsReloaded(r.data))
          }, 500)
        },
      )
      .subscribe()

    // Poll periodico como fallback defensivo: si Realtime se cae o no
    // estamos conectados al websocket, igual mantenemos sync. Cada 60s
    // (menos agresivo que antes porque ya tenemos Realtime como primario).
    const POLL_INTERVAL_MS = 60000
    const pollId = window.setInterval(() => {
      if (document.visibilityState !== 'visible' || !navigator.onLine) return
      void loadAssignments().then((r) => onAssignmentsReloaded(r.data))
    }, POLL_INTERVAL_MS)

    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      document.removeEventListener('visibilitychange', onVisible)
      window.clearInterval(pollId)
      if (realtimeDebounce !== null) window.clearTimeout(realtimeDebounce)
      void supabase.removeChannel(channel)
    }
  }, [syncOutbox, onAssignmentsReloaded, onMaestroReloaded])

  return { isOnline, outboxCount, setOutboxCount, syncOutbox }
}
