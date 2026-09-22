import { db, type OutboxItem } from './db'
import { esFalloDeRed } from './outboxInsumos'
import { leerLlavePersonal, reportarLabor, subirFotoFinca } from '../services/fincasApi'

/**
 * Cola de salida de FINCAS — el reporte de campo hecho sin señal.
 *
 * 🔴 Las fincas administradas quedan donde no hay cobertura, que es justo donde
 * se reporta la labor. El MVP exigía señal: si no había, la pantalla decía «no
 * se pudo» y el trabajo se perdía — el supervisor tenía que acordarse de
 * volverlo a registrar más tarde, con la foto ya borrada del celular. Ahora el
 * reporte se guarda completo en el equipo (con su foto) y sale solo cuando
 * vuelve la señal, como el resto de la app.
 *
 * Tres cosas que lo hacen seguro:
 * - **La id se fija al reportar.** `af_reportar` es idempotente por esa id: si
 *   el envío alcanzó a llegar antes de cortarse, el reintento NO lo duplica.
 * - **La foto viaja con el reporte.** Se guarda el archivo en el equipo y el
 *   reporte lleva un marcador `local://`; al sincronizar se sube y se cambia por
 *   su URL. Sin foto no hay reporte: si la subida falla, el reporte espera —
 *   nunca se manda sin evidencia.
 * - **Quién reportó lo decide la LLAVE**, no el aparato: al enviar se usa la
 *   llave del mismo usuario que lo registró. Si su llave venció, el reporte
 *   espera y la pantalla le pide confirmar el PIN.
 */

const PREFIJO_LOCAL = 'local://'

/** Avisa a las pantallas del módulo que cambió lo que espera señal. */
export const EVENTO_PENDIENTES = 'fincas:pendientes'
export function avisarPendientes() { window.dispatchEvent(new Event(EVENTO_PENDIENTES)) }

export interface ReporteEncolado {
  id: string
  laborId: string
  cantidad: number
  fecha: string
  /** URL pública, o `local://<id>` mientras la foto espera en el equipo. */
  fotoUrl: string
  lat: number | null
  lng: number | null
  precisionM: number | null
  nota: string
  /** De quién es la llave que debe mandarlo. */
  usuario: string
  /** Para la pantalla de pendientes: se ve sin tener que consultar la base. */
  etiqueta: string
}

export interface ReportePendiente extends ReporteEncolado {
  outboxId: number
  queuedAt: string
  estado: 'pending' | 'error'
  errorMessage?: string
}

function esFotoLocal(url: string): boolean {
  return typeof url === 'string' && url.startsWith(PREFIJO_LOCAL)
}

/** Guarda la foto en el equipo y devuelve el marcador que viaja en el reporte. */
async function guardarFotoLocal(file: File, idReporte: string): Promise<string> {
  const localId = `finca-${idReporte}`
  await db.fotos.put({
    localId, blob: file, nombre: file.name || 'labor.jpg',
    hint: `fincas/${idReporte}`, indice: 0, queuedAt: new Date().toISOString(),
  })
  return `${PREFIJO_LOCAL}${localId}`
}

async function encolar(r: ReporteEncolado): Promise<void> {
  await db.outbox.add({
    type: 'FINCA',
    fincaOp: { kind: 'REPORTE', payload: r },
    queuedAt: new Date().toISOString(),
    status: 'pending',
  })
}

/**
 * Manda el reporte; si no se pudo hablar con el servidor, lo deja en la cola.
 *
 * Devuelve `enviado` para que la pantalla diga la verdad: «reportado» solo
 * cuando de verdad llegó, y «guardado, sale cuando haya señal» cuando quedó
 * esperando. Un rechazo del servidor (pasarse del área, fecha futura, labor ya
 * cerrada) NO se encola: se relanza para que la persona lo corrija ahora.
 */
export async function enviarOEncolarReporte(
  r: Omit<ReporteEncolado, 'fotoUrl'>,
  foto: File,
  token: string,
): Promise<{ enviado: boolean }> {
  const guardar = async () => {
    await encolar({ ...r, fotoUrl: await guardarFotoLocal(foto, r.id) })
    return { enviado: false }
  }
  if (!navigator.onLine) return guardar()
  try {
    // Con señal mala, sin tope se queda en «Enviando…» para siempre. Al vencer
    // se trata como falta de red: a la cola, no a la basura.
    await conTope(90_000, (async () => {
      const fotoUrl = await subirFotoFinca(foto, 'reportes')
      await reportarLabor({ ...r, fotoUrl }, token)
    })())
    return { enviado: true }
  } catch (e) {
    if (esFalloDeRed(e)) return guardar()
    throw e
  }
}

/** Manda un reporte que estaba en cola. Lanza si todavía no se puede. */
async function ejecutar(item: OutboxItem): Promise<void> {
  const r = item.fincaOp!.payload as ReporteEncolado
  const token = leerLlavePersonal(r.usuario)
  if (!token) {
    throw new Error('SIN_LLAVE: entre a Fincas y confirme su PIN para enviar lo que quedó pendiente.')
  }

  let fotoUrl = r.fotoUrl
  if (esFotoLocal(fotoUrl)) {
    const localId = fotoUrl.slice(PREFIJO_LOCAL.length)
    const guardada = await db.fotos.get(localId)
    if (!guardada) throw new Error('SIN_FOTO: la foto de este reporte ya no está en el equipo.')
    const file = new File([guardada.blob], guardada.nombre || 'labor.jpg', { type: guardada.blob.type || 'image/jpeg' })
    fotoUrl = await subirFotoFinca(file, 'reportes')
    // La foto subida se anota de una: si el reporte falla por otra cosa, el
    // reintento no la vuelve a subir (ni deja copias sueltas en el servidor).
    await db.outbox.update(item.id!, { fincaOp: { kind: 'REPORTE', payload: { ...r, fotoUrl } } })
    await db.fotos.delete(localId)
  }

  await reportarLabor({ ...r, fotoUrl }, token)
}

/**
 * Manda todo lo que espera señal. Devuelve cuántos salieron.
 *
 * Lo que el servidor rechaza NO se borra: queda en error, con su motivo, y se
 * sigue viendo en la pantalla de pendientes. Nada de trabajo desaparece solo.
 */
export function sincronizarReportes(): Promise<number> {
  // 🔴 Un solo envío a la vez. Tres cosas disparan la sincronización (el evento
  // «volvió la señal», abrir Fincas y el botón «Intentar enviar ahora») y si dos
  // corren juntas suben la MISMA foto dos veces: el reporte no se duplica (la
  // base lo impide por su id), pero quedan fotos huérfanas en el servidor.
  if (!enVuelo) enVuelo = hacerEnvio().finally(() => { enVuelo = null })
  return enVuelo
}
let enVuelo: Promise<number> | null = null

async function hacerEnvio(): Promise<number> {
  const items = (await db.outbox.where('status').anyOf(['pending', 'error']).toArray())
    .filter((i) => i.type === 'FINCA')
  let enviados = 0
  for (const item of items) {
    try {
      // Se relee por si otro paso ya le cambió la foto por su URL.
      const fresco = (await db.outbox.get(item.id!)) ?? item
      await ejecutar(fresco)
      await db.outbox.delete(item.id!)
      enviados++
    } catch (e) {
      await db.outbox.update(item.id!, {
        status: 'error', errorMessage: String((e as Error)?.message ?? e),
      })
    }
  }
  // Quien esté mirando la lista de pendientes se entera sin recargar.
  if (items.length > 0) avisarPendientes()
  return enviados
}

/** Lo que está esperando señal, para mostrarlo tal cual se registró. */
export async function reportesPendientes(): Promise<ReportePendiente[]> {
  const items = await db.outbox.where('status').anyOf(['pending', 'error']).toArray()
  return items
    .filter((i) => i.type === 'FINCA')
    .map((i) => ({
      ...(i.fincaOp!.payload as ReporteEncolado),
      outboxId: i.id!, queuedAt: i.queuedAt, estado: i.status, errorMessage: i.errorMessage,
    }))
    .sort((a, b) => a.queuedAt.localeCompare(b.queuedAt))
}

/** Corta la espera: sin respuesta en `ms`, se considera falta de red. */
function conTope<T>(ms: number, p: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout: no hubo respuesta del servidor')), ms)
    p.then((v) => { clearTimeout(t); resolve(v) }, (e) => { clearTimeout(t); reject(e) })
  })
}
