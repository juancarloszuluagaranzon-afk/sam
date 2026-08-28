import { useCallback, useEffect, useState } from 'react'
import type { Assignment, MaestroRow } from '../domain/sam'
import { db } from '../lib/db'
import {
  createAssignment,
  loadAssignments,
  loadMaestro,
  updateAssignment,
  uploadEvidencia,
} from '../services/samApi'
import { supabase } from '../lib/supabase'
import { ejecutarInsumo, resolverFotosDePayload, type InsumoOpKind } from '../lib/outboxInsumos'

interface UseSyncParams {
  onAssignmentsReloaded: (data: Assignment[]) => void
  onMaestroReloaded: (data: MaestroRow[]) => void
  onInfo: (message: string) => void
  // Llamado tras cada loadAssignments. Mensaje no-null = el fetch fallo y
  // estamos sirviendo desde cache; null = fetch OK. La UI usa esto para
  // mostrar el banner "no pudimos cargar tus asignaciones".
  onSyncError: (message: string | null) => void
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
  onSyncError,
}: UseSyncParams): UseSyncResult {
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [outboxCount, setOutboxCount] = useState(0)

  const syncOutbox = useCallback(async () => {
    // Reintenta pendientes Y los que quedaron en 'error' (recuperación de fallos
    // transitorios de red). Un rechazo permanente (duplicado/área) volverá a
    // 'error' — pero NO se pierde ni se oculta: el contador lo sigue reflejando.
    const items = await db.outbox.where('status').anyOf(['pending', 'error']).toArray()
    if (items.length === 0) { setOutboxCount(0); return }

    // tempId → realId map built from CREATE results
    const tempIdMap: Record<string, string> = {}
    let synced = 0
    const errMsg = (err: unknown) => String((err as { message?: string })?.message ?? err)

    // Pass 1: CREATE items first so temp IDs can be resolved for subsequent UPDATEs
    for (const item of items.filter((i) => i.type === 'CREATE')) {
      try {
        const real = await createAssignment(item.createInput!)
        tempIdMap[item.tempId!] = real.id
        await db.outbox.delete(item.id!)
        await db.assignments.delete(item.tempId!)
        synced++
      } catch (err) {
        await db.outbox.update(item.id!, { status: 'error', errorMessage: errMsg(err) })
      }
    }

    // Pass 2: UPDATE items (START, FINISH, CANCEL) — resolve temp IDs if needed
    for (const item of items.filter((i) => i.type === 'UPDATE')) {
      const realId = tempIdMap[item.assignmentId!] ?? item.assignmentId!
      try {
        await updateAssignment(realId, item.updatePayload!)
        await db.outbox.delete(item.id!)
        synced++
      } catch (err) {
        await db.outbox.update(item.id!, { status: 'error', errorMessage: errMsg(err) })
      }
    }

    // Pass 3: INSUMOS. Van al final a proposito: si un despacho y el cierre de
    // la labor de esa misma maquina estaban en cola, primero queda la labor.
    // Cada uno reejecuta la operacion COMPLETA contra el servidor, asi que el
    // saldo del kardex se calcula con el stock real de ahora, no con el que
    // habia en el telefono cuando se registro sin senal.
    for (const item of items.filter((i) => i.type === 'INSUMO')) {
      try {
        // Primero las fotos: si se tomaron sin señal viven en el equipo con un
        // marcador `local://`, y hay que subirlas y cambiar el marcador por la
        // URL real antes de mandar el registro.
        const payload = await resolverFotosDePayload(item.insumoOp!.payload, uploadEvidencia)
        await ejecutarInsumo(item.insumoOp!.kind as InsumoOpKind, payload)
        await db.outbox.delete(item.id!)
        synced++
      } catch (err) {
        // Un rechazo del servidor (stock insuficiente, solicitud ya despachada)
        // NO se borra: queda en error y el contador lo sigue mostrando, para
        // que alguien lo resuelva en vez de que desaparezca en silencio.
        await db.outbox.update(item.id!, { status: 'error', errorMessage: errMsg(err) })
      }
    }

    // Recontar SIEMPRE desde Dexie (pendientes + error). Antes se reseteaba a 0
    // aunque quedara trabajo en 'error' → el badge mentía "todo sincronizado" y
    // el operario perdía cierres sin enterarse. Ahora el contador es honesto.
    const remaining = await db.outbox.where('status').anyOf(['pending', 'error']).count()
    setOutboxCount(remaining)

    if (synced > 0) {
      const result = await loadAssignments()
      onAssignmentsReloaded(result.data)
      onSyncError(result.error)
      onInfo(`${synced} accion${synced !== 1 ? 'es sincronizadas' : ' sincronizada'} con el servidor.`)
    }
  }, [onAssignmentsReloaded, onInfo, onSyncError])

  useEffect(() => {
    // Check pending outbox on startup (incluye 'error' para no ocultar trabajo).
    void db.outbox.where('status').anyOf(['pending', 'error']).count().then((count) => {
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
        void loadAssignments().then((r) => {
          onAssignmentsReloaded(r.data)
          onSyncError(r.error)
        })
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
    // Borrados pendientes de reconciliar: el delta-sync NO trae DELETEs (solo
    // filas creadas/modificadas), así que una fila borrada en otro equipo
    // "resucitaba" en la caché de los demás. Aquí capturamos el id del evento
    // DELETE y lo quitamos de Dexie antes del refresh.
    const pendingDeletes = new Set<string>()
    // ¿El websocket esta arriba? Lo dice el callback de `.subscribe`.
    let realtimeVivo = false
    const channel = supabase
      .channel('asignaciones-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'asignaciones' },
        (payload: { eventType?: string; old?: { id?: string | number } }) => {
          if (payload.eventType === 'DELETE' && payload.old?.id != null) {
            pendingDeletes.add(String(payload.old.id))
          }
          // Debounce: si llegan varios eventos en rafaga (sync de outbox que
          // dispara 5 INSERTs por ejemplo), agrupamos en un solo refresh.
          if (realtimeDebounce !== null) window.clearTimeout(realtimeDebounce)
          realtimeDebounce = window.setTimeout(() => {
            realtimeDebounce = null
            if (!navigator.onLine) return
            void (async () => {
              if (pendingDeletes.size > 0) {
                const ids = [...pendingDeletes]
                pendingDeletes.clear()
                try { await db.assignments.bulkDelete(ids) } catch { /* sin cache */ }
              }
              const r = await loadAssignments()
              onAssignmentsReloaded(r.data)
              onSyncError(r.error)
            })()
          }, 500)
        },
      )
      // El estado del websocket decide cada cuanto hace falta el poll de
      // respaldo: mientras Realtime este conectado, avisa el solo.
      .subscribe((estado) => { realtimeVivo = estado === 'SUBSCRIBED' })

    // Poll periodico como fallback defensivo: si Realtime se cae o no estamos
    // conectados al websocket, igual mantenemos sync.
    //
    // 🔴 El ritmo lo decide el estado del websocket. Con Realtime conectado el
    // poll es puro respaldo y basta cada 2 minutos; sin el, vuelve a 30 s.
    //
    // Medido: cada revision vacia son ~1,1 KB entre peticion y cabeceras, y con
    // la app abierta una jornada de 8 h eso da ~1,1 MB al dia por operario — lo
    // mas caro que consume la app despues de las actualizaciones. Aflojando a 2
    // minutos cuando no hace falta, baja a ~0,3 MB. **No se apaga**: si Realtime
    // se cae en silencio, sin el poll las labores dejarian de llegar y nadie se
    // enteraria, que es mucho peor que gastar unos megas.
    const POLL_RAPIDO_MS = 30000
    const POLL_LENTO_MS = 120000
    let ultimoPoll = 0
    const TICK_MS = 10000
    const pollId = window.setInterval(() => {
      if (document.visibilityState !== 'visible' || !navigator.onLine) return
      const cada = realtimeVivo ? POLL_LENTO_MS : POLL_RAPIDO_MS
      const ahora = Date.now()
      if (ahora - ultimoPoll < cada) return
      ultimoPoll = ahora
      void loadAssignments().then((r) => {
        // 🔴 Solo se toca el estado si de verdad llego algo. Antes se entregaba
        // la lista siempre, y como es un array nuevo cada vez, la app entera se
        // re-renderizaba cada 30 segundos aunque no hubiera pasado nada: un
        // tironcito cada medio minuto durante toda la jornada. Eso es lo que la
        // gente siente como "el telefono se puso lento".
        if (r.changed) onAssignmentsReloaded(r.data)
        onSyncError(r.error)
      })
    }, TICK_MS)

    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      document.removeEventListener('visibilitychange', onVisible)
      window.clearInterval(pollId)
      if (realtimeDebounce !== null) window.clearTimeout(realtimeDebounce)
      void supabase.removeChannel(channel)
    }
  }, [syncOutbox, onAssignmentsReloaded, onMaestroReloaded, onSyncError])

  return { isOnline, outboxCount, setOutboxCount, syncOutbox }
}
