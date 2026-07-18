import { useEffect, useMemo, useState } from 'react'
import type { MapaConfig } from '../domain/sam'
import { createMapa, updateMapa } from '../services/samApi'
import { enumerarTiles, urlTile } from '../lib/mapaOffline'

/**
 * Formulario de mapa (agregar o REEMPLAZAR cartografía), compartido entre el
 * visor (MapaView, botón "+ Agregar mapa") y Catálogos → Mapas (MapasTab).
 * Autocontenido: maneja su propio busy/error. Incluye "Copiar configuración
 * de…" (precarga bounds/zooms de un mapa existente — el caso típico de una
 * cartografía nueva de la misma zona) y "⚡ Probar que responde" (fetch de un
 * tile real antes de guardar).
 */
export function MapaFormModal({
  open,
  onClose,
  editar,
  mapas,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  /** Si viene, el modal REEMPLAZA la cartografía de este mapa (update). */
  editar?: MapaConfig | null
  /** Mapas existentes (para "Copiar configuración de…"). */
  mapas: MapaConfig[]
  onSaved: (accion: 'creado' | 'reemplazado', nombre: string) => void
}) {
  const [nombre, setNombre] = useState('')
  const [tilesBase, setTilesBase] = useState('')
  const [bounds, setBounds] = useState<[string, string, string, string]>(['', '', '', ''])
  const [minzoom, setMinzoom] = useState('10')
  const [maxzoom, setMaxzoom] = useState('16')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [probando, setProbando] = useState(false)
  const [probeOk, setProbeOk] = useState<boolean | null>(null)

  // Prefill al abrir: edición completa o formulario limpio.
  useEffect(() => {
    if (!open) return
    setError('')
    setProbeOk(null)
    if (editar) {
      setNombre(editar.nombre)
      setTilesBase(editar.tilesBase)
      setBounds([String(editar.bounds[0]), String(editar.bounds[1]), String(editar.bounds[2]), String(editar.bounds[3])])
      setMinzoom(String(editar.minzoom))
      setMaxzoom(String(editar.maxzoom))
    } else {
      setNombre(''); setTilesBase(''); setBounds(['', '', '', '']); setMinzoom('10'); setMaxzoom('16')
    }
  }, [open, editar])

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

  function copiarDe(id: string) {
    const m = mapas.find((x) => x.id === id)
    if (!m) return
    setBounds([String(m.bounds[0]), String(m.bounds[1]), String(m.bounds[2]), String(m.bounds[3])])
    setMinzoom(String(m.minzoom))
    setMaxzoom(String(m.maxzoom))
  }

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
    if (b.some(isNaN) || b.every((x) => x === 0)) { setError('Los 4 límites del área (bounds) son obligatorios. Usa "Copiar configuración de…".'); return }
    const mn = Number(minzoom); const mx = Number(maxzoom)
    if (isNaN(mn) || isNaN(mx) || mn < 1 || mx > 22 || mn > mx) { setError('Zoom inválido (mín ≤ máx, entre 1 y 22).'); return }
    setBusy(true); setError('')
    try {
      if (editar) {
        await updateMapa(editar.id, {
          nombre, tilesBase,
          bounds: b as [number, number, number, number],
          minzoom: mn, maxzoom: mx,
        })
        onSaved('reemplazado', nombre.trim())
      } else {
        await createMapa({
          nombre, tilesBase,
          bounds: b as [number, number, number, number],
          minzoom: mn, maxzoom: mx,
        })
        onSaved('creado', nombre.trim())
      }
      onClose()
    } catch (err) {
      const e = err as { message?: string }
      setError(`No se pudo guardar. (${e?.message ?? 'error'})`)
    } finally { setBusy(false) }
  }

  if (!open) return null

  return (
    <div className="modal-overlay open" onClick={() => { if (!busy) onClose() }}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 'min(520px, calc(100vw - 32px))' }}>
        <div className="labor-detail-header">
          <div><p className="eyebrow">Mapas</p><h3>{editar ? 'Reemplazar cartografía' : 'Agregar mapa'}</h3></div>
          <button type="button" className="modal-close-btn" onClick={onClose} disabled={busy} aria-label="Cerrar">&#x2715;</button>
        </div>
        {editar ? (
          <p className="subtle-copy" style={{ marginTop: 0, color: '#92610a' }}>
            Estás reemplazando la cartografía de <strong>{editar.nombre}</strong>. Los equipos con la
            versión anterior descargada verán "🔄 volver a descargar".
          </p>
        ) : (
          <p className="subtle-copy" style={{ marginTop: 0 }}>
            La URL de tiles es la de FieldMaps:
            <code style={{ fontSize: '0.72rem', display: 'block', marginTop: 4 }}>…/storage/v1/object/public/tiles/&lt;org&gt;/&lt;mapa&gt;</code>
          </p>
        )}

        {!editar && mapas.length > 0 && (
          <label>
            Copiar configuración de… <span className="field-optional">(precarga área y zooms)</span>
            <select defaultValue="" onChange={(e) => { if (e.target.value) copiarDe(e.target.value) }} disabled={busy}>
              <option value="">— elegir mapa —</option>
              {mapas.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
            </select>
          </label>
        )}

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
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
          <button type="button" className="inline-button" onClick={() => void probar()} disabled={probando || busy || !tilesBase.trim()}>
            {probando ? 'Probando…' : '⚡ Probar que responde'}
          </button>
          {probeOk === true && <span style={{ color: 'var(--color-brand)', fontWeight: 700, fontSize: '0.85rem' }}>✓ El mapa responde</span>}
          {probeOk === false && <span style={{ color: '#b3261e', fontWeight: 700, fontSize: '0.85rem' }}>✕ No responde — revisa URL/bounds</span>}
        </div>
        {error && <p className="subtle-copy" style={{ color: '#b3261e', margin: '6px 0 0' }}>{error}</p>}
        <div className="modal-footer">
          <button type="button" className="inline-button" onClick={onClose} disabled={busy}>Cancelar</button>
          <button type="button" className="primary-button" onClick={() => void guardar()} disabled={busy}>
            {busy ? 'Guardando…' : editar ? 'Reemplazar cartografía' : 'Agregar mapa'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default MapaFormModal
