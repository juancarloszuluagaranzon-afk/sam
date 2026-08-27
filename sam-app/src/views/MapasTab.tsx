import { useEffect, useRef, useState } from 'react'
import { useAppData } from '../context/AppDataContext'
import { updateMapa, deleteMapa, loadMapasAdmin, createMapa, guardarOrdenMapas,
         loadCartografiasDescartadas, descartarCartografia } from '../services/samApi'
import { metaDescarga, formatoBytes } from '../lib/mapaOffline'
import { listarCartografias, type CartografiaRemota } from '../services/fieldmapsApi'
import { MapaFormModal } from '../components/MapaFormModal'
import type { MapaConfig } from '../domain/sam'
import { Ayuda } from '../components/Ayuda'

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
  // Planos ya procesados en FieldMaps que aún no están en el visor (subidos en
  // segundo plano). Se agregan con un clic. Detectados automáticamente.
  const [procesados, setProcesados] = useState<CartografiaRemota[]>([])
  const timerRef = useRef<number | null>(null)

  const puede = session?.role === 'owner' || session?.role === 'administracion'

  // Reconcilia el catálogo de ASM con lo procesado en FieldMaps: lo que ya está
  // 'ready' y no está registrado aparece en "Listos para agregar".
  async function reconciliar() {
    try {
      const [ms, remotos, descartadas] = await Promise.all([
        loadMapasAdmin(), listarCartografias(), loadCartografiasDescartadas(),
      ])
      setMapas(ms)
      const norm = (u: string) => u.replace(/\/$/, '')
      const existentes = new Set(ms.map((m) => norm(m.tilesBase)))
      // Se descartan tambien los planos que YA fueron reemplazados: siguen
      // procesados en FieldMaps y sin dueno en ASM, asi que sin este filtro la
      // pantalla los ofrece de vuelta con su nombre viejo, como si acabaran de
      // llegar. Paso con los dos de PICHICHI.
      setProcesados(remotos.filter((r) => r.status === 'ready' && r.tilesBase
        && !existentes.has(norm(r.tilesBase)) && !descartadas.has(norm(r.tilesBase))))
    } catch { /* FieldMaps no respondió: no bloquea el catálogo */ }
  }

  async function refresh() {
    setCargando(true)
    try { await reconciliar() } finally { setCargando(false) }
  }
  useEffect(() => {
    void refresh()
    // Auto-detecta planos que terminan de procesarse (cada 30 s).
    timerRef.current = window.setInterval(() => { void reconciliar() }, 30_000)
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function agregarProcesado(r: CartografiaRemota) {
    if (!r.tilesBase || !r.bounds) return
    setBusy(true); setError('')
    try {
      await createMapa({
        nombre: r.nombre?.trim() || 'MAPA',
        tilesBase: r.tilesBase,
        bounds: r.bounds,
        minzoom: r.minzoom ?? 8,
        maxzoom: r.maxzoom ?? 16,
      })
      setInfo(`"${r.nombre}" agregado al visor.`)
      void reconciliar()
    } catch (err) {
      const e = err as { message?: string }
      setError(`No se pudo agregar. (${e?.message ?? 'error'})`)
    } finally { setBusy(false) }
  }

  /**
   * Sube o baja un mapa en la lista.
   *
   * Se mueve en pantalla PRIMERO y se guarda despues: el jefe acomoda ocho mapas
   * a punta de flechas y esperar el viaje al servidor en cada toque haria que la
   * lista se sienta trabada. Si el guardado falla se recarga del servidor, que es
   * la verdad.
   */
  async function mover(i: number, hacia: -1 | 1) {
    const j = i + hacia
    if (j < 0 || j >= mapas.length) return
    const nuevo = mapas.slice()
    ;[nuevo[i], nuevo[j]] = [nuevo[j], nuevo[i]]
    setMapas(nuevo)
    setError('')
    try {
      await guardarOrdenMapas(nuevo)
    } catch (err) {
      const e = err as { message?: string }
      setError(`No se pudo guardar el orden. (${e?.message ?? 'error'})`)
      void refresh()
    }
  }

  /** Saca un plano de "Listos para agregar" sin borrarlo de FieldMaps: la
   *  version anterior sirve de respaldo si el reemplazo salio mal. */
  async function ocultarProcesado(r: CartografiaRemota) {
    if (!r.tilesBase) return
    setBusy(true); setError('')
    try {
      await descartarCartografia(r.tilesBase, r.nombre ?? undefined, 'Ocultado a mano')
      setInfo(`"${r.nombre}" ya no se va a ofrecer.`)
      void reconciliar()
    } catch (err) {
      const e = err as { message?: string }
      setError(`No se pudo ocultar. (${e?.message ?? 'error'})`)
    } finally { setBusy(false) }
  }

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
      <Ayuda>
        <p>Los mapas aparecen en el visor (pestaña Mapa) para todos los roles como capas que se
        superponen, y cada uno se descarga para uso <strong>sin señal</strong>. Cuando la
        cartografía cambie, usa <strong>🔄 Reemplazar</strong>: el mapa conserva su identidad y
        los equipos verán el aviso de re-descarga.</p>
        <p>El <strong>orden de esta lista es el que ve todo el mundo</strong> en el visor:
        acomódalo con <strong>↑ ↓</strong> y deja de primeros los que más se abren. Un mapa
        recién agregado entra de último hasta que lo ubiques.</p>
      </Ayuda>

      {procesados.length > 0 && (
        <div className="mapa-listos">
          <p className="mapa-listos__lbl">🆕 Listos para agregar <span className="field-optional">(planos ya procesados)</span></p>
          {procesados.map((r) => (
            <div key={r.mapId} className="mapa-listos__row">
              <div className="mapa-listos__info">
                <strong>{r.nombre}</strong>
                <span className="inv-cat inv-cat--comb">✓ procesado · z{r.minzoom}–{r.maxzoom}</span>
              </div>
              <button type="button" className="inline-button" onClick={() => void ocultarProcesado(r)} disabled={busy}
                      title="No volver a ofrecerlo (no se borra de FieldMaps)">Ocultar</button>
              <button type="button" className="primary-button" onClick={() => void agregarProcesado(r)} disabled={busy}>
                + Agregar al visor
              </button>
            </div>
          ))}
        </div>
      )}

      {cargando ? (
        <p className="muted-text">Cargando…</p>
      ) : (
        <div className="inv-list">
          {mapas.map((m, i) => {
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
                  <button type="button" className="inline-button" onClick={() => void mover(i, -1)}
                          disabled={busy || i === 0} title="Subir en la lista" aria-label={`Subir ${m.nombre}`}>↑</button>
                  <button type="button" className="inline-button" onClick={() => void mover(i, 1)}
                          disabled={busy || i === mapas.length - 1} title="Bajar en la lista" aria-label={`Bajar ${m.nombre}`}>↓</button>
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
          if (accion === 'procesando') {
            setInfo(`"${nombre}" subido. Se está procesando — aparecerá aquí en "Listos para agregar" en unos minutos.`)
          } else {
            setInfo(accion === 'creado'
              ? `Mapa "${nombre}" agregado. Ya aparece en el visor para todos.`
              : `Cartografía de "${nombre}" reemplazada. Los equipos con la versión anterior verán el aviso de re-descarga.`)
          }
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
