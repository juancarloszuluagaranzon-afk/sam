import { supabase } from '../lib/supabase'

/**
 * Documentos de facturación (2-oct-2026, migración 20261002150000):
 *   SOPORTE = el papel con que el cliente acepta el trabajo (orden de servicio,
 *             acta, certificación, correo…).
 *   FACTURA = la factura emitida (número, fecha, razón social, valor, PDF).
 * Un documento cubre MUCHAS líneas realizadas; cada línea tiene a lo sumo un
 * soporte y una factura. Vincular y desvincular van por funciones de la base
 * (`fact_vincular` / `fact_desvincular`), que revisan rol y que una línea no
 * cambie de factura sin querer. Los archivos van al depósito PRIVADO `facturacion`.
 */
export type TipoDocumento = 'SOPORTE' | 'FACTURA'

export interface DocumentoFact {
  id: string
  tipo: TipoDocumento
  clase: string | null
  numero: string
  fecha: string
  razonSocial: string | null
  cliente: string | null
  valor: number | null
  archivoPath: string | null
  archivoNombre: string | null
  nota: string | null
  anulado: boolean
  creadoPor: string
  createdAt: string
}

export const RAZONES_SOCIALES = ['AGROMORALES', 'CEBALLOS Y LOZANO'] as const

const BUCKET = 'facturacion'

function mapDocumento(r: Record<string, unknown>): DocumentoFact {
  return {
    id: String(r.id),
    tipo: r.tipo as TipoDocumento,
    clase: r.clase ? String(r.clase) : null,
    numero: String(r.numero ?? ''),
    fecha: String(r.fecha ?? ''),
    razonSocial: r.razon_social ? String(r.razon_social) : null,
    cliente: r.cliente ? String(r.cliente) : null,
    valor: r.valor != null ? Number(r.valor) : null,
    archivoPath: r.archivo_path ? String(r.archivo_path) : null,
    archivoNombre: r.archivo_nombre ? String(r.archivo_nombre) : null,
    nota: r.nota ? String(r.nota) : null,
    anulado: r.anulado === true,
    creadoPor: String(r.creado_por ?? ''),
    createdAt: String(r.created_at ?? ''),
  }
}

/** El mensaje que puso la base («YA_VINCULADAS: 3 línea(s)…»), sin el código. */
function mensaje(error: { message?: string; code?: string } | null, porDefecto: string): Error {
  const m = error?.message ?? ''
  if (error?.code === '23505') return new Error('Ya existe un documento con ese número para ese cliente.')
  const limpio = m.replace(/^[A-Z_]+:\s*/, '')
  return new Error(limpio || porDefecto)
}

export async function loadDocumentos(): Promise<DocumentoFact[]> {
  const { data, error } = await supabase
    .from('fact_documentos')
    .select('*')
    .eq('anulado', false)
    .order('fecha', { ascending: false })
    .order('created_at', { ascending: false })
  if (error || !data) return []
  return (data as Record<string, unknown>[]).map(mapDocumento)
}

export interface NuevoDocumento {
  tipo: TipoDocumento
  clase?: string | null
  numero: string
  fecha: string
  razonSocial?: string | null
  cliente?: string | null
  valor?: number | null
  nota?: string | null
  creadoPor: string
}

/** Crea el documento; si trae archivo, lo sube PRIMERO (un documento sin su PDF no queda a medias). */
export async function crearDocumento(input: NuevoDocumento, archivo?: File | null): Promise<DocumentoFact> {
  let archivoPath: string | null = null
  if (archivo) {
    const limpio = archivo.name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80)
    archivoPath = `${input.tipo.toLowerCase()}/${input.fecha.slice(0, 7)}/${crypto.randomUUID()}-${limpio}`
    const { error } = await supabase.storage.from(BUCKET).upload(archivoPath, archivo, {
      upsert: false,
      contentType: archivo.type || 'application/octet-stream',
    })
    if (error) throw new Error(`No se pudo subir el archivo: ${error.message}`)
  }
  const { data, error } = await supabase
    .from('fact_documentos')
    .insert({
      tipo: input.tipo,
      clase: input.clase?.trim() || null,
      numero: input.numero.trim().toUpperCase(),
      fecha: input.fecha,
      razon_social: input.razonSocial || null,
      cliente: input.cliente?.trim() || null,
      valor: input.valor ?? null,
      nota: input.nota?.trim() || null,
      archivo_path: archivoPath,
      archivo_nombre: archivo?.name ?? null,
      creado_por: input.creadoPor,
    })
    .select('*')
    .single()
  if (error || !data) throw mensaje(error, 'No se pudo guardar el documento')
  return mapDocumento(data as Record<string, unknown>)
}

/** Vincula las líneas al documento. `reemplazar` = pasar líneas que ya tenían otro. */
export async function vincularDocumento(documentoId: string, ids: string[], usuario: string, reemplazar = false): Promise<number> {
  const { data, error } = await supabase.rpc('fact_vincular', {
    p_documento: documentoId, p_ids: ids, p_usuario: usuario, p_reemplazar: reemplazar,
  })
  if (error) throw mensaje(error, 'No se pudo vincular')
  return Number(data ?? 0)
}

export async function desvincularDocumento(tipo: TipoDocumento, ids: string[], usuario: string): Promise<number> {
  const { data, error } = await supabase.rpc('fact_desvincular', { p_tipo: tipo, p_ids: ids, p_usuario: usuario })
  if (error) throw mensaje(error, 'No se pudo quitar')
  return Number(data ?? 0)
}

/** Abre el archivo con un enlace firmado de 10 minutos (el depósito es privado). */
export async function abrirArchivo(path: string): Promise<void> {
  // La ventana se abre YA (dentro del clic) para que el navegador no la bloquee.
  const ventana = window.open('', '_blank')
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 600)
  if (error || !data?.signedUrl) {
    ventana?.close()
    throw new Error('No se pudo abrir el archivo.')
  }
  if (ventana) ventana.location.href = data.signedUrl
  else window.location.href = data.signedUrl
}
