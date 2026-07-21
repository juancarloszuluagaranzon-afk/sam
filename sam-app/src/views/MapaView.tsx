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
import {
  MARCADOR_COLORS, actualizarMedicion, borrarMarcador, borrarMedicion, crearMarcador, crearMedicion,
  errorRelativoPct, formatHectareas, formatMetros, leerMarcadores, leerMediciones,
  lineLengthM, polygonAreaHa, polygonPerimeterM,
  type LngLat, type Marcador, type Medicion,
} from '../lib/mapaGeo'
import type { MaestroRow } from '../domain/sam'

/** Precisión (m) por encima de la cual se avisa que el GPS es pobre (§ original). */
const PRECISION_POBRE_M = 30

/** Permiso de orientación (obligatorio en iOS 13+, dentro del gesto del click). */
async function pedirPermisoBrujula(): Promise<boolean> {
  if (typeof window === 'undefined' || !('DeviceOrientationEvent' in window)) return false
  const ctor = window.DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<'granted' | 'denied'> }
  if (typeof ctor.requestPermission === 'function') {
    try { return (await ctor.requestPermission()) === 'granted' } catch { return false }
  }
  return true // Android/escritorio: sin permiso explícito.
}

/** Rumbo de la brújula del teléfono a partir del evento (iOS y Android). */
function rumboDesdeEvento(e: DeviceOrientationEvent & { webkitCompassHeading?: number }): number | null {
  if (typeof e.webkitCompassHeading === 'number' && !Number.isNaN(e.webkitCompassHeading)) {
    return e.webkitCompassHeading
  }
  if (e.absolute === true && typeof e.alpha === 'number') {
    const angulo = window.screen?.orientation?.angle ?? 0
    return (360 - e.alpha + angulo + 360) % 360
  }
  return null
}

/** Posición del dedo/mouse convertida a lat/lng del mapa (respeta rotación). */
function punteroLatLng(ev: MouseEvent | TouchEvent, map: L.Map): L.LatLng {
  const t = 'touches' in ev ? (ev.touches[0] ?? ev.changedTouches[0]) : ev
  const rect = map.getContainer().getBoundingClientRect()
  return map.containerPointToLatLng(L.point(t.clientX - rect.left, t.clientY - rect.top))
}

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
  const { session, maestro } = useAppData()
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

  // ── Herramientas portadas del proyecto original (FieldMaps): medir
  // distancia/área, marcadores y mediciones guardadas — todo offline. ──
  const [toolsOpen, setToolsOpen] = useState(false)
  const [measureMode, setMeasureMode] = useState<'off' | 'distancia' | 'area'>('off')
  const [vertices, setVertices] = useState<LngLat[]>([])
  // Vértices "en vivo" mientras se ARRASTRA un punto (solo para el valor del
  // panel; la figura se actualiza directo en Leaflet sin re-render).
  const [liveVerts, setLiveVerts] = useState<LngLat[] | null>(null)
  // Sensibilidad del arrastre de puntos (persistente por equipo): 1 = 1:1
  // (rápido, sigue el dedo); <1 = fino (el punto se mueve MENOS que el dedo,
  // para clavar la esquina exacta sobre el lindero). Se lee en un ref para que
  // el handler de arrastre siempre use el valor vigente sin re-crear markers.
  const [arrastreSens, setArrastreSens] = useState<number>(() => {
    const raw = Number(localStorage.getItem('sam-mapa-arrastre-sens'))
    return raw >= 0.15 && raw <= 1 ? raw : 1
  })
  const sensRef = useRef(1)
  sensRef.current = arrastreSens
  const [guardandoMed, setGuardandoMed] = useState(false)
  const [nombreMed, setNombreMed] = useState('')
  // Panel de medición compacto: "Comparar suerte" + "Sensibilidad" van dentro
  // de un desplegable (cerrado por defecto) para no tapar media pantalla.
  const [medAjustes, setMedAjustes] = useState(false)
  const [marcadoresOpen, setMarcadoresOpen] = useState(false)
  const [marcadores, setMarcadores] = useState<Marcador[]>(() => leerMarcadores())
  const [creandoMarcador, setCreandoMarcador] = useState(false)
  const [mNombre, setMNombre] = useState('')
  const [mNota, setMNota] = useState('')
  const [mColor, setMColor] = useState<string>(MARCADOR_COLORS[0])
  const [medicionesOpen, setMedicionesOpen] = useState(false)
  const [mediciones, setMediciones] = useState<Medicion[]>(() => leerMediciones())
  const [medicionVistaId, setMedicionVistaId] = useState<string | null>(null)
  // Si viene con id, la medición en curso ACTUALIZA esa guardada (edición de
  // puntos) en vez de crear una nueva.
  const [editMedId, setEditMedId] = useState<string | null>(null)
  // Fondo del visor: satélite (Esri) o plano (sin fondo) — como el original.
  const [baseSat, setBaseSat] = useState(true)
  // Brújula del teléfono: rumbo hacia donde MIRA el usuario (cono azul).
  const [compassOn, setCompassOn] = useState(false)
  // Contraste del área medida vs área oficial de una suerte del maestro.
  const [oficialSel, setOficialSel] = useState<MaestroRow | null>(null)
  const [oficialQ, setOficialQ] = useState('')
  // Contador para refrescar chips de descarga tras descargar/borrar.
  const [descargasVersion, setDescargasVersion] = useState(0)

  const contRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layersRef = useRef<Record<string, L.TileLayer>>({})
  const gpsMarkerRef = useRef<L.CircleMarker | null>(null)
  const gpsCircleRef = useRef<L.Circle | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  // Capas de dibujo de las herramientas (viven sobre el mapa).
  const measureLayerRef = useRef<L.LayerGroup | null>(null)
  const marcadoresLayerRef = useRef<L.LayerGroup | null>(null)
  const medicionLayerRef = useRef<L.LayerGroup | null>(null)
  const baseLayerRef = useRef<L.TileLayer | null>(null)
  const conoRef = useRef<L.Polygon | null>(null)
  const headingRef = useRef<number | null>(null)

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
    // Capas de las herramientas (medición en curso, marcadores, medición guardada).
    measureLayerRef.current = L.layerGroup().addTo(map)
    marcadoresLayerRef.current = L.layerGroup().addTo(map)
    medicionLayerRef.current = L.layerGroup().addTo(map)

    // SIN detectRetina (lección 19-jul): con retina Leaflet pide tiles un nivel
    // MÁS PROFUNDO del que existe → al acercar mucho el PDF desaparecía y el
    // satélite salía en cuadros grises. maxNativeZoom 17 (límite real de Esri
    // en zona rural): más allá se ESTIRA la imagen — siempre visible.
    baseLayerRef.current = L.tileLayer(ESRI_SAT, { maxZoom: maxZ, maxNativeZoom: 17, zIndex: 0 }).addTo(map)

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
      measureLayerRef.current = null
      marcadoresLayerRef.current = null
      medicionLayerRef.current = null
      baseLayerRef.current = null
      conoRef.current = null
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
            // SIN detectRetina: pedía tiles inexistentes al acercar (ver base).
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

  // Fondo Satélite/Plano (como el original): "Plano" oculta el satélite para
  // leer la cartografía limpia (y gasta menos datos).
  useEffect(() => {
    baseLayerRef.current?.setOpacity(baseSat ? 1 : 0)
  }, [baseSat, mapas])

  // Cono de rumbo (brújula del teléfono): sector azul desde tu posición hacia
  // donde MIRAS — portado del original. Solo con GPS activo y permiso dado.
  useEffect(() => {
    const map = mapRef.current
    if (!compassOn || !gpsOn || !map) return
    if (!('DeviceOrientationEvent' in window)) return
    let ultimo = 0
    const onOrient = (ev: Event) => {
      const ahora = Date.now()
      if (ahora - ultimo < 100) return // ~10 Hz basta
      ultimo = ahora
      const heading = rumboDesdeEvento(ev as DeviceOrientationEvent)
      if (heading == null) return
      headingRef.current = heading
      const pos = gpsMarkerRef.current?.getLatLng()
      if (!pos) return
      // Sector de ±25° y radio ~3× la precisión (mín 20 m).
      const radioM = Math.max((gpsCircleRef.current?.getRadius() ?? 15) * 1.5, 20)
      const pts: [number, number][] = [[pos.lat, pos.lng]]
      for (let a = -25; a <= 25; a += 10) {
        const az = ((heading + a) * Math.PI) / 180
        const dLat = (radioM * Math.cos(az)) / 111320
        const dLng = (radioM * Math.sin(az)) / (111320 * Math.cos((pos.lat * Math.PI) / 180))
        pts.push([pos.lat + dLat, pos.lng + dLng])
      }
      if (!conoRef.current) {
        conoRef.current = L.polygon(pts, { stroke: false, fillColor: '#1d6fd1', fillOpacity: 0.28, interactive: false }).addTo(map)
      } else {
        conoRef.current.setLatLngs(pts)
      }
    }
    window.addEventListener('deviceorientationabsolute', onOrient)
    window.addEventListener('deviceorientation', onOrient)
    return () => {
      window.removeEventListener('deviceorientationabsolute', onOrient)
      window.removeEventListener('deviceorientation', onOrient)
      conoRef.current?.remove()
      conoRef.current = null
      headingRef.current = null
    }
  }, [compassOn, gpsOn])

  // Dibujo en vivo de la medición (amarillo, como el original). Los puntos son
  // ARRASTRABLES con SENSIBILIDAD ajustable: se usa arrastre propio (no el de
  // Leaflet) para poder escalar el movimiento — con sensibilidad "fina" el
  // punto se mueve menos que el dedo, permitiendo clavar la esquina exacta.
  // La figura y el valor se reajustan en vivo; al soltar se confirma el estado.
  useEffect(() => {
    const lg = measureLayerRef.current
    const map = mapRef.current
    if (!lg) return
    lg.clearLayers()
    if (measureMode === 'off' || vertices.length === 0) return
    const aLatLngs = (vs: LngLat[]) => vs.map((v) => [v[1], v[0]] as [number, number])
    let figura: L.Polygon | L.Polyline | null = null
    if (measureMode === 'area' && vertices.length >= 3) {
      figura = L.polygon(aLatLngs(vertices), { color: '#facc15', weight: 3, fillColor: '#facc15', fillOpacity: 0.18 }).addTo(lg)
    } else if (vertices.length >= 2) {
      figura = L.polyline(aLatLngs(vertices), { color: '#facc15', weight: 3, dashArray: measureMode === 'area' ? '6 6' : undefined }).addTo(lg)
    }
    const updateFigura = (nv: LngLat[]) => {
      if (!figura) return
      if (figura instanceof L.Polygon) figura.setLatLngs([aLatLngs(nv)])
      else figura.setLatLngs(aLatLngs(nv))
    }
    vertices.forEach((v, i) => {
      const mk = L.marker([v[1], v[0]], {
        draggable: false,
        keyboard: false,
        icon: L.divIcon({ className: `avz-vertex${i === 0 ? ' avz-vertex--first' : ''}`, iconSize: [24, 24], iconAnchor: [12, 12] }),
      }).addTo(lg)
      const el = mk.getElement()
      if (!el || !map) return
      const onDown = (ev: MouseEvent | TouchEvent) => {
        ev.preventDefault()
        ev.stopPropagation()
        map.dragging.disable()
        el.classList.add('is-drag')
        const anclaPunto = mk.getLatLng()       // dónde arranca el vértice
        const anclaDedo = punteroLatLng(ev, map) // dónde arranca el dedo
        const move = (mv: MouseEvent | TouchEvent) => {
          if (mv.cancelable) mv.preventDefault()
          const cur = punteroLatLng(mv, map)
          const ratio = sensRef.current // <1 = movimiento fino
          const nll = L.latLng(
            anclaPunto.lat + (cur.lat - anclaDedo.lat) * ratio,
            anclaPunto.lng + (cur.lng - anclaDedo.lng) * ratio,
          )
          mk.setLatLng(nll)
          const nv: LngLat[] = vertices.map((p, j) => (j === i ? [nll.lng, nll.lat] : p))
          updateFigura(nv)
          setLiveVerts(nv)
        }
        const up = () => {
          document.removeEventListener('mousemove', move)
          document.removeEventListener('touchmove', move)
          document.removeEventListener('mouseup', up)
          document.removeEventListener('touchend', up)
          map.dragging.enable()
          el.classList.remove('is-drag')
          const fll = mk.getLatLng()
          setVertices((prev) => prev.map((p, j) => (j === i ? [fll.lng, fll.lat] as LngLat : p)))
          setLiveVerts(null)
        }
        document.addEventListener('mousemove', move, { passive: false })
        document.addEventListener('touchmove', move, { passive: false })
        document.addEventListener('mouseup', up)
        document.addEventListener('touchend', up)
      }
      el.addEventListener('mousedown', onDown)
      el.addEventListener('touchstart', onDown, { passive: false })
    })
  }, [vertices, measureMode, mapas])

  // En modo medición, un toque en el mapa también marca un punto (además de
  // "✛ Marcar" con la cruz central y "+ GPS").
  useEffect(() => {
    const map = mapRef.current
    if (!map || measureMode === 'off') return
    const onClick = (e: L.LeafletMouseEvent) => {
      setVertices((prev) => [...prev, [e.latlng.lng, e.latlng.lat]])
    }
    map.on('click', onClick)
    return () => { map.off('click', onClick) }
  }, [measureMode, mapas])

  // Marcadores del equipo pintados en el mapa (color + nombre).
  useEffect(() => {
    const lg = marcadoresLayerRef.current
    if (!lg) return
    lg.clearLayers()
    for (const m of marcadores) {
      L.circleMarker([m.lat, m.lon], { radius: 7, weight: 2, color: '#fff', fillColor: m.color, fillOpacity: 1 })
        .bindTooltip(m.nombre, { direction: 'top', offset: L.point(0, -8) })
        .addTo(lg)
    }
  }, [marcadores, mapas])

  // Medición guardada seleccionada: se dibuja (azul) y se encuadra.
  useEffect(() => {
    const lg = medicionLayerRef.current
    const map = mapRef.current
    if (!lg || !map) return
    lg.clearLayers()
    if (!medicionVistaId) return
    const med = mediciones.find((x) => x.id === medicionVistaId)
    if (!med || med.vertices.length === 0) return
    const latlngs = med.vertices.map((v) => [v[1], v[0]] as [number, number])
    const layer = med.tipo === 'area'
      ? L.polygon(latlngs, { color: '#4da3ff', weight: 3, fillColor: '#4da3ff', fillOpacity: 0.15 })
      : L.polyline(latlngs, { color: '#4da3ff', weight: 3 })
    layer.bindTooltip(`${med.nombre}: ${med.tipo === 'area' ? formatHectareas(med.valor) : formatMetros(med.valor)}`)
    layer.addTo(lg)
    map.fitBounds(layer.getBounds(), { padding: [40, 40] })
  }, [medicionVistaId, mediciones, mapas])

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
  //
  // Precisión: `enableHighAccuracy` obliga al teléfono a usar el chip GNSS con
  // TODAS las constelaciones que soporte (GPS + GLONASS + Galileo + BeiDou) en
  // vez de wifi/celdas, y `maximumAge: 0` prohíbe lecturas cacheadas. Además,
  // en vez de saltar con cada lectura (el GPS "rebota"), se mantiene una
  // ventana de las lecturas de los últimos 8 s y se usa LA MÁS PRECISA — el
  // punto se estabiliza y "+ GPS" marca siempre con la mejor lectura. Cuantos
  // más segundos lleve encendido, más satélites engancha y mejor la precisión.
  useEffect(() => {
    const map = mapRef.current
    if (!gpsOn || !map) return
    if (!('geolocation' in navigator)) { setGpsError('Este dispositivo no tiene GPS disponible.'); setGpsOn(false); return }
    setGpsError('')
    let centrado = false
    const VENTANA_MS = 8000
    const lecturas: { lat: number; lng: number; acc: number; t: number }[] = []
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const ahora = Date.now()
        lecturas.push({ lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy, t: ahora })
        while (lecturas.length > 0 && ahora - lecturas[0].t > VENTANA_MS) lecturas.shift()
        // La mejor lectura reciente (menor error en metros) manda.
        const mejor = lecturas.reduce((a, b) => (b.acc < a.acc ? b : a))
        const ll = L.latLng(mejor.lat, mejor.lng)
        setGpsPos({ lat: mejor.lat, lng: mejor.lng, acc: mejor.acc })
        if (!gpsMarkerRef.current) {
          gpsCircleRef.current = L.circle(ll, { radius: mejor.acc, weight: 1, color: '#1d6fd1', fillColor: '#1d6fd1', fillOpacity: 0.12 }).addTo(map)
          gpsMarkerRef.current = L.circleMarker(ll, { radius: 7, weight: 2, color: '#fff', fillColor: '#1d6fd1', fillOpacity: 1 }).addTo(map)
        } else {
          gpsMarkerRef.current.setLatLng(ll)
          gpsCircleRef.current?.setLatLng(ll)
          gpsCircleRef.current?.setRadius(mejor.acc)
        }
        if (!centrado) { map.setView(ll, Math.max(map.getZoom(), 15)); centrado = true }
      },
      (err) => {
        setGpsError(err.code === 1 ? 'Permiso de ubicación denegado.' : 'No se pudo obtener la ubicación.')
        setGpsOn(false)
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
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

  // ── Acciones de las herramientas ──

  function abrirHerramienta(t: 'distancia' | 'area' | 'marcadores' | 'mediciones') {
    setToolsOpen(false); setSheetOpen(false); setSearchOpen(false)
    setMarcadoresOpen(false); setMedicionesOpen(false); setCreandoMarcador(false)
    setGuardandoMed(false)
    setEditMedId(null); setNombreMed('')
    if (t === 'distancia' || t === 'area') {
      setMeasureMode(t)
      setVertices([])
    } else {
      setMeasureMode('off')
      setVertices([])
      if (t === 'marcadores') setMarcadoresOpen(true)
      else setMedicionesOpen(true)
    }
  }

  function marcarCentro() {
    const map = mapRef.current
    if (!map) return
    const c = map.getCenter()
    setVertices((prev) => [...prev, [c.lng, c.lat]])
  }

  function marcarGps() {
    if (gpsPos) setVertices((prev) => [...prev, [gpsPos.lng, gpsPos.lat]])
  }

  function cerrarMedicion() {
    setMeasureMode('off')
    setVertices([])
    setGuardandoMed(false)
    setNombreMed('')
    setOficialSel(null)
    setOficialQ('')
    setEditMedId(null)
  }

  // Cargar una medición guardada de vuelta al modo medición para EDITAR sus
  // puntos (arrastrar/agregar/quitar) y re-guardarla.
  function editarPuntosMedicion(m: Medicion) {
    setMedicionesOpen(false)
    setMedicionVistaId(null)
    setEditMedId(m.id)
    setMeasureMode(m.tipo === 'area' ? 'area' : 'distancia')
    setVertices(m.vertices)
    setNombreMed(m.nombre)
    const map = mapRef.current
    if (map && m.vertices.length) {
      const b = L.latLngBounds(m.vertices.map((v) => [v[1], v[0]] as [number, number]))
      map.fitBounds(b, { padding: [60, 60] })
    }
    setMsg(`Editando "${m.nombre}". Arrastra los puntos y guarda.`)
  }

  function renombrarMedicion(m: Medicion) {
    const nuevo = window.prompt(`Nuevo nombre para "${m.nombre}":`, m.nombre)
    if (!nuevo?.trim() || nuevo.trim() === m.nombre) return
    actualizarMedicion(m.id, { nombre: nuevo.trim() })
    setMediciones(leerMediciones())
  }

  // GPS como el original: primer toque enciende (y pide permiso de brújula
  // DENTRO del gesto — requisito iOS); con GPS activo, tocar RE-CENTRA en mí
  // (no apaga). Apagar = tocar la píldora inferior.
  function handleGpsClick() {
    if (!gpsOn) {
      setGpsOn(true)
      void pedirPermisoBrujula().then((ok) => setCompassOn(ok))
      return
    }
    const map = mapRef.current
    if (map && gpsPos) map.setView([gpsPos.lat, gpsPos.lng], Math.max(map.getZoom(), 16))
  }

  function guardarMedicion() {
    if (!nombreMed.trim()) return
    const esArea = measureMode === 'area'
    const valor = esArea ? polygonAreaHa(vertices) : lineLengthM(vertices)
    if (editMedId) {
      // Editando una guardada: ACTUALIZA (mismo id) en vez de crear otra.
      actualizarMedicion(editMedId, { nombre: nombreMed.trim(), valor, vertices })
      setMsg(`Medición "${nombreMed.trim()}" actualizada.`)
    } else {
      crearMedicion({ nombre: nombreMed.trim(), tipo: esArea ? 'area' : 'distancia', valor, vertices })
      setMsg(`Medición "${nombreMed.trim()}" guardada en este equipo.`)
    }
    setMediciones(leerMediciones())
    setNombreMed('')
    setGuardandoMed(false)
    // Cerrar la medición y ABRIR la lista de guardadas para que la vea de una
    // (antes quedaba atrapado en modo medición sin forma clara de verlas).
    setVertices([])
    setMeasureMode('off')
    setEditMedId(null)
    setOficialSel(null); setOficialQ(''); setMedAjustes(false)
    setMedicionesOpen(true)
  }

  function guardarMarcadorAqui() {
    const map = mapRef.current
    if (!map || !mNombre.trim()) return
    const c = map.getCenter()
    crearMarcador({ nombre: mNombre.trim(), nota: mNota.trim(), color: mColor, lat: c.lat, lon: c.lng })
    setMarcadores(leerMarcadores())
    setMsg(`Marcador "${mNombre.trim()}" guardado en este equipo.`)
    setMNombre(''); setMNota(''); setCreandoMarcador(false)
  }

  function irAMarcador(m: Marcador) {
    const map = mapRef.current
    if (!map) return
    map.setView([m.lat, m.lon], Math.max(map.getZoom(), 16))
    setMarcadoresOpen(false)
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
          ? `${gpsPos.lat.toFixed(5)}, ${gpsPos.lng.toFixed(5)} · ±${Math.round(gpsPos.acc)} m${gpsPos.acc > PRECISION_POBRE_M ? ' · precisión baja' : ''} ✕`
          : 'Buscando señal GPS… ✕'
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
            {/* Centro amarillo (color de la medición) — se ve claro sobre
                satélite y sobre el plano rosado. */}
            <circle cx="22" cy="22" r="3.4" fill="#facc15" stroke="#111" strokeWidth="1.6" />
          </svg>
        </div>

        {/* Botones flotantes circulares (GPS y brújula), como Avenza */}
        <div className="avz-fabs">
          <button
            type="button"
            className={`avz-fab${gpsOn ? ' is-active' : ''}`}
            onClick={handleGpsClick}
            aria-label={gpsOn ? 'Centrar en mi ubicación' : 'Mi ubicación'}
            title={gpsOn ? 'Centrar en mí (apagar: toca la barra de abajo)' : 'Mi ubicación'}
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

        {/* Menú de herramientas (✏️ abajo-izquierda, como Avenza/original) */}
        {toolsOpen && (
          <div className="avz-tools">
            <button type="button" onClick={() => abrirHerramienta('distancia')}>📏 Medir distancia</button>
            <button type="button" onClick={() => abrirHerramienta('area')}>⬠ Medir área</button>
            <button type="button" onClick={() => abrirHerramienta('marcadores')}>📍 Marcadores</button>
            <button type="button" onClick={() => abrirHerramienta('mediciones')}>📐 Mediciones guardadas</button>
          </div>
        )}

        {/* Panel de MEDICIÓN en vivo (portado del original) */}
        {measureMode !== 'off' && (() => {
          // Durante el arrastre de un punto, el valor se calcula con los
          // vértices "en vivo" — el área/distancia se reajusta al instante.
          const vp = liveVerts ?? vertices
          return (
          <div className="avz-measure">
            {/* Fila compacta: valor grande + perímetro/Δ + cerrar. */}
            <div className="avz-measure__top">
              <div className="avz-measure__val-wrap">
                <span className="avz-measure__valor">
                  {measureMode === 'area'
                    ? (vp.length >= 3 ? formatHectareas(polygonAreaHa(vp)) : '—')
                    : (vp.length >= 2 ? formatMetros(lineLengthM(vp)) : '—')}
                </span>
                <span className="avz-measure__meta">
                  {editMedId ? '✎ Editando · ' : ''}{measureMode === 'area' ? 'Área' : 'Distancia'} · {vertices.length} pts
                  {measureMode === 'area' && vp.length >= 2 && ` · perím. ${formatMetros(polygonPerimeterM(vp))}`}
                  {oficialSel && vp.length >= 3 && (
                    <span className={errorRelativoPct(polygonAreaHa(vp), oficialSel.area) >= 5 ? ' avz-dpct is-alto' : ' avz-dpct'}>
                      {' · Δ '}{errorRelativoPct(polygonAreaHa(vp), oficialSel.area).toFixed(1)}%
                    </span>
                  )}
                </span>
              </div>
              <button type="button" className="avz-measure__close" onClick={cerrarMedicion} aria-label="Terminar medición">✕</button>
            </div>

            <div className="avz-measure__grid">
              <button type="button" className="is-primary" onClick={marcarCentro}>✛ Marcar</button>
              <button type="button" onClick={marcarGps} disabled={!gpsPos} title={gpsPos ? 'Agregar mi posición GPS' : 'Activa el GPS primero'}>+ GPS</button>
              <button
                type="button"
                className="is-save"
                onClick={() => setGuardandoMed(true)}
                disabled={measureMode === 'area' ? vertices.length < 3 : vertices.length < 2}
              >
                {editMedId ? '💾 Actualizar' : '💾 Guardar'}
              </button>
              <button type="button" onClick={() => setVertices((p) => p.slice(0, -1))} disabled={vertices.length === 0}>Deshacer</button>
              <button type="button" onClick={() => setVertices([])} disabled={vertices.length === 0}>Limpiar</button>
              <button type="button" className={medAjustes ? 'is-on' : ''} onClick={() => setMedAjustes((v) => !v)}>⚙ Ajustes</button>
            </div>

            {/* Desplegable: comparar con suerte + sensibilidad (cerrado por
                defecto para que el panel no tape media pantalla). */}
            {medAjustes && (
              <div className="avz-measure__ajustes">
                {measureMode === 'area' && (
                  oficialSel ? (
                    <p className="avz-measure__oficial">
                      Oficial {oficialSel.haciendaName} · S{oficialSel.suerte}: {formatHectareas(oficialSel.area)}
                      <button type="button" onClick={() => { setOficialSel(null); setOficialQ('') }} aria-label="Quitar comparación">✕</button>
                    </p>
                  ) : (
                    <div className="avz-measure__buscar">
                      <input
                        value={oficialQ}
                        onChange={(e) => setOficialQ(e.target.value)}
                        placeholder="Comparar con suerte… (ej. FLORESTA 12)"
                      />
                      {oficialQ.trim().length >= 2 && (
                        <div className="avz-measure__matches">
                          {maestro
                            .filter((r) => `${r.haciendaName} ${r.suerte} ${r.haciendaCode}`.toLowerCase().includes(oficialQ.trim().toLowerCase()))
                            .slice(0, 6)
                            .map((r) => (
                              <button key={`${r.haciendaCode}-${r.suerte}`} type="button" onClick={() => { setOficialSel(r); setOficialQ('') }}>
                                {r.haciendaName} · S{r.suerte} · {formatHectareas(r.area)}
                              </button>
                            ))}
                        </div>
                      )}
                    </div>
                  )
                )}
                <div className="avz-measure__sens-row">
                  <span>🐢 Fina</span>
                  <input
                    type="range" min={0.15} max={1} step={0.05}
                    value={arrastreSens}
                    onChange={(e) => { const val = Number(e.target.value); setArrastreSens(val); localStorage.setItem('sam-mapa-arrastre-sens', String(val)) }}
                    aria-label="Sensibilidad del arrastre de puntos"
                  />
                  <span>Rápida 🐇</span>
                </div>
              </div>
            )}
            {guardandoMed && (
              <form
                className="avz-measure__save"
                onSubmit={(e) => { e.preventDefault(); guardarMedicion() }}
              >
                <input
                  value={nombreMed}
                  onChange={(e) => setNombreMed(e.target.value)}
                  placeholder="Nombre de la medición"
                  autoFocus
                />
                <button type="submit" className="is-save" disabled={!nombreMed.trim()}>Guardar</button>
                <button type="button" onClick={() => setGuardandoMed(false)}>Cancelar</button>
              </form>
            )}
          </div>
          )
        })()}

        {/* Panel de MARCADORES (portado del original) */}
        {marcadoresOpen && !creandoMarcador && (
          <div className="avz-sheet">
            <div className="avz-sheet__head">
              <strong>📍 Mis marcadores</strong>
              <button type="button" className="avz-iconbtn" onClick={() => setMarcadoresOpen(false)} aria-label="Cerrar">✕</button>
            </div>
            <button type="button" className="avz-sheet__add" style={{ width: '100%', marginBottom: 8 }} onClick={() => { setMNombre(''); setMNota(''); setMColor(MARCADOR_COLORS[0]); setCreandoMarcador(true) }}>
              ➕ Nuevo marcador
            </button>
            {marcadores.length === 0 && <p className="avz-sheet__vacio">Aún no tienes marcadores. Solo tú los ves (quedan en este equipo).</p>}
            {marcadores.map((m) => (
              <div key={m.id} className="avz-item">
                <span className="avz-item__dot" style={{ background: m.color }} />
                <button type="button" className="avz-item__nombre" onClick={() => irAMarcador(m)} title={m.nota || m.nombre}>
                  {m.nombre}
                </button>
                <button type="button" className="avz-item__del" onClick={() => { borrarMarcador(m.id); setMarcadores(leerMarcadores()) }} aria-label={`Borrar ${m.nombre}`}>🗑</button>
              </div>
            ))}
          </div>
        )}

        {/* Hoja de NUEVO MARCADOR: centra la cruz y guarda (como el original) */}
        {creandoMarcador && (
          <div className="avz-sheet">
            <div className="avz-sheet__head">
              <strong>📍 Nuevo marcador</strong>
              <button type="button" className="avz-iconbtn" onClick={() => setCreandoMarcador(false)} aria-label="Cancelar">✕</button>
            </div>
            <p className="avz-marcador__hint">Centra la cruz ✛ donde quieras el punto y guarda.</p>
            <input className="avz-input" value={mNombre} onChange={(e) => setMNombre(e.target.value)} placeholder="Nombre del punto" />
            <textarea className="avz-input" value={mNota} onChange={(e) => setMNota(e.target.value)} placeholder="Nota (opcional)" rows={2} />
            <div className="avz-colores">
              {MARCADOR_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`avz-color${mColor === c ? ' is-sel' : ''}`}
                  style={{ background: c }}
                  onClick={() => setMColor(c)}
                  aria-label={`Color ${c}`}
                />
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button type="button" className="avz-sheet__add" style={{ flex: 1 }} onClick={guardarMarcadorAqui} disabled={!mNombre.trim()}>
                Guardar aquí
              </button>
              <button type="button" className="avz-capa__btn" onClick={() => setCreandoMarcador(false)}>Cancelar</button>
            </div>
          </div>
        )}

        {/* Panel de MEDICIONES GUARDADAS (portado del original) */}
        {medicionesOpen && (
          <div className="avz-sheet">
            <div className="avz-sheet__head">
              <strong>📐 Mediciones guardadas</strong>
              <button type="button" className="avz-iconbtn" onClick={() => { setMedicionesOpen(false); setMedicionVistaId(null) }} aria-label="Cerrar">✕</button>
            </div>
            {mediciones.length === 0 && <p className="avz-sheet__vacio">Sin mediciones guardadas. Mide un área o distancia y usa 💾 Guardar.</p>}
            {mediciones.map((m) => (
              <div key={m.id} className="avz-item">
                <span aria-hidden style={{ flexShrink: 0 }}>{m.tipo === 'area' ? '⬠' : '📏'}</span>
                <button
                  type="button"
                  className={`avz-item__nombre${medicionVistaId === m.id ? ' is-sel' : ''}`}
                  onClick={() => { setMedicionVistaId(medicionVistaId === m.id ? null : m.id); setMedicionesOpen(false) }}
                  title="Ver en el mapa"
                >
                  {m.nombre}
                  <span className="avz-item__valor">{m.tipo === 'area' ? formatHectareas(m.valor) : formatMetros(m.valor)}</span>
                </button>
                <button type="button" className="avz-item__act" onClick={() => renombrarMedicion(m)} title="Renombrar" aria-label={`Renombrar ${m.nombre}`}>✎</button>
                <button type="button" className="avz-item__act" onClick={() => editarPuntosMedicion(m)} title="Editar puntos" aria-label={`Editar puntos de ${m.nombre}`}>📐</button>
                <button type="button" className="avz-item__del" onClick={() => { borrarMedicion(m.id); setMediciones(leerMediciones()); if (medicionVistaId === m.id) setMedicionVistaId(null) }} aria-label={`Borrar ${m.nombre}`}>🗑</button>
              </div>
            ))}
          </div>
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
            {/* Fondo del visor (como el original): satélite o plano limpio. */}
            <div className="avz-base">
              <span>Fondo</span>
              <button type="button" className={baseSat ? 'is-sel' : ''} onClick={() => setBaseSat(true)}>🛰️ Satélite</button>
              <button type="button" className={!baseSat ? 'is-sel' : ''} onClick={() => setBaseSat(false)}>🗺️ Plano</button>
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

      {/* Barra inferior negra: herramientas ✏️ · píldora de estado · capas (como Avenza) */}
      <footer className="avz-bottom">
        <button
          type="button"
          className={`avz-iconbtn${toolsOpen || measureMode !== 'off' || marcadoresOpen || medicionesOpen ? ' is-tool' : ''}`}
          onClick={() => {
            if (measureMode !== 'off') { cerrarMedicion(); return }
            setToolsOpen((v) => !v)
            setSheetOpen(false); setMarcadoresOpen(false); setMedicionesOpen(false); setCreandoMarcador(false)
          }}
          aria-label="Dibujar y medir"
        >
          <PencilIcon />
        </button>
        <div
          className={`avz-pill${gpsOn ? ' is-gps' : ''}${gpsOn && gpsPos && gpsPos.acc > PRECISION_POBRE_M ? ' is-pobre' : ''}`}
          onClick={() => { if (gpsOn) { setGpsOn(false); setCompassOn(false) } }}
          role={gpsOn ? 'button' : undefined}
          title={gpsOn ? 'Tocar para apagar el GPS' : undefined}
          style={gpsOn ? { cursor: 'pointer' } : undefined}
        >
          {pillTexto}
        </div>
        <button type="button" className="avz-iconbtn" onClick={() => { setSheetOpen((v) => !v); setToolsOpen(false); setMarcadoresOpen(false); setMedicionesOpen(false) }} aria-label="Capas"><LayersIcon /></button>
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

function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
      <path d="m15 5 4 4" />
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
