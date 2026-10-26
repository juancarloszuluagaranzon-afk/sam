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

/**
 * Ruta dentro del depósito `taller`: `repuestos/<2 primeros del hash>/<hash>_<variante>.<ext>`.
 * Ej.: `repuestos/7a/7ab3…e1_thumb.webp`. Lanza si el hash no es SHA-256 hexadecimal.
 */
export function rutaFotoPieza(hash: string, variante: VarianteFotoPieza, ext: ExtFotoPieza): string {
  void hash; void variante; void ext
  throw new Error('no implementado')
}

/** SHA-256 hexadecimal minúscula de unos bytes (`crypto.subtle.digest`). */
export async function sha256Hex(datos: ArrayBuffer): Promise<string> {
  void datos
  throw new Error('no implementado')
}

/**
 * Convierte la foto que tomó el celular en las dos variantes listas para subir.
 * Si el archivo no se puede decodificar lanza un Error con mensaje claro en español (la pantalla lo muestra).
 */
export async function prepararFotoPieza(file: File): Promise<FotoPiezaLista> {
  void file
  throw new Error('no implementado')
}
