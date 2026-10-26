import type { Insumo } from '../domain/sam'
import type { FotoPiezaLista } from '../lib/fotoPieza'

/**
 * Piezas del taller: alta rápida con foto y cambio de foto (26-oct-2026).
 *
 * Una pieza es una fila de `insumos` con `es_repuesto = true` y su existencia vive en la bodega del taller.
 * 🔴 Se encola la INTENCIÓN (como el resto de `outboxInsumos`): «crear la pieza X con N unidades», no el
 * resultado; y todo es IDEMPOTENTE, porque un reintento de la cola no puede crear una pieza gemela.
 * El orden importa: primero los DATOS (la pieza ya sirve para una orden de trabajo) y luego las fotos
 * (miniatura y luego detalle); si la foto falla por señal, la pieza no se pierde.
 */

export interface FotoPiezaSubida {
  /** URL pública del detalle y de la miniatura, y el hash (SHA-256 del detalle). */
  fotoUrl: string
  fotoThumbUrl: string
  fotoHash: string
}

export interface NuevaPieza {
  /** uuid que pone el CELULAR (`crypto.randomUUID()`): hace idempotente el reintento. */
  id: string
  /** Se guarda en MAYÚSCULA. */
  nombre: string
  /** Estante o lugar (texto libre, MAYÚSCULA). Obligatorio en el alta. */
  ubicacion: string
  /** Cuántas hay. 0 es válido. */
  cantidad: number
  /** Bodega del taller donde queda la existencia (`useTaller().bodegaTaller.id`). */
  bodegaId: string
  /** Opcionales («Más datos»). Con `familia` y sin `codigo`, el código propio se pide a la base al guardar. */
  codigo?: string
  familia?: string
  marca?: string
  numeroParte?: string
  referencia?: string
  stockMinimo?: number
  /** Quién la registra (id del usuario). */
  creadoPor?: string
}

/** ¿Una foto que ya está en el servidor, o un marcador `local://` que se sube al volver la señal? */
export interface FotoPiezaRef {
  fotoUrl: string
  fotoThumbUrl: string
  fotoHash: string
}

/**
 * Sube las dos variantes al depósito `taller` (miniatura primero) con `upsert: true` y
 * `cacheControl: '31536000'` (un año: el nombre cambia si cambia el contenido). Devuelve las URLs públicas.
 */
export async function subirFotoPieza(foto: FotoPiezaLista): Promise<FotoPiezaSubida> {
  void foto
  throw new Error('no implementado')
}

/**
 * Crea la pieza (o la completa si ya existe: idempotente por `id`) y fija su existencia en la bodega del taller.
 * - `insert … on conflict (id) do nothing` / upsert con `ignoreDuplicates`.
 * - Si `cantidad` difiere del stock actual de esa bodega, `ajustarStockInsumo` con motivo «Carga inicial del taller»;
 *   si ya es igual NO escribe un movimiento vacío.
 * - Con `familia` y sin `codigo`: pide `siguienteCodigo(familia)` UNA vez (si ya tiene código no lo cambia).
 * - Si trae `foto` (URLs reales), las guarda en `foto_url`/`foto_thumb_url`/`foto_hash`.
 */
export async function crearPiezaTaller(p: NuevaPieza, foto?: FotoPiezaRef): Promise<Insumo> {
  void p; void foto
  throw new Error('no implementado')
}

/** Cambia la foto de una pieza que ya existe (sube y actualiza las tres columnas). */
export async function cambiarFotoPieza(insumoId: string, foto: FotoPiezaLista): Promise<Insumo> {
  void insumoId; void foto
  throw new Error('no implementado')
}

/**
 * Lo que llama la pantalla al guardar. Prepara el orden correcto:
 *  1. Si hay foto: cada variante va por `subirOGuardarFoto` (sin señal queda en el equipo con marcador `local://`).
 *  2. La pieza va por `enviarOEncolar('PIEZA', payload, …)`: con señal se crea ya; sin señal queda en la cola
 *     (`outboxInsumos`) y, al sincronizar, se suben las fotos pendientes y se crea la pieza.
 * Devuelve `enviado: false` cuando quedó en cola — la pantalla debe decir «guardada, sube cuando haya señal».
 */
export async function guardarPiezaTaller(p: NuevaPieza, foto?: FotoPiezaLista): Promise<{ enviado: boolean }> {
  void p; void foto
  throw new Error('no implementado')
}
