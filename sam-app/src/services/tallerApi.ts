import { supabase } from '../lib/supabase'
import { registrarMovimientoInsumo } from './samApi'
import { redondear2 } from '../lib/cantidad'
import type {
  EquipoHorometro, HorometroDudoso,
  Proveedor, ProveedorTipo, InsumoProveedor, Aplicabilidad,
  Compra, CompraItem, CompraEstado,
  MttoPlan, OrdenTrabajo, OtRepuesto, OtTipo, OtEstado,
  EquipoCosto, CostoConcepto,
} from '../domain/sam'

/**
 * API del taller de maquinaria.
 *
 * Va aparte de `samApi` porque es otro dominio: allá se responde "¿qué le
 * entregué hoy al operario?", aquí "¿qué le he metido a esta máquina en toda su
 * vida y cuánto me cuesta la hora?".
 *
 * Lo único que comparte es el kardex: los repuestos que consume una orden de
 * trabajo se descuentan con `registrarMovimientoInsumo`, igual que cualquier
 * otra salida. Nada de inventarios paralelos.
 */

const s = (v: unknown) => (v == null || v === '' ? undefined : String(v))
const n = (v: unknown) => (v == null ? undefined : Number(v))

/* ── Horómetro ───────────────────────────────────────────────────────────── */

/** Lectura vigente por máquina. La vista ya descartó los dedazos. */
export async function loadHorometros(): Promise<EquipoHorometro[]> {
  const { data, error } = await supabase.from('equipo_horometro_v').select('*')
  if (error || !data) return []
  return (data as Record<string, unknown>[]).map((r) => ({
    codigo: String(r.codigo),
    horometro: Number(r.horometro ?? 0),
    leidoEn: String(r.leido_en ?? ''),
    fuente: String(r.fuente ?? ''),
  }))
}

/** Lecturas descartadas por implausibles — se muestran para que las corrijan. */
export async function loadHorometrosDudosos(): Promise<HorometroDudoso[]> {
  const { data, error } = await supabase.from('equipo_horometro_dudoso_v').select('*')
  if (error || !data) return []
  return (data as Record<string, unknown>[]).map((r) => ({
    origenId: String(r.origen_id ?? ''),
    codigo: String(r.codigo),
    horas: Number(r.horas ?? 0),
    cuando: String(r.cuando ?? ''),
    fuente: String(r.fuente ?? ''),
    magnitudEsperada: Number(r.magnitud_esperada ?? 0),
  }))
}

export async function setHorometroManual(codigo: string, horas: number): Promise<void> {
  const { error } = await supabase
    .from('equipos')
    .update({ horometro_manual: horas, horometro_manual_en: new Date().toISOString() })
    .eq('codigo', codigo)
  if (error) throw new Error(error.message || 'No se pudo guardar el horómetro')
}

/** Datos del activo que no se deducen de la operación (para depreciar). */
export async function updateEquipoActivo(codigo: string, patch: {
  valorCompra?: number | null
  fechaCompra?: string | null
  vidaUtilHoras?: number | null
  valorResidual?: number | null
}): Promise<void> {
  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (patch.valorCompra !== undefined) payload.valor_compra = patch.valorCompra
  if (patch.fechaCompra !== undefined) payload.fecha_compra = patch.fechaCompra || null
  if (patch.vidaUtilHoras !== undefined) payload.vida_util_horas = patch.vidaUtilHoras
  if (patch.valorResidual !== undefined) payload.valor_residual = patch.valorResidual
  const { error } = await supabase.from('equipos').update(payload).eq('codigo', codigo)
  if (error) throw new Error(error.message || 'No se pudo actualizar el equipo')
}

export interface EquipoActivo {
  codigo: string
  valorCompra?: number
  fechaCompra?: string
  vidaUtilHoras?: number
  valorResidual?: number
}

export async function loadEquiposActivo(): Promise<EquipoActivo[]> {
  const { data, error } = await supabase
    .from('equipos')
    .select('codigo,valor_compra,fecha_compra,vida_util_horas,valor_residual')
  if (error || !data) return []
  return (data as Record<string, unknown>[]).map((r) => ({
    codigo: String(r.codigo),
    valorCompra: n(r.valor_compra),
    fechaCompra: s(r.fecha_compra),
    vidaUtilHoras: n(r.vida_util_horas),
    valorResidual: n(r.valor_residual),
  }))
}

/* ── Proveedores ─────────────────────────────────────────────────────────── */

const TIPOS: ProveedorTipo[] = ['REPUESTOS', 'AGROINSUMOS', 'SERVICIOS', 'OTRO']

function mapProveedor(r: Record<string, unknown>): Proveedor {
  const t = String(r.tipo ?? 'REPUESTOS').toUpperCase() as ProveedorTipo
  return {
    id: String(r.id),
    nombre: String(r.nombre ?? ''),
    nit: s(r.nit),
    tipo: TIPOS.includes(t) ? t : 'OTRO',
    contacto: s(r.contacto),
    telefono: s(r.telefono),
    email: s(r.email),
    zona: s(r.zona),
    direccion: s(r.direccion),
    nota: s(r.nota),
    activo: r.activo == null ? true : Boolean(r.activo),
  }
}

export async function loadProveedores(): Promise<Proveedor[]> {
  const { data, error } = await supabase.from('proveedores').select('*').order('nombre')
  if (error || !data) return []
  return (data as Record<string, unknown>[]).map(mapProveedor)
}

export async function saveProveedor(input: Partial<Proveedor> & { nombre: string }): Promise<Proveedor> {
  const payload: Record<string, unknown> = {
    nombre: input.nombre.trim().toUpperCase(),
    nit: input.nit?.trim() || null,
    tipo: input.tipo ?? 'REPUESTOS',
    contacto: input.contacto?.trim() || null,
    telefono: input.telefono?.trim() || null,
    email: input.email?.trim() || null,
    zona: input.zona?.trim() || null,
    direccion: input.direccion?.trim() || null,
    nota: input.nota?.trim() || null,
    activo: input.activo ?? true,
    updated_at: new Date().toISOString(),
  }
  const q = input.id
    ? supabase.from('proveedores').update(payload).eq('id', input.id).select('*').single()
    : supabase.from('proveedores').insert(payload).select('*').single()
  const { data, error } = await q
  if (error || !data) throw new Error(error?.message || 'No se pudo guardar el proveedor')
  return mapProveedor(data as Record<string, unknown>)
}

/* ── Ficha del repuesto ──────────────────────────────────────────────────── */

export async function updateRepuestoFicha(insumoId: string, patch: {
  referencia?: string
  marca?: string
  numeroParte?: string
  ubicacion?: string
  stockMaximo?: number | null
  stockSeguridad?: number | null
  esRepuesto?: boolean
  costoPromedio?: number | null
}): Promise<void> {
  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (patch.referencia !== undefined) payload.referencia = patch.referencia.trim() || null
  if (patch.marca !== undefined) payload.marca = patch.marca.trim().toUpperCase() || null
  if (patch.numeroParte !== undefined) payload.numero_parte = patch.numeroParte.trim().toUpperCase() || null
  if (patch.ubicacion !== undefined) payload.ubicacion = patch.ubicacion.trim().toUpperCase() || null
  if (patch.stockMaximo !== undefined) payload.stock_maximo = patch.stockMaximo
  if (patch.stockSeguridad !== undefined) payload.stock_seguridad = patch.stockSeguridad
  if (patch.esRepuesto !== undefined) payload.es_repuesto = patch.esRepuesto
  if (patch.costoPromedio !== undefined) payload.costo_promedio = patch.costoPromedio
  const { error } = await supabase.from('insumos').update(payload).eq('id', insumoId)
  if (error) throw new Error(error.message || 'No se pudo actualizar el repuesto')
}

export async function loadAplicabilidad(insumoId?: string): Promise<Aplicabilidad[]> {
  let q = supabase.from('insumos_aplicabilidad').select('*')
  if (insumoId) q = q.eq('insumo_id', insumoId)
  const { data, error } = await q
  if (error || !data) return []
  return (data as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    insumoId: String(r.insumo_id),
    marca: s(r.marca),
    modelo: s(r.modelo),
    equipoCodigo: s(r.equipo_codigo),
    nota: s(r.nota),
  }))
}

export async function addAplicabilidad(input: {
  insumoId: string; marca?: string; modelo?: string; equipoCodigo?: string
}): Promise<void> {
  const { error } = await supabase.from('insumos_aplicabilidad').insert({
    insumo_id: input.insumoId,
    marca: input.marca?.trim().toUpperCase() || null,
    modelo: input.modelo?.trim().toUpperCase() || null,
    equipo_codigo: input.equipoCodigo?.trim().toUpperCase() || null,
  })
  if (error) throw new Error(error.message || 'No se pudo guardar la aplicabilidad')
}

export async function deleteAplicabilidad(id: string): Promise<void> {
  const { error } = await supabase.from('insumos_aplicabilidad').delete().eq('id', id)
  if (error) throw new Error(error.message || 'No se pudo borrar')
}

export async function loadInsumoProveedores(insumoId?: string): Promise<InsumoProveedor[]> {
  let q = supabase.from('insumos_proveedores').select('*, proveedores(nombre)')
  if (insumoId) q = q.eq('insumo_id', insumoId)
  const { data, error } = await q
  if (error || !data) return []
  return (data as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    insumoId: String(r.insumo_id),
    proveedorId: String(r.proveedor_id),
    proveedorNombre: (r.proveedores as { nombre?: string } | null)?.nombre,
    referenciaProveedor: s(r.referencia_proveedor),
    precio: n(r.precio),
    diasEntrega: n(r.dias_entrega),
    preferido: Boolean(r.preferido),
    ultimaCompra: s(r.ultima_compra),
  }))
}

export async function saveInsumoProveedor(input: {
  insumoId: string; proveedorId: string; referenciaProveedor?: string
  precio?: number; diasEntrega?: number; preferido?: boolean
}): Promise<void> {
  const { error } = await supabase.from('insumos_proveedores').upsert({
    insumo_id: input.insumoId,
    proveedor_id: input.proveedorId,
    referencia_proveedor: input.referenciaProveedor?.trim() || null,
    precio: input.precio ?? null,
    dias_entrega: input.diasEntrega ?? null,
    preferido: input.preferido ?? false,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'insumo_id,proveedor_id' })
  if (error) throw new Error(error.message || 'No se pudo guardar el precio')
}

/* ── Compras ─────────────────────────────────────────────────────────────── */

function mapCompra(r: Record<string, unknown>): Compra {
  const est = String(r.estado ?? 'BORRADOR').toUpperCase()
  const items = Array.isArray(r.compra_items) ? (r.compra_items as Record<string, unknown>[]) : []
  return {
    id: String(r.id),
    consecutivo: Number(r.consecutivo ?? 0),
    proveedorId: s(r.proveedor_id),
    proveedorNombre: (r.proveedores as { nombre?: string } | null)?.nombre,
    bodegaId: s(r.bodega_id),
    fecha: String(r.fecha ?? ''),
    factura: s(r.factura),
    estado: (['BORRADOR', 'RECIBIDA', 'ANULADA'].includes(est) ? est : 'BORRADOR') as CompraEstado,
    subtotal: Number(r.subtotal ?? 0),
    impuestos: Number(r.impuestos ?? 0),
    total: Number(r.total ?? 0),
    nota: s(r.nota),
    soporteUrl: s(r.soporte_url),
    creadoNombre: s(r.creado_nombre),
    recibidaEn: s(r.recibida_en),
    createdAt: String(r.created_at ?? ''),
    items: items.map((it) => ({
      id: String(it.id),
      insumoId: String(it.insumo_id),
      cantidad: Number(it.cantidad ?? 0),
      precioUnitario: Number(it.precio_unitario ?? 0),
    })),
  }
}

export async function loadCompras(opts?: { estado?: CompraEstado; limit?: number }): Promise<Compra[]> {
  let q = supabase
    .from('compras')
    .select('*, proveedores(nombre), compra_items(*)')
    .order('fecha', { ascending: false })
    .limit(opts?.limit ?? 200)
  if (opts?.estado) q = q.eq('estado', opts.estado)
  const { data, error } = await q
  if (error || !data) return []
  return (data as Record<string, unknown>[]).map(mapCompra)
}

export async function crearCompra(input: {
  proveedorId?: string
  bodegaId?: string
  fecha: string
  factura?: string
  impuestos?: number
  nota?: string
  soporteUrl?: string
  creadoPor?: string
  creadoNombre?: string
  items: CompraItem[]
}): Promise<string> {
  const subtotal = redondear2(input.items.reduce((t, i) => t + i.cantidad * i.precioUnitario, 0))
  const impuestos = redondear2(input.impuestos ?? 0)
  const { data, error } = await supabase
    .from('compras')
    .insert({
      proveedor_id: input.proveedorId ?? null,
      bodega_id: input.bodegaId ?? null,
      fecha: input.fecha,
      factura: input.factura?.trim() || null,
      estado: 'BORRADOR',
      subtotal, impuestos, total: redondear2(subtotal + impuestos),
      nota: input.nota?.trim() || null,
      soporte_url: input.soporteUrl ?? null,
      creado_por: input.creadoPor ?? null,
      creado_nombre: input.creadoNombre ?? null,
    })
    .select('id').single()
  if (error || !data) throw new Error(error?.message || 'No se pudo crear la compra')

  const compraId = String(data.id)
  const { error: e2 } = await supabase.from('compra_items').insert(
    input.items.map((i) => ({
      compra_id: compraId,
      insumo_id: i.insumoId,
      cantidad: redondear2(i.cantidad),
      precio_unitario: redondear2(i.precioUnitario),
    })),
  )
  if (e2) throw new Error(e2.message || 'No se pudieron guardar los ítems')
  return compraId
}

/**
 * Recibir la compra: es lo que mete el material al inventario.
 *
 * Hasta aquí la compra era papel. Al recibirla se genera una ENTRADA de kardex
 * por ítem —misma regla que rige todo lo demás: el stock nunca aparece de la
 * nada— y se actualiza el costo promedio del repuesto para poder valorizar.
 */
export async function recibirCompra(compraId: string, recibidaPor?: string): Promise<void> {
  const { data, error } = await supabase
    .from('compras').select('*, compra_items(*)').eq('id', compraId).single()
  if (error || !data) throw new Error(error?.message || 'No se encontró la compra')
  const compra = mapCompra(data as Record<string, unknown>)
  if (compra.estado !== 'BORRADOR') throw new Error('Esta compra ya fue recibida o anulada')
  if (!compra.bodegaId) throw new Error('La compra no tiene bodega de destino')

  for (const it of compra.items) {
    await registrarMovimientoInsumo({
      insumoId: it.insumoId,
      tipo: 'ENTRADA',
      cantidad: it.cantidad,
      motivo: `Compra #${compra.consecutivo}${compra.factura ? ` · factura ${compra.factura}` : ''}`,
      referencia: compraId,
      creadoPor: recibidaPor,
      bodegaId: compra.bodegaId,
    })
    if (it.precioUnitario > 0) {
      await supabase.from('insumos')
        .update({ costo_promedio: redondear2(it.precioUnitario) })
        .eq('id', it.insumoId)
    }
  }

  const { error: e2 } = await supabase.from('compras').update({
    estado: 'RECIBIDA',
    recibida_en: new Date().toISOString(),
    recibida_por: recibidaPor ?? null,
    updated_at: new Date().toISOString(),
  }).eq('id', compraId).eq('estado', 'BORRADOR')
  if (e2) throw new Error(e2.message || 'No se pudo marcar como recibida')

  if (compra.proveedorId) {
    for (const it of compra.items) {
      await supabase.from('insumos_proveedores').upsert({
        insumo_id: it.insumoId,
        proveedor_id: compra.proveedorId,
        precio: redondear2(it.precioUnitario),
        ultima_compra: compra.fecha,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'insumo_id,proveedor_id' })
    }
  }
}

export async function anularCompra(compraId: string): Promise<void> {
  const { error } = await supabase.from('compras')
    .update({ estado: 'ANULADA', updated_at: new Date().toISOString() })
    .eq('id', compraId).eq('estado', 'BORRADOR')
  if (error) throw new Error(error.message || 'No se pudo anular')
}

/* ── Plan preventivo ─────────────────────────────────────────────────────── */

function mapPlan(r: Record<string, unknown>): MttoPlan {
  return {
    id: String(r.id),
    equipoCodigo: s(r.equipo_codigo),
    marca: s(r.marca),
    modelo: s(r.modelo),
    tarea: String(r.tarea ?? ''),
    cadaHoras: n(r.cada_horas),
    cadaDias: n(r.cada_dias),
    avisarAntesHoras: Number(r.avisar_antes_horas ?? 50),
    ultimaHoras: n(r.ultima_horas),
    ultimaFecha: s(r.ultima_fecha),
    activo: r.activo == null ? true : Boolean(r.activo),
    nota: s(r.nota),
  }
}

export async function loadPlanes(): Promise<MttoPlan[]> {
  const { data, error } = await supabase.from('mtto_planes').select('*').order('tarea')
  if (error || !data) return []
  return (data as Record<string, unknown>[]).map(mapPlan)
}

export async function savePlan(input: Partial<MttoPlan> & { tarea: string }): Promise<void> {
  const payload: Record<string, unknown> = {
    equipo_codigo: input.equipoCodigo?.trim().toUpperCase() || null,
    marca: input.marca?.trim().toUpperCase() || null,
    modelo: input.modelo?.trim().toUpperCase() || null,
    tarea: input.tarea.trim(),
    cada_horas: input.cadaHoras ?? null,
    cada_dias: input.cadaDias ?? null,
    avisar_antes_horas: input.avisarAntesHoras ?? 50,
    ultima_horas: input.ultimaHoras ?? null,
    ultima_fecha: input.ultimaFecha || null,
    activo: input.activo ?? true,
    nota: input.nota?.trim() || null,
    updated_at: new Date().toISOString(),
  }
  const q = input.id
    ? supabase.from('mtto_planes').update(payload).eq('id', input.id)
    : supabase.from('mtto_planes').insert(payload)
  const { error } = await q
  if (error) throw new Error(error.message || 'No se pudo guardar el plan')
}

export async function deletePlan(id: string): Promise<void> {
  const { error } = await supabase.from('mtto_planes').update({ activo: false }).eq('id', id)
  if (error) throw new Error(error.message || 'No se pudo desactivar el plan')
}

/* ── Órdenes de trabajo ──────────────────────────────────────────────────── */

function mapOt(r: Record<string, unknown>): OrdenTrabajo {
  const tipo = String(r.tipo ?? 'CORRECTIVO').toUpperCase()
  const est = String(r.estado ?? 'ABIERTA').toUpperCase()
  const reps = Array.isArray(r.ot_repuestos) ? (r.ot_repuestos as Record<string, unknown>[]) : []
  return {
    id: String(r.id),
    consecutivo: Number(r.consecutivo ?? 0),
    equipoCodigo: String(r.equipo_codigo ?? ''),
    tipo: (['PREVENTIVO', 'CORRECTIVO', 'MEJORA'].includes(tipo) ? tipo : 'CORRECTIVO') as OtTipo,
    estado: (['ABIERTA', 'EN_PROCESO', 'CERRADA', 'ANULADA'].includes(est) ? est : 'ABIERTA') as OtEstado,
    planId: s(r.plan_id),
    descripcion: String(r.descripcion ?? ''),
    causa: s(r.causa),
    trabajoRealizado: s(r.trabajo_realizado),
    horometro: n(r.horometro),
    paroEn: s(r.paro_en),
    arranqueEn: s(r.arranque_en),
    horasMo: Number(r.horas_mo ?? 0),
    valorHoraMo: Number(r.valor_hora_mo ?? 0),
    costoExterno: Number(r.costo_externo ?? 0),
    proveedorExternoId: s(r.proveedor_externo_id),
    responsable: s(r.responsable),
    evidenciaUrls: Array.isArray(r.evidencia_urls) ? (r.evidencia_urls as string[]) : undefined,
    creadoNombre: s(r.creado_nombre),
    cerradaEn: s(r.cerrada_en),
    createdAt: String(r.created_at ?? ''),
    repuestos: reps.map((x) => ({
      id: String(x.id),
      insumoId: String(x.insumo_id),
      bodegaId: s(x.bodega_id),
      cantidad: Number(x.cantidad ?? 0),
      costoUnitario: Number(x.costo_unitario ?? 0),
      descargado: Boolean(x.descargado),
    })),
  }
}

export async function loadOrdenes(opts?: {
  equipoCodigo?: string; estado?: OtEstado; desde?: string; hasta?: string; limit?: number
}): Promise<OrdenTrabajo[]> {
  let q = supabase
    .from('ordenes_trabajo')
    .select('*, ot_repuestos(*)')
    .order('created_at', { ascending: false })
    .limit(opts?.limit ?? 300)
  if (opts?.equipoCodigo) q = q.eq('equipo_codigo', opts.equipoCodigo)
  if (opts?.estado) q = q.eq('estado', opts.estado)
  if (opts?.desde) q = q.gte('created_at', opts.desde)
  if (opts?.hasta) q = q.lte('created_at', `${opts.hasta}T23:59:59`)
  const { data, error } = await q
  if (error || !data) return []
  return (data as Record<string, unknown>[]).map(mapOt)
}

export async function crearOrden(input: {
  equipoCodigo: string
  tipo: OtTipo
  descripcion: string
  causa?: string
  horometro?: number
  paroEn?: string
  planId?: string
  responsable?: string
  creadoPor?: string
  creadoNombre?: string
}): Promise<string> {
  const { data, error } = await supabase.from('ordenes_trabajo').insert({
    equipo_codigo: input.equipoCodigo.trim().toUpperCase(),
    tipo: input.tipo,
    estado: 'ABIERTA',
    plan_id: input.planId ?? null,
    descripcion: input.descripcion.trim(),
    causa: input.causa?.trim() || null,
    horometro: input.horometro ?? null,
    paro_en: input.paroEn ?? null,
    responsable: input.responsable?.trim() || null,
    creado_por: input.creadoPor ?? null,
    creado_nombre: input.creadoNombre ?? null,
  }).select('id').single()
  if (error || !data) throw new Error(error?.message || 'No se pudo crear la orden')
  return String(data.id)
}

export async function updateOrden(id: string, patch: Partial<{
  tipo: OtTipo; estado: OtEstado; descripcion: string; causa: string
  trabajoRealizado: string; horometro: number | null
  paroEn: string | null; arranqueEn: string | null
  horasMo: number; valorHoraMo: number; costoExterno: number
  proveedorExternoId: string | null; responsable: string
  evidenciaUrls: string[]
}>): Promise<void> {
  const p: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (patch.tipo !== undefined) p.tipo = patch.tipo
  if (patch.estado !== undefined) p.estado = patch.estado
  if (patch.descripcion !== undefined) p.descripcion = patch.descripcion.trim()
  if (patch.causa !== undefined) p.causa = patch.causa.trim() || null
  if (patch.trabajoRealizado !== undefined) p.trabajo_realizado = patch.trabajoRealizado.trim() || null
  if (patch.horometro !== undefined) p.horometro = patch.horometro
  if (patch.paroEn !== undefined) p.paro_en = patch.paroEn
  if (patch.arranqueEn !== undefined) p.arranque_en = patch.arranqueEn
  if (patch.horasMo !== undefined) p.horas_mo = patch.horasMo
  if (patch.valorHoraMo !== undefined) p.valor_hora_mo = patch.valorHoraMo
  if (patch.costoExterno !== undefined) p.costo_externo = patch.costoExterno
  if (patch.proveedorExternoId !== undefined) p.proveedor_externo_id = patch.proveedorExternoId
  if (patch.responsable !== undefined) p.responsable = patch.responsable.trim() || null
  if (patch.evidenciaUrls !== undefined) p.evidencia_urls = patch.evidenciaUrls
  const { error } = await supabase.from('ordenes_trabajo').update(p).eq('id', id)
  if (error) throw new Error(error.message || 'No se pudo actualizar la orden')
}

export async function addRepuestoOt(input: {
  otId: string; insumoId: string; bodegaId?: string; cantidad: number; costoUnitario?: number
}): Promise<void> {
  const { error } = await supabase.from('ot_repuestos').insert({
    ot_id: input.otId,
    insumo_id: input.insumoId,
    bodega_id: input.bodegaId ?? null,
    cantidad: redondear2(input.cantidad),
    costo_unitario: redondear2(input.costoUnitario ?? 0),
  })
  if (error) throw new Error(error.message || 'No se pudo agregar el repuesto')
}

export async function deleteRepuestoOt(id: string): Promise<void> {
  // Solo se puede quitar lo que todavía no salió del inventario.
  const { error } = await supabase.from('ot_repuestos').delete().eq('id', id).eq('descargado', false)
  if (error) throw new Error(error.message || 'No se pudo quitar el repuesto')
}

/**
 * Cerrar la orden: descarga los repuestos y sella el arranque.
 *
 * El descargue va marcado uno por uno (`descargado`) para que cerrar dos veces
 * —o reintentar tras un fallo a mitad de camino— no descuente el inventario
 * dos veces.
 */
export async function cerrarOrden(input: {
  otId: string
  trabajoRealizado?: string
  arranqueEn?: string
  horometro?: number
  cerradaPor?: string
}): Promise<void> {
  const { data, error } = await supabase
    .from('ordenes_trabajo').select('*, ot_repuestos(*)').eq('id', input.otId).single()
  if (error || !data) throw new Error(error?.message || 'No se encontró la orden')
  const ot = mapOt(data as Record<string, unknown>)
  if (ot.estado === 'CERRADA') throw new Error('Esta orden ya está cerrada')
  if (ot.estado === 'ANULADA') throw new Error('Esta orden está anulada')

  for (const r of ot.repuestos) {
    if (r.descargado || !r.bodegaId || r.cantidad <= 0) continue
    await registrarMovimientoInsumo({
      insumoId: r.insumoId,
      tipo: 'SALIDA',
      cantidad: r.cantidad,
      motivo: `OT #${ot.consecutivo} · ${ot.tipo === 'PREVENTIVO' ? 'Preventivo' : 'Correctivo'}`,
      referencia: ot.id,
      creadoPor: input.cerradaPor,
      equipoCodigo: ot.equipoCodigo,
      bodegaId: r.bodegaId,
    })
    await supabase.from('ot_repuestos').update({ descargado: true }).eq('id', r.id!)
  }

  const arranque = input.arranqueEn ?? new Date().toISOString()
  const { error: e2 } = await supabase.from('ordenes_trabajo').update({
    estado: 'CERRADA',
    trabajo_realizado: input.trabajoRealizado?.trim() || ot.trabajoRealizado || null,
    arranque_en: ot.arranqueEn ?? arranque,
    horometro: input.horometro ?? ot.horometro ?? null,
    cerrada_en: new Date().toISOString(),
    cerrada_por: input.cerradaPor ?? null,
    updated_at: new Date().toISOString(),
  }).eq('id', input.otId)
  if (e2) throw new Error(e2.message || 'No se pudo cerrar la orden')

  // Un preventivo cerrado reinicia el contador de su plan.
  if (ot.planId && (input.horometro ?? ot.horometro)) {
    await supabase.from('mtto_planes').update({
      ultima_horas: input.horometro ?? ot.horometro,
      ultima_fecha: new Date().toISOString().slice(0, 10),
      updated_at: new Date().toISOString(),
    }).eq('id', ot.planId)
  }
}

export async function anularOrden(id: string): Promise<void> {
  const { error } = await supabase.from('ordenes_trabajo')
    .update({ estado: 'ANULADA', updated_at: new Date().toISOString() })
    .eq('id', id).neq('estado', 'CERRADA')
  if (error) throw new Error(error.message || 'No se pudo anular')
}

/* ── Costos administrativos ──────────────────────────────────────────────── */

export async function loadEquipoCostos(opts?: { equipoCodigo?: string; desde?: string; hasta?: string }): Promise<EquipoCosto[]> {
  let q = supabase.from('equipo_costos').select('*').order('periodo', { ascending: false })
  if (opts?.equipoCodigo) q = q.eq('equipo_codigo', opts.equipoCodigo)
  if (opts?.desde) q = q.gte('periodo', opts.desde)
  if (opts?.hasta) q = q.lte('periodo', opts.hasta)
  const { data, error } = await q
  if (error || !data) return []
  return (data as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    equipoCodigo: String(r.equipo_codigo),
    concepto: String(r.concepto ?? 'OTRO').toUpperCase() as CostoConcepto,
    periodo: String(r.periodo ?? ''),
    valor: Number(r.valor ?? 0),
    nota: s(r.nota),
  }))
}

export async function saveEquipoCosto(input: {
  equipoCodigo: string; concepto: CostoConcepto; periodo: string; valor: number; nota?: string; creadoPor?: string
}): Promise<void> {
  const { error } = await supabase.from('equipo_costos').upsert({
    equipo_codigo: input.equipoCodigo.trim().toUpperCase(),
    concepto: input.concepto,
    periodo: input.periodo,
    valor: redondear2(input.valor),
    nota: input.nota?.trim() || null,
    creado_por: input.creadoPor ?? null,
  }, { onConflict: 'equipo_codigo,concepto,periodo' })
  if (error) throw new Error(error.message || 'No se pudo guardar el costo')
}

export async function deleteEquipoCosto(id: string): Promise<void> {
  const { error } = await supabase.from('equipo_costos').delete().eq('id', id)
  if (error) throw new Error(error.message || 'No se pudo borrar el costo')
}

export type { OtRepuesto, Proveedor, Compra, MttoPlan, OrdenTrabajo, EquipoCosto }
