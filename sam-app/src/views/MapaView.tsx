import { useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { MapaConfig } from '../domain/sam'
import { loadMapas } from '../services/samApi'
import { useAppData } from '../context/AppDataContext'
import { MapaFormModal } from '../components/MapaFormModal'
import {
  descargarMapa, borrarMapa, metaDescarga, estadoDescarga, enumerarTiles, formatoBytes,
} from '../lib/mapaOffline'

/**
 * Visor de mapas OFFLINE tipo Avenza — modo CAPAS.
 *
 * Varios mapas pueden verse AL TIEMPO: cada uno es una capa que se prende/apaga
 * y se superpone a las demás, con opacidad individual para compararlas
 * (cartografías de fechas distintas, zonas, etc.). Cada capa se descarga por
 * separado para uso sin señal. GPS solo mientras el usuario lo activa.
 * Imports ESTÁTICOS a propósito (regla 17-jul: nada de lazy chunks).
 */

const ESRI_SAT = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'

interface CapaEstado { on: boolean; op: number }

export function MapaView() {
  const { session } = useAppData()
  const puedeGestionar = session?.role === 'owner' || session?.role === 'administracion'
  const [mapas, setMapas] = useState<MapaConfig[] | null>(null)
  const [capas, setCapas] = useState<Record<string, CapaEstado>>({})
  const [formOpen, setFormOpen] = useState(false)
  // Panel de capas CONTRAÍDO por defecto (pedido del dueño): el mapa se ve de
  // una, sin la lista de capas tapando la vista. Se abre con "🗂 Capas".
  const [panelOpen, setPanelOpen] = useState(false)
  const [gpsOn, setGpsOn] = useState(false)
  const [gpsError, setGpsError] = useState('')
  const [descargandoId, setDescargandoId] = useState<string | null>(null)
  const [progreso, setProgreso] = useState<{ hechos: number; total: number } | null>(null)
  const [msg, setMsg] = useState('')
  // Contador para refrescar chips de descarga tras descargar/borrar.
  const [descargasVersion, setDescargasVersion] = useState(0)

  const contRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layersRef = useRef<Record<string, L.TileLayer>>({})
  const gpsMarkerRef = useRef<L.CircleMarker | null>(null)
  const gpsCircleRef = useRef<L.Circle | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Config de mapas: on-demand (nunca en el arranque de la app).
  useEffect(() => {
    let alive = true
    void loadMapas().then((ms) => {
      if (!alive) return
      setMapas(ms)
      // Por defecto: la primera capa prendida, el resto apagadas.
      const init: Record<string, CapaEstado> = {}
      ms.forEach((m, i) => { init[m.id] = { on: i === 0, op: 1 } })
      setCapas(init)
    })
    return () => { alive = false }
  }, [])

  const unionBounds = (ids: string[]): L.LatLngBounds | null => {
    if (!mapas) return null
    let acc: L.LatLngBounds | null = null
    for (const id of ids) {
      const m = mapas.find((x) => x.id === id)
      if (!m) continue
      const b = L.latLngBounds([m.bounds[1], m.bounds[0]], [m.bounds[3], m.bounds[2]])
      acc = acc ? acc.extend(b) : b
    }
    return acc
  }

  // Montaje del mapa Leaflet (UNA vez, cuando hay mapas).
  useEffect(() => {
    if (!mapas || mapas.length === 0 || !contRef.current || mapRef.current) return
    const minZ = Math.max(Math.min(...mapas.map((m) => m.minzoom)) - 2, 3)
    const maxZ = Math.max(...mapas.map((m) => m.maxzoom)) + 4

    const map = L.map(contRef.current, {
      zoomControl: true,
      attributionControl: false,
      minZoom: minZ,
      maxZoom: maxZ,
    })
    mapRef.current = map

    // Base satélite (Esri World Imagery).
    L.tileLayer(ESRI_SAT, { maxZoom: maxZ, maxNativeZoom: 19, zIndex: 0 }).addTo(map)

    const encendidas = mapas.filter((_, i) => i === 0).map((m) => m.id)
    const b = unionBounds(encendidas) ?? unionBounds(mapas.map((m) => m.id))
    if (b) map.fitBounds(b, { padding: [16, 16] })

    return () => {
      abortRef.current?.abort()
      map.remove()
      mapRef.current = null
      layersRef.current = {}
      gpsMarkerRef.current = null
      gpsCircleRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapas])

  // Sincroniza capas Leaflet con el estado (prender/apagar/opacidad, traslape
  // por zIndex según el orden del catálogo).
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapas) return
    mapas.forEach((m, i) => {
      const st = capas[m.id]
      const existente = layersRef.current[m.id]
      if (st?.on) {
        if (!existente) {
          const layer = L.tileLayer(`${m.tilesBase}/{z}/{x}/{y}.png`, {
            minZoom: Math.max(m.minzoom - 2, 3),
            maxZoom: (map.getMaxZoom?.() ?? m.maxzoom + 4),
            maxNativeZoom: m.maxzoom,
            minNativeZoom: m.minzoom,
            bounds: L.latLngBounds([m.bounds[1], m.bounds[0]], [m.bounds[3], m.bounds[2]]),
            opacity: st.op,
            zIndex: 10 + i,
          }).addTo(map)
          layersRef.current[m.id] = layer
        } else {
          existente.setOpacity(st.op)
        }
      } else if (existente) {
        existente.remove()
        delete layersRef.current[m.id]
      }
    })
  }, [capas, mapas])

  function toggleCapa(m: MapaConfig) {
    setCapas((prev) => {
      const next = { ...prev, [m.id]: { on: !prev[m.id]?.on, op: prev[m.id]?.op ?? 1 } }
      // Al PRENDER una capa, ajustar la vista a la unión de las visibles.
      if (next[m.id].on && mapRef.current && mapas) {
        const ids = mapas.filter((x) => next[x.id]?.on).map((x) => x.id)
        const b = unionBounds(ids)
        if (b) mapRef.current.fitBounds(b, { padding: [16, 16] })
      }
      return next
    })
  }

  // GPS on-demand (igual que antes): watch SOLO con el toggle activo.
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
    return () => {
      navigator.geolocation.clearWatch(id)
      gpsMarkerRef.current?.remove(); gpsMarkerRef.current = null
      gpsCircleRef.current?.remove(); gpsCircleRef.current = null
    }
  }, [gpsOn])

  async function handleDescargar(m: MapaConfig) {
    if (descargandoId) return
    setDescargandoId(m.id)
    setMsg('')
    setProgreso({ hechos: 0, total: enumerarTiles(m).length })
    abortRef.current = new AbortController()
    try {
      const meta = await descargarMapa(m, (hechos, total) => setProgreso({ hechos, total }), abortRef.current.signal)
      setMsg(`"${m.nombre}" guardado para uso sin señal (${meta.tiles} imágenes · ${formatoBytes(meta.bytes)}).`)
    } catch (e) {
      if ((e as DOMException)?.name === 'AbortError') setMsg('Descarga cancelada.')
      else setMsg('No se pudo completar la descarga. Revisa la señal (lo bajado no se pierde).')
    } finally {
      setDescargandoId(null)
      setProgreso(null)
      abortRef.current = null
      setDescargasVersion((v) => v + 1)
    }
  }

  async function handleBorrar(m: MapaConfig) {
    await borrarMapa(m)
    setMsg(`"${m.nombre}" eliminado del dispositivo.`)
    setDescargasVersion((v) => v + 1)
  }

  // Tras agregar/reemplazar un mapa desde el visor: recargar la lista, prender
  // la capa nueva y encuadrar la vista para verla de una.
  async function refreshTrasGuardar(accion: 'creado' | 'reemplazado', nombreMapa: string) {
    const ms = await loadMapas()
    setMapas(ms)
    setCapas((prev) => {
      const next = { ...prev }
      for (const m of ms) if (!next[m.id]) next[m.id] = { on: true, op: 1 }
      return next
    })
    const map = mapRef.current
    if (map && ms.length > 0) {
      map.setMinZoom(Math.max(Math.min(...ms.map((m) => m.minzoom)) - 2, 3))
      map.setMaxZoom(Math.max(...ms.map((m) => m.maxzoom)) + 4)
      const nuevo = ms.find((m) => m.nombre === nombreMapa)
      if (nuevo) {
        map.fitBounds(L.latLngBounds([nuevo.bounds[1], nuevo.bounds[0]], [nuevo.bounds[3], nuevo.bounds[2]]), { padding: [16, 16] })
      }
    }
    setMsg(accion === 'creado' ? `Mapa "${nombreMapa}" agregado y visible.` : `Cartografía de "${nombreMapa}" reemplazada.`)
    setDescargasVersion((v) => v + 1)
  }

  const capasOn = useMemo(
    () => (mapas ?? []).filter((m) => capas[m.id]?.on).length,
    [mapas, capas],
  )

  if (mapas === null) {
    return <section className="panel-card"><p className="muted-text">Cargando mapas…</p></section>
  }
  if (mapas.length === 0) {
    return (
      <section className="panel-card">
        <h2>Mapas</h2>
        <p className="subtle-copy">
          {puedeGestionar
            ? 'Aún no hay mapas. Agrega el primero:'
            : 'Aún no hay mapas configurados. Administración los registra.'}
        </p>
        {puedeGestionar && (
          <button type="button" className="primary-button" onClick={() => setFormOpen(true)}>
            + Agregar mapa
          </button>
        )}
        <MapaFormModal
          open={formOpen}
          onClose={() => setFormOpen(false)}
          mapas={mapas}
          onSaved={(a, n) => void refreshTrasGuardar(a, n)}
        />
      </section>
    )
  }

  const pct = progreso && progreso.total > 0 ? Math.round((progreso.hechos / progreso.total) * 100) : 0

  return (
    <section className="panel-card mapa-shell">
      <div className="mapa-toolbar">
        <button
          type="button"
          className={`inline-button${panelOpen ? ' is-active' : ''}`}
          onClick={() => setPanelOpen((v) => !v)}
        >
          🗂 Capas ({capasOn}/{mapas.length})
        </button>
        <button
          type="button"
          className={`inline-button mapa-gps-btn${gpsOn ? ' is-active' : ''}`}
          onClick={() => setGpsOn((v) => !v)}
        >
          {gpsOn ? '📍 GPS activo' : '📍 Mi ubicación'}
        </button>
        {puedeGestionar && (
          <button type="button" className="inline-button" onClick={() => setFormOpen(true)}>
            + Agregar mapa
          </button>
        )}
      </div>

      {panelOpen && (
        <div className="mapa-capas" data-refresh={descargasVersion}>
          {mapas.map((m) => {
            const st = capas[m.id] ?? { on: false, op: 1 }
            const estado = estadoDescarga(m)
            const meta = metaDescarga(m.id)
            const bajandoEsta = descargandoId === m.id
            return (
              <div key={m.id} className={`mapa-capa${st.on ? ' mapa-capa--on' : ''}`}>
                <label className="mapa-capa__check">
                  <input type="checkbox" checked={st.on} onChange={() => toggleCapa(m)} />
                  <span className="mapa-capa__nombre">{m.nombre}</span>
                </label>
                <input
                  className="mapa-capa__op"
                  type="range" min={0.1} max={1} step={0.05}
                  value={st.op}
                  disabled={!st.on}
                  onChange={(e) => setCapas((prev) => ({ ...prev, [m.id]: { on: true, op: Number(e.target.value) } }))}
                  aria-label={`Opacidad de ${m.nombre}`}
                  title="Opacidad (para ver el traslape con las otras capas)"
                />
                <span className="mapa-capa__estado">
                  {bajandoEsta ? (
                    <button type="button" className="inline-button" onClick={() => abortRef.current?.abort()}>
                      Cancelar ({pct}%)
                    </button>
                  ) : estado === 'ok' && meta ? (
                    <button
                      type="button"
                      className="inline-button"
                      onClick={() => void handleBorrar(m)}
                      title={`Descargado ${new Date(meta.fecha).toLocaleDateString('es-CO')} · ${formatoBytes(meta.bytes)} · clic para borrar`}
                    >
                      ✓ Sin señal
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="primary-button mapa-capa__descargar"
                      onClick={() => void handleDescargar(m)}
                      disabled={descargandoId != null}
                    >
                      {estado === 'desactualizado' ? '🔄 Actualizar' : '⬇ Descargar'}
                    </button>
                  )}
                </span>
              </div>
            )
          })}
        </div>
      )}

      {descargandoId && progreso && (
        <div className="mapa-progreso">
          <div className="mapa-progreso__bar"><span style={{ width: `${pct}%` }} /></div>
          <span className="mapa-progreso__txt">{progreso.hechos} / {progreso.total} imágenes ({pct}%)</span>
        </div>
      )}
      {(msg || gpsError) && <p className="subtle-copy mapa-msg">{gpsError || msg}</p>}

      <div ref={contRef} className="mapa-canvas" />

      <MapaFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        mapas={mapas}
        onSaved={(a, n) => void refreshTrasGuardar(a, n)}
      />
    </section>
  )
}

export default MapaView
