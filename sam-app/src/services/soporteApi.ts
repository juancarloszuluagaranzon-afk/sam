import { supabase } from '../lib/supabase'

/**
 * Casos de soporte — fallas y peticiones sobre la app, reportadas desde campo.
 *
 * 🔴 **La palabra «ticket» no aparece en ninguna pantalla.** El que reporta es un
 * operario de tractor; «caso» es lo que él dice.
 *
 * 🔴 **La app solo LEE estas tablas; todo lo que escribe pasa por una función de
 * base de datos.** No es purismo: `recibido_en_servidor` y `primera_respuesta_en`
 * son las dos columnas de las que cuelga el tablero entero. Si el navegador
 * pudiera escribirlas, el tablero mediría la disciplina de quien programó el
 * cliente, no el servicio que se prestó.
 *
 * 🔴 **El folio lo genera el CELULAR, no la base.** Así se le puede dar un número
 * al operario ANTES de que haya señal — y sin número, el reporte offline se
 * siente como que no quedó. Lleva su id adentro para que dos personas reportando
 * en el mismo minuto no choquen, y la función es idempotente: el reintento de la
 * cola no crea un caso gemelo. Probado contra producción.
 */

export type Severidad = 'parado' | 'con_problemas' | 'puede_esperar'
export type EstadoCaso = 'nuevo' | 'revisando' | 'falta_dato' | 'resuelto' | 'cerrado'
export type TipoCaso = 'falla' | 'peticion'

/** Lo que el operario ve, en sus palabras. Nunca se le muestra la clave. */
export const SEVERIDAD_LABEL: Record<Severidad, string> = {
  parado: 'No puedo seguir',
  con_problemas: 'Puedo seguir, pero con problemas',
  puede_esperar: 'Puede esperar',
}

export const SEVERIDAD_ICONO: Record<Severidad, string> = {
  parado: '🔴', con_problemas: '🟡', puede_esperar: '🟢',
}

/**
 * Los estados, dichos como los diría una persona.
 *
 * ⚠️ «Resuelto» lleva la pregunta pegada a propósito: quien cierra es soporte,
 * pero quien sabe si de verdad quedó es el operario.
 */
export const ESTADO_LABEL: Record<EstadoCaso, string> = {
  nuevo: 'Recibido',
  revisando: 'Lo estamos revisando',
  falta_dato: 'Falta un dato tuyo',
  resuelto: 'Resuelto — ¿quedó bien?',
  cerrado: 'Cerrado',
}

export interface Caso {
  id: string
  folio: string
  creadoPor: string
  creadoPorNombre: string | null
  rolCreador: string | null
  registradoPor: string | null
  origen: string
  tipo: TipoCaso | null
  severidad: Severidad
  severidadFinal: Severidad | null
  categoria: string | null
  creadoEnDispositivo: string
  recibidoEnServidor: string | null
  texto: string | null
  fotoUrl: string | null
  pantalla: string | null
  errorMensaje: string | null
  estado: EstadoCaso
  atendidoPor: string | null
  primeraRespuestaEn: string | null
  resueltoEn: string | null
  cerradoEn: string | null
  razonCierre: string | null
  confirmadoPorOperario: boolean | null
  fusionadoEn: string | null
  versionCorregida: string | null
  updatedAt: string
  /** Derivados de la vista: no se guardan, se calculan. */
  severidadEfectiva: Severidad
  horasPrimeraRespuesta: number | null
  horasOperario: number | null
  horasSoporte: number | null
  edadDias: number | null
}

export interface MensajeCaso {
  id: string
  casoId: string
  autor: string | null
  nombre: string | null
  rol: string | null
  texto: string | null
  fotoUrl: string | null
  esSistema: boolean
  creadoEnDispositivo: string | null
  recibidoEnServidor: string
}

function mapCaso(r: Record<string, unknown>): Caso {
  const s = (v: unknown) => (v == null ? null : String(v))
  const n = (v: unknown) => (v == null ? null : Number(v))
  return {
    id: String(r.id), folio: String(r.folio),
    creadoPor: String(r.creado_por), creadoPorNombre: s(r.creado_por_nombre),
    rolCreador: s(r.rol_creador), registradoPor: s(r.registrado_por),
    origen: String(r.origen ?? 'app'),
    tipo: (s(r.tipo) as TipoCaso | null),
    severidad: String(r.severidad) as Severidad,
    severidadFinal: s(r.severidad_final) as Severidad | null,
    categoria: s(r.categoria),
    creadoEnDispositivo: String(r.creado_en_dispositivo ?? ''),
    recibidoEnServidor: s(r.recibido_en_servidor),
    texto: s(r.texto), fotoUrl: s(r.foto_url), pantalla: s(r.pantalla),
    errorMensaje: s(r.error_mensaje),
    estado: String(r.estado ?? 'nuevo') as EstadoCaso,
    atendidoPor: s(r.atendido_por),
    primeraRespuestaEn: s(r.primera_respuesta_en),
    resueltoEn: s(r.resuelto_en), cerradoEn: s(r.cerrado_en),
    razonCierre: s(r.razon_cierre),
    confirmadoPorOperario: r.confirmado_por_operario == null ? null : Boolean(r.confirmado_por_operario),
    fusionadoEn: s(r.fusionado_en), versionCorregida: s(r.version_corregida),
    updatedAt: String(r.updated_at ?? ''),
    severidadEfectiva: String(r.severidad_efectiva ?? r.severidad) as Severidad,
    horasPrimeraRespuesta: n(r.horas_primera_respuesta),
    horasOperario: n(r.horas_operario),
    horasSoporte: n(r.horas_soporte),
    edadDias: n(r.edad_dias),
  }
}

function mapMensaje(r: Record<string, unknown>): MensajeCaso {
  return {
    id: String(r.id), casoId: String(r.caso_id),
    autor: r.autor ? String(r.autor) : null,
    nombre: r.nombre ? String(r.nombre) : null,
    rol: r.rol ? String(r.rol) : null,
    texto: r.texto ? String(r.texto) : null,
    fotoUrl: r.foto_url ? String(r.foto_url) : null,
    esSistema: Boolean(r.es_sistema),
    creadoEnDispositivo: r.creado_en_dispositivo ? String(r.creado_en_dispositivo) : null,
    recibidoEnServidor: String(r.recibido_en_servidor ?? ''),
  }
}

/**
 * Arma el folio en el celular: `S-U032-0902-1435-K7`.
 *
 * Lleva el id del usuario para que dos personas reportando en el mismo minuto no
 * choquen, y una cola de dos caracteres al azar para el caso raro de la misma
 * persona en el mismo minuto. Si aun así choca, la función de base de datos le
 * pone otro sufijo y devuelve el folio real.
 */
export function nuevoFolio(usuarioId: string): string {
  const ahora = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  const fecha = `${p(ahora.getMonth() + 1)}${p(ahora.getDate())}`
  const hora = `${p(ahora.getHours())}${p(ahora.getMinutes())}`
  const cola = Math.random().toString(36).slice(2, 4).toUpperCase()
  return `S-${usuarioId}-${fecha}-${hora}-${cola}`
}

export interface NuevoCaso {
  folio: string
  creadoPor: string
  creadoPorNombre?: string
  rolCreador?: string
  registradoPor?: string
  origen?: 'app' | 'whatsapp' | 'telefono'
  severidad: Severidad
  tipo?: TipoCaso
  creadoEnDispositivo: string
  texto?: string
  fotoUrl?: string
  pantalla?: string
  appVersion?: string
  equipo?: string
  errorMensaje?: string
}

export async function crearCaso(c: NuevoCaso): Promise<Caso | null> {
  const { data, error } = await supabase.rpc('soporte_crear_caso', {
    p_folio: c.folio,
    p_creado_por: c.creadoPor,
    p_creado_por_nombre: c.creadoPorNombre ?? null,
    p_rol_creador: c.rolCreador ?? null,
    p_registrado_por: c.registradoPor ?? null,
    p_origen: c.origen ?? 'app',
    p_severidad: c.severidad,
    p_tipo: c.tipo ?? null,
    p_creado_en_dispositivo: c.creadoEnDispositivo,
    p_texto: c.texto ?? null,
    p_foto_url: c.fotoUrl ?? null,
    p_pantalla: c.pantalla ?? null,
    p_app_version: c.appVersion ?? null,
    p_equipo: c.equipo ?? null,
    p_error_mensaje: c.errorMensaje ?? null,
    p_contexto: {},
  })
  if (error) throw new Error(error.message || 'No se pudo registrar el caso')
  return data ? mapCaso(data as Record<string, unknown>) : null
}

export async function enviarMensaje(input: {
  casoId: string
  autor: string
  nombre?: string
  rol?: string
  texto?: string
  fotoUrl?: string
  creadoEnDispositivo: string
}): Promise<void> {
  const { error } = await supabase.rpc('soporte_mensaje', {
    p_caso: input.casoId,
    p_autor: input.autor,
    p_nombre: input.nombre ?? null,
    p_rol: input.rol ?? null,
    p_texto: input.texto ?? null,
    p_foto_url: input.fotoUrl ?? null,
    p_creado_en_dispositivo: input.creadoEnDispositivo,
  })
  if (error) throw new Error(error.message || 'No se pudo enviar el mensaje')
}

export async function cambiarEstado(input: {
  casoId: string
  estado: EstadoCaso
  actor: string
  razonCierre?: string
  versionCorregida?: string
}): Promise<void> {
  const { error } = await supabase.rpc('soporte_estado', {
    p_caso: input.casoId,
    p_estado: input.estado,
    p_actor: input.actor,
    p_razon_cierre: input.razonCierre ?? null,
    p_version_corregida: input.versionCorregida ?? null,
  })
  if (error) throw new Error(error.message || 'No se pudo cambiar el estado')
}

/** El operario dice si de verdad quedó. Es lo que cierra el ciclo. */
export async function confirmarCaso(casoId: string, actor: string, quedoBien: boolean): Promise<void> {
  const { error } = await supabase.rpc('soporte_confirmar', {
    p_caso: casoId, p_actor: actor, p_quedo_bien: quedoBien,
  })
  if (error) throw new Error(error.message || 'No se pudo confirmar')
}

/** Los casos de UNA persona: lo que ve el operario en «Mis reportes». */
export async function loadMisCasos(usuarioId: string): Promise<Caso[]> {
  const { data, error } = await supabase
    .from('soporte_casos_v').select('*')
    .eq('creado_por', usuarioId)
    .order('creado_en_dispositivo', { ascending: false })
    .limit(50)
  if (error) throw new Error(error.message || 'No se pudieron cargar tus casos')
  return (data ?? []).map((r) => mapCaso(r as Record<string, unknown>))
}

/**
 * La bandeja de soporte.
 *
 * ⚠️ Ordenada por severidad y luego por antigüedad, no solo por fecha: quien
 * está PARADO va de primero aunque haya reportado después. Es la única promesa
 * que el módulo le hace al operario, y se cumple en el ORDEN, no en un texto.
 */
export async function loadBandejaCasos(incluirCerrados = false): Promise<Caso[]> {
  let q = supabase.from('soporte_casos_v').select('*')
  if (!incluirCerrados) q = q.not('estado', 'in', '(cerrado)')
  const { data, error } = await q.order('creado_en_dispositivo', { ascending: true }).limit(300)
  if (error) throw new Error(error.message || 'No se pudo cargar la bandeja')
  const casos = (data ?? []).map((r) => mapCaso(r as Record<string, unknown>))
  const peso: Record<Severidad, number> = { parado: 0, con_problemas: 1, puede_esperar: 2 }
  return casos.sort((a, b) =>
    peso[a.severidadEfectiva] - peso[b.severidadEfectiva]
    || a.creadoEnDispositivo.localeCompare(b.creadoEnDispositivo))
}

export async function loadMensajes(casoId: string): Promise<MensajeCaso[]> {
  const { data, error } = await supabase
    .from('soporte_mensajes').select('*')
    .eq('caso_id', casoId)
    .order('recibido_en_servidor', { ascending: true })
  if (error) throw new Error(error.message || 'No se pudieron cargar los mensajes')
  return (data ?? []).map((r) => mapMensaje(r as Record<string, unknown>))
}

/** Cuántos casos abiertos hay, para el contador del encabezado de soporte. */
export async function contarAbiertos(): Promise<number> {
  const { count, error } = await supabase
    .from('soporte_casos').select('id', { count: 'exact', head: true })
    .not('estado', 'in', '(resuelto,cerrado)')
  if (error) return 0
  return count ?? 0
}
