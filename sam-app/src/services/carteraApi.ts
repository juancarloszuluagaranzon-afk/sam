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
}

export interface Pago {
  id: string
  facturaId: string
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
  }
}

function mapPago(r: Record<string, unknown>): Pago {
  return {
    id: String(r.id), facturaId: String(r.factura_id), fecha: String(r.fecha ?? ''), valor: num(r.valor),
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

export async function registrarPago(input: {
  facturaId: string; fecha: string; valor: number; medio?: string; referencia?: string; nota?: string; creadoPor: string
}, archivo?: File | null): Promise<void> {
  let archivoPath: string | null = null
  if (archivo) {
    const limpio = archivo.name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80)
    archivoPath = `pago/${input.fecha.slice(0, 7)}/${crypto.randomUUID()}-${limpio}`
    const { error } = await supabase.storage.from('facturacion').upload(archivoPath, archivo, { upsert: false, contentType: archivo.type || 'application/octet-stream' })
    if (error) throw new Error(`No se pudo subir el comprobante: ${error.message}`)
  }
  const { error } = await supabase.from('fact_pagos').insert({
    factura_id: input.facturaId, fecha: input.fecha, valor: input.valor,
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
