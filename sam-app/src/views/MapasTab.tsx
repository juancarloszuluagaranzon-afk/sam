import { useEffect, useState } from 'react'
import { useAppData } from '../context/AppDataContext'
import { updateMapa, deleteMapa, loadMapasAdmin } from '../services/samApi'
import { metaDescarga, formatoBytes } from '../lib/mapaOffline'
import { MapaFormModal } from '../components/MapaFormModal'
import type { MapaConfig } from '../domain/sam'

/**
 * Pestaña "Mapas" (SOLO propietario/jefe y administración) — submenú Catálogos.
 *
 * Gestión autoservicio de los mapas del visor offline: agregar, REEMPLAZAR la
 * cartografía (cuando cambia el plano), renombrar, ocultar/mostrar y eliminar.
 * El formulario (con "Copiar configuración" y "Probar que responde") es el
 * componente compartido MapaFormModal — el mismo del botón "+ Agregar mapa"
 * del visor. Los tiles se generan subiendo el GeoPDF a FieldMaps.
 */
export function MapasTab() {
  const { session, busy, setBusy, setError, setInfo } = useAppData()

  const [mapas, setMapas] = useState<MapaConfig[]>([])
  const [cargando, setCargando] = useState(true)
  const [formOpen, setFormOpen] = useState(false)
  // null = agregando; con valor = REEMPLAZANDO la cartografía de ese mapa.
  const [editTarget, setEditTarget] = useState<MapaConfig | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<MapaConfig | null>(null)

  const puede = session?.role === 'owner' || session?.role === 'administracion'

  async function refresh() {
    setCargando(true)
    try { setMapas(await loadMapasAdmin()) } finally { setCargando(false) }
  }
  useEffect(() => { void refresh() }, [])

  async function toggleActivo(m: MapaConfig) {
    setBusy(true); setError('')
    try {
      await updateMapa(m.id, { activo: !m.activo })
      setInfo(m.activo ? `"${m.nombre}" ocultado del visor.` : `"${m.nombre}" visible en el visor.`)
      void refresh()
    } catch (err) {
      const e = err as { message?: string }
      setError(`No se pudo cambiar. (${e?.message ?? 'error'})`)
    } finally { setBusy(false) }
  }

  async function renombrar(m: MapaConfig) {
    const nuevo = window.prompt(`Nuevo nombre para "${m.nombre}":`, m.nombre)
    if (!nuevo?.trim() || nuevo.trim() === m.nombre) return
    setBusy(true); setError('')
    try {
      await updateMapa(m.id, { nombre: nuevo.trim() })
      setInfo('Mapa renombrado.')
      void refresh()
    } catch (err) {
      const e = err as { message?: string }
      setError(`No se pudo renombrar. (${e?.message ?? 'error'})`)
    } finally { setBusy(false) }
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    setBusy(true); setError('')
    try {
      await deleteMapa(deleteTarget.id)
      setInfo(`Mapa "${deleteTarget.nombre}" eliminado del catálogo.`)
      setDeleteTarget(null)
      void refresh()
    } catch (err) {
      const e = err as { message?: string }
      setError(`No se pudo eliminar. (${e?.message ?? 'error'})`)
    } finally { setBusy(false) }
  }

  if (!puede) {
    return <section className="panel-card"><p className="muted-text">Solo el jefe o administración gestiona los mapas.</p></section>
  }

  return (
    <section className="panel-card">
      <div className="panel-title split">
        <h2>Mapas — catálogo</h2>
        <button type="button" className="primary-button" onClick={() => { setEditTarget(null); setFormOpen(true) }} disabled={busy}>
          + Agregar mapa
        </button>
      </div>
      <p className="subtle-copy" style={{ marginTop: 0 }}>
        Los mapas aparecen en el visor (pestaña Mapa) para todos los roles como capas que se
        superponen, y cada uno se descarga para uso <strong>sin señal</strong>. Cuando la
        cartografía cambie, usa <strong>🔄 Reemplazar</strong>: el mapa conserva su identidad y
        los equipos verán el aviso de re-descarga.
      </p>

      {cargando ? (
        <p className="muted-text">Cargando…</p>
      ) : (
        <div className="inv-list">
          {mapas.map((m) => {
            const meta = metaDescarga(m.id)
            return (
              <div key={m.id} className={`inv-row${m.activo ? '' : ' inv-row--off'}`}>
                <div className="inv-row__main">
                  <strong>{m.nombre}</strong>
                  <span className="inv-cat inv-cat--mat">z{m.minzoom}–{m.maxzoom}</span>
                  {!m.activo && <span className="inv-cat inv-cat--off">Oculto</span>}
                  {meta && <span className="inv-cat inv-cat--comb">⬇ en este equipo ({formatoBytes(meta.bytes)})</span>}
                </div>
                <div className="inv-row__actions">
                  <button type="button" className="inline-button" onClick={() => { setEditTarget(m); setFormOpen(true) }} disabled={busy} title="La cartografía cambió: apuntar este mapa a la versión nueva">
                    🔄 Reemplazar
                  </button>
                  <button type="button" className="inline-button" onClick={() => void renombrar(m)} disabled={busy}>Renombrar</button>
                  <button type="button" className="inline-button" onClick={() => void toggleActivo(m)} disabled={busy}>
                    {m.activo ? 'Ocultar' : 'Mostrar'}
                  </button>
                  <button type="button" className="inline-button maestro-delete-btn" onClick={() => setDeleteTarget(m)} disabled={busy}>
                    Eliminar
                  </button>
                </div>
              </div>
            )
          })}
          {mapas.length === 0 && <p className="muted-text">Sin mapas. Agrega el primero.</p>}
        </div>
      )}

      <MapaFormModal
        open={formOpen}
        onClose={() => { setFormOpen(false); setEditTarget(null) }}
        editar={editTarget}
        mapas={mapas}
        onSaved={(accion, nombre) => {
          setInfo(accion === 'creado'
            ? `Mapa "${nombre}" agregado. Ya aparece en el visor para todos.`
            : `Cartografía de "${nombre}" reemplazada. Los equipos con la versión anterior verán el aviso de re-descarga.`)
          void refresh()
        }}
      />

      {deleteTarget && (
        <div className="modal-overlay open" onClick={() => setDeleteTarget(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 'min(440px, calc(100vw - 32px))' }}>
            <div className="labor-detail-header">
              <div><p className="eyebrow">Mapas</p><h3>¿Eliminar este mapa?</h3></div>
              <button type="button" className="modal-close-btn" onClick={() => setDeleteTarget(null)} disabled={busy} aria-label="Cerrar">&#x2715;</button>
            </div>
            <p className="subtle-copy" style={{ marginTop: 0 }}><strong>{deleteTarget.nombre}</strong></p>
            <p className="subtle-copy">
              Deja de aparecer en el visor de todos. Las descargas offline en los teléfonos no se
              borran solas (cada quien la borra desde el visor). Si solo quieres esconderlo, usa <strong>Ocultar</strong>.
            </p>
            <div className="modal-footer">
              <button type="button" className="inline-button" onClick={() => setDeleteTarget(null)} disabled={busy}>Cancelar</button>
              <button type="button" className="release-confirm-btn" onClick={() => void confirmDelete()} disabled={busy}>
                {busy ? 'Eliminando…' : 'Sí, eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

export default MapasTab
