import type { Insumo } from '../domain/sam'
import type { FotoPiezaLista } from '../lib/fotoPieza'
import { rutaFotoPieza } from '../lib/fotoPieza'
import { supabase } from '../lib/supabase'
import { ajustarStockInsumo, mapInsumo } from './samApi'
import { siguienteCodigo } from './tallerApi'
import { db } from '../lib/db'
import { enviarOEncolar, esFotoLocal, subirOGuardarFoto } from '../lib/outboxInsumos'

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

interface PayloadPieza { pieza: NuevaPieza; foto?: FotoPiezaRef }

async function leerInsumo(id: string): Promise<Insumo> {
  const { data, error } = await supabase.from('insumos').select('*').eq('id', id).single()
  if (error || !data) throw new Error(error?.message || 'No se pudo leer la pieza')
  // El mismo mapeo que usa todo el catálogo: una copia a mano se desfasa cuando se agrega un campo.
  return mapInsumo(data as Record<string, unknown>)
}

const MOTIVO_CARGA_INICIAL = 'Carga inicial del taller'

async function subirBlob(hash: string, variante: 'thumb' | 'full', file: File): Promise<string> {
  const ext = file.type === 'image/webp' ? 'webp' : 'jpg'
  const ruta = rutaFotoPieza(hash, variante, ext)
  const { error } = await supabase.storage.from('taller').upload(ruta, file, {
    upsert: true, cacheControl: '31536000', contentType: file.type,
  })
  if (error) throw error
  return supabase.storage.from('taller').getPublicUrl(ruta).data.publicUrl
}

/**
 * Sube las dos variantes al depósito `taller` (miniatura primero) con `upsert: true` y
 * `cacheControl: '31536000'` (un año: el nombre cambia si cambia el contenido). Devuelve las URLs públicas.
 */
export async function subirFotoPieza(foto: FotoPiezaLista): Promise<FotoPiezaSubida> {
  const thumbPath = rutaFotoPieza(foto.hash, 'thumb', foto.ext)
  const { error: thumbError } = await supabase.storage.from('taller').upload(thumbPath, foto.thumb, {
    upsert: true, cacheControl: '31536000', contentType: foto.tipo,
  })
  if (thumbError) throw thumbError
  const fullPath = rutaFotoPieza(foto.hash, 'full', foto.ext)
  const { error } = await supabase.storage.from('taller').upload(fullPath, foto.full, {
    upsert: true, cacheControl: '31536000', contentType: foto.tipo,
  })
  if (error) throw error
  const storage = supabase.storage.from('taller')
  return { fotoThumbUrl: storage.getPublicUrl(thumbPath).data.publicUrl, fotoUrl: storage.getPublicUrl(fullPath).data.publicUrl, fotoHash: foto.hash }
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
  const normal = (v?: string) => v?.trim().toUpperCase() || null
  const { data: existente } = await supabase.from('insumos').select('*').eq('id', p.id).maybeSingle()
  if (!existente) {
    const payload: Record<string, unknown> = {
      id: p.id, nombre: p.nombre.trim().toUpperCase(), categoria: 'MATERIAL', unidad: 'unidad', es_repuesto: true,
      ubicacion: p.ubicacion.trim().toUpperCase(), stock_minimo: p.stockMinimo ?? 0,
    }
    if (p.codigo) payload.codigo = normal(p.codigo)
    if (p.familia) payload.familia = normal(p.familia)
    if (p.marca) payload.marca = normal(p.marca)
    if (p.numeroParte) payload.numero_parte = normal(p.numeroParte)
    if (p.referencia) payload.referencia = normal(p.referencia)
    const { error } = await supabase.from('insumos').upsert(payload, { onConflict: 'id', ignoreDuplicates: true })
    if (error) throw error
  }
  let actual = await leerInsumo(p.id)
  if (p.familia && !p.codigo && !actual.codigo) {
    const codigo = await siguienteCodigo(p.familia)
    const { error } = await supabase.from('insumos').update({ codigo: codigo.trim().toUpperCase() }).eq('id', p.id).is('codigo', null)
    if (error) throw error
    actual = await leerInsumo(p.id)
  }
  // 🔴 La carga inicial se hace UNA sola vez por pieza y bodega. Un reintento de la cola (p. ej. porque falló la
  // foto) no puede volver a «fijar» la existencia: si entretanto se gastaron repuestos, los devolvería al
  // conteo inicial. La marca de que ya se hizo es su movimiento en el kardex. Una pieza nueva nace con 0: con
  // cantidad 0 no hay nada que registrar.
  if (p.cantidad > 0) {
    const { data: yaCargada, error: kardexError } = await supabase.from('insumos_kardex').select('id')
      .eq('insumo_id', p.id).eq('bodega_id', p.bodegaId).eq('motivo', MOTIVO_CARGA_INICIAL).limit(1)
    if (kardexError) throw kardexError
    if (!yaCargada || yaCargada.length === 0) {
      actual = await ajustarStockInsumo({ insumoId: p.id, nuevoStock: p.cantidad, motivo: MOTIVO_CARGA_INICIAL, creadoPor: p.creadoPor, bodegaId: p.bodegaId })
    }
  }
  if (foto && !esFotoLocal(foto.fotoUrl) && !esFotoLocal(foto.fotoThumbUrl)) {
    const { error } = await supabase.from('insumos').update({ foto_url: foto.fotoUrl, foto_thumb_url: foto.fotoThumbUrl, foto_hash: foto.fotoHash, updated_at: new Date().toISOString() }).eq('id', p.id)
    if (error) throw error
  }
  return leerInsumo(p.id)
}

/** Cambia la foto de una pieza que ya existe (sube y actualiza las tres columnas). */
export async function cambiarFotoPieza(insumoId: string, foto: FotoPiezaLista): Promise<Insumo> {
  const subida = await subirFotoPieza(foto)
  const { error } = await supabase.from('insumos').update({ foto_url: subida.fotoUrl, foto_thumb_url: subida.fotoThumbUrl, foto_hash: subida.fotoHash, updated_at: new Date().toISOString() }).eq('id', insumoId)
  if (error) throw error
  return leerInsumo(insumoId)
}

/**
 * Lo que llama la pantalla al guardar. Prepara el orden correcto:
 *  1. Si hay foto: cada variante va por `subirOGuardarFoto` (sin señal queda en el equipo con marcador `local://`).
 *  2. La pieza va por `enviarOEncolar('PIEZA', payload, …)`: con señal se crea ya; sin señal queda en la cola
 *     (`outboxInsumos`) y, al sincronizar, se suben las fotos pendientes y se crea la pieza.
 * Devuelve `enviado: false` cuando quedó en cola — la pantalla debe decir «guardada, sube cuando haya señal».
 */
export async function guardarPiezaTaller(p: NuevaPieza, foto?: FotoPiezaLista): Promise<{ enviado: boolean }> {
  let ref: FotoPiezaRef | undefined
  if (foto) {
    const upload = (hint: string, file: File, indice: number) => subirBlob(hint, indice === 0 ? 'thumb' : 'full', file)
    const thumb = await subirOGuardarFoto(foto.hash, new File([foto.thumb], `${foto.hash}_thumb.${foto.ext}`, { type: foto.tipo }), 0, upload)
    const full = await subirOGuardarFoto(foto.hash, new File([foto.full], `${foto.hash}_full.${foto.ext}`, { type: foto.tipo }), 1, upload)
    ref = { fotoUrl: full.url, fotoThumbUrl: thumb.url, fotoHash: foto.hash }
  }
  const payload: PayloadPieza = { pieza: p, foto: ref }
  return enviarOEncolar('PIEZA', payload, () => ejecutarPieza(payload))
}

export interface ProgresoCarga { hechas: number; total: number }

/**
 * Guarda MUCHAS piezas de una vez (la carga desde Excel). Por tandas de 50, con 3 peticiones por tanda en vez de 5-6
 * por pieza (500 piezas ≈ 30 peticiones, no 3.000). Todas las piezas traen su `id` (uuid) desde el análisis, así que
 * una tanda que se repite NO crea gemelas. Cada pieza lleva su `bodegaId` y `creadoPor` (el mismo para todas).
 *
 * Por tanda, en este orden:
 *  1. `insumos`: insert con `ignoreDuplicates` (nombre, ubicación, es_repuesto, stock = cantidad, stock_minimo y lo opcional en
 *     MAYÚSCULA; categoría 'MATERIAL', unidad 'unidad'). Si trae `familia` y no `codigo`, el código propio lo pide
 *     `siguienteCodigo(familia)` ANTES, de a una, solo a esas.
 *  2. Pregunta qué ids de la tanda YA tienen su movimiento «Carga inicial del taller» en `insumos_kardex` (para esa bodega) y
 *     a las que ya lo tienen NO les repite nada (así un reintento no vuelve a «fijar» la existencia).
 *  3. A las demás, con cantidad > 0: un insert en `insumos_kardex` (tipo 'AJUSTE', cantidad = saldo = la cantidad, motivo
 *     «Carga inicial del taller», creado_por) y un upsert en `insumos_stock` (insumo_id,bodega_id → stock).
 * Si una tanda falla, lanza el error con cuántas llevaba hechas (`error.hechas`): lo ya guardado queda guardado y se puede
 * reintentar el MISMO arreglo. Devuelve cuántas piezas se crearon y cuántas ya existían.
 */
export async function importarPiezas(
  piezas: Array<NuevaPieza & { codigo?: string }>,
  onProgreso?: (p: ProgresoCarga) => void,
): Promise<{ creadas: number; yaExistian: number }> {
  if (piezas.length === 0) return { creadas: 0, yaExistian: 0 }
  let hechas = 0
  let creadas = 0
  let yaExistian = 0
  const motivo = MOTIVO_CARGA_INICIAL
  for (let inicio = 0; inicio < piezas.length; inicio += 50) {
    const tanda = piezas.slice(inicio, inicio + 50)
    try {
      const ids = tanda.map((p) => p.id)
      const { data: antes, error: errorIds } = await supabase.from('insumos').select('id').in('id', ids)
      if (errorIds) throw errorIds
      const ya = new Set((antes ?? []).map((r) => String(r.id)))
      const filas = tanda.map((p) => {
        const fila: Record<string, unknown> = { id: p.id, nombre: p.nombre.trim().toUpperCase(), ubicacion: p.ubicacion.trim().toUpperCase(), categoria: 'MATERIAL', unidad: 'unidad', es_repuesto: true, stock: p.cantidad, stock_minimo: p.stockMinimo ?? 0 }
        if (p.codigo) fila.codigo = p.codigo.trim().toUpperCase()
        if (p.familia) fila.familia = p.familia.trim().toUpperCase()
        if (p.marca) fila.marca = p.marca.trim().toUpperCase()
        if (p.numeroParte) fila.numero_parte = p.numeroParte.trim().toUpperCase()
        if (p.referencia) fila.referencia = p.referencia.trim().toUpperCase()
        return fila
      })
      const { error: errorInsumos } = await supabase.from('insumos').upsert(filas, { onConflict: 'id', ignoreDuplicates: true })
      if (errorInsumos) throw errorInsumos
      const { data: movimientos, error: errorKardex } = await supabase.from('insumos_kardex').select('insumo_id')
        .in('insumo_id', ids).eq('bodega_id', tanda[0].bodegaId).eq('motivo', motivo)
      if (errorKardex) throw errorKardex
      const cargados = new Set((movimientos ?? []).map((r) => String(r.insumo_id)))
      const paraCargar = tanda.filter((p) => p.cantidad > 0 && !cargados.has(p.id))
      if (paraCargar.length) {
        // 🔴 Primero la EXISTENCIA y después su movimiento: la marca de «ya se cargó» es el movimiento del kardex. Si fuera
        // al revés y fallara la existencia, el reintento vería el movimiento, daría la carga por hecha y la pieza
        // quedaría en 0 para siempre. Así, un corte a mitad solo repite lo que falta (sin movimiento no se ha gastado nada).
        const { error: errorStock } = await supabase.from('insumos_stock').upsert(paraCargar.map((p) => ({ insumo_id: p.id, bodega_id: p.bodegaId, stock: p.cantidad })), { onConflict: 'insumo_id,bodega_id' })
        if (errorStock) throw errorStock
        const { error: errorInsertKardex } = await supabase.from('insumos_kardex').insert(paraCargar.map((p) => ({
          insumo_id: p.id, bodega_id: p.bodegaId, tipo: 'AJUSTE', cantidad: p.cantidad, saldo: p.cantidad, motivo, creado_por: p.creadoPor ?? null,
        })))
        if (errorInsertKardex) throw errorInsertKardex
      }
      // 🔴 Los códigos propios (ROD-0001…) los reparte la BASE, de un solo golpe y con candado por familia (migración
      // 20261026235000): pedir `siguienteCodigo` pieza por pieza antes de insertar daba el MISMO código a todas las de una familia.
      if (tanda.some((p) => p.familia && !p.codigo)) {
        const { error: errorCodigos } = await supabase.rpc('asignar_codigos_insumos', { p_ids: ids })
        if (errorCodigos) throw errorCodigos
      }
      yaExistian += tanda.filter((p) => ya.has(p.id)).length
      creadas += tanda.length - tanda.filter((p) => ya.has(p.id)).length
      hechas += tanda.length
      onProgreso?.({ hechas, total: piezas.length })
    } catch (error) {
      // Los errores de la base llegan como objetos {message, code}, no como `Error`: sin esto el mensaje era «[object Object]».
      const fallo = error instanceof Error ? error : new Error((error as { message?: string })?.message || 'No se pudo guardar la tanda')
      Object.assign(fallo, { hechas })
      throw fallo
    }
  }
  return { creadas, yaExistian }
}

export async function ejecutarPieza(payload: PayloadPieza): Promise<void> {
  await crearPiezaTaller(payload.pieza)
  if (!payload.foto) return
  const foto = { ...payload.foto }
  // 🔴 Las fotos del equipo se borran SOLO al final, cuando la pieza ya quedó con sus dos URLs. Si se borraran
  // al subir cada una y fallara la segunda, el reintento de la cola no encontraría la primera y se atascaría
  // para siempre. Subir de nuevo es inofensivo: el nombre sale del contenido y la subida es `upsert`.
  const subidas: string[] = []
  for (const [key, variante] of [['fotoThumbUrl', 'thumb'], ['fotoUrl', 'full']] as const) {
    const url = foto[key]
    if (!esFotoLocal(url)) continue
    const localId = url.slice('local://'.length)
    const pendiente = await db.fotos.get(localId)
    if (!pendiente) throw new Error('No se encontró una foto pendiente del taller')
    const file = new File([pendiente.blob], pendiente.nombre, { type: pendiente.blob.type || 'image/jpeg' })
    foto[key] = await subirBlob(foto.fotoHash, variante, file)
    subidas.push(localId)
  }
  await crearPiezaTaller(payload.pieza, foto)
  for (const localId of subidas) await db.fotos.delete(localId)
}
