import { useEffect, useMemo, useState } from 'react'
import { useAppData } from '../context/AppDataContext'
import { createMapa, updateMapa, deleteMapa, loadMapasAdmin } from '../services/samApi'
import { metaDescarga, enumerarTiles, urlTile, formatoBytes } from '../lib/mapaOffline'
import type { MapaConfig } from '../domain/sam'

/**
 * Pestaña "Mapas" (propietario / administración) — submenú Catálogos.
 *
 * Gestión autoservicio de los mapas del visor offline: agregar los que se
 * quiera (con validación en vivo de que los tiles responden), renombrar,
 * activar/desactivar y eliminar. Los tiles los genera FieldMaps (subir el PDF
 * allá); aquí solo se registra la configuración para que aparezca en ASM.
 * "Copiar configuración" precarga bounds/zooms de un mapa existente — el caso
 * típico de un PDF nuevo de la misma zona.
 */
export function MapasTab() {
  const { session, busy, setBusy, setError, setInfo } = useAppData()

  const [mapas, setMapas] = useState<MapaConfig[]>([])
  const [cargando, setCargando] = useState(true)
  const [formOpen, setFormOpen] = useState(false)
  const [nombre, setNombre] = useState('')
  const [tilesBase, setTilesBase] = useState('')
  const [bounds, setBounds] = useState<[string, string, string, string]>(['', '', '', ''])
  const [minzoom, setMinzoom] = useState('10')
  const [maxzoom, setMaxzoom] = useState('16')
  const [probando, setProbando] = useState(false)
  const [probeOk, setProbeOk] = useState<boolean | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<MapaConfig | null>(null)

  const puede = session?.role === 'owner' || session?.role === 'administracion'

  async function refresh() {
    setCargando(true)
    try { setMapas(await loadMapasAdmin()) } finally { setCargando(false) }
  }
  useEffect(() => { void refresh() }, [])

  const tilesEstimados = useMemo(() => {
    const b = bounds.map(Number)
    const mn = Number(minzoom); const mx = Number(maxzoom)
    if (b.some(isNaN) || b.every((x) => x === 0) || isNaN(mn) || isNaN(mx) || mn > mx) return null
    try {
      return enumerarTiles({
        id: '', nombre: '', tilesBase: '', activo: true,
        bounds: b as [number, number, number, number], minzoom: mn, maxzoom: mx,
      }).length
    } catch { return null }
  }, [bounds, minzoom, maxzoom])

  function copiarDe(m: MapaConfig) {
    setBounds([String(m.bounds[0]), String(m.bounds[1]), String(m.bounds[2]), String(m.bounds[3])])
    setMinzoom(String(m.minzoom))
    setMaxzoom(String(m.maxzoom))
    setInfo(`Configuración copiada de "${m.nombre}". Cambia el nombre y la URL de tiles.`)
  }

  // Validación en vivo: probar que la URL sirve un tile real (el del centro
  // del área al zoom mínimo). Feedback inmediato sin adivinar.
  async function probar() {
    setProbando(true)
    setProbeOk(null)
    try {
      const b = bounds.map(Number) as [number, number, number, number]
      const cfg: MapaConfig = {
        id: '', nombre: '', activo: true,
        tilesBase: tilesBase.trim().replace(/\/$/, ''),
        bounds: b, minzoom: Number(minzoom), maxzoom: Number(maxzoom),
      }
      const tiles = enumerarTiles({ ...cfg, maxzoom: cfg.minzoom })
      const centro = tiles[Math.floor(tiles.length / 2)]
      const res = await fetch(urlTile(cfg, centro))
      setProbeOk(res.ok)
    } catch {
      setProbeOk(false)
    } finally { setProbando(false) }
  }

  async function guardar() {
    const b = bounds.map(Number)
    if (!nombre.trim()) { setError('Ponle un nombre al mapa.'); return }
    if (!tilesBase.trim().startsWith('http')) { setError('La URL de tiles debe empezar por https://'); return }
    if (b.some(isNaN) || b.every((x) => x === 0)) { setError('Los 4 límites del área (bounds) son obligatorios.'); return }
    const mn = Number(minzoom); const mx = Number(maxzoom)
    if (isNaN(mn) || isNaN(mx) || mn < 1 || mx > 22 || mn > mx) { setError('Zoom inválido (mín ≤ máx, entre 1 y 22).'); return }
    setBusy(true); setError('')
    try {
      await createMapa({
        nombre, tilesBase,
        bounds: b as [number, number, number, number],
        minzoom: mn, maxzoom: mx,
      })
      setInfo(`Mapa "${nombre.trim()}" agregado. Ya aparece en el visor para todos.`)
      setFormOpen(false)
      setNombre(''); setTilesBase(''); setBounds(['', '', '', '']); setMinzoom('10'); setMaxzoom('16'); setProbeOk(null)
      void refresh()
    } catch (err) {
      const e = err as { message?: string }
      setError(`No se pudo agregar. (${e?.message ?? 'error'})`)
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
    return <section className="panel-card"><p className="muted-text">Solo el dueño o administración gestiona los mapas.</p></section>
  }

  return (
    <section className="panel-card">
      <div className="panel-title split">
        <h2>Mapas — catálogo</h2>
        <button type="button" className="primary-button" onClick={() => setFormOpen(true)} disabled={busy}>
          + Agregar mapa
        </button>
      </div>
      <p className="subtle-copy" style={{ marginTop: 0 }}>
        Los mapas registrados aquí aparecen en el visor (pestaña Mapa) para todos los roles, y
        cada uno se puede <strong>descargar para uso sin señal</strong>. Los tiles se generan
        subiendo el GeoPDF a FieldMaps; aquí solo se registra su configuración.
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
                  <button type="button" className="inline-button" onClick={() => copiarDe(m)} disabled={busy} title="Usar sus bounds/zooms para un mapa nuevo">
                    Copiar config
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

      {formOpen && (
        <div className="modal-overlay open" onClick={() => setFormOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 'min(520px, calc(100vw - 32px))' }}>
            <div className="labor-detail-header">
              <div><p className="eyebrow">Mapas</p><h3>Agregar mapa</h3></div>
              <button type="button" className="modal-close-btn" onClick={() => setFormOpen(false)} disabled={busy} aria-label="Cerrar">&#x2715;</button>
            </div>
            <p className="subtle-copy" style={{ marginTop: 0 }}>
              Tip: usa <strong>Copiar config</strong> en un mapa existente de la misma zona y solo
              cambia nombre y URL. La URL de tiles es la de FieldMaps:
              <code style={{ fontSize: '0.72rem', display: 'block', marginTop: 4 }}>…/storage/v1/object/public/tiles/&lt;org&gt;/&lt;mapa&gt;</code>
            </p>
            <label>
              Nombre
              <input type="text" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="ej. CARTOGRAFIA AGOSTO" disabled={busy} autoFocus />
            </label>
            <label>
              URL base de tiles
              <input type="text" value={tilesBase} onChange={(e) => { setTilesBase(e.target.value); setProbeOk(null) }} placeholder="https://api.mapview.surcoapp.tech/storage/v1/object/public/tiles/…" disabled={busy} />
            </label>
            <div className="mapa-form-grid">
              <label>Lon mín<input type="number" step="any" value={bounds[0]} onChange={(e) => setBounds([e.target.value, bounds[1], bounds[2], bounds[3]])} disabled={busy} /></label>
              <label>Lat mín<input type="number" step="any" value={bounds[1]} onChange={(e) => setBounds([bounds[0], e.target.value, bounds[2], bounds[3]])} disabled={busy} /></label>
              <label>Lon máx<input type="number" step="any" value={bounds[2]} onChange={(e) => setBounds([bounds[0], bounds[1], e.target.value, bounds[3]])} disabled={busy} /></label>
              <label>Lat máx<input type="number" step="any" value={bounds[3]} onChange={(e) => setBounds([bounds[0], bounds[1], bounds[2], e.target.value])} disabled={busy} /></label>
              <label>Zoom mín<input type="number" min={1} max={22} value={minzoom} onChange={(e) => setMinzoom(e.target.value)} disabled={busy} /></label>
              <label>Zoom máx<input type="number" min={1} max={22} value={maxzoom} onChange={(e) => setMaxzoom(e.target.value)} disabled={busy} /></label>
            </div>
            {tilesEstimados != null && (
              <p className="subtle-copy" style={{ margin: '4px 0 0' }}>
                ≈ {tilesEstimados.toLocaleString('es-CO')} imágenes para la descarga offline.
              </p>
            )}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
              <button type="button" className="inline-button" onClick={() => void probar()} disabled={probando || busy || !tilesBase.trim()}>
                {probando ? 'Probando…' : '⚡ Probar que responde'}
              </button>
              {probeOk === true && <span style={{ color: 'var(--color-brand)', fontWeight: 700, fontSize: '0.85rem' }}>✓ El mapa responde</span>}
              {probeOk === false && <span style={{ color: '#b3261e', fontWeight: 700, fontSize: '0.85rem' }}>✕ No responde — revisa URL/bounds</span>}
            </div>
            <div className="modal-footer">
              <button type="button" className="inline-button" onClick={() => setFormOpen(false)} disabled={busy}>Cancelar</button>
              <button type="button" className="primary-button" onClick={() => void guardar()} disabled={busy}>
                {busy ? 'Guardando…' : 'Agregar mapa'}
              </button>
            </div>
          </div>
        </div>
      )}

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
