// Descarga y gestión OFFLINE de mapas (modelo Avenza: un mapa = un paquete
// descargable). Los tiles XYZ (PNG 256px, generados por FieldMaps) se bajan UNA
// vez a Cache Storage con progreso y el visor los sirve cache-first. La regla
// runtimeCaching del SW usa el MISMO cacheName, así que navegar el mapa online
// también va llenando la caché de forma pasiva.
import type { MapaConfig } from '../domain/sam'

// DEBE coincidir con el cacheName de la regla runtimeCaching en vite.config.ts.
export const MAPAS_CACHE = 'mapas-tiles'

const META_KEY = 'sam-mapas-descargados'

export interface MapaDescargaMeta {
  mapaId: string
  tiles: number
  bytes: number
  fecha: string
}

function leerMetas(): Record<string, MapaDescargaMeta> {
  try {
    return JSON.parse(window.localStorage.getItem(META_KEY) ?? '{}')
  } catch {
    return {}
  }
}
function guardarMetas(m: Record<string, MapaDescargaMeta>) {
  try { window.localStorage.setItem(META_KEY, JSON.stringify(m)) } catch { /* sin localStorage */ }
}

export function metaDescarga(mapaId: string): MapaDescargaMeta | null {
  return leerMetas()[mapaId] ?? null
}

// ── Matemática slippy-map: tiles XYZ que cubren unos bounds en un zoom ──
function lon2tile(lon: number, z: number) { return Math.floor(((lon + 180) / 360) * 2 ** z) }
function lat2tile(lat: number, z: number) {
  const rad = (lat * Math.PI) / 180
  return Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z)
}

export function enumerarTiles(cfg: MapaConfig): { z: number; x: number; y: number }[] {
  const [minLon, minLat, maxLon, maxLat] = cfg.bounds
  const out: { z: number; x: number; y: number }[] = []
  for (let z = cfg.minzoom; z <= cfg.maxzoom; z++) {
    const x0 = lon2tile(minLon, z)
    const x1 = lon2tile(maxLon, z)
    const y0 = lat2tile(maxLat, z) // lat mayor → tile y menor
    const y1 = lat2tile(minLat, z)
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
      for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) {
        out.push({ z, x, y })
      }
    }
  }
  return out
}

export function urlTile(cfg: MapaConfig, t: { z: number; x: number; y: number }) {
  return `${cfg.tilesBase}/${t.z}/${t.x}/${t.y}.png`
}

/**
 * Descarga TODOS los tiles del mapa a Cache Storage con progreso. Los tiles de
 * borde que no existen (404) se ignoran (la pirámide no es un rectángulo
 * perfecto). Devuelve el meta guardado. `onProgress(hechos, total)`.
 */
export async function descargarMapa(
  cfg: MapaConfig,
  onProgress: (hechos: number, total: number) => void,
  signal?: AbortSignal,
): Promise<MapaDescargaMeta> {
  // Pedir almacenamiento persistente (evita evicción; en PWA instalada se concede).
  try { await navigator.storage?.persist?.() } catch { /* opcional */ }

  const tiles = enumerarTiles(cfg)
  const cache = await caches.open(MAPAS_CACHE)
  let hechos = 0
  let bytes = 0
  let guardados = 0
  const CONCURRENCIA = 8

  async function bajarUno(t: { z: number; x: number; y: number }) {
    if (signal?.aborted) throw new DOMException('cancelado', 'AbortError')
    const url = urlTile(cfg, t)
    // Si ya está cacheado (navegación previa), no re-bajar.
    const ya = await cache.match(url)
    if (!ya) {
      try {
        const res = await fetch(url, { signal })
        if (res.ok) {
          const clon = res.clone()
          const buf = await res.arrayBuffer()
          bytes += buf.byteLength
          await cache.put(url, clon)
          guardados++
        }
        // 404 = tile fuera de la pirámide real; se ignora.
      } catch (e) {
        if ((e as DOMException)?.name === 'AbortError') throw e
        // Error de red puntual: se tolera (el usuario puede reintentar; los
        // tiles ya guardados no se pierden).
      }
    } else {
      guardados++
    }
    hechos++
    if (hechos % 10 === 0 || hechos === tiles.length) onProgress(hechos, tiles.length)
  }

  // Pool de concurrencia limitada.
  let idx = 0
  async function trabajador() {
    while (idx < tiles.length) {
      const mio = tiles[idx++]
      await bajarUno(mio)
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCIA }, () => trabajador()))

  const meta: MapaDescargaMeta = {
    mapaId: cfg.id,
    tiles: guardados,
    bytes,
    fecha: new Date().toISOString(),
  }
  const metas = leerMetas()
  metas[cfg.id] = meta
  guardarMetas(metas)
  return meta
}

/** Borra del Cache Storage todos los tiles de un mapa y su meta. */
export async function borrarMapa(cfg: MapaConfig): Promise<number> {
  const cache = await caches.open(MAPAS_CACHE)
  const keys = await cache.keys()
  let borrados = 0
  for (const req of keys) {
    if (req.url.startsWith(cfg.tilesBase)) {
      await cache.delete(req)
      borrados++
    }
  }
  const metas = leerMetas()
  delete metas[cfg.id]
  guardarMetas(metas)
  return borrados
}

export function formatoBytes(b: number): string {
  if (b >= 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`
  if (b >= 1024) return `${Math.round(b / 1024)} KB`
  return `${b} B`
}
