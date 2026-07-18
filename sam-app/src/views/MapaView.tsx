import { useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { MapaConfig } from '../domain/sam'
import { loadMapas } from '../services/samApi'
import {
  descargarMapa, borrarMapa, metaDescarga, estadoDescarga, enumerarTiles, formatoBytes,
  type MapaDescargaMeta,
} from '../lib/mapaOffline'

/**
 * Visor de mapas OFFLINE tipo Avenza (Fase 1).
 *
 * - Va en un chunk LAZY (React.lazy) → cero impacto en el arranque de ASM.
 * - Tiles: los que FieldMaps ya genera (bucket público, cache 1 año). ASM no
 *   genera ni sirve tiles; tras la descarga offline, cero red.
 * - Offline: botón "Descargar" baja todos los tiles a Cache Storage con
 *   progreso (la regla runtimeCaching del SW sirve cache-first el mismo cache).
 * - GPS: watchPosition SOLO mientras el usuario lo activa y el visor está
 *   montado; se apaga al salir (cero GPS con el mapa cerrado).
 */

const ESRI_SAT = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'

export function MapaView() {
  const [mapas, setMapas] = useState<MapaConfig[] | null>(null)
  const [activo, setActivo] = useState<MapaConfig | null>(null)
  const [opacidad, setOpacidad] = useState(1)
  const [gpsOn, setGpsOn] = useState(false)
  const [gpsError, setGpsError] = useState('')
  const [descargando, setDescargando] = useState(false)
  const [progreso, setProgreso] = useState<{ hechos: number; total: number } | null>(null)
  const [meta, setMeta] = useState<MapaDescargaMeta | null>(null)
  const [msg, setMsg] = useState('')

  const contRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const overlayRef = useRef<L.TileLayer | null>(null)
  const gpsWatchRef = useRef<number | null>(null)
  const gpsMarkerRef = useRef<L.CircleMarker | null>(null)
  const gpsCircleRef = useRef<L.Circle | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Config de mapas: on-demand (nunca en el arranque de la app).
  useEffect(() => {
    let alive = true
    void loadMapas().then((ms) => {
      if (!alive) return
      setMapas(ms)
      if (ms.length > 0) setActivo(ms[0])
    })
    return () => { alive = false }
  }, [])

  useEffect(() => {
    setMeta(activo ? metaDescarga(activo.id) : null)
  }, [activo])

  const totalTiles = useMemo(() => (activo ? enumerarTiles(activo).length : 0), [activo])

  // Montaje del mapa Leaflet.
  useEffect(() => {
    if (!activo || !contRef.current) return
    const [minLon, minLat, maxLon, maxLat] = activo.bounds
    const bounds = L.latLngBounds([minLat, minLon], [maxLat, maxLon])

    const map = L.map(contRef.current, {
      zoomControl: true,
      attributionControl: false,
      maxZoom: activo.maxzoom + 4, // overzoom visual (reescala el último nivel)
      minZoom: Math.max(activo.minzoom - 2, 3),
    })
    mapRef.current = map

    // Base satélite (Esri World Imagery — mismo fondo que FieldMaps).
    L.tileLayer(ESRI_SAT, { maxZoom: activo.maxzoom + 4, maxNativeZoom: 19 }).addTo(map)

    // Overlay del plano (GeoPDF tileado por FieldMaps).
    const overlay = L.tileLayer(`${activo.tilesBase}/{z}/{x}/{y}.png`, {
      minZoom: Math.max(activo.minzoom - 2, 3),
      maxZoom: activo.maxzoom + 4,
      maxNativeZoom: activo.maxzoom,
      minNativeZoom: activo.minzoom,
      bounds,
      opacity: opacidad,
    }).addTo(map)
    overlayRef.current = overlay

    map.fitBounds(bounds, { padding: [16, 16] })

    return () => {
      // Cleanup total: GPS + mapa (cero consumo con el visor cerrado).
      if (gpsWatchRef.current != null) {
        navigator.geolocation.clearWatch(gpsWatchRef.current)
        gpsWatchRef.current = null
      }
      abortRef.current?.abort()
      map.remove()
      mapRef.current = null
      overlayRef.current = null
      gpsMarkerRef.current = null
      gpsCircleRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activo])

  useEffect(() => {
    overlayRef.current?.setOpacity(opacidad)
  }, [opacidad])

  // GPS on-demand: watch SOLO con el toggle activo; cleanup al apagar/salir.
  useEffect(() => {
    const map = mapRef.current
    if (!gpsOn || !map) return
    if (!('geolocation' in navigator)) { setGpsError('Este dispositivo no tiene GPS disponible.'); setGpsOn(false); return }
    setGpsError('')
    let centrado = false
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const ll = L.latLng(pos.coords.latitude, pos.coords.longitude)
        if (!gpsMarkerRef.current) {
          gpsCircleRef.current = L.circle(ll, { radius: pos.coords.accuracy, weight: 1, color: '#1d6fd1', fillColor: '#1d6fd1', fillOpacity: 0.12 }).addTo(map)
          gpsMarkerRef.current = L.circleMarker(ll, { radius: 7, weight: 2, color: '#fff', fillColor: '#1d6fd1', fillOpacity: 1 }).addTo(map)
        } else {
          gpsMarkerRef.current.setLatLng(ll)
          gpsCircleRef.current?.setLatLng(ll)
          gpsCircleRef.current?.setRadius(pos.coords.accuracy)
        }
        if (!centrado) { map.setView(ll, Math.max(map.getZoom(), 15)); centrado = true }
      },
      (err) => {
        setGpsError(err.code === 1 ? 'Permiso de ubicación denegado.' : 'No se pudo obtener la ubicación.')
        setGpsOn(false)
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
    )
    gpsWatchRef.current = id
    return () => {
      navigator.geolocation.clearWatch(id)
      gpsWatchRef.current = null
      gpsMarkerRef.current?.remove(); gpsMarkerRef.current = null
      gpsCircleRef.current?.remove(); gpsCircleRef.current = null
    }
  }, [gpsOn])

  async function handleDescargar() {
    if (!activo || descargando) return
    setDescargando(true)
    setMsg('')
    setProgreso({ hechos: 0, total: totalTiles })
    abortRef.current = new AbortController()
    try {
      const m = await descargarMapa(activo, (hechos, total) => setProgreso({ hechos, total }), abortRef.current.signal)
      setMeta(m)
      setMsg(`Mapa guardado para uso sin señal (${m.tiles} imágenes · ${formatoBytes(m.bytes)}).`)
    } catch (e) {
      if ((e as DOMException)?.name === 'AbortError') setMsg('Descarga cancelada.')
      else setMsg('No se pudo completar la descarga. Revisa la señal e inténtalo de nuevo (lo ya bajado no se pierde).')
    } finally {
      setDescargando(false)
      setProgreso(null)
      abortRef.current = null
    }
  }

  async function handleBorrar() {
    if (!activo) return
    await borrarMapa(activo)
    setMeta(null)
    setMsg('Mapa eliminado del dispositivo.')
  }

  if (mapas === null) {
    return <section className="panel-card"><p className="muted-text">Cargando mapas…</p></section>
  }
  if (mapas.length === 0) {
    return (
      <section className="panel-card">
        <h2>Mapas</h2>
        <p className="subtle-copy">
          Aún no hay mapas configurados. Administración debe registrar el mapa
          (Catálogo de mapas) para que aparezca aquí.
        </p>
      </section>
    )
  }

  const pct = progreso && progreso.total > 0 ? Math.round((progreso.hechos / progreso.total) * 100) : 0

  return (
    <section className="mapa-shell">
      <div className="mapa-toolbar">
        {mapas.length > 1 && (
          <select
            value={activo?.id ?? ''}
            onChange={(e) => setActivo(mapas.find((m) => m.id === e.target.value) ?? null)}
            aria-label="Mapa"
          >
            {mapas.map((m) => (
              <option key={m.id} value={m.id}>
                {estadoDescarga(m) === 'ok' ? `✓ ${m.nombre}` : estadoDescarga(m) === 'desactualizado' ? `🔄 ${m.nombre}` : m.nombre}
              </option>
            ))}
          </select>
        )}
        <button
          type="button"
          className={`inline-button mapa-gps-btn${gpsOn ? ' is-active' : ''}`}
          onClick={() => setGpsOn((v) => !v)}
        >
          {gpsOn ? '📍 GPS activo' : '📍 Mi ubicación'}
        </button>
        <label className="mapa-opacidad">
          Plano
          <input type="range" min={0} max={1} step={0.05} value={opacidad} onChange={(e) => setOpacidad(Number(e.target.value))} />
        </label>
        {!descargando ? (
          activo && estadoDescarga(activo) === 'ok' && meta ? (
            <button type="button" className="inline-button" onClick={() => void handleBorrar()} title={`Descargado ${new Date(meta.fecha).toLocaleDateString('es-CO')} · ${formatoBytes(meta.bytes)}`}>
              ✓ Sin señal OK · Borrar
            </button>
          ) : (
            <button type="button" className="primary-button mapa-descargar-btn" onClick={() => void handleDescargar()}>
              {activo && estadoDescarga(activo) === 'desactualizado'
                ? '🔄 Plano actualizado — volver a descargar'
                : '⬇ Descargar para usar sin señal'}
            </button>
          )
        ) : (
          <button type="button" className="inline-button" onClick={() => abortRef.current?.abort()}>
            Cancelar ({pct}%)
          </button>
        )}
      </div>

      {descargando && progreso && (
        <div className="mapa-progreso">
          <div className="mapa-progreso__bar"><span style={{ width: `${pct}%` }} /></div>
          <span className="mapa-progreso__txt">{progreso.hechos} / {progreso.total} imágenes ({pct}%)</span>
        </div>
      )}
      {(msg || gpsError) && <p className="subtle-copy mapa-msg">{gpsError || msg}</p>}

      <div ref={contRef} className="mapa-canvas" />
    </section>
  )
}

export default MapaView
