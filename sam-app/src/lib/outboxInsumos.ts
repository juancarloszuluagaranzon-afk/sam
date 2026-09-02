import { db } from './db'
import { crearCaso } from '../services/soporteApi'
import {
  entregarSolicitud, entregarDirecto, confirmarRecepcion, createSolicitud,
  confirmarTraslado, registrarCombustibleExterno, autoAbastecer, anularTraslado,
  setOperarioNovedades, confirmarTanqueo,
} from '../services/samApi'

/**
 * Cola de salida para INSUMOS — lo que se registra sin señal.
 *
 * El outbox existía solo para las labores. Todo el módulo de insumos escribía
 * directo a Supabase, así que **sin señal el registro se perdía**: la promesa
 * fallaba, la pantalla mostraba "no se pudo" y ahí moría. El supervisor de
 * insumos trabaja justamente donde no hay cobertura, así que era el peor sitio
 * posible para no tener cola.
 *
 * Qué se encola: solo lo que se hace EN CAMPO. Inventario, compras y taller los
 * maneja administración con señal, y ahí un error a la cara es preferible a una
 * cola invisible.
 *
 * 🔴 Se encola la INTENCIÓN, no el resultado. Un despacho no guarda "el saldo
 * quedó en 78" sino "saqué 12 galones de esta bodega": el saldo se recalcula
 * al sincronizar, contra el stock real de ese momento. Guardar el saldo
 * calculado offline y aplicarlo días después descuadraría el inventario.
 */

export type InsumoOpKind =
  | 'SOLICITUD'            // el operario pide
  | 'DESPACHO'             // el supervisor entrega contra una solicitud
  | 'ENTREGA_DIRECTA'      // el supervisor entrega sin solicitud previa
  | 'CONFIRMAR_RECEPCION'  // el operario aprueba lo que recibió
  | 'CONFIRMAR_TRASLADO'   // el supervisor recibe material de la principal
  | 'TANQUEO'              // combustible: estación o sede
  | 'AUTOABASTECER'        // el supervisor toma material de la principal
  | 'ANULAR_TRASLADO'      // se devuelve a la principal: error al enviar o rechazo
  | 'NOVEDAD'              // el operario reporta vacaciones, taller, incapacidad…
  | 'CONFIRMAR_TANQUEO'    // el operario aprueba el combustible que le echaron
  | 'SOPORTE'              // el operario reporta una falla de la app

/** Etiqueta para la pantalla de pendientes; el operario no lee códigos. */
export const OP_LABEL: Record<InsumoOpKind, string> = {
  SOLICITUD: 'Solicitud de insumos',
  DESPACHO: 'Despacho al operario',
  ENTREGA_DIRECTA: 'Entrega directa',
  CONFIRMAR_RECEPCION: 'Confirmación de recibido',
  CONFIRMAR_TRASLADO: 'Recepción de traslado',
  TANQUEO: 'Tanqueo de combustible',
  AUTOABASTECER: 'Abastecimiento del carro',
  ANULAR_TRASLADO: 'Rechazo de traslado',
  NOVEDAD: 'Novedad reportada',
  CONFIRMAR_TANQUEO: 'Confirmación de tanqueo',
  SOPORTE: 'Reporte a soporte',
}

/**
 * ¿El fallo fue por falta de red, o el servidor rechazó la operación?
 *
 * Es la distinción que decide todo: un rechazo real (stock insuficiente, una
 * solicitud ya despachada) **no se debe encolar** — reintentarlo mañana volvería
 * a fallar y le habríamos mentido al usuario diciendo "quedó guardado". Solo se
 * encola cuando de verdad no se pudo hablar con el servidor.
 */
export function esFalloDeRed(err: unknown): boolean {
  if (!navigator.onLine) return true
  const e = err as { message?: string; name?: string; code?: string }
  const msg = String(e?.message ?? '').toLowerCase()
  return (
    e?.name === 'TypeError' ||                 // fetch abortado sin red
    e?.name === 'AbortError' ||
    msg.includes('failed to fetch') ||
    msg.includes('networkerror') ||
    msg.includes('network request failed') ||
    msg.includes('load failed') ||             // Safari
    msg.includes('timeout') ||
    msg.includes('err_internet') ||
    e?.code === 'ECONNREFUSED'
  )
}

export async function encolarInsumo(kind: InsumoOpKind, payload: unknown): Promise<void> {
  await db.outbox.add({
    type: 'INSUMO',
    insumoOp: { kind, payload },
    queuedAt: new Date().toISOString(),
    status: 'pending',
  })
}

/** Ejecuta contra el servidor una operación que estaba en cola. */
export async function ejecutarInsumo(kind: InsumoOpKind, payload: unknown): Promise<void> {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const p = payload as any
  switch (kind) {
    case 'SOLICITUD': await createSolicitud(p); return
    case 'DESPACHO': await entregarSolicitud(p); return
    case 'ENTREGA_DIRECTA': await entregarDirecto(p); return
    case 'CONFIRMAR_RECEPCION': await confirmarRecepcion(p); return
    case 'CONFIRMAR_TRASLADO': await confirmarTraslado(p); return
    case 'TANQUEO': await registrarCombustibleExterno(p); return
    case 'AUTOABASTECER': await autoAbastecer(p); return
    case 'ANULAR_TRASLADO': await anularTraslado(p); return
    case 'NOVEDAD': await setOperarioNovedades(p.operadorId, p.fechas, p.tipo); return
    case 'CONFIRMAR_TANQUEO': await confirmarTanqueo(p); return
    // ⚠️ `crearCaso` es idempotente por folio: el reintento de la cola no crea
    // un caso gemelo. Probado contra produccion.
    case 'SOPORTE': await crearCaso(p); return
    default: throw new Error(`Operación desconocida en la cola: ${kind}`)
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

export interface ResultadoEnvio {
  /** true = llegó al servidor; false = quedó en cola esperando señal. */
  enviado: boolean
}

/**
 * Intenta la operación; si falla POR RED, la guarda en la cola.
 *
 * Devuelve `enviado` para que la pantalla diga la verdad: "entregado" cuando de
 * verdad se registró, y "guardado, se enviará cuando haya señal" cuando quedó
 * en cola. Decir "listo" en los dos casos es como se pierde la confianza.
 *
 * Si el servidor rechaza, relanza el error: eso lo tiene que ver el usuario.
 */
export async function enviarOEncolar(
  kind: InsumoOpKind,
  payload: unknown,
  ejecutar: () => Promise<void>,
): Promise<ResultadoEnvio> {
  // Sin red ni lo intentamos: directo a la cola, sin la espera del timeout.
  if (!navigator.onLine) {
    await encolarInsumo(kind, payload)
    return { enviado: false }
  }
  try {
    await ejecutar()
    return { enviado: true }
  } catch (err) {
    if (esFalloDeRed(err)) {
      await encolarInsumo(kind, payload)
      return { enviado: false }
    }
    throw err
  }
}

/** Cuántas operaciones de insumos esperan señal. */
export async function pendientesInsumos(): Promise<number> {
  const items = await db.outbox.where('status').anyOf(['pending', 'error']).toArray()
  return items.filter((i) => i.type === 'INSUMO').length
}

/* ── Fotos de evidencia sin señal ─────────────────────────────────────────── */

const PREFIJO_LOCAL = 'local://'

/**
 * Sube la foto; si no hay señal la guarda en el equipo y devuelve un marcador.
 *
 * El marcador (`local://abc123`) viaja dentro del registro encolado. Al
 * sincronizar se sube la foto de verdad y se reemplaza por su URL pública, así
 * que la evidencia llega completa aunque se haya tomado sin una raya de señal.
 */
export async function subirOGuardarFoto(
  hint: string,
  file: File,
  indice: number,
  subir: (hint: string, file: File, indice: number) => Promise<string>,
): Promise<{ url: string; local: boolean }> {
  const guardar = async () => {
    const localId = `${hint}-${indice}-${Date.now()}-${Math.round(Math.random() * 1e6)}`
    await db.fotos.put({
      localId, blob: file, nombre: file.name, hint, indice,
      queuedAt: new Date().toISOString(),
    })
    return { url: `${PREFIJO_LOCAL}${localId}`, local: true }
  }

  if (!navigator.onLine) return guardar()
  try {
    return { url: await subir(hint, file, indice), local: false }
  } catch (err) {
    if (esFalloDeRed(err)) return guardar()
    throw err
  }
}

export function esFotoLocal(url: string): boolean {
  return typeof url === 'string' && url.startsWith(PREFIJO_LOCAL)
}

/**
 * Cambia los marcadores `local://` por URLs reales, subiendo lo que haga falta.
 *
 * Se llama al sincronizar, justo antes de mandar el registro. Si una foto no
 * sube, se descarta del arreglo en vez de tumbar toda la operación: es mejor
 * perder una foto que perder la entrega entera.
 */
export async function resolverFotos(
  urls: string[] | undefined,
  subir: (hint: string, file: File, indice: number) => Promise<string>,
): Promise<string[] | undefined> {
  if (!urls || urls.length === 0) return urls
  const out: string[] = []
  for (const u of urls) {
    if (!esFotoLocal(u)) { out.push(u); continue }
    const localId = u.slice(PREFIJO_LOCAL.length)
    const foto = await db.fotos.get(localId)
    if (!foto) continue
    try {
      const file = new File([foto.blob], foto.nombre || 'evidencia.jpg', { type: foto.blob.type || 'image/jpeg' })
      out.push(await subir(foto.hint, file, foto.indice))
      await db.fotos.delete(localId)
    } catch {
      // La foto se queda para el próximo intento; el registro sigue su camino.
    }
  }
  return out
}

/** Campos de evidencia que puede traer un payload encolado. */
export async function resolverFotosDePayload(
  payload: unknown,
  subir: (hint: string, file: File, indice: number) => Promise<string>,
): Promise<unknown> {
  if (!payload || typeof payload !== 'object') return payload
  const p = { ...(payload as Record<string, unknown>) }
  if (Array.isArray(p.evidenciaUrls)) {
    p.evidenciaUrls = await resolverFotos(p.evidenciaUrls as string[], subir)
  }
  if (typeof p.tirillaUrl === 'string' && esFotoLocal(p.tirillaUrl)) {
    const [u] = (await resolverFotos([p.tirillaUrl], subir)) ?? []
    p.tirillaUrl = u
  }
  return p
}
