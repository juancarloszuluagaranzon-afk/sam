/**
 * Compresión de imágenes en el navegador — fotos LIVIANAS para no llenar el
 * servidor. Redimensiona el lado más largo y re-codifica a JPEG de baja calidad.
 *
 * Por qué: las fotos de celular pesan 2–5 MB. Subidas crudas, llenan el Storage
 * rapidísimo. Comprimidas quedan en ~20–80 KB (50–100× más livianas) y siguen
 * siendo legibles para saber qué se ve (evidencia de una entrega, una firma, un
 * estado). Se aplica en TODOS los puntos donde el app sube una foto.
 *
 * Medido en producción (1-ago-2026): las fotos de campo pesan ~70 KB con el
 * perfil viejo. Con el nuevo bajan a ~35 KB sin perder lo que se necesita ver.
 *
 * Detalles técnicos:
 *  - `createImageBitmap(file, { imageOrientation: 'from-image' })` corrige la
 *    orientación EXIF (fotos de celular no salen rotadas). Con fallback a
 *    <img> para navegadores viejos.
 *  - Canvas + `toBlob('image/jpeg', calidad)` para el peso mínimo.
 *  - Si el resultado quedara MÁS pesado que el original (imágenes ya chicas), se
 *    devuelve el original.
 *  - GIF y no-imágenes se dejan intactos (los GIF son animados: comprimir a JPEG
 *    los rompería).
 */

export interface OpcionesImagen {
  /** Px del lado más largo tras redimensionar (default 1024). */
  maxLado?: number
  /** Calidad JPEG 0..1 (default 0.5 = muy liviano y legible). */
  calidad?: number
  /** Si el resultado supera estos bytes, baja la calidad por pasos (opcional). */
  maxBytes?: number
}

const DEFAULTS: Required<Omit<OpcionesImagen, 'maxBytes'>> = {
  maxLado: 1024,
  calidad: 0.5,
}

/** Carga un File como bitmap corrigiendo la orientación EXIF, con fallback. */
async function cargarBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' })
    } catch {
      /* algunos navegadores no soportan la opción → fallback abajo */
    }
    try {
      return await createImageBitmap(file)
    } catch {
      /* fallback abajo */
    }
  }
  // Fallback: HTMLImageElement vía objectURL.
  return await new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => { URL.revokeObjectURL(url); resolve(img) }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('no se pudo leer la imagen')) }
    img.src = url
  })
}

function dimensiones(src: ImageBitmap | HTMLImageElement): { w: number; h: number } {
  if ('naturalWidth' in src) return { w: src.naturalWidth, h: src.naturalHeight }
  return { w: src.width, h: src.height }
}

function toBlob(canvas: HTMLCanvasElement, calidad: number): Promise<Blob | null> {
  return new Promise((res) => canvas.toBlob(res, 'image/jpeg', calidad))
}

/**
 * Comprime una imagen a JPEG liviano. Devuelve un File nuevo (.jpg) o el
 * original si no aplica (GIF/no-imagen) o si comprimir no lo hiciera más chico.
 */
export async function comprimirImagen(file: File, opts: OpcionesImagen = {}): Promise<File> {
  // No tocar lo que no es imagen, ni GIF (animado).
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return file

  const maxLado = opts.maxLado ?? DEFAULTS.maxLado
  let calidad = opts.calidad ?? DEFAULTS.calidad

  let src: ImageBitmap | HTMLImageElement
  try {
    src = await cargarBitmap(file)
  } catch {
    return file // si no se puede decodificar, subimos el original antes que fallar
  }

  const { w, h } = dimensiones(src)
  if (!w || !h) { if ('close' in src) src.close(); return file }

  const escala = Math.min(1, maxLado / Math.max(w, h))
  const outW = Math.max(1, Math.round(w * escala))
  const outH = Math.max(1, Math.round(h * escala))

  const canvas = document.createElement('canvas')
  canvas.width = outW
  canvas.height = outH
  const ctx = canvas.getContext('2d')
  if (!ctx) { if ('close' in src) src.close(); return file }
  ctx.drawImage(src as CanvasImageSource, 0, 0, outW, outH)
  if ('close' in src) src.close()

  let blob = await toBlob(canvas, calidad)
  // Si nos pusieron un objetivo de peso, bajamos calidad por pasos hasta cumplir.
  if (blob && opts.maxBytes) {
    let intentos = 0
    while (blob && blob.size > opts.maxBytes && calidad > 0.25 && intentos < 4) {
      calidad = Math.max(0.25, calidad - 0.12)
      blob = await toBlob(canvas, calidad)
      intentos++
    }
  }
  if (!blob) return file
  if (blob.size >= file.size) return file // no empeorar imágenes ya chicas

  const nombre = file.name.replace(/\.[^.]+$/, '') + '.jpg'
  return new File([blob], nombre, { type: 'image/jpeg', lastModified: Date.now() })
}

/**
 * Perfiles de compresión por caso de uso.
 *
 * El criterio no es "lo más chico posible": es lo más chico que TODAVÍA SIRVE
 * para lo que se va a mirar. Una foto de una pimpina solo tiene que dejar ver
 * que es una pimpina; una tirilla de la bomba tiene que dejar LEER los números,
 * y ahí achicar de más convierte la evidencia en nada. Por eso van separadas.
 */
export const PERFIL_IMAGEN = {
  /** Evidencia de campo (despacho, entrega, estado): se mira, no se lee. ~25–45 KB. */
  evidencia: { maxLado: 800, calidad: 0.45, maxBytes: 60_000 },
  /**
   * Documento con texto que hay que poder leer: tirilla de la bomba, factura.
   * Va más grande a propósito — son pocas y el número es la prueba. ~60–140 KB.
   */
  documento: { maxLado: 1400, calidad: 0.6, maxBytes: 150_000 },
  /** Foto de perfil / avatar: se ve en un círculo de 40 px. ~10–25 KB. */
  avatar: { maxLado: 400, calidad: 0.65, maxBytes: 40_000 },
  /** Imagen motivacional (se muestra grande). ~50–120 KB. */
  motivacion: { maxLado: 1000, calidad: 0.65, maxBytes: 150_000 },
} as const
