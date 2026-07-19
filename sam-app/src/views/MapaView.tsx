import { useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
// Rotación del mapa estilo Avenza (dos dedos en móvil, Shift+arrastrar en PC).
import 'leaflet-rotate'
import type { MapaConfig } from '../domain/sam'
import { loadMapas } from '../services/samApi'
import { useAppData } from '../context/AppDataContext'
import { MapaFormModal } from '../components/MapaFormModal'
import {
  descargarMapa, borrarMapa, metaDescarga, estadoDescarga, enumerarTiles, formatoBytes,
} from '../lib/mapaOffline'

/**
 * Visor de mapas OFFLINE — visual IDÉNTICA a Avenza Maps (pedido del dueño):
 * pantalla completa oscura, barra superior negra (← título ℹ️ 🔍), mapa a
 * sangre con retícula central, botones flotantes circulares (GPS y brújula),
 * barra inferior negra con píldora de estado GPS y botón de capas que abre
 * una hoja oscura desde abajo.
 *
 * Conserva TODAS las funciones propias: capas múltiples superpuestas con
 * opacidad individual, descarga offline por capa (+ aviso 🔄 si administración
 * reemplazó la cartografía), y "+ Agregar mapa" para admin/jefe.
 * Imports ESTÁTICOS a propósito (regla 17-jul: nada de lazy chunks).
 */

const ESRI_SAT = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'

interface CapaEstado { on: boolean; op: number }

export function MapaView({ onBack }: { onBack?: () => void } = {}) {
  const { session } = useAppData()
  const puedeGestionar = session?.role === 'owner' || session?.role === 'administracion'

  const [mapas, setMapas] = useState<MapaConfig[] | null>(null)
  const [capas, setCapas] = useState<Record<string, CapaEstado>>({})
  const [sheetOpen, setSheetOpen] = useState(false)
  const [infoOpen, setInfoOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [q, setQ] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [gpsOn, setGpsOn] = useState(false)
  const [gpsPos, setGpsPos] = useState<{ lat: number; lng: number; acc: number } | null>(null)
  const [gpsError, setGpsError] = useState('')
  const [descargandoId, setDescargandoId] = useState<string | null>(null)
  const [progreso, setProgreso] = useState<{ hechos: number; total: number } | null>(null)
  const [msg, setMsg] = useState('')
  // Rumbo actual del mapa (grados). La aguja de la brújula gira con él.
  const [bearing, setBearing] = useState(0)
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

  // Montaje del mapa Leaflet (UNA vez, cuando hay mapas). Sin botones +/- :
  // como Avenza, se navega con pellizco/rueda.
  useEffect(() => {
    if (!mapas || mapas.length === 0 || !contRef.current || mapRef.current) return
    const minZ = Math.max(Math.min(...mapas.map((m) => m.minzoom)) - 2, 3)
    const maxZ = Math.max(...mapas.map((m) => m.maxzoom)) + 4

    const map = L.map(contRef.current, {
      zoomControl: false,
      attributionControl: false,
      minZoom: minZ,
      maxZoom: maxZ,
      // Rotación estilo Avenza (plugin leaflet-rotate).
      rotate: true,
      touchRotate: true,
      shiftKeyRotate: true,
      rotateControl: false,
      bearing: 0,
    })
    mapRef.current = map
    // La aguja de la brújula sigue el rumbo del mapa en vivo.
    map.on('rotate', () => setBearing(map.getBearing()))

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

  // Sincroniza capas Leaflet con el estado (traslape por zIndex del catálogo).
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
      if (next[m.id].on && mapRef.current && mapas) {
        const ids = mapas.filter((x) => next[x.id]?.on).map((x) => x.id)
        const b = unionBounds(ids)
        if (b) mapRef.current.fitBounds(b, { padding: [16, 16] })
      }
      return next
    })
  }

  // GPS on-demand: watch SOLO con el botón activo (batería).
  useEffect(() => {
    const map = mapRef.current
    if (!gpsOn || !map) return
    if (!('geolocation' in navigator)) { setGpsError('Este dispositivo no tiene GPS disponible.'); setGpsOn(false); return }
    setGpsError('')
    let centrado = false
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const ll = L.latLng(pos.coords.latitude, pos.coords.longitude)
        setGpsPos({ lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy })
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
      setGpsPos(null)
    }
  }, [gpsOn])

  // Mensajes transitorios (toast estilo Avenza).
  useEffect(() => {
    if (!msg) return
    const t = setTimeout(() => setMsg(''), 5000)
    return () => clearTimeout(t)
  }, [msg])

  async function handleDescargar(m: MapaConfig) {
    if (descargandoId) return
    setDescargandoId(m.id)
    setMsg('')
    setProgreso({ hechos: 0, total: enumerarTiles(m).length })
    abortRef.current = new AbortController()
    try {
      const meta = await descargarMapa(m, (hechos, total) => setProgreso({ hechos, total }), abortRef.current.signal)
      setMsg(`"${m.nombre}" guardado sin señal (${meta.tiles} imágenes · ${formatoBytes(meta.bytes)}).`)
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

  // Brújula (como Avenza): SOLO orienta el mapa al norte. Nunca toca el zoom
  // ni el encuadre (el fallback de fitBounds en el segundo toque quitaba todo
  // el zoom — corregido a pedido del dueño, 17-jul).
  function handleBrujula() {
    const map = mapRef.current
    if (!map) return
    map.setBearing(0)
    setBearing(0)
  }

  const capasOn = useMemo(
    () => (mapas ?? []).filter((m) => capas[m.id]?.on),
    [mapas, capas],
  )
  const titulo = capasOn.length === 1 ? capasOn[0].nombre : capasOn.length > 1 ? `Mapas (${capasOn.length})` : 'Mapa'
  const pct = progreso && progreso.total > 0 ? Math.round((progreso.hechos / progreso.total) * 100) : 0
  const listaSheet = (mapas ?? []).filter((m) => !q.trim() || m.nombre.toLowerCase().includes(q.trim().toLowerCase()))

  // Píldora inferior estilo Avenza: estado del GPS (o de la descarga en curso).
  const pillTexto = descargandoId && progreso
    ? `Descargando… ${pct}%`
    : gpsError
      ? gpsError
      : gpsOn
        ? gpsPos
          ? `${gpsPos.lat.toFixed(5)}, ${gpsPos.lng.toFixed(5)} · ±${Math.round(gpsPos.acc)} m`
          : 'Buscando señal GPS…'
        : 'Inactivo'

  if (mapas === null) {
    return (
      <div className="avz-shell">
        <header className="avz-top">
          {onBack && <button type="button" className="avz-iconbtn" onClick={onBack} aria-label="Volver"><BackIcon /></button>}
          <h1>Mapa</h1>
        </header>
        <div className="avz-body"><p className="avz-cargando">Cargando mapas…</p></div>
      </div>
    )
  }

  if (mapas.length === 0) {
    return (
      <div className="avz-shell">
        <header className="avz-top">
          {onBack && <button type="button" className="avz-iconbtn" onClick={onBack} aria-label="Volver"><BackIcon /></button>}
          <h1>Mapa</h1>
        </header>
        <div className="avz-body">
          <div className="avz-vacio">
            <p>{puedeGestionar ? 'Aún no hay mapas. Agrega el primero:' : 'Aún no hay mapas configurados. Administración los registra.'}</p>
            {puedeGestionar && (
              <button type="button" className="primary-button" onClick={() => setFormOpen(true)}>+ Agregar mapa</button>
            )}
          </div>
        </div>
        <MapaFormModal open={formOpen} onClose={() => setFormOpen(false)} mapas={mapas} onSaved={(a, n) => void refreshTrasGuardar(a, n)} />
      </div>
    )
  }

  return (
    <div className="avz-shell">
      {/* Barra superior negra: ← TÍTULO ℹ️ 🔍 (idéntica a Avenza) */}
      <header className="avz-top">
        {onBack && <button type="button" className="avz-iconbtn" onClick={onBack} aria-label="Volver"><BackIcon /></button>}
        <h1>{titulo}</h1>
        <button type="button" className="avz-iconbtn" onClick={() => setInfoOpen(true)} aria-label="Información del mapa"><InfoIcon /></button>
        <button type="button" className="avz-iconbtn" onClick={() => { setSearchOpen((v) => !v); setSheetOpen(true) }} aria-label="Buscar mapa"><SearchIcon /></button>
      </header>
      {searchOpen && (
        <div className="avz-search">
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar mapa…"
            autoFocus
          />
        </div>
      )}

      <div className="avz-body">
        <div ref={contRef} className="avz-map" />

        {/* Retícula central (como Avenza) */}
        <div className="avz-crosshair" aria-hidden>
          <svg viewBox="0 0 44 44" width="44" height="44">
            <g stroke="#fff" strokeWidth="5" fill="none" opacity="0.9">
              <circle cx="22" cy="22" r="9" />
              <path d="M22 2v9M22 33v9M2 22h9M33 22h9" />
            </g>
            <g stroke="#111" strokeWidth="2.4" fill="none">
              <circle cx="22" cy="22" r="9" />
              <path d="M22 2v9M22 33v9M2 22h9M33 22h9" />
            </g>
            <circle cx="22" cy="22" r="1.6" fill="#111" />
          </svg>
        </div>

        {/* Botones flotantes circulares (GPS y brújula), como Avenza */}
        <div className="avz-fabs">
          <button
            type="button"
            className={`avz-fab${gpsOn ? ' is-active' : ''}`}
            onClick={() => setGpsOn((v) => !v)}
            aria-label={gpsOn ? 'Apagar GPS' : 'Mi ubicación'}
          >
            <GpsIcon />
          </button>
          <button type="button" className="avz-fab" onClick={handleBrujula} aria-label="Orientar al norte">
            {/* La aguja gira en vivo con el rumbo del mapa (igual que Avenza). */}
            <span className="avz-fab__needle" style={{ transform: `rotate(${bearing}deg)` }}>
              <CompassIcon />
            </span>
          </button>
        </div>

        {msg && <div className="avz-toast">{msg}</div>}
        {descargandoId && progreso && (
          <div className="avz-progress"><span style={{ width: `${pct}%` }} /></div>
        )}

        {/* Hoja de CAPAS (desde abajo, oscura, como el panel de Avenza) */}
        {sheetOpen && (
          <div className="avz-sheet" data-refresh={descargasVersion}>
            <div className="avz-sheet__head">
              <strong>Capas</strong>
              <div style={{ display: 'flex', gap: 8 }}>
                {puedeGestionar && (
                  <button type="button" className="avz-sheet__add" onClick={() => setFormOpen(true)}>+ Agregar mapa</button>
                )}
                <button type="button" className="avz-iconbtn" onClick={() => { setSheetOpen(false); setSearchOpen(false); setQ('') }} aria-label="Cerrar capas">✕</button>
              </div>
            </div>
            {listaSheet.map((m) => {
              const st = capas[m.id] ?? { on: false, op: 1 }
              const estado = estadoDescarga(m)
              const meta = metaDescarga(m.id)
              const bajandoEsta = descargandoId === m.id
              return (
                <div key={m.id} className={`avz-capa${st.on ? ' is-on' : ''}`}>
                  <label className="avz-capa__check">
                    <input type="checkbox" checked={st.on} onChange={() => toggleCapa(m)} />
                    <span className="avz-capa__nombre">{m.nombre}</span>
                  </label>
                  <input
                    className="avz-capa__op"
                    type="range" min={0.1} max={1} step={0.05}
                    value={st.op}
                    disabled={!st.on}
                    onChange={(e) => setCapas((prev) => ({ ...prev, [m.id]: { on: true, op: Number(e.target.value) } }))}
                    aria-label={`Opacidad de ${m.nombre}`}
                    title="Opacidad (para ver el traslape con las otras capas)"
                  />
                  <span className="avz-capa__estado">
                    {bajandoEsta ? (
                      <button type="button" className="avz-capa__btn" onClick={() => abortRef.current?.abort()}>
                        Cancelar ({pct}%)
                      </button>
                    ) : estado === 'ok' && meta ? (
                      <button
                        type="button"
                        className="avz-capa__btn is-ok"
                        onClick={() => void handleBorrar(m)}
                        title={`Descargado ${new Date(meta.fecha).toLocaleDateString('es-CO')} · ${formatoBytes(meta.bytes)} · clic para borrar`}
                      >
                        ✓ Sin señal
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="avz-capa__btn is-dl"
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
            {listaSheet.length === 0 && <p className="avz-sheet__vacio">Sin resultados para "{q}".</p>}
          </div>
        )}
      </div>

      {/* Barra inferior negra: descarga · píldora de estado · capas (como Avenza) */}
      <footer className="avz-bottom">
        <button type="button" className="avz-iconbtn" onClick={() => setSheetOpen(true)} aria-label="Descargas sin señal"><DownloadIcon /></button>
        <div className={`avz-pill${gpsOn ? ' is-gps' : ''}`}>{pillTexto}</div>
        <button type="button" className="avz-iconbtn" onClick={() => setSheetOpen((v) => !v)} aria-label="Capas"><LayersIcon /></button>
      </footer>

      {/* Modal ℹ️: detalle de los mapas (info útil real, estilo app) */}
      {infoOpen && (
        <div className="modal-overlay open" onClick={() => setInfoOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 'min(440px, calc(100vw - 32px))' }}>
            <div className="labor-detail-header">
              <div><p className="eyebrow">Mapas</p><h3>Información</h3></div>
              <button type="button" className="modal-close-btn" onClick={() => setInfoOpen(false)} aria-label="Cerrar">&#x2715;</button>
            </div>
            {(mapas ?? []).map((m) => {
              const meta = metaDescarga(m.id)
              const estado = estadoDescarga(m)
              return (
                <p key={m.id} className="subtle-copy" style={{ margin: '6px 0' }}>
                  <strong>{m.nombre}</strong> — zoom {m.minzoom}–{m.maxzoom}<br />
                  {estado === 'ok' && meta
                    ? `✓ Descargado en este equipo (${formatoBytes(meta.bytes)}, ${new Date(meta.fecha).toLocaleDateString('es-CO')})`
                    : estado === 'desactualizado'
                      ? '🔄 Cartografía actualizada — vuelve a descargar'
                      : 'Sin descarga en este equipo (requiere señal)'}
                </p>
              )
            })}
          </div>
        </div>
      )}

      <MapaFormModal open={formOpen} onClose={() => setFormOpen(false)} mapas={mapas} onSaved={(a, n) => void refreshTrasGuardar(a, n)} />
    </div>
  )
}

/* ── Iconos (trazo blanco, estilo Avenza) ── */

function BackIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M19 12H5" /><path d="m12 19-7-7 7-7" />
    </svg>
  )
}

function InfoIcon() {
  return (
    <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <circle cx="12" cy="12" r="9" /><path d="M12 16v-5" /><path d="M12 8h.01" />
    </svg>
  )
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
      <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
    </svg>
  )
}

function GpsIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden>
      <path d="M21.4 2.6 12.9 21.5c-.2.5-.9.4-1-.1l-1.8-8.1-8.1-1.8c-.5-.1-.6-.8-.1-1L20.8 2c.4-.2.8.2.6.6Z" />
    </svg>
  )
}

function CompassIcon() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden>
      <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <text x="12" y="7.6" textAnchor="middle" fontSize="5.2" fill="currentColor" fontWeight="700">N</text>
      <path d="M12 8.5 14 15h-4Z" fill="#e53935" />
      <path d="m12 15.5-2-0.5h4Z" fill="#fff" />
    </svg>
  )
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M4 21h16" />
    </svg>
  )
}

function LayersIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m12 2 9 5-9 5-9-5 9-5Z" /><path d="m3 12 9 5 9-5" /><path d="m3 17 9 5 9-5" />
    </svg>
  )
}

export default MapaView
