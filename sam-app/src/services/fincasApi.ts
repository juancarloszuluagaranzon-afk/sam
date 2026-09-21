/**
 * Administración de fincas de caña — acceso a datos (MVP, 22-sep-2026).
 *
 * Tablas `af_*` (migración 20260922120000). Lo delicado NO se escribe directo:
 * abrir un ciclo, reportar, aceptar/rechazar y anular pasan por funciones de la
 * base (`af_*`), que son las que hacen cumplir las reglas — sin foto no hay
 * reporte, nadie acepta lo suyo, no se pasa del área, nada se borra. La pantalla
 * solo avisa antes; si se le olvida algo, la base lo frena igual.
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

export interface DatosFincas {
  fincas: Finca[]
  suertes: SuerteFinca[]
  ciclos: Ciclo[]
  labores: LaborCiclo[]
  reportes: ReporteCampo[]
  movimientos: Movimiento[]
  paquete: LaborPaquete[]
}

const num = (v: unknown): number => Number(v ?? 0)
const numN = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))
const txt = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v))

/**
 * Todo el módulo de una vez. Son pocas fincas (decenas de suertes, cientos de
 * reportes): traerlo junto deja que Inicio, la finca y la cuenta salgan de la
 * MISMA foto de los datos, y ninguna cifra contradice a otra.
 * ⚠️ PostgREST corta en 1.000 filas: si una tabla llega al tope, se avisa.
 */
export async function cargarFincas(): Promise<DatosFincas & { truncado: string[] }> {
  const [f, s, c, l, r, m, p] = await Promise.all([
    supabase.from('af_fincas').select('*').order('nombre'),
    supabase.from('af_suertes').select('*').order('codigo'),
    supabase.from('af_ciclos').select('*').order('fecha_corte', { ascending: false }),
    supabase.from('af_labores').select('*').order('orden'),
    supabase.from('af_reportes').select('*').order('created_at', { ascending: false }),
    supabase.from('af_movimientos').select('*').order('fecha', { ascending: false }),
    supabase.from('af_paquete').select('*').order('orden'),
  ])
  const err = f.error ?? s.error ?? c.error ?? l.error ?? r.error ?? m.error ?? p.error
  if (err) throw new Error(err.message)
  const truncado = [['fincas', f.data], ['suertes', s.data], ['ciclos', c.data], ['labores', l.data], ['reportes', r.data], ['movimientos', m.data]]
    .filter(([, d]) => (d as unknown[] | null)?.length === 1000).map(([n]) => n as string)
  type Fila = Record<string, unknown>
  return {
    truncado,
    fincas: (f.data as Fila[]).map((x) => ({
      id: String(x.id), nombre: String(x.nombre), duenoNombre: String(x.dueno_nombre),
      duenoTelefono: txt(x.dueno_telefono), duenoCorreo: txt(x.dueno_correo), ingenioId: txt(x.ingenio_id),
      municipio: txt(x.municipio), honorarioModo: (x.honorario_modo as Finca['honorarioModo']) ?? 'POR_DEFINIR',
      honorarioValor: numN(x.honorario_valor), nota: txt(x.nota), activa: x.activa !== false, createdAt: String(x.created_at),
    })),
    suertes: (s.data as Fila[]).map((x) => ({
      id: String(x.id), fincaId: String(x.finca_id), codigo: String(x.codigo), areaHa: num(x.area_ha),
      variedad: txt(x.variedad), activa: x.activa !== false,
    })),
    ciclos: (c.data as Fila[]).map((x) => ({
      id: String(x.id), suerteId: String(x.suerte_id), fechaCorte: String(x.fecha_corte),
      tipo: (x.tipo as TipoCiclo) ?? 'SOCA', estado: (x.estado as Ciclo['estado']) ?? 'ABIERTO', fechaCierre: txt(x.fecha_cierre),
    })),
    labores: (l.data as Fila[]).map((x) => ({
      id: String(x.id), cicloId: String(x.ciclo_id), labor: String(x.labor), unidad: String(x.unidad ?? 'ha'),
      cantidadPlan: num(x.cantidad_plan), costoUnitarioPlan: num(x.costo_unitario_plan),
      ventanaIdeal: numN(x.ventana_ideal), ventanaNormal: numN(x.ventana_normal),
      estado: (x.estado as EstadoLabor) ?? 'PROGRAMADA', anuladaMotivo: txt(x.anulada_motivo), orden: num(x.orden),
    })),
    reportes: (r.data as Fila[]).map((x) => ({
      id: String(x.id), laborId: String(x.labor_id), cantidad: num(x.cantidad), fecha: String(x.fecha),
      fotoUrl: String(x.foto_url), lat: numN(x.lat), lng: numN(x.lng), precisionM: numN(x.precision_m),
      nota: txt(x.nota), reportadoPor: String(x.reportado_por), estado: (x.estado as EstadoReporte) ?? 'PENDIENTE',
      revisadoPor: txt(x.revisado_por), revisadoEn: txt(x.revisado_en), motivoRechazo: txt(x.motivo_rechazo),
      costoUnitario: numN(x.costo_unitario), createdAt: String(x.created_at),
    })),
    movimientos: (m.data as Fila[]).map((x) => ({
      id: String(x.id), fincaId: String(x.finca_id), tipo: x.tipo as TipoMovimiento, fecha: String(x.fecha),
      concepto: String(x.concepto), suerteId: txt(x.suerte_id), laborId: txt(x.labor_id), reporteId: txt(x.reporte_id),
      cantidad: numN(x.cantidad), unidad: txt(x.unidad), valorUnitario: numN(x.valor_unitario), valor: num(x.valor),
      soporteUrl: txt(x.soporte_url), registradoPor: String(x.registrado_por), anulado: x.anulado === true,
      anuladoPor: txt(x.anulado_por), anuladoMotivo: txt(x.anulado_motivo), createdAt: String(x.created_at),
    })),
    paquete: (p.data as Fila[]).map((x) => ({
      id: String(x.id), labor: String(x.labor), unidad: String(x.unidad ?? 'ha'), cantidadPorHa: num(x.cantidad_por_ha),
      costoUnitario: num(x.costo_unitario), ventanaIdeal: numN(x.ventana_ideal), ventanaNormal: numN(x.ventana_normal),
      aplica: (x.aplica as LaborPaquete['aplica']) ?? 'AMBOS', orden: num(x.orden), activa: x.activa !== false,
    })),
  }
}

/** Los errores de la base traen un código al frente («SIN_FOTO: …»): se muestra la frase. */
export function mensajeDeError(e: unknown): string {
  const m = (e as { message?: string })?.message ?? String(e)
  const i = m.indexOf(': ')
  return i > 0 && /^[A-Z_]+$/.test(m.slice(0, i)) ? m.slice(i + 2) : m
}

async function lanzar<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p
  if (error) throw new Error(error.message)
  return data
}

// ── Fincas y suertes (solo administración: lo exige la base) ─────────────
export async function guardarFinca(f: {
  id?: string; nombre: string; duenoNombre: string; duenoTelefono?: string; duenoCorreo?: string
  ingenioId?: string; municipio?: string; honorarioModo: Finca['honorarioModo']; honorarioValor?: number | null; nota?: string
}, usuario: string): Promise<string> {
  const fila = {
    nombre: f.nombre.trim(), dueno_nombre: f.duenoNombre.trim(),
    dueno_telefono: f.duenoTelefono?.trim() || null, dueno_correo: f.duenoCorreo?.trim() || null,
    ingenio_id: f.ingenioId || null, municipio: f.municipio?.trim() || null,
    honorario_modo: f.honorarioModo, honorario_valor: f.honorarioValor ?? null, nota: f.nota?.trim() || null,
    editado_por: usuario,
  }
  if (f.id) {
    await lanzar(supabase.from('af_fincas').update(fila).eq('id', f.id).select('id'))
    return f.id
  }
  const d = await lanzar(supabase.from('af_fincas').insert(fila).select('id').single())
  return String((d as { id: string }).id)
}

export async function agregarSuertes(fincaId: string, suertes: { codigo: string; areaHa: number; variedad?: string }[], usuario: string) {
  if (!suertes.length) return
  await lanzar(supabase.from('af_suertes').insert(suertes.map((s) => ({
    finca_id: fincaId, codigo: s.codigo.trim(), area_ha: s.areaHa, variedad: s.variedad?.trim() || null, editado_por: usuario,
  }))).select('id'))
}

export async function guardarPaquete(p: Partial<LaborPaquete> & { labor: string }, usuario: string) {
  const fila = {
    labor: p.labor.trim().toUpperCase(), unidad: p.unidad ?? 'ha', cantidad_por_ha: p.cantidadPorHa ?? 1,
    costo_unitario: p.costoUnitario ?? 0, ventana_ideal: p.ventanaIdeal ?? null, ventana_normal: p.ventanaNormal ?? null,
    aplica: p.aplica ?? 'AMBOS', orden: p.orden ?? 100, activa: p.activa ?? true, editado_por: usuario,
  }
  if (p.id) await lanzar(supabase.from('af_paquete').update(fila).eq('id', p.id).select('id'))
  else await lanzar(supabase.from('af_paquete').insert(fila).select('id'))
}

export async function actualizarLaborPlan(id: string, cambios: { cantidadPlan?: number; costoUnitarioPlan?: number }, usuario: string) {
  await lanzar(supabase.from('af_labores').update({
    ...(cambios.cantidadPlan !== undefined ? { cantidad_plan: cambios.cantidadPlan } : {}),
    ...(cambios.costoUnitarioPlan !== undefined ? { costo_unitario_plan: cambios.costoUnitarioPlan } : {}),
    editado_por: usuario,
  }).eq('id', id).select('id'))
}

export async function anularLabor(id: string, motivo: string, usuario: string) {
  await lanzar(supabase.from('af_labores').update({ estado: 'ANULADA', anulada_motivo: motivo.trim(), editado_por: usuario }).eq('id', id).select('id'))
}

// ── Ciclos, reportes y aceptación (por funciones de la base) ─────────────
export async function abrirCiclo(suerteId: string, fechaCorte: string, tipo: TipoCiclo, usuario: string): Promise<string> {
  const d = await lanzar(supabase.rpc('af_abrir_ciclo', { p_suerte: suerteId, p_fecha_corte: fechaCorte, p_tipo: tipo, p_usuario: usuario }))
  return String(d)
}

export async function reportarLabor(r: {
  id: string; laborId: string; cantidad: number; fecha: string; fotoUrl: string
  lat: number | null; lng: number | null; precisionM: number | null; nota: string
}, usuario: string) {
  await lanzar(supabase.rpc('af_reportar', {
    p_id: r.id, p_labor: r.laborId, p_cantidad: r.cantidad, p_fecha: r.fecha, p_foto: r.fotoUrl,
    p_lat: r.lat, p_lng: r.lng, p_precision: r.precisionM, p_nota: r.nota, p_usuario: usuario,
  }))
}

export async function revisarReporte(id: string, aceptar: boolean, motivo: string, usuario: string): Promise<string> {
  const d = await lanzar(supabase.rpc('af_revisar', { p_reporte: id, p_aceptar: aceptar, p_motivo: motivo, p_usuario: usuario }))
  return String(d)
}

// ── Cuenta del dueño ──────────────────────────────────────────────────────
export async function registrarMovimiento(m: {
  fincaId: string; tipo: TipoMovimiento; fecha: string; concepto: string; valor: number
  suerteId?: string | null; soporteUrl?: string | null
}, usuario: string) {
  await lanzar(supabase.from('af_movimientos').insert({
    finca_id: m.fincaId, tipo: m.tipo, fecha: m.fecha, concepto: m.concepto.trim(), valor: m.valor,
    suerte_id: m.suerteId || null, soporte_url: m.soporteUrl || null, registrado_por: usuario,
  }).select('id'))
}

export async function anularMovimiento(id: string, motivo: string, usuario: string) {
  await lanzar(supabase.rpc('af_anular_movimiento', { p_id: id, p_motivo: motivo, p_usuario: usuario }))
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
