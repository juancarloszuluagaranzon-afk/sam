/**
 * Ingesta de cartografía: subir un GeoPDF y que la app haga todo lo demás
 * (experiencia Avenza). El procesamiento pesado (GDAL → tiles) lo hace
 * FieldMaps en su VPS; aquí solo se sube el PDF y se consulta el estado hasta
 * que la cartografía queda lista, para luego registrarla en `mapas`.
 *
 * NOTA de seguridad: el secreto viaja en el bundle (es una app de navegador),
 * así que solo protege de uso casual — la superficie expuesta es "subir un PDF
 * a FieldMaps", nada de la BD de ASM. Decisión consciente para no obligar a
 * administración a copiar URLs y coordenadas a mano.
 */

const INGEST_URL = 'https://mapview.surcoapp.tech/api/asm/ingest'
const INGEST_SECRET = '8c0f7dced312874b4ccf3976d3c5a537e9cc3e353bba710b'

export interface CartografiaRemota {
  mapId: string
  nombre: string | null
  status: string | null
  error: string | null
  tilesBase?: string
  bounds?: [number, number, number, number]
  minzoom?: number
  maxzoom?: number
}

interface RespuestaCruda {
  map_id: string
  nombre: string | null
  status: string | null
  error: string | null
  tiles_base?: string
  bounds?: number[]
  minzoom?: number
  maxzoom?: number
}

function mapear(r: RespuestaCruda): CartografiaRemota {
  const b = r.bounds
  return {
    mapId: String(r.map_id),
    nombre: r.nombre,
    status: r.status,
    error: r.error,
    tilesBase: r.tiles_base,
    bounds: b && b.length >= 4 ? [Number(b[0]), Number(b[1]), Number(b[2]), Number(b[3])] : undefined,
    minzoom: r.minzoom ?? undefined,
    maxzoom: r.maxzoom ?? undefined,
  }
}

async function leerError(res: Response, porDefecto: string): Promise<string> {
  try {
    const j = (await res.json()) as { error?: string }
    return j?.error || porDefecto
  } catch {
    return porDefecto
  }
}

/** Sube el GeoPDF y devuelve el id del mapa en proceso. */
export async function subirCartografia(file: File, nombre: string): Promise<string> {
  const fd = new FormData()
  fd.append('file', file)
  fd.append('nombre', nombre.trim())
  let res: Response
  try {
    res = await fetch(INGEST_URL, { method: 'POST', headers: { 'x-asm-secret': INGEST_SECRET }, body: fd })
  } catch {
    throw new Error('No se pudo conectar con el procesador de mapas. Revisa la conexión.')
  }
  if (!res.ok) throw new Error(await leerError(res, `No se pudo subir el PDF (HTTP ${res.status}).`))
  const j = (await res.json()) as { map_id?: string }
  if (!j?.map_id) throw new Error('El servidor no devolvió el identificador del mapa.')
  return j.map_id
}

/** Estado de una cartografía en proceso (para sondear hasta `ready`). */
export async function estadoCartografia(mapId: string): Promise<CartografiaRemota> {
  const res = await fetch(`${INGEST_URL}?id=${encodeURIComponent(mapId)}`, {
    headers: { 'x-asm-secret': INGEST_SECRET },
  })
  if (!res.ok) throw new Error(await leerError(res, `No se pudo consultar el estado (HTTP ${res.status}).`))
  return mapear((await res.json()) as RespuestaCruda)
}

/** Todas las cartografías de la organización en FieldMaps (para importar). */
export async function listarCartografias(): Promise<CartografiaRemota[]> {
  const res = await fetch(INGEST_URL, { headers: { 'x-asm-secret': INGEST_SECRET } })
  if (!res.ok) throw new Error(await leerError(res, `No se pudo listar (HTTP ${res.status}).`))
  const j = (await res.json()) as { mapas?: RespuestaCruda[] }
  return (j.mapas ?? []).map(mapear)
}
