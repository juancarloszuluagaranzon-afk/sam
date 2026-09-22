/**
 * Administración de fincas de caña — acceso a datos (MVP, 22-sep-2026).
 *
 * 🔴 Desde la migración 20260922150000 las tablas `af_*` NO se leen ni se escriben
 * directo: todo pasa por funciones de la base que reciben una LLAVE y deciden con
 * ella quién es y qué puede ver. El personal saca su llave con el PIN
 * (`abrirSesionFincas`); el dueño de la tierra la trae en su enlace personal.
 * Las reglas siguen en la base — sin foto no hay reporte, nadie acepta lo suyo,
 * no se pasa del área, nada se borra —; la pantalla solo avisa antes.
 */
import { supabase } from '../lib/supabase'
import { comprimirImagen, PERFIL_IMAGEN } from '../lib/imagenLigera'

export type EstadoLabor = 'PROGRAMADA' | 'EN_CURSO' | 'TERMINADA' | 'ANULADA'
export type EstadoReporte = 'PENDIENTE' | 'ACEPTADO' | 'RECHAZADO'
export type TipoMovimiento = 'ANTICIPO' | 'GASTO' | 'HONORARIO'
export type TipoCiclo = 'SOCA' | 'PLANTILLA'

export interface Finca {
  id: string
  nombre: string
  duenoNombre: string
  duenoTelefono: string | null
  duenoCorreo: string | null
  ingenioId: string | null
  municipio: string | null
  honorarioModo: 'POR_DEFINIR' | 'PORCENTAJE' | 'FIJO_HA_MES'
  honorarioValor: number | null
  nota: string | null
  activa: boolean
  createdAt: string
}
export interface SuerteFinca { id: string; fincaId: string; codigo: string; areaHa: number; variedad: string | null; activa: boolean }
export interface Ciclo {
  id: string; suerteId: string; fechaCorte: string; tipo: TipoCiclo
  estado: 'ABIERTO' | 'CERRADO'; fechaCierre: string | null
}
export interface LaborPaquete {
  id: string; labor: string; unidad: string; cantidadPorHa: number; costoUnitario: number
  ventanaIdeal: number | null; ventanaNormal: number | null
  aplica: 'SOCA' | 'PLANTILLA' | 'AMBOS'; orden: number; activa: boolean
}
export interface LaborCiclo {
  id: string; cicloId: string; labor: string; unidad: string
  cantidadPlan: number; costoUnitarioPlan: number
  ventanaIdeal: number | null; ventanaNormal: number | null
  estado: EstadoLabor; anuladaMotivo: string | null; orden: number
}
export interface ReporteCampo {
  id: string; laborId: string; cantidad: number; fecha: string; fotoUrl: string
  lat: number | null; lng: number | null; precisionM: number | null; nota: string | null
  reportadoPor: string; estado: EstadoReporte
  revisadoPor: string | null; revisadoEn: string | null; motivoRechazo: string | null
  costoUnitario: number | null; createdAt: string
}
export interface Movimiento {
  id: string; fincaId: string; tipo: TipoMovimiento; fecha: string; concepto: string
  suerteId: string | null; laborId: string | null; reporteId: string | null
  cantidad: number | null; unidad: string | null; valorUnitario: number | null; valor: number
  soporteUrl: string | null; registradoPor: string
  anulado: boolean; anuladoPor: string | null; anuladoMotivo: string | null; createdAt: string
}
/** Un enlace del dueño de la tierra. La llave NUNCA vuelve de la base: solo su huella. */
export interface AccesoDueno {
  id: string; fincaId: string; nombre: string; creadoPor: string; creadoEn: string
  revocadoEn: string | null; ultimoUso: string | null; usos: number
}

export interface DatosFincas {
  fincas: Finca[]
  suertes: SuerteFinca[]
  ciclos: Ciclo[]
  labores: LaborCiclo[]
  reportes: ReporteCampo[]
  movimientos: Movimiento[]
  paquete: LaborPaquete[]
}
export interface CargaFincas extends DatosFincas {
  /** 'owner' | 'administracion' | 'supervisor' | 'dueno' — lo dice la base, no el celular. */
  rol: string
  accesos: AccesoDueno[]
  /** Nombres de quien aparece en los datos (el dueño no tiene la lista de usuarios). */
  nombres: Record<string, string>
}

const num = (v: unknown): number => Number(v ?? 0)
const numN = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))
const txt = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v))

async function lanzar<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p
  if (error) throw new Error(error.message)
  return data
}

/** Los errores de la base traen un código al frente («SIN_FOTO: …»): se muestra la frase. */
export function mensajeDeError(e: unknown): string {
  const m = (e as { message?: string })?.message ?? String(e)
  const i = m.indexOf(': ')
  return i > 0 && /^[A-Z_]+$/.test(m.slice(0, i)) ? m.slice(i + 2) : m
}

/** ¿La llave dejó de servir (vencida, cancelada, inventada)? Hay que pedir otra. */
export function esSinSesion(e: unknown): boolean {
  return String((e as { message?: string })?.message ?? '').startsWith('SIN_SESION')
}

// ── Llaves ────────────────────────────────────────────────────────────────
const LLAVE_PERSONAL = 'sam:af-sesion'
const LLAVE_DUENO = 'sam:af-dueno'

/** La llave del personal, solo si es del MISMO usuario que tiene la sesión abierta. */
export function leerLlavePersonal(usuario: string): string | null {
  try {
    const x = JSON.parse(window.localStorage.getItem(LLAVE_PERSONAL) ?? 'null') as { usuario?: string; token?: string } | null
    return x && x.usuario === usuario && x.token ? x.token : null
  } catch { return null }
}
export function guardarLlavePersonal(usuario: string, token: string | null) {
  try {
    if (token) window.localStorage.setItem(LLAVE_PERSONAL, JSON.stringify({ usuario, token }))
    else window.localStorage.removeItem(LLAVE_PERSONAL)
  } catch { /* sin almacenamiento: se pedirá el PIN otra vez */ }
}
export function leerLlaveDueno(): string | null {
  try { return window.localStorage.getItem(LLAVE_DUENO) } catch { return null }
}
export function guardarLlaveDueno(token: string | null) {
  try {
    if (token) window.localStorage.setItem(LLAVE_DUENO, token)
    else window.localStorage.removeItem(LLAVE_DUENO)
  } catch { /* nada */ }
}

/** La llave del módulo a partir del PIN (dura 30 días). `null` = PIN errado. */
export async function abrirSesionFincas(usuario: string, pin: string): Promise<string | null> {
  const d = await lanzar(supabase.rpc('af_abrir_sesion', { p_usuario: usuario, p_pin: pin }))
  return d ? String(d) : null
}
export async function cerrarSesionFincas(token: string) {
  await supabase.rpc('af_cerrar_sesion', { p_token: token })
}

/**
 * Todo el módulo de una vez, por UNA función de la base: el personal recibe todas
 * las fincas; el dueño, SOLO la suya (lo decide la base con la llave, no la pantalla).
 * Inicio, la finca y la cuenta salen de la misma foto y ninguna cifra contradice a otra.
 */
export async function cargarFincas(token: string): Promise<CargaFincas> {
  type Fila = Record<string, unknown>
  const raw = (await lanzar(supabase.rpc('af_datos', { p_token: token })) ?? {}) as Record<string, unknown>
  const arr = (k: string) => ((raw[k] as Fila[] | null) ?? [])
  return {
    rol: String(raw.rol ?? ''),
    nombres: (raw.nombres as Record<string, string> | null) ?? {},
    accesos: arr('accesos').map((x) => ({
      id: String(x.id), fincaId: String(x.finca_id), nombre: String(x.nombre), creadoPor: String(x.creado_por),
      creadoEn: String(x.creado_en), revocadoEn: txt(x.revocado_en), ultimoUso: txt(x.ultimo_uso), usos: num(x.usos),
    })),
    fincas: arr('fincas').map((x) => ({
      id: String(x.id), nombre: String(x.nombre), duenoNombre: String(x.dueno_nombre),
      duenoTelefono: txt(x.dueno_telefono), duenoCorreo: txt(x.dueno_correo), ingenioId: txt(x.ingenio_id),
      municipio: txt(x.municipio), honorarioModo: (x.honorario_modo as Finca['honorarioModo']) ?? 'POR_DEFINIR',
      honorarioValor: numN(x.honorario_valor), nota: txt(x.nota), activa: x.activa !== false, createdAt: String(x.created_at),
    })),
    suertes: arr('suertes').map((x) => ({
      id: String(x.id), fincaId: String(x.finca_id), codigo: String(x.codigo), areaHa: num(x.area_ha),
      variedad: txt(x.variedad), activa: x.activa !== false,
    })),
    ciclos: arr('ciclos').map((x) => ({
      id: String(x.id), suerteId: String(x.suerte_id), fechaCorte: String(x.fecha_corte),
      tipo: (x.tipo as TipoCiclo) ?? 'SOCA', estado: (x.estado as Ciclo['estado']) ?? 'ABIERTO', fechaCierre: txt(x.fecha_cierre),
    })),
    labores: arr('labores').map((x) => ({
      id: String(x.id), cicloId: String(x.ciclo_id), labor: String(x.labor), unidad: String(x.unidad ?? 'ha'),
      cantidadPlan: num(x.cantidad_plan), costoUnitarioPlan: num(x.costo_unitario_plan),
      ventanaIdeal: numN(x.ventana_ideal), ventanaNormal: numN(x.ventana_normal),
      estado: (x.estado as EstadoLabor) ?? 'PROGRAMADA', anuladaMotivo: txt(x.anulada_motivo), orden: num(x.orden),
    })),
    reportes: arr('reportes').map((x) => ({
      id: String(x.id), laborId: String(x.labor_id), cantidad: num(x.cantidad), fecha: String(x.fecha),
      fotoUrl: String(x.foto_url), lat: numN(x.lat), lng: numN(x.lng), precisionM: numN(x.precision_m),
      nota: txt(x.nota), reportadoPor: String(x.reportado_por), estado: (x.estado as EstadoReporte) ?? 'PENDIENTE',
      revisadoPor: txt(x.revisado_por), revisadoEn: txt(x.revisado_en), motivoRechazo: txt(x.motivo_rechazo),
      costoUnitario: numN(x.costo_unitario), createdAt: String(x.created_at),
    })),
    movimientos: arr('movimientos').map((x) => ({
      id: String(x.id), fincaId: String(x.finca_id), tipo: x.tipo as TipoMovimiento, fecha: String(x.fecha),
      concepto: String(x.concepto), suerteId: txt(x.suerte_id), laborId: txt(x.labor_id), reporteId: txt(x.reporte_id),
      cantidad: numN(x.cantidad), unidad: txt(x.unidad), valorUnitario: numN(x.valor_unitario), valor: num(x.valor),
      soporteUrl: txt(x.soporte_url), registradoPor: String(x.registrado_por), anulado: x.anulado === true,
      anuladoPor: txt(x.anulado_por), anuladoMotivo: txt(x.anulado_motivo), createdAt: String(x.created_at),
    })),
    paquete: arr('paquete').map((x) => ({
      id: String(x.id), labor: String(x.labor), unidad: String(x.unidad ?? 'ha'), cantidadPorHa: num(x.cantidad_por_ha),
      costoUnitario: num(x.costo_unitario), ventanaIdeal: numN(x.ventana_ideal), ventanaNormal: numN(x.ventana_normal),
      aplica: (x.aplica as LaborPaquete['aplica']) ?? 'AMBOS', orden: num(x.orden), activa: x.activa !== false,
    })),
  }
}

// ── Escrituras: todas por funciones con llave (la base decide quién puede) ──
// Quién lo hizo sale de la llave, no de un parámetro: el celular no lo puede cambiar.
export async function guardarFinca(f: {
  id?: string; nombre: string; duenoNombre: string; duenoTelefono?: string; duenoCorreo?: string
  ingenioId?: string; municipio?: string; honorarioModo: Finca['honorarioModo']; honorarioValor?: number | null; nota?: string
}, token: string): Promise<string> {
  const d = await lanzar(supabase.rpc('af_guardar_finca', {
    p_token: token, p_id: f.id ?? null,
    p_datos: {
      nombre: f.nombre.trim(), dueno_nombre: f.duenoNombre.trim(), dueno_telefono: f.duenoTelefono?.trim() ?? '',
      dueno_correo: f.duenoCorreo?.trim() ?? '', ingenio_id: f.ingenioId ?? '', municipio: f.municipio?.trim() ?? '',
      honorario_modo: f.honorarioModo, honorario_valor: f.honorarioValor ?? null, nota: f.nota?.trim() ?? '',
    },
  }))
  return String(d)
}

export async function agregarSuertes(fincaId: string, suertes: { codigo: string; areaHa: number; variedad?: string }[], token: string) {
  if (!suertes.length) return
  await lanzar(supabase.rpc('af_agregar_suertes', {
    p_token: token, p_finca: fincaId,
    p_suertes: suertes.map((s) => ({ codigo: s.codigo.trim(), area_ha: s.areaHa, variedad: s.variedad?.trim() ?? '' })),
  }))
}

export async function guardarPaquete(p: Partial<LaborPaquete> & { labor: string }, token: string) {
  await lanzar(supabase.rpc('af_guardar_paquete', {
    p_token: token, p_id: p.id ?? null,
    p_datos: {
      labor: p.labor.trim().toUpperCase(), unidad: p.unidad ?? 'ha', cantidad_por_ha: p.cantidadPorHa ?? 1,
      costo_unitario: p.costoUnitario ?? 0, ventana_ideal: p.ventanaIdeal ?? null, ventana_normal: p.ventanaNormal ?? null,
      aplica: p.aplica ?? 'AMBOS', orden: p.orden ?? 100, activa: p.activa ?? true,
    },
  }))
}

export async function actualizarLaborPlan(id: string, cambios: { cantidadPlan?: number; costoUnitarioPlan?: number }, token: string) {
  // null = no se toca ese campo.
  await lanzar(supabase.rpc('af_actualizar_labor', {
    p_token: token, p_id: id, p_cantidad: cambios.cantidadPlan ?? null, p_costo: cambios.costoUnitarioPlan ?? null,
  }))
}

export async function anularLabor(id: string, motivo: string, token: string) {
  await lanzar(supabase.rpc('af_anular_labor', { p_token: token, p_id: id, p_motivo: motivo.trim() }))
}

export async function abrirCiclo(suerteId: string, fechaCorte: string, tipo: TipoCiclo, token: string): Promise<string> {
  const d = await lanzar(supabase.rpc('af_abrir_ciclo', { p_token: token, p_suerte: suerteId, p_fecha_corte: fechaCorte, p_tipo: tipo }))
  return String(d)
}

export async function reportarLabor(r: {
  id: string; laborId: string; cantidad: number; fecha: string; fotoUrl: string
  lat: number | null; lng: number | null; precisionM: number | null; nota: string
}, token: string) {
  await lanzar(supabase.rpc('af_reportar', {
    p_token: token, p_id: r.id, p_labor: r.laborId, p_cantidad: r.cantidad, p_fecha: r.fecha, p_foto: r.fotoUrl,
    p_lat: r.lat, p_lng: r.lng, p_precision: r.precisionM, p_nota: r.nota,
  }))
}

export async function revisarReporte(id: string, aceptar: boolean, motivo: string, token: string): Promise<string> {
  const d = await lanzar(supabase.rpc('af_revisar', { p_token: token, p_reporte: id, p_aceptar: aceptar, p_motivo: motivo }))
  return String(d)
}

export async function registrarMovimiento(m: {
  fincaId: string; tipo: TipoMovimiento; fecha: string; concepto: string; valor: number
  suerteId?: string | null; soporteUrl?: string | null
}, token: string) {
  await lanzar(supabase.rpc('af_registrar_movimiento', {
    p_token: token,
    p_datos: {
      finca_id: m.fincaId, tipo: m.tipo, fecha: m.fecha, concepto: m.concepto.trim(), valor: m.valor,
      suerte_id: m.suerteId ?? '', soporte_url: m.soporteUrl ?? '',
    },
  }))
}

export async function anularMovimiento(id: string, motivo: string, token: string) {
  await lanzar(supabase.rpc('af_anular_movimiento', { p_token: token, p_id: id, p_motivo: motivo }))
}

// ── Enlaces del dueño de la tierra (solo administración) ──────────────────
/** Crea el enlace personal del dueño. Devuelve la llave: es la ÚNICA vez que existe en claro. */
export async function crearAccesoDueno(fincaId: string, nombre: string, token: string): Promise<string> {
  return String(await lanzar(supabase.rpc('af_crear_acceso', { p_token: token, p_finca: fincaId, p_nombre: nombre })))
}
export async function revocarAccesoDueno(accesoId: string, token: string) {
  await lanzar(supabase.rpc('af_revocar_acceso', { p_token: token, p_acceso: accesoId }))
}
/** El enlace que abre la vista del dueño. La llave va después del «#»: no viaja al servidor web ni queda en sus registros. */
export function enlaceDueno(llave: string): string {
  return `${window.location.origin}/#finca=${llave}`
}

/** Foto de campo o soporte de un gasto. Mismo almacenamiento de las demás evidencias. */
export async function subirFotoFinca(file: File, carpeta: 'reportes' | 'soportes'): Promise<string> {
  const liviana = await comprimirImagen(file, carpeta === 'soportes' ? PERFIL_IMAGEN.documento : PERFIL_IMAGEN.evidencia)
  const ext = (liviana.name.split('.').pop() || 'jpg').toLowerCase()
  const path = `fincas/${carpeta}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
  const { error } = await supabase.storage.from('avatars').upload(path, liviana, { upsert: false, contentType: liviana.type || 'image/jpeg' })
  if (error) throw new Error(error.message)
  return supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl
}
