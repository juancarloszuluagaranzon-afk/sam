/**
 * Foto de una pieza del taller — DOS tamaños generados en el celular (26-oct-2026).
 *
 * Por qué dos: el servidor es un VPS sin CDN que redimensione al vuelo. Si la lista bajara la foto grande,
 * cada fila costaría ~45 KB; con la miniatura cuesta ~5 KB y la grande solo se baja al abrir la ficha.
 *
 * Reglas (las dos primeras son lecciones de este proyecto):
 *  - El criterio no es «lo más chico posible» sino lo más chico que TODAVÍA SIRVE: el detalle debe dejar
 *    leer un número de parte grabado, la miniatura solo reconocer la pieza.
 *  - 🔴 `canvas.toBlob('image/webp')` en Safari/iPhone NO falla: devuelve un PNG (más pesado). Por eso se
 *    pide WebP y se COMPRUEBA `blob.type`; si no es WebP se vuelve a pedir JPEG.
 *  - El nombre del archivo sale del SHA-256 del detalle: la misma foto no se guarda dos veces y un
 *    reintento de subida es idempotente.
 *  - Nunca subir crudo (las fotos de celular pesan 2–5 MB): se reutiliza `createImageBitmap` con la
 *    orientación EXIF, igual que `lib/imagenLigera.ts`.
 */

export type TipoFotoPieza = 'image/webp' | 'image/jpeg'
export type ExtFotoPieza = 'webp' | 'jpg'
export type VarianteFotoPieza = 'thumb' | 'full'

export interface FotoPiezaLista {
  /** Miniatura: lado mayor ~200 px, calidad ~0,5. */
  thumb: Blob
  /** Detalle: lado mayor ~900 px, calidad ~0,65. Si el resultado pasa de ~90 KB se baja la calidad por pasos. */
  full: Blob
  /** El tipo REAL que salió (comprobado, no el pedido). Las dos variantes llevan el mismo. */
  tipo: TipoFotoPieza
  ext: ExtFotoPieza
  /** SHA-256 en hexadecimal minúscula (64 caracteres) del detalle. */
  hash: string
  /** Medidas reales del detalle en px. */
  w: number
  h: number
}

/** Perfiles de compresión de la pieza (el detalle usa `maxBytes` para bajar la calidad si hace falta). */
export const PERFIL_PIEZA = {
  thumb: { maxLado: 200, calidad: 0.5, maxBytes: 12_000 },
  full: { maxLado: 900, calidad: 0.65, maxBytes: 90_000 },
} as const

export function escalarA(w: number, h: number, maxLado: number): { w: number; h: number } {
  const escala = Math.min(1, maxLado / Math.max(w, h))
  return { w: Math.max(1, Math.round(w * escala)), h: Math.max(1, Math.round(h * escala)) }
}

/**
 * Ruta dentro del depósito `taller`: `repuestos/<2 primeros del hash>/<hash>_<variante>.<ext>`.
 * Ej.: `repuestos/7a/7ab3…e1_thumb.webp`. Lanza si el hash no es SHA-256 hexadecimal.
 */
export function rutaFotoPieza(hash: string, variante: VarianteFotoPieza, ext: ExtFotoPieza): string {
  if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error('Hash de foto inválido')
  return `repuestos/${hash.slice(0, 2)}/${hash}_${variante}.${ext}`
}

/** SHA-256 hexadecimal minúscula de unos bytes (`crypto.subtle.digest`). */
export async function sha256Hex(datos: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', datos)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Convierte la foto que tomó el celular en las dos variantes listas para subir.
 * Si el archivo no se puede decodificar lanza un Error con mensaje claro en español (la pantalla lo muestra).
 */
export async function prepararFotoPieza(file: File): Promise<FotoPiezaLista> {
  let src: ImageBitmap | HTMLImageElement
  if (typeof createImageBitmap === 'function') {
    try { src = await createImageBitmap(file, { imageOrientation: 'from-image' }) }
    catch {
      try { src = await createImageBitmap(file) }
      catch { src = await cargarImagen(file) }
    }
  } else src = await cargarImagen(file)
  try {
    const sw = 'naturalWidth' in src ? src.naturalWidth : src.width
    const sh = 'naturalHeight' in src ? src.naturalHeight : src.height
    if (!sw || !sh) throw new Error('No se pudo leer la foto. Toma otra.')
    const render = async (perfil: { maxLado: number; calidad: number; maxBytes: number }, mime: string): Promise<Blob> => {
      const d = escalarA(sw, sh, perfil.maxLado)
      let canvas: OffscreenCanvas | HTMLCanvasElement
      if (typeof OffscreenCanvas !== 'undefined') canvas = new OffscreenCanvas(d.w, d.h)
      else { const c = document.createElement('canvas'); c.width = d.w; c.height = d.h; canvas = c }
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('No se pudo procesar la foto. Toma otra.')
      ctx.drawImage(src, 0, 0, d.w, d.h)
      const toBlob = async (quality: number): Promise<Blob | null> => {
        if (typeof OffscreenCanvas !== 'undefined' && canvas instanceof OffscreenCanvas) return canvas.convertToBlob({ type: mime, quality })
        return new Promise((resolve) => (canvas as HTMLCanvasElement).toBlob(resolve, mime, quality))
      }
      let quality: number = perfil.calidad
      let blob = await toBlob(quality)
      for (let i = 0; blob && blob.size > perfil.maxBytes && quality > 0.25 && i < 4; i++) {
        quality = Math.max(0.25, quality - 0.12)
        blob = await toBlob(quality)
      }
      if (!blob) throw new Error('No se pudo procesar la foto. Toma otra.')
      return blob
    }
    let tipo: TipoFotoPieza = 'image/webp'
    let full = await render(PERFIL_PIEZA.full, tipo)
    if (full.type !== 'image/webp') { tipo = 'image/jpeg'; full = await render(PERFIL_PIEZA.full, tipo) }
    const thumb = await render(PERFIL_PIEZA.thumb, tipo)
    if (thumb.type !== tipo) throw new Error('No se pudo procesar la foto. Toma otra.')
    const hash = await sha256Hex(await full.arrayBuffer())
    const d = escalarA(sw, sh, PERFIL_PIEZA.full.maxLado)
    return { thumb, full, tipo, ext: tipo === 'image/webp' ? 'webp' : 'jpg', hash, w: d.w, h: d.h }
  } catch (err) {
    if (err instanceof Error && err.message === 'No se pudo leer la foto. Toma otra.') throw err
    throw err
  } finally { if ('close' in src) src.close() }
}

async function cargarImagen(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => { URL.revokeObjectURL(url); resolve(img) }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se pudo leer la foto. Toma otra.')) }
    img.src = url
  })
}
