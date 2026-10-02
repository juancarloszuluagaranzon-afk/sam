import { supabase } from '../lib/supabase'
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '../data/constants'

/**
 * Facturas conectadas con SIIGO (2-oct-2026, migración 20261002210000 y la función
 * del servidor `siigo-factura`). La app NUNCA ve las credenciales de Siigo: le pide
 * a la función, que solo trabaja sobre facturas ya registradas en SAM.
 *   · verPdfSiigo  → abre el PDF OFICIAL de Siigo de esa factura.
 *   · traerEstadoSiigo → trae total, saldo y CUFE de Siigo y los deja guardados.
 */
export interface EstadoSiigo { siigo_id: string; nombre: string | null; total: number | null; saldo: number | null; cufe: string | null }
export interface DatosSiigo { siigoId: string | null; nombre: string | null; cufe: string | null; total: number | null; saldo: number | null; consultadoEn: string | null }

async function llamar<T>(documentoId: string, accion: 'estado' | 'pdf'): Promise<T> {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/siigo-factura`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}` },
    body: JSON.stringify({ documento_id: documentoId, accion }),
  })
  const d = await r.json().catch(() => ({})) as T & { error?: string }
  if (!r.ok || d.error) throw new Error(d.error || `Siigo no respondió (${r.status})`)
  return d
}

/** ¿Están cargadas las credenciales de Siigo de esta razón social? */
export async function siigoConectado(razonSocial: string | null): Promise<boolean> {
  if (!razonSocial) return false
  const { data } = await supabase.rpc('siigo_conectado', { p_razon_social: razonSocial })
  return data === true
}

/** Lo último que se trajo de Siigo para esta factura. */
export async function datosSiigo(documentoId: string): Promise<DatosSiigo | null> {
  const { data } = await supabase.from('fact_documentos')
    .select('siigo_id,siigo_nombre,siigo_cufe,siigo_total,siigo_saldo,siigo_consultado_en').eq('id', documentoId).maybeSingle()
  if (!data) return null
  const r = data as Record<string, unknown>
  return {
    siigoId: r.siigo_id ? String(r.siigo_id) : null, nombre: r.siigo_nombre ? String(r.siigo_nombre) : null,
    cufe: r.siigo_cufe ? String(r.siigo_cufe) : null, total: r.siigo_total != null ? Number(r.siigo_total) : null,
    saldo: r.siigo_saldo != null ? Number(r.siigo_saldo) : null, consultadoEn: r.siigo_consultado_en ? String(r.siigo_consultado_en) : null,
  }
}

export function traerEstadoSiigo(documentoId: string): Promise<EstadoSiigo> {
  return llamar<EstadoSiigo>(documentoId, 'estado')
}

/** Abre el PDF oficial de Siigo. La ventana se abre YA (en el clic) para que el navegador no la bloquee. */
export async function verPdfSiigo(documentoId: string): Promise<void> {
  const ventana = window.open('', '_blank')
  try {
    const { base64 } = await llamar<{ base64: string; nombre: string }>(documentoId, 'pdf')
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
    if (ventana) ventana.location.href = url
    else window.location.href = url
  } catch (e) {
    ventana?.close()
    throw e
  }
}
