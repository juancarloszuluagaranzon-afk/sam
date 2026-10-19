import { useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { CtxFincas } from './FincasView'
import {
  asignarPoligono, guardarPoligonos, mensajeDeError, quitarPoligono, type Finca, type Poligono, type SuerteFinca,
} from '../../services/fincasApi'
import { loadMapas } from '../../services/samApi'
import type { MapaConfig } from '../../domain/sam'
import { cicloAbiertoDe, edadMeses, fmtCant, hechosDeFinca, nombreLabor, type HechoSuerte } from '../../lib/fincas'
import { ingenioNombre } from '../../data/ingenios'
import { polygonAreaHa } from '../../lib/mapaGeo'
import { leerKmlPoligonos } from './kmlPoligonos'

/**
 * El MAPA de la finca (23-sep-2026) — «que el avance de labores y todo sea muy
 * visual desde un mapa». Ideas tomadas del geovisor de AgroControl: satélite de
 * fondo, polígonos con relleno tenue para que se vea el terreno, el número de la
 * suerte encima (solo de cerca), y la ficha de la suerte al tocarla.
 *
 * Se pinta de tres maneras:
 * - **Última labor**: cada suerte con el color de lo último que se le hizo.
 * - **Edad**: meses desde el corte (la caña se lee por su edad: madurante hacia
 *   los 10–12 meses, cosecha de 12 en adelante).
 * - **Una labor**: hecha (verde) · a medias o por aceptar (ámbar) · sin hacer.
 *
 * Los polígonos son PEDAZOS (`af_poligonos`): el plano del ingenio no siempre
 * coincide con las suertes de hoy. Un pedazo sin suerte se ve en gris punteado con
 * el número del plano, y administración lo asigna tocándolo.
 */

const ESRI_SAT = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'

/**
 * 🛰 Capas satelitales Sentinel (Copernicus, ESA — gratis), 17-oct-2026.
 *
 * Las sirve el proxy YA PUBLICADO de AgroCampo (la app de Riopaila de Iván):
 * mismas claves, misma cuota, ningún secreto nuevo aquí. Es un mosaico de los
 * últimos 30 días con el mejor píxel sin nube; el proxy responde vacío fuera de
 * z 9–16, por eso `maxNativeZoom: 16` (de ahí en adelante Leaflet agranda).
 * Catálogo y colores: agrocampo-repo/src/services/sentinel2.ts; evalscripts:
 * agrocampo-repo/api/s2-tile.ts. Si algún día ASM necesita sus propias claves,
 * se copia ese `api/s2-tile.ts` y se cambia `SAT_BASE` a '/api/s2-tile'.
 */
const SAT_BASE = 'https://agrocampo-seven.vercel.app/api/s2-tile'
/**
 * 🔴 El CALENDARIO (`op=info`, JSON) va por la MISMA app (18-oct-2026): el proxy de
 * AgroCampo no manda `Access-Control-Allow-Origin`, así que el navegador bloqueaba
 * la lectura desde ASM y en producción nunca salían ni la fecha de la imagen ni el
 * histórico. `vercel.json` (y `vite.config` en desarrollo) reenvían `/api/s2-tile`
 * a AgroCampo. Las baldosas siguen directas: una imagen no necesita CORS.
 */
const SAT_INFO = '/api/s2-tile'
const SAT_DIAS = 30
const SAT_VER = 5
type CapaSat = { key: string; nombre: string; opacity: number; ramp: string[] | null; etiquetas: string[]; explica: string; radar?: boolean }
const CAPAS_SAT: CapaSat[] = [
  { key: 'COLOR', nombre: 'Foto reciente', opacity: 1, ramp: null, etiquetas: [],
    explica: 'Foto real de los últimos 30 días (detalle 10 m): avance de cosecha, quemas, encharcamientos.' },
  { key: 'NDVI', nombre: 'Vigor de la caña', opacity: 0.9,
    ramp: ['#a50026', '#d73027', '#f46d43', '#fdae61', '#fee08b', '#d9ef8b', '#addd8e', '#78c679', '#41ab5d', '#238b45', '#005a32'],
    etiquetas: ['Suelo / estrés', 'Medio', 'Vigorosa'],
    explica: 'Qué tan verde y densa está la caña (NDVI). Rojo = suelo o estrés; verde oscuro = vigorosa.' },
  { key: 'NDMI', nombre: 'Humedad de la planta', opacity: 0.85,
    ramp: ['#d73027', '#f46d43', '#fdae61', '#fee08b', '#abdda4', '#66c2a5', '#3288bd'],
    etiquetas: ['Seca', '', 'Bien hidratada'],
    explica: 'Agua en la planta (NDMI): cae antes que el vigor, sirve de semáforo de riego.' },
  { key: 'NDRE', nombre: 'Nitrógeno (caña adulta)', opacity: 0.9,
    ramp: ['#d73027', '#f46d43', '#fdae61', '#fee08b', '#d9ef8b', '#a6d96a', '#66bd63', '#1a9850'],
    etiquetas: ['N bajo', 'Medio', 'N alto'],
    explica: 'Nitrógeno en caña grande (NDRE), donde el vigor ya no distingue. Orienta la fertilización.' },
  { key: 'HUMEDAD_RADAR', nombre: 'Humedad del suelo (radar)', opacity: 0.85, radar: true,
    ramp: ['#8c510a', '#bf812d', '#dfc27d', '#f6e8c3', '#c7eae5', '#80cdc1', '#35978f', '#01665e'],
    etiquetas: ['Seco', '', 'Húmedo'],
    explica: 'Radar Sentinel-1: atraviesa las nubes. Marrón = suelo seco; verde azulado = húmedo. Más fresco que la foto.' },
]
/** Con `fecha` (AAAA-MM-DD) pide la imagen de ESE día en vez del mosaico reciente: el histórico. */
const urlSat = (k: string, fecha = '') => `${SAT_BASE}?z={z}&x={x}&y={y}&p=${k}&d=${SAT_DIAS}&v=${SAT_VER}${fecha ? `&f=${fecha}` : ''}`
const fechaCorta = (f: string) => new Date(`${f}T12:00:00`).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })
const fechaLarga = (f: string) => new Date(`${f}T12:00:00`).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: '2-digit' })
/** Lo que el proxy sabe de la finca: la imagen reciente y el CALENDARIO de un año atrás (histórico). */
type InfoSat = { fecha: string; nubes: number; radar: string | null; todas: { fecha: string; nubes: number }[]; radares: string[] }

type Modo = { tipo: 'ultima' } | { tipo: 'edad' } | { tipo: 'labor'; llave: string }

/** Colores fijos por labor: la misma labor siempre del mismo color. */
const COLOR_LABOR: [string, string][] = [
  ['DESPEJE', '#a16207'],
  ['SUBSUELO', '#7c3aed'],
  ['TRIPLE', '#2563eb'],
  ['REENCALLE', '#0891b2'],
  ['FERTILIZ', '#16a34a'],
  ['MADURANTE', '#db2777'],
  ['CULTIVO', '#ea580c'],
  ['ROTURA', '#4f46e5'],
  ['RIEGO', '#0284c7'],
  ['MALEZA', '#65a30d'],
]
const OTRAS = ['#be123c', '#0f766e', '#9333ea', '#b45309']
function colorLabor(llave: string): string {
  const hit = COLOR_LABOR.find(([k]) => llave.includes(k))
  if (hit) return hit[1]
  let h = 0
  for (const ch of llave) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return OTRAS[h % OTRAS.length]
}

/** Edad en meses → verde cada vez más oscuro. */
const EDAD: { hasta: number; color: string; texto: string }[] = [
  { hasta: 3, color: '#d9f99d', texto: '0–3 meses' },
  { hasta: 6, color: '#a3e635', texto: '3–6' },
  { hasta: 9, color: '#65a30d', texto: '6–9' },
  { hasta: 12, color: '#3f6212', texto: '9–12' },
  { hasta: Infinity, color: '#b45309', texto: '12 o más (madura)' },
]
function colorEdad(m: number | null): string | null {
  if (m == null) return null
  return (EDAD.find((e) => m < e.hasta) ?? EDAD[EDAD.length - 1]).color
}

const fmtFecha = (iso: string) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '')
export function MapaFinca({ ctx, finca }: { ctx: CtxFincas; finca: Finca }) {
  const { datos: d, hoy, esAdmin, modoDueno, token, recargar } = ctx
  const suertes = useMemo(() => d.suertes.filter((s) => s.fincaId === finca.id && s.activa), [d.suertes, finca.id])
  const piezas = useMemo(() => d.poligonos.filter((p) => p.fincaId === finca.id), [d.poligonos, finca.id])
  const hechos = useMemo(() => hechosDeFinca(finca.id, d, ctx.nombre), [finca.id, d, ctx.nombre])

  const suerteDe = useMemo(() => new Map(suertes.map((s) => [s.id, s])), [suertes])
  const hechosPor = useMemo(() => {
    const m = new Map<string, HechoSuerte[]>()
    for (const h of hechos) m.set(h.suerteCodigo, [...(m.get(h.suerteCodigo) ?? []), h])
    return m
  }, [hechos])
  /** Las labores que aparecen en esta finca, de la más reciente a la más vieja. */
  const labores = useMemo(() => {
    const vistas = new Map<string, string>()
    for (const h of hechos) if (!vistas.has(h.llave)) vistas.set(h.llave, h.labor)
    return [...vistas.entries()].map(([llave, nombre]) => ({ llave, nombre }))
  }, [hechos])
  const edadDe = (s: SuerteFinca): number | null => {
    const ciclo = cicloAbiertoDe(s.id, d.ciclos)
    return edadMeses(ciclo?.fechaCorte ?? s.datosIngenio?.fUltCorte, hoy)
  }

  const [modo, setModo] = useState<Modo>({ tipo: 'ultima' })
  const [selId, setSelId] = useState<string | null>(null)
  const [verPlano, setVerPlano] = useState(false)
  const [plano, setPlano] = useState<MapaConfig | null>(null)
  // 🛰 Capa satelital encima de la foto base ('' = solo la foto ESRI de siempre).
  const [capaSat, setCapaSat] = useState('')
  // '' = mosaico reciente; 'AAAA-MM-DD' = la imagen de ese día. Es el HISTÓRICO
  // (17-oct-2026, reunión con Cristian): comparar antes y después de una labor,
  // o demostrar con la imagen de hace meses que el problema fue el drenaje.
  const [fechaSat, setFechaSat] = useState('')
  const [infoSat, setInfoSat] = useState<InfoSat | null>(null)
  const [error, setError] = useState('')
  const [ocupado, setOcupado] = useState(false)
  // Pantalla completa (pedido del cliente, 23-sep): el mapa en la página va a la
  // mitad de alto, y el que quiera verlo grande lo abre a toda la pantalla.
  const [grande, setGrande] = useState(false)

  const cajaRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const capaRef = useRef<L.LayerGroup | null>(null)
  // UN solo lienzo para los polígonos. Crear uno en cada repintada los dejaba
  // apilados (uno por cada cambio de color o de selección) y crecía sin fin.
  const lienzoRef = useRef<L.Canvas | null>(null)
  const etiquetasRef = useRef<L.LayerGroup | null>(null)
  const planoRef = useRef<L.TileLayer | null>(null)
  const satRef = useRef<L.TileLayer | null>(null)
  const gpsRef = useRef<L.CircleMarker | null>(null)
  const encuadradoRef = useRef(false)

  // El plano georreferenciado del ingenio de la finca (las cartografías de ASM).
  useEffect(() => {
    let vivo = true
    const buscado = (ingenioNombre(finca.ingenioId ?? '') || '').replace(/^ingenio\s+/i, '').toUpperCase()
    if (!buscado) return
    loadMapas().then((ms) => {
      if (vivo) setPlano(ms.find((m) => m.nombre.toUpperCase().includes(buscado)) ?? null)
    }).catch(() => { /* sin plano: solo satélite */ })
    return () => { vivo = false }
  }, [finca.ingenioId])

  // El mapa se crea una vez.
  useEffect(() => {
    if (!cajaRef.current || mapRef.current) return
    const map = L.map(cajaRef.current, {
      zoomControl: true, attributionControl: false, maxZoom: 19,
      rotate: false, rotateControl: false, touchRotate: false, shiftKeyRotate: false,
    })
    L.tileLayer(ESRI_SAT, { maxZoom: 19, maxNativeZoom: 18 }).addTo(map)
    map.setView([4.6075, -76.032], 15)
    capaRef.current = L.layerGroup().addTo(map)
    lienzoRef.current = L.canvas({ padding: 0.5 })
    etiquetasRef.current = L.layerGroup().addTo(map)
    mapRef.current = map
    // Solo en desarrollo: para probar el mapa desde la consola.
    if (import.meta.env.DEV) (window as unknown as { __mapaFinca?: L.Map }).__mapaFinca = map
    // El contenedor puede nacer sin tamaño (pestaña recién abierta). 🔴 Los reintentos
    // miran que el mapa siga vivo: si se cerró antes, Leaflet revienta en la consola.
    setTimeout(() => { if (mapRef.current === map) map.invalidateSize() }, 0)
    setTimeout(() => { if (mapRef.current === map) map.invalidateSize() }, 400)
    return () => { map.remove(); mapRef.current = null; encuadradoRef.current = false }
  }, [])

  // Plano del ingenio encima del satélite (se prende y se apaga).
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    planoRef.current?.remove(); planoRef.current = null
    if (verPlano && plano) {
      planoRef.current = L.tileLayer(`${plano.tilesBase}/{z}/{x}/{y}.png`, {
        maxZoom: 19, maxNativeZoom: plano.maxzoom, minNativeZoom: plano.minzoom, opacity: 0.6,
        bounds: L.latLngBounds([plano.bounds[1], plano.bounds[0]], [plano.bounds[3], plano.bounds[2]]),
      }).addTo(map)
    }
  }, [verPlano, plano])

  // 🛰 Capa Sentinel: entre la foto base y el plano/polígonos.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    satRef.current?.remove(); satRef.current = null
    const capa = CAPAS_SAT.find((c) => c.key === capaSat)
    if (!capa) return
    satRef.current = L.tileLayer(urlSat(capa.key, fechaSat), {
      maxZoom: 19, maxNativeZoom: 16, minNativeZoom: 9, opacity: capa.opacity, zIndex: 2,
    }).addTo(map)
  }, [capaSat, fechaSat])

  // La fecha de la imagen que se está viendo y el calendario de un año atrás: una
  // consulta por finca (el mapa ya está encuadrado en ella cuando se toca el
  // selector). Sin señal no dice fecha y la capa igual sale si quedó en la caché.
  useEffect(() => {
    const map = mapRef.current
    if (!capaSat || infoSat || !map) return
    const b = map.getBounds()
    const bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map((n) => n.toFixed(4)).join(',')
    let vivo = true
    fetch(`${SAT_INFO}?op=info&bbox=${bbox}&d=${SAT_DIAS}&cal=365`).then((r) => r.json())
      .then((j: { reciente?: { fecha: string; nubes: number } | null; radar?: { fecha: string } | null; todas?: { fecha: string; nubes: number }[]; radares?: string[] }) => {
        if (!vivo) return
        setInfoSat({
          fecha: j.reciente?.fecha ?? '', nubes: j.reciente?.nubes ?? 100, radar: j.radar?.fecha ?? null,
          // Para elegir, solo los días que de verdad se ven (hasta 60 % de nubes).
          todas: (j.todas ?? []).filter((x) => x.nubes <= 60), radares: j.radares ?? [],
        })
      })
      .catch(() => { /* sin señal: la leyenda queda sin fecha */ })
    return () => { vivo = false }
  }, [capaSat, infoSat])

  // Los pedazos, pintados según el modo.
  useEffect(() => {
    const map = mapRef.current
    const capa = capaRef.current
    if (!map || !capa) return
    capa.clearLayers()
    const render = lienzoRef.current ?? undefined
    for (const p of piezas) {
      const s = p.suerteId ? suerteDe.get(p.suerteId) : undefined
      const latlngs = p.anillo.map(([lng, lat]) => [lat, lng] as [number, number])
      let fill: string | null = null
      if (s) {
        const hs = hechosPor.get(s.codigo) ?? []
        if (modo.tipo === 'ultima') fill = hs[0] ? colorLabor(hs[0].llave) : null
        else if (modo.tipo === 'edad') fill = colorEdad(edadDe(s))
        else {
          const deLabor = hs.filter((h) => h.llave === modo.llave)
          fill = deLabor.some((h) => h.estado === 'hecha') ? '#16a34a' : deLabor.length ? '#f59e0b' : null
        }
      }
      const sel = p.id === selId
      // Novedad desde la última visita del dueño: borde amarillo grueso.
      const nuevo = !!s && !!ctx.resaltar?.has(s.codigo)
      L.polygon(latlngs, {
        renderer: render,
        color: sel || nuevo ? '#facc15' : s ? '#ffffff' : '#cbd5e1',
        weight: sel ? 3.5 : nuevo ? 4 : s ? 1.6 : 1.2,
        dashArray: s ? undefined : '5 4',
        fillColor: fill ?? (s ? '#ffffff' : '#94a3b8'),
        fillOpacity: fill ? 0.55 : s ? 0.1 : 0.18,
      }).on('click', () => setSelId(p.id)).addTo(capa)
    }
    // Encuadre inicial a la finca. 🔴 El contenedor nace sin tamaño (la pestaña se
    // está pintando): un solo fitBounds quedaba corrido y la finca salía en una
    // esquina. Se repite cuando ya tiene tamaño, salvo que el usuario ya haya
    // movido el mapa.
    if (!encuadradoRef.current && piezas.length) {
      encuadradoRef.current = true
      const b = L.latLngBounds(piezas.flatMap((p) => p.anillo.map(([lng, lat]) => [lat, lng] as [number, number])))
      let movio = false
      map.once('dragstart', () => { movio = true })
      const encuadrar = () => { if (!movio && mapRef.current === map) { map.invalidateSize(); map.fitBounds(b, { padding: [24, 24], maxZoom: 17 }) } }
      encuadrar()
      setTimeout(encuadrar, 350)
      setTimeout(encuadrar, 900)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [piezas, suerteDe, hechosPor, modo, selId, d.ciclos, hoy, ctx.resaltar])

  // Números de suerte sobre el polígono: solo de cerca y solo lo que se ve.
  useEffect(() => {
    const map = mapRef.current
    const grupo = etiquetasRef.current
    if (!map || !grupo) return
    const poner = () => {
      grupo.clearLayers()
      if (map.getZoom() < 15) return
      const vista = map.getBounds().pad(0.15)
      for (const p of piezas) {
        const s = p.suerteId ? suerteDe.get(p.suerteId) : undefined
        const c = L.latLngBounds(p.anillo.map(([lng, lat]) => [lat, lng] as [number, number])).getCenter()
        if (!vista.contains(c)) continue
        const texto = s ? s.codigo.replace(/^0+/, '') : (p.etiqueta ?? '?')
        L.marker(c, {
          interactive: false, keyboard: false,
          icon: L.divIcon({ className: 'af-mapa-et', html: `<span class="${s ? '' : 'af-mapa-et--sin'}">${texto}</span>`, iconSize: [0, 0] }),
        }).addTo(grupo)
      }
    }
    poner()
    map.on('zoomend moveend', poner)
    return () => { map.off('zoomend moveend', poner) }
  }, [piezas, suerteDe])

  // Al abrir o cerrar la pantalla completa el contenedor cambia de tamaño: Leaflet
  // tiene que volver a medirlo (si no, las teselas quedan corridas o en blanco).
  // Se repite porque el navegador tarda en asentar el tamaño nuevo.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const medir = () => map.invalidateSize({ pan: false })
    const r = requestAnimationFrame(() => requestAnimationFrame(medir))
    const t1 = setTimeout(medir, 300)
    const t2 = setTimeout(medir, 700)
    if (!grande) return () => { cancelAnimationFrame(r); clearTimeout(t1); clearTimeout(t2) }
    // Grande: sin scroll de la página detrás, y Esc para salir.
    const antes = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setGrande(false) }
    window.addEventListener('keydown', esc)
    return () => {
      cancelAnimationFrame(r); clearTimeout(t1); clearTimeout(t2)
      document.body.style.overflow = antes
      window.removeEventListener('keydown', esc)
    }
  }, [grande])

  function centrar() {
    const map = mapRef.current
    if (!map || !piezas.length) return
    map.fitBounds(L.latLngBounds(piezas.flatMap((p) => p.anillo.map(([lng, lat]) => [lat, lng] as [number, number]))), { padding: [24, 24], maxZoom: 17 })
  }
  function ubicarme() {
    if (!('geolocation' in navigator)) { setError('Este celular no da ubicación.'); return }
    navigator.geolocation.getCurrentPosition((pos) => {
      const map = mapRef.current
      if (!map) return
      const ll: [number, number] = [pos.coords.latitude, pos.coords.longitude]
      gpsRef.current?.remove()
      gpsRef.current = L.circleMarker(ll, { radius: 8, color: '#fff', weight: 3, fillColor: '#059669', fillOpacity: 1 }).addTo(map)
      map.setView(ll, Math.max(map.getZoom(), 16))
    }, () => setError('No se pudo tomar la ubicación (revise el permiso).'), { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 })
  }

  async function hacer(fn: () => Promise<unknown>) {
    setOcupado(true); setError('')
    try { await fn(); await recargar() } catch (e) { setError(mensajeDeError(e)) } finally { setOcupado(false) }
  }

  const sel = piezas.find((p) => p.id === selId) ?? null
  const selSuerte = sel?.suerteId ? suerteDe.get(sel.suerteId) ?? null : null
  const capaSel = CAPAS_SAT.find((c) => c.key === capaSat) ?? null
  const sinAsignar = piezas.filter((p) => !p.suerteId).length
  const sinMapa = suertes.filter((s) => !piezas.some((p) => p.suerteId === s.id))

  const barraModos = (
    <div className="af-mapa-modos" role="group" aria-label="Cómo pintar el mapa">
      <button type="button" aria-pressed={modo.tipo === 'ultima'} onClick={() => setModo({ tipo: 'ultima' })}>Última labor</button>
      <button type="button" aria-pressed={modo.tipo === 'edad'} onClick={() => setModo({ tipo: 'edad' })}>Edad</button>
      {labores.map((l) => (
        <button key={l.llave} type="button" aria-pressed={modo.tipo === 'labor' && modo.llave === l.llave}
                onClick={() => setModo({ tipo: 'labor', llave: l.llave })}>
          <i style={{ background: colorLabor(l.llave) }} aria-hidden="true" />{nombreLabor(l.nombre)}
        </button>
      ))}
      {/* 🛰 Satélite: un desplegable, no cinco botones — en celular no caben. */}
      <select className={`af-mapa-sat${capaSat ? ' af-mapa-sat--on' : ''}`} value={capaSat}
              onChange={(e) => { setCapaSat(e.target.value); setFechaSat('') }} aria-label="Imagen satelital" title="Imagen satelital Sentinel (ESA)">
        <option value="">🛰 Satélite: foto base</option>
        {CAPAS_SAT.map((c) => <option key={c.key} value={c.key}>🛰 {c.nombre}</option>)}
      </select>
      {/* 📅 Histórico: la imagen de un día concreto. Óptico: días con ≤ 60 % de
          nubes del último año; radar: sus pasadas (cada ~12 días). */}
      {capaSel && infoSat && (
        <select className={`af-mapa-sat${fechaSat ? ' af-mapa-sat--on' : ''}`} value={fechaSat}
                onChange={(e) => setFechaSat(e.target.value)} aria-label="Fecha de la imagen" title="Ver la imagen de un día (histórico)">
          <option value="">📅 Más reciente</option>
          {(capaSel.radar ? infoSat.radares.map((f) => ({ fecha: f, nubes: -1 })) : infoSat.todas).map((x) => (
            <option key={x.fecha} value={x.fecha}>📅 {fechaLarga(x.fecha)}{x.nubes >= 0 ? ` · ${x.nubes} % nubes` : ''}</option>
          ))}
        </select>
      )}
    </div>
  )
  const ficha = sel && (
    <FichaSuerte
      pieza={sel} suerte={selSuerte} suertes={suertes} hechos={selSuerte ? hechosPor.get(selSuerte.codigo) ?? [] : []}
      edad={selSuerte ? edadDe(selSuerte) : null}
      corte={selSuerte ? (cicloAbiertoDe(selSuerte.id, d.ciclos)?.fechaCorte ?? selSuerte.datosIngenio?.fUltCorte ?? null) : null}
      puedeAsignar={esAdmin && !modoDueno} ocupado={ocupado}
      onAsignar={(sid) => hacer(() => asignarPoligono(sel.id, sid, token))}
      onQuitar={() => { if (window.confirm('¿Quitar este pedazo del mapa? Queda en la auditoría.')) void hacer(async () => { await quitarPoligono(sel.id, token); setSelId(null) }) }}
      onCerrar={() => setSelId(null)}
    />
  )

  return (
    <div className="af-card af-card--ancha af-mapa-card">
      {!grande && barraModos}

      <div className={`af-mapa${grande ? ' af-mapa--grande' : ''}`}>
        <div ref={cajaRef} className="af-mapa__lienzo" />
        {grande && <div className="af-mapa__arriba">{barraModos}</div>}
        <div className="af-mapa__botones">
          <button type="button" title={grande ? 'Salir de pantalla completa' : 'Pantalla completa'} aria-pressed={grande}
                  onClick={() => setGrande(!grande)}>{grande ? '✕' : '⛶'}</button>
          <button type="button" title="Ver toda la finca" onClick={centrar}>⌂</button>
          <button type="button" title="Dónde estoy" onClick={ubicarme}>◎</button>
          {plano && <button type="button" title="Plano del ingenio" aria-pressed={verPlano} onClick={() => setVerPlano(!verPlano)}>▦</button>}
        </div>
        {piezas.length === 0 && (
          <div className="af-mapa__vacio">Esta finca todavía no está dibujada en el mapa.{esAdmin && !modoDueno ? ' Cárguela con un KML (abajo).' : ''}</div>
        )}
        {/* En pantalla completa la ficha sube desde abajo, encima del mapa. */}
        {grande && ficha && <div className="af-mapa__hoja">{ficha}</div>}
        {grande && !ficha && (
          <div className="af-mapa__leyenda-flot">
            <Leyenda modo={modo} labores={labores} />
            {capaSel && <LeyendaSat capa={capaSel} info={infoSat} fecha={fechaSat} />}
          </div>
        )}
      </div>

      {!grande && <Leyenda modo={modo} labores={labores} />}
      {!grande && capaSel && <LeyendaSat capa={capaSel} info={infoSat} fecha={fechaSat} />}
      {error && <p className="feedback error">{error}</p>}

      {!grande && ficha}

      {esAdmin && !modoDueno && (
        <div className="af-mapa-admin">
          {sinAsignar > 0 && <p className="af-nota">▲ {sinAsignar} pedazo{sinAsignar === 1 ? '' : 's'} sin suerte (gris punteado): tóquelo y diga de qué suerte es.</p>}
          {sinMapa.length > 0 && <p className="af-nota">Sin dibujar en el mapa: suerte{sinMapa.length === 1 ? '' : 's'} {sinMapa.map((s) => s.codigo).join(', ')}.</p>}
          <ImportarKml fincaId={finca.id} suertes={suertes} token={token} ocupado={ocupado} onHecho={() => void recargar()} onError={setError} />
        </div>
      )}
    </div>
  )
}

function Leyenda({ modo, labores }: { modo: Modo; labores: { llave: string; nombre: string }[] }) {
  if (modo.tipo === 'edad') {
    return (
      <div className="af-mapa-leyenda">
        {EDAD.map((e) => <span key={e.texto}><i style={{ background: e.color }} />{e.texto}</span>)}
      </div>
    )
  }
  if (modo.tipo === 'labor') {
    return (
      <div className="af-mapa-leyenda">
        <span><i style={{ background: '#16a34a' }} />hecha</span>
        <span><i style={{ background: '#f59e0b' }} />a medias o por aceptar</span>
        <span><i className="af-mapa-leyenda__vacio" />sin hacer</span>
      </div>
    )
  }
  return (
    <div className="af-mapa-leyenda">
      {labores.length === 0 ? <span>Todavía no hay labores registradas en esta finca.</span>
        : labores.map((l) => <span key={l.llave}><i style={{ background: colorLabor(l.llave) }} />{nombreLabor(l.nombre)}</span>)}
      <span><i className="af-mapa-leyenda__vacio" />sin labores</span>
    </div>
  )
}

/** Leyenda de la capa satelital: la escala de colores, la fecha de la imagen y qué significa. */
function LeyendaSat({ capa, info, fecha: elegida }: { capa: CapaSat; info: InfoSat | null; fecha: string }) {
  // Si se eligió un día, se habla de ese día; si no, de la imagen reciente del mosaico.
  const fecha = elegida || (capa.radar ? info?.radar : info?.fecha) || ''
  const nubes = elegida ? (info?.todas.find((x) => x.fecha === elegida)?.nubes ?? null) : (info?.nubes ?? null)
  return (
    <div className="af-mapa-satley">
      {capa.ramp && (
        <>
          <div className="af-mapa-satley__barra" style={{ background: `linear-gradient(to right, ${capa.ramp.join(', ')})` }} />
          <div className="af-mapa-satley__rot">{capa.etiquetas.map((t, i) => <span key={i}>{t}</span>)}</div>
        </>
      )}
      <span>
        🛰 {capa.nombre} · {capa.radar ? 'Sentinel-1 (radar)' : 'Sentinel-2'}
        {fecha ? ` · imagen del ${elegida ? fechaLarga(fecha) : fechaCorta(fecha)}` : ` · últimos ${SAT_DIAS} días`}
        {!capa.radar && nubes != null ? ` · ${nubes} % nubes` : ''}
        {elegida ? ' (histórico)' : ''}. {capa.explica}
        {' '}<a href="/manuales/satelite-fincas.html" target="_blank" rel="noopener">¿Cómo leerla?</a>
      </span>
    </div>
  )
}

function FichaSuerte({ pieza, suerte, suertes, hechos, edad, corte, puedeAsignar, ocupado, onAsignar, onQuitar, onCerrar }: {
  pieza: Poligono; suerte: SuerteFinca | null; suertes: SuerteFinca[]; hechos: HechoSuerte[]
  edad: number | null; corte: string | null
  puedeAsignar: boolean; ocupado: boolean
  onAsignar: (suerteId: string | null) => void; onQuitar: () => void; onCerrar: () => void
}) {
  const di = suerte?.datosIngenio
  return (
    <div className="af-ficha">
      <div className="af-cab af-cab--chica">
        <div>
          <h3 style={{ margin: 0 }}>{suerte ? `Suerte ${suerte.codigo}` : 'Pedazo sin suerte'}
            <small className="subtle-copy"> {suerte ? `${fmtCant(suerte.areaHa)} ha` : ''}</small></h3>
          {pieza.etiqueta && <p className="af-nota" style={{ margin: 0 }}>En el plano: {pieza.etiqueta}{pieza.areaHa ? ` · ${fmtCant(pieza.areaHa)} ha dibujadas` : ''}</p>}
        </div>
        <button type="button" className="af-link" onClick={onCerrar}>Cerrar</button>
      </div>

      {suerte && (
        <div className="af-ficha__datos">
          <div><b>{edad != null ? `${fmtCant(edad)} meses` : '—'}</b><span>edad</span></div>
          <div><b>{corte ? fmtFecha(corte) : '—'}</b><span>último corte</span></div>
          <div><b>{di?.numeroCorte ?? '—'}</b><span>n.º de corte</span></div>
          <div><b>{di?.tch != null ? fmtCant(di.tch) : '—'}</b><span>TCH última cosecha</span></div>
          {di?.toneladas != null && <div><b>{fmtCant(di.toneladas)} t</b><span>última cosecha</span></div>}
          {di?.edadMeses != null && <div><b>{fmtCant(di.edadMeses)} m</b><span>edad al cosechar</span></div>}
          {di?.rendimiento != null && <div><b>{fmtCant(di.rendimiento)} %</b><span>rendimiento</span></div>}
        </div>
      )}

      {suerte && (
        <>
          <h4 className="af-ficha__tit">Labores ({hechos.length})</h4>
          {hechos.length === 0 ? <p className="af-nota">Todavía no hay labores registradas en esta suerte.</p> : (
            <ul className="af-lista">
              {hechos.map((h) => (
                <li key={h.id} className="af-mov">
                  {h.foto ? <a href={h.foto} target="_blank" rel="noreferrer"><img className="af-foto" src={h.foto} alt="evidencia" loading="lazy" /></a>
                    : <span className="af-foto af-foto--vacia" style={{ background: colorLabor(h.llave), color: '#fff' }}>🚜</span>}
                  <span>
                    <b>{nombreLabor(h.labor)} · {fmtCant(h.cantidad)} {h.unidad}</b>
                    <small>{fmtFecha(h.fecha)}{h.detalle ? ` · ${h.detalle}` : ''}</small>
                  </span>
                  <span className={`af-chip ${h.estado === 'hecha' ? 'af-chip--ok' : 'af-chip--ojo'}`}>{h.estado}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {puedeAsignar && (
        <div className="af-mini-form">
          <label>Este pedazo es de la suerte
            <select id="af-asignar-suerte" value={pieza.suerteId ?? ''} disabled={ocupado}
                    onChange={(e) => onAsignar(e.target.value || null)}>
              <option value="">— sin suerte —</option>
              {suertes.map((s) => <option key={s.id} value={s.id}>{s.codigo} · {fmtCant(s.areaHa)} ha</option>)}
            </select>
          </label>
          <button type="button" className="af-link" disabled={ocupado} onClick={onQuitar}>Quitar pedazo</button>
        </div>
      )}
      {!suerte && !puedeAsignar && <p className="af-nota">Administración todavía no ha dicho de qué suerte es este pedazo.</p>}
    </div>
  )
}

/** Cargar pedazos desde un KML (del ingenio, de Google Earth o del dron). */
function ImportarKml({ fincaId, suertes, token, ocupado, onHecho, onError }: {
  fincaId: string; suertes: SuerteFinca[]; token: string; ocupado: boolean
  onHecho: () => void; onError: (m: string) => void
}) {
  const [leyendo, setLeyendo] = useState(false)
  async function leer(file: File) {
    setLeyendo(true)
    try {
      const texto = await file.text()
      const pol = leerKmlPoligonos(texto)
      if (!pol.length) { onError('El archivo no trae polígonos.'); return }
      const codigos = new Map(suertes.map((s) => [s.codigo.replace(/^0+/, '').toUpperCase(), s.codigo]))
      const filas = pol.map((p) => {
        const m = p.nombre.toUpperCase().match(/(\d+[A-Z]?)\s*$/)
        const codigo = m ? codigos.get(m[1].replace(/^0+/, '')) : undefined
        return { anillo: p.anillo, etiqueta: p.nombre, areaHa: Math.round(polygonAreaHa(p.anillo) * 1000) / 1000, suerteCodigo: codigo, fuente: `KML: ${file.name}` }
      })
      const asignados = filas.filter((f) => f.suerteCodigo).length
      if (!window.confirm(`El archivo trae ${filas.length} polígono${filas.length === 1 ? '' : 's'}; ${asignados} se reconocen como suertes de esta finca. ¿Cargarlos?`)) return
      await guardarPoligonos(fincaId, filas, token)
      onHecho()
    } catch (e) { onError(mensajeDeError(e)) } finally { setLeyendo(false) }
  }
  return (
    <label className="af-mapa-kml">
      <span>Cargar polígonos desde un KML</span>
      <input id="af-mapa-kml" type="file" accept=".kml,application/vnd.google-earth.kml+xml" disabled={ocupado || leyendo}
             onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void leer(f) }} />
      {leyendo && <small>Leyendo…</small>}
    </label>
  )
}
