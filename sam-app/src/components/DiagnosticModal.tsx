import { useEffect, useState } from 'react'
import { db } from '../lib/db'
import { loadAssignments } from '../services/samApi'
import { SUPABASE_URL } from '../data/constants'
import type { Assignment, UserProfile } from '../domain/sam'

// Pantalla de diagnostico para que el usuario y soporte puedan ver de un
// vistazo si la app esta sincronizada con el servidor o si algo se rompio
// silenciosamente. Cuando un operador diga "no veo mis labores", abrir esto
// y la causa salta a la vista (cache vacio, lastSync viejo, backend caido,
// session.id distinto al esperado, etc).

interface DiagnosticModalProps {
  session: UserProfile
  assignmentsInState: Assignment[]
  isOnline: boolean
  outboxCount: number
  onClose: () => void
  onAssignmentsReloaded: (data: Assignment[]) => void
}

interface DiagnosticState {
  loading: boolean
  cacheTotal: number
  cacheMine: number
  lastSync: string | null
  backendStatus: 'pending' | 'ok' | 'fail'
  backendLatencyMs: number | null
  backendError: string | null
}

export function DiagnosticModal({
  session,
  assignmentsInState,
  isOnline,
  outboxCount,
  onClose,
  onAssignmentsReloaded,
}: DiagnosticModalProps) {
  const [state, setState] = useState<DiagnosticState>({
    loading: true,
    cacheTotal: 0,
    cacheMine: 0,
    lastSync: null,
    backendStatus: 'pending',
    backendLatencyMs: null,
    backendError: null,
  })
  const [actionMessage, setActionMessage] = useState<string>('')
  const [actionBusy, setActionBusy] = useState(false)

  async function refresh() {
    setState((s) => ({ ...s, loading: true, backendStatus: 'pending' }))
    const cacheAll = await db.assignments.toArray()
    const lastSyncRow = await db.meta.get('assignments_last_sync')
    const mine = cacheAll.filter(
      (a) => (a.operatorId || '').toUpperCase() === session.id.toUpperCase(),
    ).length

    // Ping al healthz del backend. Usamos timeout corto para no colgar el
    // modal si el VPS esta muerto.
    let backendStatus: 'ok' | 'fail' = 'fail'
    let backendLatencyMs: number | null = null
    let backendError: string | null = null
    const ctrl = new AbortController()
    const timeout = window.setTimeout(() => ctrl.abort(), 5000)
    const t0 = performance.now()
    try {
      const res = await fetch(`${SUPABASE_URL}/healthz`, { signal: ctrl.signal })
      backendLatencyMs = Math.round(performance.now() - t0)
      if (res.ok) backendStatus = 'ok'
      else backendError = `HTTP ${res.status}`
    } catch (err) {
      backendError = err instanceof Error ? err.message : 'desconocido'
    } finally {
      window.clearTimeout(timeout)
    }

    setState({
      loading: false,
      cacheTotal: cacheAll.length,
      cacheMine: mine,
      lastSync: lastSyncRow?.value ?? null,
      backendStatus,
      backendLatencyMs,
      backendError,
    })
  }

  useEffect(() => {
    void refresh()
  }, [])

  async function forceSync() {
    setActionBusy(true)
    setActionMessage('')
    try {
      await db.meta.delete('assignments_last_sync')
      const result = await loadAssignments()
      onAssignmentsReloaded(result.data)
      setActionMessage(`Sincronizado: ${result.data.length} asignaciones recargadas.`)
      void refresh()
    } catch (err) {
      setActionMessage(
        err instanceof Error
          ? `Error al sincronizar: ${err.message}`
          : 'Error al sincronizar.',
      )
    } finally {
      setActionBusy(false)
    }
  }

  async function clearCacheAndReload() {
    if (!window.confirm('Esto borra el cache local y recarga la app. ¿Continuar?')) return
    setActionBusy(true)
    try {
      await db.assignments.clear()
      await db.outbox.clear()
      await db.meta.clear()
    } catch {
      // ignore
    }
    window.location.reload()
  }

  const lastSyncLabel = state.lastSync
    ? formatRelative(new Date(state.lastSync))
    : 'nunca'

  return (
    <div className="modal-overlay open" onClick={onClose}>
      <div
        className="modal-card diagnostic-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="labor-detail-header"
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}
        >
          <h3 style={{ margin: 0 }}>Diagnóstico</h3>
          <button
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            aria-label="Cerrar"
          >
            ×
          </button>
        </div>

        <dl className="diagnostic-grid">
          <dt>Versión del bundle</dt>
          <dd>
            <code>{__APP_VERSION__}</code>
            <span className="diagnostic-hint">{__APP_BUILD_TIME__.slice(0, 19)}</span>
          </dd>

          <dt>Conexión</dt>
          <dd>
            <span className={`diagnostic-pill diagnostic-pill--${isOnline ? 'ok' : 'fail'}`}>
              {isOnline ? 'En línea' : 'Sin conexión'}
            </span>
          </dd>

          <dt>Backend ({hostnameOf(SUPABASE_URL)})</dt>
          <dd>
            {state.backendStatus === 'pending' ? (
              <span className="diagnostic-hint">probando…</span>
            ) : state.backendStatus === 'ok' ? (
              <span className="diagnostic-pill diagnostic-pill--ok">
                OK · {state.backendLatencyMs}ms
              </span>
            ) : (
              <span className="diagnostic-pill diagnostic-pill--fail">
                Falla{state.backendError ? ` · ${state.backendError}` : ''}
              </span>
            )}
          </dd>

          <dt>Sesión actual</dt>
          <dd>
            <code>{session.id}</code> · {session.name}
          </dd>

          <dt>Última sincronización</dt>
          <dd>{lastSyncLabel}</dd>

          <dt>Asignaciones en cache</dt>
          <dd>
            {state.cacheTotal} totales · <strong>{state.cacheMine} tuyas</strong>
          </dd>

          <dt>En la vista actual</dt>
          <dd>{assignmentsInState.length} asignaciones</dd>

          <dt>Cambios sin sincronizar</dt>
          <dd>
            {outboxCount === 0 ? (
              <span className="diagnostic-pill diagnostic-pill--ok">0</span>
            ) : (
              <span className="diagnostic-pill diagnostic-pill--warn">{outboxCount}</span>
            )}
          </dd>
        </dl>

        {actionMessage && <p className="diagnostic-action-msg">{actionMessage}</p>}

        <div className="modal-footer diagnostic-actions">
          <button
            type="button"
            className="inline-button"
            onClick={clearCacheAndReload}
            disabled={actionBusy}
          >
            Limpiar cache y reiniciar
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={forceSync}
            disabled={actionBusy || !isOnline}
          >
            {actionBusy ? 'Sincronizando…' : 'Forzar sync ahora'}
          </button>
        </div>
      </div>
    </div>
  )
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

function formatRelative(date: Date): string {
  const diffMs = Date.now() - date.getTime()
  const diffSec = Math.round(diffMs / 1000)
  if (diffSec < 60) return `hace ${diffSec}s`
  const diffMin = Math.round(diffSec / 60)
  if (diffMin < 60) return `hace ${diffMin} min`
  const diffHr = Math.round(diffMin / 60)
  if (diffHr < 24) return `hace ${diffHr}h`
  return date.toLocaleString('es-CO', { timeZone: 'America/Bogota' })
}
