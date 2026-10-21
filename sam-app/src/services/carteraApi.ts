import { supabase } from '../lib/supabase'

/**
 * CARTERA (2-oct-2026, migración 20261002170000). Una fila por factura desde la
 * vista `cartera_facturas_v`: vence = fecha + plazo (estándar 30 días); después
 * corren los días de mora. Estados (por días desde la factura, mientras tenga saldo):
 *   AL_DIA ≤30 · VENCIDA 31–60 · CRITICA 61–180 · OTRAS_MEDIDAS >180 · PAGADA
 *   SIN_VALOR = la factura aún no tiene valor (sin tarifas): los días corren igual.
 * Pagada: los días se congelan en el último pago (en cuánto pagó el cliente).
 * Pagos con abonos parciales y comprobante; se ANULAN con motivo, no se borran.
 */
export type EstadoCartera = 'AL_DIA' | 'VENCIDA' | 'CRITICA' | 'OTRAS_MEDIDAS' | 'PAGADA' | 'SIN_VALOR'

export const ESTADOS_CARTERA: { id: EstadoCartera; titulo: string; detalle: string; clase: string }[] = [
  { id: 'AL_DIA', titulo: 'Al día', detalle: '0 a 30 días', clase: 'cart--ok' },
  { id: 'SIN_VALOR', titulo: 'Sin valor', detalle: 'falta el valor de la factura', clase: 'cart--neutro' },
  { id: 'VENCIDA', titulo: 'Vencida', detalle: '31 a 60 días · corre la mora', clase: 'cart--ojo' },
  { id: 'CRITICA', titulo: 'Crítica', detalle: '61 a 180 días', clase: 'cart--mal' },
  { id: 'OTRAS_MEDIDAS', titulo: 'Otras medidas', detalle: 'más de 180 días', clase: 'cart--grave' },
  { id: 'PAGADA', titulo: 'Pagada', detalle: 'pagos cubren el valor', clase: 'cart--pagada' },
]
export const infoEstado = (e: EstadoCartera) => ESTADOS_CARTERA.find((x) => x.id === e) ?? ESTADOS_CARTERA[0]


export interface FacturaCartera {
  id: string
  numero: string
  fecha: string
  razonSocial: string | null
  cliente: string | null
  valor: number | null
  plazoDias: number
  vence: string
  pagado: number
  saldo: number | null
  ultimoPago: string | null
  nPagos: number
  nLineas: number
  cantidad: number
  diasCartera: number
  diasMora: number
  estado: EstadoCartera
  archivoPath: string | null
  /** Acuerdo de pago al que pertenece (colono): su plan manda el vencimiento. */
  acuerdoId: string | null
  colono: string | null
  /** Anticipo del acuerdo ya descontado de esta factura. */
  anticipo: number
}

export interface Pago {
  id: string
  /** null = anticipo de un acuerdo que todavía no tiene factura. */
  facturaId: string | null
  acuerdoId: string | null
  /** Se pagó al acuerdo antes de la factura: se descuenta de la factura final. */
  anticipo: boolean
  fecha: string
  valor: number
  medio: string | null
  referencia: string | null
  archivoPath: string | null
  nota: string | null
  anulado: boolean
  anuladoMotivo: string | null
  creadoPor: string
  createdAt: string
}

const num = (v: unknown) => (v == null ? 0 : Number(v))

function mapFactura(r: Record<string, unknown>): FacturaCartera {
  return {
    id: String(r.id), numero: String(r.numero ?? ''), fecha: String(r.fecha ?? ''),
    razonSocial: r.razon_social ? String(r.razon_social) : null, cliente: r.cliente ? String(r.cliente) : null,
    valor: r.valor != null ? Number(r.valor) : null, plazoDias: num(r.plazo_dias), vence: String(r.vence ?? ''),
    pagado: num(r.pagado), saldo: r.saldo != null ? Number(r.saldo) : null,
    ultimoPago: r.ultimo_pago ? String(r.ultimo_pago) : null, nPagos: num(r.n_pagos),
    nLineas: num(r.n_lineas), cantidad: num(r.cantidad), diasCartera: num(r.dias_cartera), diasMora: num(r.dias_mora),
    estado: (r.estado as EstadoCartera) ?? 'AL_DIA', archivoPath: r.archivo_path ? String(r.archivo_path) : null,
    acuerdoId: r.acuerdo_id ? String(r.acuerdo_id) : null, colono: r.colono ? String(r.colono) : null,
    anticipo: num(r.anticipo),
  }
}

function mapPago(r: Record<string, unknown>): Pago {
  return {
    id: String(r.id), facturaId: r.factura_id ? String(r.factura_id) : null,
    acuerdoId: r.acuerdo_id ? String(r.acuerdo_id) : null, anticipo: r.anticipo === true, fecha: String(r.fecha ?? ''), valor: num(r.valor),
    medio: r.medio ? String(r.medio) : null, referencia: r.referencia ? String(r.referencia) : null,
    archivoPath: r.archivo_path ? String(r.archivo_path) : null, nota: r.nota ? String(r.nota) : null,
    anulado: r.anulado === true, anuladoMotivo: r.anulado_motivo ? String(r.anulado_motivo) : null,
    creadoPor: String(r.creado_por ?? ''), createdAt: String(r.created_at ?? ''),
  }
}

const sinCodigo = (m?: string) => (m ?? '').replace(/^[A-Z_]+:\s*/, '')

export async function loadCartera(): Promise<FacturaCartera[]> {
  const { data, error } = await supabase.from('cartera_facturas_v').select('*').order('dias_cartera', { ascending: false })
  if (error || !data) return []
  return (data as Record<string, unknown>[]).map(mapFactura)
}

/** La cartera de UNA factura (para el detalle de una labor). */
export async function loadFacturaCartera(facturaId: string): Promise<FacturaCartera | null> {
  const { data } = await supabase.from('cartera_facturas_v').select('*').eq('id', facturaId).maybeSingle()
  return data ? mapFactura(data as Record<string, unknown>) : null
}

export async function loadPagos(facturaId: string): Promise<Pago[]> {
  const { data, error } = await supabase.from('fact_pagos').select('*').eq('factura_id', facturaId).order('fecha', { ascending: false })
  if (error || !data) return []
  return (data as Record<string, unknown>[]).map(mapPago)
}

/**
 * Un pago va a una FACTURA o a un ACUERDO. Al acuerdo: si ya tiene factura con
 * saldo, la base lo pone en ella; si no, queda como anticipo (se descuenta de la
 * factura final cuando se ligue). Ver migración 20261021120000.
 */
export async function registrarPago(input: {
  facturaId?: string | null; acuerdoId?: string | null; fecha: string; valor: number; medio?: string; referencia?: string; nota?: string; creadoPor: string
}, archivo?: File | null): Promise<void> {
  let archivoPath: string | null = null
  if (archivo) {
    const limpio = archivo.name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80)
    archivoPath = `pago/${input.fecha.slice(0, 7)}/${crypto.randomUUID()}-${limpio}`
    const { error } = await supabase.storage.from('facturacion').upload(archivoPath, archivo, { upsert: false, contentType: archivo.type || 'application/octet-stream' })
    if (error) throw new Error(`No se pudo subir el comprobante: ${error.message}`)
  }
  const { error } = await supabase.from('fact_pagos').insert({
    factura_id: input.facturaId ?? null, acuerdo_id: input.acuerdoId ?? null, fecha: input.fecha, valor: input.valor,
    medio: input.medio?.trim() || null, referencia: input.referencia?.trim() || null, nota: input.nota?.trim() || null,
    archivo_path: archivoPath, archivo_nombre: archivo?.name ?? null, creado_por: input.creadoPor,
  })
  if (error) throw new Error(sinCodigo(error.message) || 'No se pudo registrar el pago')
}

export async function anularPago(id: string, motivo: string, usuario: string): Promise<void> {
  const { error } = await supabase.from('fact_pagos')
    .update({ anulado: true, anulado_motivo: motivo.trim(), anulado_por: usuario }).eq('id', id)
  if (error) throw new Error(sinCodigo(error.message) || 'No se pudo anular el pago')
}

/** Valor y plazo de la factura (el valor puede llegar después, cuando haya tarifas). */
export async function actualizarFactura(id: string, cambios: { valor?: number | null; plazoDias?: number }): Promise<void> {
  const payload: Record<string, unknown> = {}
  if (cambios.valor !== undefined) payload.valor = cambios.valor
  if (cambios.plazoDias !== undefined) payload.plazo_dias = cambios.plazoDias
  const { error } = await supabase.from('fact_documentos').update(payload).eq('id', id).eq('tipo', 'FACTURA')
  if (error) throw new Error(sinCodigo(error.message) || 'No se pudo actualizar la factura')
}

export const pesos = (n: number | null | undefined) =>
  n == null ? '—' : `$${Math.round(n).toLocaleString('es-CO')}`

// ── ACUERDOS DE PAGO con proveedores / colonos (21-oct-2026, migración 20261021120000) ──
// Cristian negocia (plazos de 2-3 meses, anticipo de un % de la labor); administración
// los registra. El plan: el ANTICIPO (cuota 0) y las cuotas. Regla de Iván: «el
// anticipo se descuenta de la factura final» — el pago del anticipo queda en el
// acuerdo y, cuando la factura se liga, pasa a ella (su saldo baja).

export interface Cuota {
  id?: string
  orden: number
  anticipo: boolean
  vence: string
  valor: number
}

export interface Acuerdo {
  id: string
  colono: string
  telefono: string | null
  haciendas: string[]
  fecha: string
  negociadoPor: string
  condiciones: string | null
  anulado: boolean
  anuladoMotivo: string | null
  creadoPor: string
  /** Suma del plan (anticipo + cuotas). */
  valor: number
  anticipo: number
  nCuotas: number
  pagado: number
  anticipoPagado: number
  /** Anticipo pagado que todavía no tiene factura donde descontarse. */
  porDescontar: number
  ultimoPago: string | null
  nFacturas: number
  facturado: number | null
  /** «FE-1214, FE-1250» */
  facturas: string | null
  cuotas: Cuota[]
}

export type EstadoCuota = 'PAGADA' | 'PARCIAL' | 'VENCIDA' | 'PRONTO' | 'PENDIENTE'

export interface CuotaConEstado extends Cuota {
  /** Lo que los pagos del acuerdo ya cubren de esta cuota. */
  cubierto: number
  falta: number
  estado: EstadoCuota
  /** VENCIDA: días desde que venció. Si no: días que faltan. */
  dias: number
}

export type EstadoAcuerdo = 'ANULADO' | 'CUMPLIDO' | 'ATRASADO' | 'PRONTO' | 'AL_DIA'

export const ESTADOS_ACUERDO: Record<EstadoAcuerdo, { titulo: string; clase: string }> = {
  AL_DIA: { titulo: 'Al día', clase: 'cart--ok' },
  PRONTO: { titulo: 'Cuota esta semana', clase: 'cart--ojo' },
  ATRASADO: { titulo: 'Cuota vencida', clase: 'cart--mal' },
  CUMPLIDO: { titulo: 'Cumplido', clase: 'cart--pagada' },
  ANULADO: { titulo: 'Anulado', clase: 'cart--neutro' },
}

/** Días que se avisa antes de que venza una cuota. */
export const DIAS_AVISO_CUOTA = 7

export function sumarDias(iso: string, dias: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

export const diasEntre = (desde: string, hasta: string) =>
  Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000)

/** Lo pagado al acuerdo cubre las cuotas en orden: primero el anticipo, luego la 1, la 2… */
export function cuotasConEstado(a: Pick<Acuerdo, 'cuotas' | 'pagado'>, hoy: string): CuotaConEstado[] {
  let resto = a.pagado
  return [...a.cuotas].sort((x, y) => x.orden - y.orden).map((c) => {
    const cubierto = Math.max(0, Math.min(c.valor, resto))
    resto -= cubierto
    const falta = c.valor - cubierto
    const dias = diasEntre(hoy, c.vence)
    const estado: EstadoCuota = falta <= 0.5 ? 'PAGADA'
      : dias < 0 ? 'VENCIDA'
      : dias <= DIAS_AVISO_CUOTA ? 'PRONTO'
      : cubierto > 0 ? 'PARCIAL' : 'PENDIENTE'
    return { ...c, cubierto, falta: falta <= 0.5 ? 0 : falta, estado, dias: Math.abs(dias) }
  })
}

export function estadoAcuerdo(a: Acuerdo, hoy: string): {
  estado: EstadoAcuerdo; cuotas: CuotaConEstado[]; proxima: CuotaConEstado | null; vencidas: CuotaConEstado[]; saldo: number
} {
  const cuotas = cuotasConEstado(a, hoy)
  const vencidas = cuotas.filter((c) => c.estado === 'VENCIDA')
  const proxima = cuotas.find((c) => c.falta > 0) ?? null
  const saldo = Math.max(0, a.valor - a.pagado)
  const estado: EstadoAcuerdo = a.anulado ? 'ANULADO'
    : !proxima ? 'CUMPLIDO'
    : vencidas.length > 0 ? 'ATRASADO'
    : proxima.estado === 'PRONTO' ? 'PRONTO' : 'AL_DIA'
  return { estado, cuotas, proxima, vencidas, saldo }
}

/** Nombre de la cuota para mostrar: «Anticipo», «Cuota 2 de 3». */
export const nombreCuota = (c: Cuota, nCuotas: number) => (c.anticipo ? 'Anticipo' : `Cuota ${c.orden} de ${nCuotas}`)

/**
 * Arma el plan: anticipo (si hay) + N cuotas iguales cada `cadaDias` desde `primera`.
 * Las cuotas se redondean a miles; la última absorbe la diferencia.
 */
export function armarPlan(p: {
  valor: number; anticipo: number; fechaAnticipo: string; nCuotas: number; primera: string; cadaDias: number
}): Cuota[] {
  const out: Cuota[] = []
  const anticipo = Math.max(0, Math.min(p.anticipo, p.valor))
  if (anticipo > 0) out.push({ orden: 0, anticipo: true, vence: p.fechaAnticipo, valor: Math.round(anticipo) })
  const resto = Math.round(p.valor - anticipo)
  const n = Math.max(0, Math.round(p.nCuotas))
  if (resto <= 0 || n === 0) return out
  const base = resto >= n * 1000 ? Math.floor(resto / n / 1000) * 1000 : Math.floor(resto / n)
  for (let i = 1; i <= n; i++) {
    out.push({ orden: i, anticipo: false, vence: sumarDias(p.primera, (i - 1) * p.cadaDias), valor: i === n ? resto - base * (n - 1) : base })
  }
  return out
}

function mapAcuerdo(r: Record<string, unknown>, cuotas: Cuota[]): Acuerdo {
  return {
    id: String(r.id), colono: String(r.colono ?? ''), telefono: r.telefono ? String(r.telefono) : null,
    haciendas: Array.isArray(r.haciendas) ? (r.haciendas as unknown[]).map(String) : [],
    fecha: String(r.fecha ?? ''), negociadoPor: String(r.negociado_por ?? ''),
    condiciones: r.condiciones ? String(r.condiciones) : null, anulado: r.anulado === true,
    anuladoMotivo: r.anulado_motivo ? String(r.anulado_motivo) : null, creadoPor: String(r.creado_por ?? ''),
    valor: num(r.valor), anticipo: num(r.anticipo), nCuotas: num(r.n_cuotas), pagado: num(r.pagado),
    anticipoPagado: num(r.anticipo_pagado), porDescontar: num(r.por_descontar),
    ultimoPago: r.ultimo_pago ? String(r.ultimo_pago) : null, nFacturas: num(r.n_facturas),
    facturado: r.facturado != null ? Number(r.facturado) : null, facturas: r.facturas ? String(r.facturas) : null,
    cuotas,
  }
}

export async function loadAcuerdos(): Promise<Acuerdo[]> {
  const [a, c] = await Promise.all([
    supabase.from('fact_acuerdos_v').select('*').order('fecha', { ascending: false }),
    supabase.from('fact_acuerdo_cuotas').select('id,acuerdo_id,orden,anticipo,vence,valor').order('orden'),
  ])
  if (a.error || !a.data) return []
  const porAcuerdo = new Map<string, Cuota[]>()
  for (const r of (c.data ?? []) as Record<string, unknown>[]) {
    const id = String(r.acuerdo_id)
    const lista = porAcuerdo.get(id) ?? []
    lista.push({ id: String(r.id), orden: num(r.orden), anticipo: r.anticipo === true, vence: String(r.vence ?? ''), valor: num(r.valor) })
    porAcuerdo.set(id, lista)
  }
  return (a.data as Record<string, unknown>[]).map((r) => mapAcuerdo(r, porAcuerdo.get(String(r.id)) ?? []))
}

export async function loadPagosAcuerdo(acuerdoId: string): Promise<Pago[]> {
  const { data, error } = await supabase.from('fact_pagos').select('*').eq('acuerdo_id', acuerdoId)
    .order('fecha', { ascending: false }).order('created_at', { ascending: false })
  if (error || !data) return []
  return (data as Record<string, unknown>[]).map(mapPago)
}

export interface DatosAcuerdo {
  colono: string
  telefono?: string
  haciendas: string[]
  fecha: string
  negociadoPor: string
  condiciones?: string
}

/** Crea (id null) o cambia el acuerdo con su plan completo. Devuelve su id. */
export async function guardarAcuerdo(id: string | null, datos: DatosAcuerdo, cuotas: Cuota[], usuario: string): Promise<string> {
  const { data, error } = await supabase.rpc('fact_acuerdo_guardar', {
    p_id: id,
    p_datos: {
      colono: datos.colono, telefono: datos.telefono ?? '', haciendas: datos.haciendas, fecha: datos.fecha,
      negociado_por: datos.negociadoPor, condiciones: datos.condiciones ?? '',
    },
    p_cuotas: cuotas.map((c) => ({ vence: c.vence, valor: c.valor, anticipo: c.anticipo })),
    p_usuario: usuario,
  })
  if (error || !data) throw new Error(sinCodigo(error?.message) || 'No se pudo guardar el acuerdo')
  return String(data)
}

export async function anularAcuerdo(id: string, motivo: string, usuario: string): Promise<void> {
  const { error } = await supabase.rpc('fact_acuerdo_anular', { p_id: id, p_motivo: motivo, p_usuario: usuario })
  if (error) throw new Error(sinCodigo(error.message) || 'No se pudo anular el acuerdo')
}

/** Liga la factura al acuerdo (null = la quita). Devuelve el anticipo que quedó descontado en ella. */
export async function ligarFacturaAcuerdo(facturaId: string, acuerdoId: string | null, usuario: string): Promise<number> {
  const { data, error } = await supabase.rpc('fact_acuerdo_ligar_factura', { p_factura: facturaId, p_acuerdo: acuerdoId, p_usuario: usuario })
  if (error) throw new Error(sinCodigo(error.message) || 'No se pudo ligar la factura al acuerdo')
  return Number(data ?? 0)
}

/** Haciendas «iguales» aunque cambien mayúsculas o espacios. */
export const claveHacienda = (h: string) => h.trim().replace(/\s+/g, ' ').toUpperCase()

/** Acuerdos vigentes que cubren alguna de esas haciendas. */
export function acuerdosDeHaciendas(acuerdos: Acuerdo[], haciendas: string[]): Acuerdo[] {
  const claves = new Set(haciendas.map(claveHacienda))
  return acuerdos.filter((a) => !a.anulado && a.haciendas.some((h) => claves.has(claveHacienda(h))))
}

