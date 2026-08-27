import { LOCAL_MAESTRO } from '../data/constants'
import { ingenioNombre, slugIngenio } from '../data/ingenios'
import { DESTINO_LABEL } from '../domain/sam'
import type {
  ValorCatalogo,
  ApprovalStatus,
  Assignment,
  AssignmentStatus,
  CreateEquipmentInput,
  CreateAssignmentInput,
  DashboardMetrics,
  Empresa,
  Ingenio,
  Equipment,
  FlotaServicio,
  CreateFlotaServicioInput,
  Bodega,
  BodegaTipo,
  StockBodega,
  Traslado,
  TrasladoItem,
  CombustibleExterno,
  CombustibleDestino,
  CombustibleOrigen,
  CombustibleEstado,
  Vehiculo,
  Insumo,
  InsumoCategoria,
  InsumoKardex,
  EdicionDespacho,
  KardexTipo,
  SolicitudEstado,
  SolicitudInsumo,
  SolicitudItem,
  Labor,
  LaborTipo,
  MapaConfig,
  Motivacion,
  MaestroRow,
  Tercero,
  Zona,
  UpdateAssignmentInput,
  UserProfile,
  Zone,
} from '../domain/sam'
import { db } from '../lib/db'
import { supabase } from '../lib/supabase'
import { comprimirImagen, PERFIL_IMAGEN } from '../lib/imagenLigera'
import { redondear2 } from '../lib/cantidad'

type Source = 'supabase' | 'fallback' | 'cache'

function dayKey(value: string | null | undefined) {
  if (!value) {
    return ''
  }

  return new Date(value).toLocaleDateString('en-CA', {
    timeZone: 'America/Bogota',
  })
}

function normalizeStatus(value: string | null | undefined): AssignmentStatus {
  const normalized = String(value ?? 'PENDIENTE').trim().toUpperCase()

  if (normalized === 'ASIGNADO' || normalized === 'PENDIENTE') return 'PENDIENTE'
  if (
    normalized === 'EN_PROGRESO' ||
    normalized === 'EN PROGRESO' ||
    normalized === 'EN_PROCESO'
  ) {
    return 'EN_PROCESO'
  }
  if (normalized === 'FINALIZADO' || normalized === 'COMPLETADA') {
    return 'COMPLETADA'
  }
  if (normalized === 'CANCELADA') return 'CANCELADA'
  if (normalized === 'PARCIAL') return 'PARCIAL'

  return 'PENDIENTE'
}

function normalizeApproval(value: string | null | undefined): ApprovalStatus {
  const normalized = String(value ?? 'APROBADA').trim().toUpperCase()
  if (normalized === 'PENDIENTE') return 'PENDIENTE'
  if (normalized === 'RECHAZADA') return 'RECHAZADA'
  return 'APROBADA'
}

function normalizeZone(value: string | null | undefined): Zone | null {
  if (value == null) return null
  const normalized = String(value).trim().toUpperCase()
  if (normalized === 'NORTE') return 'NORTE'
  if (normalized === 'SUR') return 'SUR'
  return null
}

// Mapeo legible para los IDs del maestro. Si en el futuro se agregan ingenios
// nuevos, agregarlos aqui asi el modal muestra el nombre formateado en vez
// del id crudo (ej "san_carlos").
// Nombres de ingenio: fuente única en src/data/ingenios (evita divergencias).

// Resuelve el ingenio de una asignacion cruzando con el maestro por
// haciendaCode + suerte. Devuelve el nombre legible si lo encuentra, o null
// si la suerte no esta en el maestro (caso raro pero posible: suerte vieja
// que fue removida o asignacion creada en campo libre con un codigo manual).
export function getIngenioName(
  assignment: { haciendaCode: string; suerte: string },
  maestro: MaestroRow[],
): string | null {
  const row = maestro.find(
    (r) => r.haciendaCode === assignment.haciendaCode && r.suerte === assignment.suerte,
  )
  if (!row) return null
  return ingenioNombre(row.ingenio_id)
}

// Devuelve el ingenio_id crudo (ej 'pichichi') para filtrar por ID; útil cuando
// el selector usa el id como value y necesitamos comparar contra las filas.
export function getAssignmentIngenioId(
  assignment: { haciendaCode: string; suerte: string },
  maestro: MaestroRow[],
): string | null {
  const row = maestro.find(
    (r) => r.haciendaCode === assignment.haciendaCode && r.suerte === assignment.suerte,
  )
  return row ? row.ingenio_id : null
}

function mapAssignment(row: Record<string, unknown>): Assignment {
  const suerteCode = String(row.suerte_codigo ?? '')
  const parts = suerteCode.includes('-') ? suerteCode.split('-') : []
  const haciendaCode = String(row.codigo_hacienda ?? parts[0] ?? '')
  const suerte = String(row.numero_suerte ?? parts[1] ?? '')

  return {
    id: String(row.id),
    createdAt: String(row.created_at ?? ''),
    dateKey: dayKey(String(row.created_at ?? '')),
    haciendaCode,
    haciendaName: String(row.nombre_hacienda ?? ''),
    suerte,
    suerteCode: suerteCode || `${haciendaCode}-${suerte}`,
    labor: String(row.labor_nombre ?? ''),
    area: Number(row.area_asignada ?? 0),
    status: normalizeStatus(String(row.estado ?? 'PENDIENTE')),
    operatorId: String(row.operador_id ?? ''),
    operatorName: String(row.operador_nombre ?? ''),
    supervisorId: String(row.supervisor_id ?? ''),
    equipmentCode: String(row.equipo_codigo ?? row.tractor ?? ''),
    equipmentName: String(row.equipo_nombre ?? row.tractor ?? ''),
    startedAt: row.fecha_inicio ? String(row.fecha_inicio) : null,
    finishedAt: row.fecha_fin ? String(row.fecha_fin) : null,
    executedArea: Number(row.area_realizada ?? 0),
    notes: String(row.observaciones ?? ''),
    cliente: (row.cliente as 'ingenios' | 'proveedores') || undefined,
    kind: String(row.tipo_registro ?? 'ASIGNADA'),
    horometroInicial: row.horometro_inicial != null ? Number(row.horometro_inicial) : null,
    horometroFinal: row.horometro_final != null ? Number(row.horometro_final) : null,
    approval: normalizeApproval(row.aprobacion as string | null | undefined),
    approvedBy: row.aprobada_por ? String(row.aprobada_por) : null,
    approvedAt: row.aprobada_en ? String(row.aprobada_en) : null,
    zone: normalizeZone(row.zona as string | null | undefined),
    liberada: Boolean(row.liberada ?? false),
    updatedAt: row.updated_at ? String(row.updated_at) : undefined,
    editadoPor: row.editado_por ? String(row.editado_por) : undefined,
    facturaNumero: row.factura_numero ? String(row.factura_numero) : null,
  }
}

// Columnas que mapAssignment realmente usa. Los sync (delta y full) las piden
// explícitas en vez de `select('*')`: recorta ~30-50% del payload más gordo de
// la app (observaciones largas y columnas no mapeadas viajaban gratis).
// ⚠️ Solo columnas YA MIGRADAS en producción — agregar aquí una columna que no
// exista en la BD rompe TODO el sync (lección factura_numero/42703).
const ASSIGNMENT_COLS =
  'id,created_at,updated_at,suerte_codigo,codigo_hacienda,numero_suerte,nombre_hacienda,labor_nombre,area_asignada,estado,operador_id,operador_nombre,supervisor_id,equipo_codigo,equipo_nombre,tractor,fecha_inicio,fecha_fin,area_realizada,observaciones,cliente,tipo_registro,horometro_inicial,horometro_final,aprobacion,aprobada_por,aprobada_en,zona,liberada,editado_por,factura_numero'

function mapAssignmentPayload(input: CreateAssignmentInput) {
  return {
    suerte_codigo: `${input.haciendaCode}-${input.suerte}`,
    numero_suerte: input.suerte,
    codigo_hacienda: input.haciendaCode,
    nombre_hacienda: input.haciendaName,
    labor_nombre: input.labor,
    tractor: input.equipmentName || input.equipmentCode,
    equipo_codigo: input.equipmentCode,
    equipo_nombre: input.equipmentName || input.equipmentCode,
    area_asignada: input.area,
    estado: input.initialStatus,
    fecha_inicio: input.startedAt ?? null,
    fecha_fin: null,
    area_realizada: null,
    tipo_area: 'NETA',
    observaciones: input.notes,
    supervisor_id: input.supervisorId,
    supervisor_nombre: input.supervisorName,
    operador_id: input.operatorId,
    operador_nombre: input.operatorName,
    tipo_registro: input.kind,
    cliente: input.cliente,
    aprobacion: input.approval ?? 'APROBADA',
    zona: input.zone ?? null,
  }
}

// Version barata del maestro: count + max(updated_at). Se compara con la
// version cacheada localmente para evitar la descarga completa de ~15K filas
// cuando el maestro no cambia (caso comun). Si la BD no tiene updated_at,
// devuelve null y el caller hace fetch completo como fallback.
async function getMaestroVersion(): Promise<string | null> {
  try {
    const [countRes, latestRes] = await Promise.all([
      supabase
        .from('maestro_risaralda')
        .select('*', { count: 'exact', head: true })
        .eq('activo', true),
      supabase
        .from('maestro_risaralda')
        .select('updated_at')
        .eq('activo', true)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])
    if (countRes.error || latestRes.error) return null
    const count = countRes.count ?? 0
    const latest = (latestRes.data as { updated_at?: string } | null)?.updated_at ?? ''
    return `${count}-${latest}`
  } catch {
    return null
  }
}

export async function loadMaestro(): Promise<{
  data: MaestroRow[]
  source: Source
}> {
  const cached = await db.maestro.toArray()
  const localVersion = (await db.meta.get('maestro_version'))?.value

  try {
    // Chequeo de version barato (~2 queries chicas, <100ms). Si la version no
    // cambio respecto a lo cacheado y tenemos cache, NO bajamos el maestro
    // completo. Se devuelve el cache de Dexie tal cual.
    const serverVersion = await getMaestroVersion()
    if (serverVersion && serverVersion === localVersion && cached.length > 0) {
      return { data: cached, source: 'cache' }
    }

    let allData: any[] = []
    let hasMore = true
    // Server-side max-rows en PostgREST capa el response. Si el VPS tiene
    // PGRST_DB_MAX_ROWS en 20000+, todo el maestro entra en una request.
    // ⚠️ LANDMINE corregida: antes `data.length < 20000` se tomaba como "fin",
    // pero si el server capa a 1000 devuelve 1000 (<20000) y el maestro quedaba
    // TRUNCADO en silencio a 1000 de ~15K filas. Ahora el offset avanza por lo
    // realmente recibido y solo se asume fin cuando la página no es múltiplo de
    // 1000 (ningún cap de PostgREST opera por debajo de 1000 aquí); si es
    // múltiplo exacto, se pide otra página (a lo sumo 1 request extra vacía).
    const REQUEST = 20000

    while (hasMore) {
      const { data, error } = await supabase
        .from('maestro_risaralda')
        .select('hacienda,nombre_hacienda,suerte,area_neta,ingenio_id,creado_manual,creado_por')
        .eq('activo', true)
        .order('hacienda')
        .order('suerte')
        .range(allData.length, allData.length + REQUEST - 1)

      if (error) throw error

      if (data && data.length > 0) {
        allData = allData.concat(data)
        hasMore = data.length % 1000 === 0
      } else {
        hasMore = false
      }
    }

    if (!allData.length) throw new Error('empty')

    const mapped: MaestroRow[] = allData
      .filter((row) => row.hacienda != null && row.suerte != null && row.suerte !== '')
      .map((row) => ({
        haciendaCode: String(row.hacienda),
        haciendaName: row.nombre_hacienda,
        suerte: row.suerte,
        area: Number(row.area_neta),
        ingenio_id: String(row.ingenio_id ?? 'risaralda'),
        creadoManual: row.creado_manual === true,
        creadoPor: row.creado_por ?? undefined,
      }))

    void (async () => {
      try {
        await db.maestro.clear()
        await db.maestro.bulkPut(mapped)
        if (serverVersion) {
          await db.meta.put({ key: 'maestro_version', value: serverVersion })
        }
      } catch {
        // ignore write errors
      }
    })()

    return { data: mapped, source: 'supabase' }
  } catch {
    if (cached.length) return { data: cached, source: 'fallback' }
    return { data: LOCAL_MAESTRO, source: 'fallback' }
  }
}

/**
 * Crea una suerte ad-hoc en el maestro. Se usa cuando el supervisor u
 * operario llega a una suerte que aun no esta en el catalogo oficial
 * del ingenio. Marca la fila con creado_manual=true para auditoria.
 *
 * Errores manejados:
 *   - 23505 (unique_violation): la combinacion hacienda+suerte+ingenio_id
 *     ya existe. El llamador debe mostrar "esa suerte ya existe,
 *     seleccionala del listado".
 *   - otros: re-lanza para que la UI muestre mensaje generico.
 */
export async function createMaestroRow(
  input: import('../domain/sam').CreateMaestroRowInput,
): Promise<MaestroRow> {
  const payload = {
    hacienda: input.haciendaCode,
    nombre_hacienda: input.haciendaName,
    suerte: input.suerte,
    area_neta: input.area,
    ingenio_id: input.ingenio_id,
    activo: true,
    creado_manual: true,
    creado_por: input.createdBy,
    creado_en: new Date().toISOString(),
  }

  const { data, error } = await supabase
    .from('maestro_risaralda')
    .insert(payload)
    .select('hacienda,nombre_hacienda,suerte,area_neta,ingenio_id,creado_manual,creado_por')
    .single()

  if (error) {
    // Codigo PostgREST/Postgres 23505: violacion de unique constraint.
    if ((error as { code?: string }).code === '23505') {
      throw new Error('DUPLICATE')
    }
    throw error
  }
  if (!data) {
    throw new Error('No se pudo crear la suerte.')
  }

  const row: MaestroRow = {
    haciendaCode: String(data.hacienda),
    haciendaName: data.nombre_hacienda,
    suerte: data.suerte,
    area: Number(data.area_neta),
    ingenio_id: String(data.ingenio_id ?? 'risaralda'),
    creadoManual: data.creado_manual === true,
    creadoPor: data.creado_por ?? undefined,
  }

  // Refleja la nueva fila en el cache local de Dexie para que aparezca
  // de inmediato en el dropdown sin esperar al proximo loadMaestro.
  try {
    await db.maestro.put(row)
  } catch {
    /* sin cache no falla — la proxima carga de maestro la traera */
  }

  return row
}

/**
 * Edita una fila del maestro (area_neta y/o nombre de la hacienda) desde la
 * pestana "Maestros". La fila se identifica por su clave unica
 * (hacienda + suerte + ingenio_id). Requiere la policy RLS de UPDATE
 * (migracion 20260601150000) — si falta, PostgREST devuelve un error de RLS.
 */
export async function updateMaestroRow(
  key: { haciendaCode: string; suerte: string; ingenio_id: string },
  changes: { area?: number; haciendaName?: string },
): Promise<MaestroRow> {
  const payload: Record<string, unknown> = {}
  if (changes.area !== undefined) payload.area_neta = changes.area
  if (changes.haciendaName !== undefined) payload.nombre_hacienda = changes.haciendaName

  const { data, error } = await supabase
    .from('maestro_risaralda')
    .update(payload)
    .eq('hacienda', key.haciendaCode)
    .eq('suerte', key.suerte)
    .eq('ingenio_id', key.ingenio_id)
    .select('hacienda,nombre_hacienda,suerte,area_neta,ingenio_id,creado_manual,creado_por')
    .single()

  if (error || !data) {
    throw error ?? new Error('No se pudo actualizar la suerte del maestro.')
  }

  const row: MaestroRow = {
    haciendaCode: String(data.hacienda),
    haciendaName: data.nombre_hacienda,
    suerte: data.suerte,
    area: Number(data.area_neta),
    ingenio_id: String(data.ingenio_id ?? 'risaralda'),
    creadoManual: data.creado_manual === true,
    creadoPor: data.creado_por ?? undefined,
  }

  try {
    await db.maestro.put(row)
  } catch {
    /* sin cache no falla */
  }

  return row
}

/**
 * "Elimina" una suerte del catálogo = la DESACTIVA (`activo = false`).
 * `loadMaestro` solo trae `activo = true`, así que deja de aparecer en el
 * catálogo y en los dropdowns, pero NO rompe el histórico de asignaciones que
 * la referencian (no es un DELETE físico). Reusa la policy RLS de UPDATE
 * (migración 20260601150000) — no necesita policy de DELETE.
 */
export async function deleteMaestroRow(
  key: { haciendaCode: string; suerte: string; ingenio_id: string },
): Promise<void> {
  const { error } = await supabase
    .from('maestro_risaralda')
    .update({ activo: false })
    .eq('hacienda', key.haciendaCode)
    .eq('suerte', key.suerte)
    .eq('ingenio_id', key.ingenio_id)

  if (error) throw error

  // El cache local (Dexie) usa la clave compuesta [haciendaCode+suerte].
  try {
    await db.maestro.delete([key.haciendaCode, key.suerte])
  } catch {
    /* sin cache no falla */
  }
}

/**
 * Cargue masivo de suertes (desde plantilla Excel). Inserta TODAS las filas
 * con `creado_manual=true` (pasa la policy RLS de INSERT). Las que ya existen
 * (mismo `hacienda + suerte + ingenio_id`) se OMITEN gracias a
 * `ignoreDuplicates` (ON CONFLICT DO NOTHING) — no se tocan ni se reflejan
 * como manuales. Devuelve SOLO las filas realmente insertadas.
 */
export async function bulkInsertMaestro(
  rows: { haciendaCode: string; haciendaName: string; suerte: string; area: number; ingenio_id: string }[],
  createdBy: string,
): Promise<MaestroRow[]> {
  if (rows.length === 0) return []
  const now = new Date().toISOString()
  const inserted: MaestroRow[] = []
  const CHUNK = 500
  for (let i = 0; i < rows.length; i += CHUNK) {
    const payload = rows.slice(i, i + CHUNK).map((r) => ({
      hacienda: r.haciendaCode,
      nombre_hacienda: r.haciendaName,
      suerte: r.suerte,
      area_neta: r.area,
      ingenio_id: r.ingenio_id,
      activo: true,
      creado_manual: true,
      creado_por: createdBy,
      creado_en: now,
    }))
    const { data, error } = await supabase
      .from('maestro_risaralda')
      .upsert(payload, { onConflict: 'hacienda,suerte,ingenio_id', ignoreDuplicates: true })
      .select('hacienda,nombre_hacienda,suerte,area_neta,ingenio_id,creado_manual,creado_por')
    if (error) throw error
    for (const d of (data ?? []) as Record<string, unknown>[]) {
      inserted.push({
        haciendaCode: String(d.hacienda),
        haciendaName: String(d.nombre_hacienda ?? ''),
        suerte: String(d.suerte ?? ''),
        area: Number(d.area_neta),
        ingenio_id: String(d.ingenio_id ?? 'risaralda'),
        creadoManual: d.creado_manual === true,
        creadoPor: d.creado_por ? String(d.creado_por) : undefined,
      })
    }
  }
  try {
    for (const r of inserted) await db.maestro.put(r)
  } catch {
    /* sin cache no falla */
  }
  return inserted
}

/**
 * Actualiza el área neta de varias suertes EXISTENTES (reconciliación del cargue
 * masivo). Clave por (ingenio, hacienda, suerte). Requiere la policy RLS de
 * UPDATE del maestro (mig. 20260601150000). Devuelve cuántas se actualizaron.
 */
export async function bulkUpdateMaestroArea(
  rows: { haciendaCode: string; suerte: string; ingenio_id: string; area: number }[],
): Promise<number> {
  let updated = 0
  const CHUNK = 25
  for (let i = 0; i < rows.length; i += CHUNK) {
    await Promise.all(
      rows.slice(i, i + CHUNK).map(async (r) => {
        const { error } = await supabase
          .from('maestro_risaralda')
          .update({ area_neta: r.area })
          .eq('hacienda', r.haciendaCode)
          .eq('suerte', r.suerte)
          .eq('ingenio_id', r.ingenio_id)
        if (!error) {
          updated++
          try { await db.maestro.update([r.haciendaCode, r.suerte], { area: r.area }) } catch { /* sin cache */ }
        }
      }),
    )
  }
  return updated
}

/**
 * Reactiva (activo=true) + fija el área de suertes que REAPARECEN en el catálogo
 * (estaban soft-deleted). El cargue masivo las detecta como "nuevas" que en
 * realidad chocan con una fila inactiva (bulkInsertMaestro las omite por el
 * ON CONFLICT). Devuelve las filas reactivadas (para sumarlas al estado activo).
 */
export async function bulkReactivateMaestro(
  rows: { haciendaCode: string; haciendaName: string; suerte: string; ingenio_id: string; area: number }[],
): Promise<MaestroRow[]> {
  const out: MaestroRow[] = []
  const CHUNK = 25
  for (let i = 0; i < rows.length; i += CHUNK) {
    await Promise.all(
      rows.slice(i, i + CHUNK).map(async (r) => {
        const { data, error } = await supabase
          .from('maestro_risaralda')
          .update({ activo: true, area_neta: r.area })
          .eq('hacienda', r.haciendaCode)
          .eq('suerte', r.suerte)
          .eq('ingenio_id', r.ingenio_id)
          .select('hacienda,nombre_hacienda,suerte,area_neta,ingenio_id,creado_manual,creado_por')
          .maybeSingle()
        if (!error && data) {
          const row: MaestroRow = {
            haciendaCode: String(data.hacienda),
            haciendaName: String(data.nombre_hacienda ?? r.haciendaName),
            suerte: String(data.suerte),
            area: Number(data.area_neta),
            ingenio_id: String(data.ingenio_id ?? 'risaralda'),
            creadoManual: data.creado_manual === true,
            creadoPor: data.creado_por ? String(data.creado_por) : undefined,
          }
          out.push(row)
          try { await db.maestro.put(row) } catch { /* sin cache */ }
        }
      }),
    )
  }
  return out
}

/**
 * Desactiva (soft-delete, activo=false) suertes que DESAPARECIERON del catálogo
 * nuevo. Agrupa por (ingenio, hacienda) → una query con .in('suerte'). NO borra:
 * conserva el histórico de labores. Devuelve cuántas se desactivaron.
 */
export async function bulkDeactivateMaestro(
  keys: { haciendaCode: string; suerte: string; ingenio_id: string }[],
): Promise<number> {
  if (keys.length === 0) return 0
  const groups = new Map<string, { ingenio_id: string; haciendaCode: string; suertes: string[] }>()
  for (const k of keys) {
    const gk = `${k.ingenio_id}|${k.haciendaCode}`
    const g = groups.get(gk) ?? { ingenio_id: k.ingenio_id, haciendaCode: k.haciendaCode, suertes: [] }
    g.suertes.push(k.suerte)
    groups.set(gk, g)
  }
  let deactivated = 0
  const CHUNK = 200
  for (const g of groups.values()) {
    for (let i = 0; i < g.suertes.length; i += CHUNK) {
      const slice = g.suertes.slice(i, i + CHUNK)
      const { error } = await supabase
        .from('maestro_risaralda')
        .update({ activo: false })
        .eq('ingenio_id', g.ingenio_id)
        .eq('hacienda', g.haciendaCode)
        .in('suerte', slice)
      if (!error) {
        deactivated += slice.length
        for (const s of slice) {
          try { await db.maestro.delete([g.haciendaCode, s]) } catch { /* sin cache */ }
        }
      }
    }
  }
  return deactivated
}

// IDs de asignaciones con un cambio local pendiente de enviar (outbox
// status='pending', type='UPDATE'). Los usamos en loadAssignments para NO
// sobrescribir esas filas con la version del servidor: si lo hicieramos,
// el cambio offline desapareceria visualmente en el siguiente sync hasta
// que syncOutbox lo envie y vuelva a traerlo. Aunque eventualmente convergen,
// el "parpadeo" confunde al operador. Esta proteccion lo elimina.
async function getPendingOutboxIds(): Promise<Set<string>> {
  // Incluye 'error' además de 'pending': una edición que falló al sincronizar
  // sigue siendo un cambio local no confirmado; si no la protegiéramos, el
  // siguiente delta la pisaría con la versión vieja del servidor y el cambio
  // desaparecería sin rastro (se reintenta en cada syncOutbox).
  const pending = await db.outbox.where('status').anyOf(['pending', 'error']).toArray()
  const ids = new Set<string>()
  for (const item of pending) {
    if (item.type === 'UPDATE' && item.assignmentId) {
      ids.add(item.assignmentId)
    }
  }
  return ids
}

export async function loadAssignments(): Promise<{
  data: Assignment[]
  source: Source
  error: string | null
}> {
  const cached = await db.assignments.toArray()
  const lastSync = (await db.meta.get('assignments_last_sync'))?.value
  const now = new Date().toISOString()

  try {
    // Delta sync: si tenemos cache + ultimo sync, solo descargamos las
    // asignaciones creadas o actualizadas desde la ultima sincronizacion.
    // En el caso comun (nada nuevo) la respuesta es []. En el caso normal
    // (1-5 cambios) son unos pocos KB en vez de toda la tabla.
    //
    // Usamos un buffer de 10 segundos retroactivo (gte en vez de gt sobre
    // lastSync - 10s) para protegernos de: (a) precision de timestamp en
    // Postgres vs JS, (b) skew de reloj entre cliente y servidor, (c)
    // latencia entre el UPDATE y la lectura. Costa pocos rows duplicados
    // en cada delta (bulkPut es idempotente sobre primary key).
    if (lastSync && cached.length > 0) {
      const sinceTime = new Date(new Date(lastSync).getTime() - 10000).toISOString()
      const { data, error } = await supabase
        .from('asignaciones')
        .select(ASSIGNMENT_COLS)
        .or(`updated_at.gte.${sinceTime},created_at.gte.${sinceTime}`)
        .order('created_at', { ascending: false })

      if (error) throw error

      const rawDelta = data ?? []
      // Si el delta llega al tope de PostgREST (~1000 filas), pudo dejar cambios
      // FUERA de la ventana → no es confiable. Caemos al full sync (que sí tiene
      // el anti-cap open+recent). Solo confiamos en el delta si vino corto.
      if (rawDelta.length < 1000) {
        const deltas = rawDelta.map((row) => mapAssignment(row as Record<string, unknown>))
        // No sobrescribir filas con cambios locales pendientes en outbox: la
        // version del servidor todavia no incluye esos cambios (estan en cola
        // de envio), asi que aplicarla "borra" temporalmente el cambio del
        // operador hasta que syncOutbox lo reenvie. Filtramos esas filas y
        // dejamos que la version local sobreviva en db.assignments.
        const pendingIds = await getPendingOutboxIds()
        const safeDeltas =
          pendingIds.size > 0 ? deltas.filter((d) => !pendingIds.has(d.id)) : deltas
        if (safeDeltas.length > 0) {
          await db.assignments.bulkPut(safeDeltas)
        }
        const all = await db.assignments.toArray()
        all.sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1))
        void db.meta.put({ key: 'assignments_last_sync', value: now })
        return { data: all, source: 'supabase', error: null }
      }
      // rawDelta.length >= 1000 → posible cap; continúa al full sync abajo.
    }

    // Sync completo (primera carga o cache vacio).
    // PostgREST capa el response (~1000 filas). Ordenando por created_at, las
    // asignaciones VIEJAS se salen de la ventana → una programada/abierta de
    // hace tiempo desaparecía de Activas en cada full sync. Para evitarlo,
    // hacemos DOS consultas y las combinamos (dedupe por id):
    //   1) TODAS las ABIERTAS (no cerradas) — sin importar antigüedad.
    //   2) Las recientes — historial (acotado por el cap).
    // Así una abierta nunca se pierde hasta que se cierre (COMPLETADA) o cancele.
    const [openRes, recentRes] = await Promise.all([
      supabase.from('asignaciones').select(ASSIGNMENT_COLS).not('estado', 'in', '(COMPLETADA,CANCELADA,FINALIZADO)'),
      supabase.from('asignaciones').select(ASSIGNMENT_COLS).order('created_at', { ascending: false }),
    ])
    const error = openRes.error ?? recentRes.error
    const rawRows = [...(openRes.data ?? []), ...(recentRes.data ?? [])]
    if (error || rawRows.length === 0) throw error ?? new Error('empty')

    const byId = new Map<string, Record<string, unknown>>()
    for (const r of rawRows) byId.set(String((r as Record<string, unknown>).id), r as Record<string, unknown>)
    const mapped = Array.from(byId.values()).map((row) => mapAssignment(row))

    // Antes de clear()+bulkPut(), rescatamos las filas locales con cambios
    // pendientes en outbox. Sin esto, un full sync (ej. al login o al forzar
    // sync desde Diagnostico) destruiria el cambio offline del operador
    // hasta que syncOutbox lo reenvie. Las re-aplicamos despues del bulkPut
    // para que sobrevivan en el cache y en el return de esta funcion.
    const pendingIds = await getPendingOutboxIds()
    const localPendingRows =
      pendingIds.size > 0
        ? await db.assignments.where('id').anyOf([...pendingIds]).toArray()
        : []

    // Persistimos el cache ANTES de retornar. Antes esto era fire-and-forget
    // para no bloquear la UI, pero introducia una race: cualquier lector que
    // consultara Dexie inmediatamente despues (ej. la pantalla de diagnostico
    // tras "Forzar sync") leia el cache aun vacio y se mostraba "0 totales,
    // ultima sync: nunca" pese a que el fetch habia traido cientos de filas.
    // El await agrega ~50-100ms para tablas de 200 filas, irrelevante para
    // la UX porque el caller ya tiene los datos del state mientras espera.
    try {
      await db.assignments.clear()
      await db.assignments.bulkPut(mapped)
      // Re-aplica las filas con cambios locales pendientes ENCIMA del fetch
      // del servidor. bulkPut sobre el mismo PK (id) sobreescribe.
      if (localPendingRows.length > 0) {
        await db.assignments.bulkPut(localPendingRows)
      }
      await db.meta.put({ key: 'assignments_last_sync', value: now })
    } catch {
      // No bloqueamos el retorno por fallos de escritura local: el caller
      // igual recibe los datos. La proxima sincronizacion intentara escribir
      // de nuevo.
    }

    // Para el state de React, devolver tambien la version local pendiente
    // en vez de la del servidor, asi la UI no parpadea.
    const localById = new Map(localPendingRows.map((r) => [r.id, r]))
    const finalData = mapped.map((row) => localById.get(row.id) ?? row)
    return { data: finalData, source: 'supabase', error: null }
  } catch (err) {
    // El fetch a Supabase fallo. Devolvemos lo que tengamos en cache y
    // exponemos el error para que la UI muestre un banner. Si el caller
    // esta online y el cache esta vacio, "data: []" se confunde con "no
    // hay asignaciones" — el `error` permite distinguir esos casos.
    cached.sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1))
    const message =
      err instanceof Error
        ? err.message
        : typeof err === 'object' && err !== null && 'message' in err
          ? String((err as { message: unknown }).message)
          : 'No pudimos conectarnos al servidor'
    return { data: cached, source: 'fallback', error: message }
  }
}

// Mapeo ÚNICO rol DB → app. Antes estaba copiado en loadAppUsers y appLogin y
// derivó: appLogin omitía `supervisor_insumos` → ese usuario entraba degradado
// a operador. Fuente única para evitar que vuelva a divergir.
export function mapRole(rol: unknown): UserProfile['role'] {
  const r = String(rol ?? '')
  if (r === 'supervisor' || r === 'owner' || r === 'administracion' || r === 'soporte' || r === 'supervisor_insumos' || r === 'conductor' || r === 'analista_insumos' || r === 'taller' || r === 'conductor_madera') {
    return r
  }
  return 'operador'
}

export async function loadAppUsers(): Promise<{
  data: UserProfile[]
  source: Source
}> {
  // Carga TODOS los usuarios (activos e inactivos). La gestión de Usuarios los
  // lista con su estado; los selectores/asignación filtran activos aparte.
  // (Rebuild marker 2026-06-23: sin filtro .eq('activo', true).)
  try {
    const { data, error } = await supabase
      .from('app_usuarios')
      .select('id,nombre_completo,rol,equipo_codigo,foto_url,zona,activo')
      .order('orden')

    if (error || !data) throw error ?? new Error('empty')

    const mapped: UserProfile[] = data.map((row) => ({
      id: String(row.id),
      name: String(row.nombre_completo),
      role: mapRole(row.rol),
      equipmentCode: String(row.equipo_codigo ?? ''),
      photoUrl: row.foto_url ? String(row.foto_url) : undefined,
      zona: row.zona ? String(row.zona) : undefined,
      active: row.activo == null ? true : Boolean(row.activo),
    }))
    void db.users.clear().then(() => db.users.bulkPut(mapped))
    return { data: mapped, source: 'supabase' }
  } catch {
    const cached = await db.users.toArray()
    return { data: cached, source: 'fallback' }
  }
}

/**
 * Todas las maquinas, INCLUIDAS las desactivadas.
 *
 * `loadEquipment` filtra por `activo = true` porque alimenta los selectores de
 * toda la app. Pero la pantalla que las administra necesita ver las apagadas o
 * desactivar seria un viaje sin vuelta: la maquina desaparece de la lista y ya
 * no hay desde donde volver a prenderla.
 */
export async function loadEquipmentTodos(): Promise<Array<Equipment & { active: boolean }>> {
  const { data, error } = await supabase
    .from('equipos')
    .select('codigo,nombre,marca,modelo,numero_serie,placa,activo')
    .order('codigo')
  if (error || !data) return []
  return (data as Record<string, unknown>[]).map((row) => ({
    code: String(row.codigo),
    name: String(row.nombre),
    brand: row.marca ? String(row.marca) : undefined,
    model: row.modelo ? String(row.modelo) : undefined,
    serial: row.numero_serie ? String(row.numero_serie) : undefined,
    plate: row.placa ? String(row.placa) : undefined,
    active: row.activo !== false,
  }))
}

export async function loadEquipment(): Promise<{
  data: Equipment[]
  source: Source
}> {
  try {
    const { data, error } = await supabase
      .from('equipos')
      .select('codigo,nombre,marca,modelo,numero_serie,placa,tipo')
      .eq('activo', true)
      .order('codigo')

    if (error || !data) throw error ?? new Error('empty')

    const mapped: Equipment[] = data.map((row) => ({
      code: String(row.codigo),
      name: String(row.nombre),
      brand: row.marca ? String(row.marca) : undefined,
      model: row.modelo ? String(row.modelo) : undefined,
      serial: row.numero_serie ? String(row.numero_serie) : undefined,
      plate: row.placa ? String(row.placa) : undefined,
      type: row.tipo ? (String(row.tipo) as Equipment['type']) : undefined,
    }))
    void db.equipment.clear().then(() => db.equipment.bulkPut(mapped))
    return { data: mapped, source: 'supabase' }
  } catch {
    const cached = await db.equipment.toArray()
    return { data: cached, source: 'fallback' }
  }
}

/**
 * Equipos CON su estado (activo / en_mantenimiento / inactivo), para el
 * dashboard del dueño. `loadEquipment` solo trae los activos y sin estado
 * porque alimenta los selectores; aquí necesitamos el parque completo.
 */
export interface EquipoEstado {
  code: string
  name: string
  tipo?: string
  estado: 'activo' | 'en_mantenimiento' | 'inactivo'
  activo: boolean
}

export async function loadEquiposEstado(): Promise<EquipoEstado[]> {
  const { data, error } = await supabase.from('equipos').select('*').order('codigo')
  if (error || !data) return []
  return (data as Record<string, unknown>[]).map((r) => {
    const e = String(r.estado ?? 'activo').toLowerCase()
    return {
      code: String(r.codigo ?? ''),
      name: String(r.nombre ?? ''),
      tipo: r.tipo ? String(r.tipo) : undefined,
      estado: e === 'en_mantenimiento' ? 'en_mantenimiento' : e === 'inactivo' ? 'inactivo' : 'activo',
      activo: r.activo == null ? true : Boolean(r.activo),
    }
  })
}

export async function createEquipment(input: CreateEquipmentInput) {
  const payload: Record<string, unknown> = {
    codigo: input.code,
    nombre: input.name,
    tipo: input.type,
    estado: input.state,
    marca: input.brand || null,
    modelo: input.model || null,
    ['a\u00f1o']: input.year,
    placa: input.plate || null,
    numero_serie: input.serialNumber || null,
    observaciones: input.notes || null,
    activo: input.active,
  }

  const { data, error } = await supabase
    .from('equipos')
    .insert(payload)
    .select('codigo,nombre')
    .single()

  if (error || !data) {
    throw error ?? new Error('No se pudo crear el equipo')
  }

  return {
    code: String(data.codigo),
    name: String(data.nombre),
  } as Equipment
}

/**
 * La ficha completa de UNA maquina, para editarla.
 *
 * `loadEquipment` solo trae codigo, nombre, marca, modelo, serie y placa porque
 * alimenta selectores en toda la app y se carga en cada arranque. La ficha
 * entera se pide solo cuando alguien abre a editar.
 */
/**
 * Corrige los galones de un tanqueo mal registrado.
 *
 * Va por RPC y no por varios `update` seguidos porque cambiar la cantidad obliga
 * a rehacer el `saldo` de todos los movimientos posteriores de esa bodega — el
 * saldo es una foto del stock en ese instante, no una formula. Si eso se corta a
 * la mitad, el kardex queda peor que antes. La funcion lo hace todo o nada.
 *
 * NO avala: el tanqueo corregido sigue PENDIENTE del segundo par de ojos.
 */
export async function corregirTanqueo(input: {
  id: string
  galones: number
  motivo: string
  editadoPor: string
}): Promise<{ antes: number; despues: number; filas: number }> {
  const { data, error } = await supabase.rpc('corregir_tanqueo', {
    p_id: input.id,
    p_galones: input.galones,
    p_motivo: input.motivo,
    p_editado_por: input.editadoPor,
  })
  if (error) throw new Error(error.message || 'No se pudo corregir el tanqueo')
  const r = (data ?? {}) as Record<string, unknown>
  return {
    antes: Number(r.antes ?? 0),
    despues: Number(r.despues ?? input.galones),
    filas: Number(r.filas_recalculadas ?? 0),
  }
}

export async function loadEquipoDetalle(codigo: string): Promise<CreateEquipmentInput | null> {
  const { data, error } = await supabase
    .from('equipos').select('*').eq('codigo', codigo).maybeSingle()
  if (error || !data) return null
  const row = data as Record<string, unknown>
  const txt = (k: string) => (row[k] == null ? '' : String(row[k]))
  return {
    code: txt('codigo'),
    name: txt('nombre'),
    type: (txt('tipo') || 'tractor') as CreateEquipmentInput['type'],
    state: (txt('estado') || 'activo') as CreateEquipmentInput['state'],
    brand: txt('marca'),
    model: txt('modelo'),
    year: row['año'] == null ? null : Number(row['año']),
    plate: txt('placa'),
    serialNumber: txt('numero_serie'),
    notes: txt('observaciones'),
    active: row['activo'] !== false,
  }
}

/**
 * Actualiza la ficha. El CODIGO no se toca: es la llave con la que la nombran
 * `asignaciones`, `insumos_kardex`, `equipo_metas` y `equipo_horas_mes`, y
 * ninguna de esas es una FK con cascada de actualizacion. Cambiarlo dejaria todo
 * el historial apuntando a una maquina que ya no existe, sin avisar.
 */
export async function updateEquipment(codigo: string, input: CreateEquipmentInput): Promise<void> {
  const payload: Record<string, unknown> = {
    nombre: input.name,
    tipo: input.type,
    estado: input.state,
    marca: input.brand || null,
    modelo: input.model || null,
    ['año']: input.year,
    placa: input.plate || null,
    numero_serie: input.serialNumber || null,
    observaciones: input.notes || null,
    activo: input.active,
    updated_at: new Date().toISOString(),
  }
  const { error } = await supabase.from('equipos').update(payload).eq('codigo', codigo)
  if (error) throw new Error(error.message || 'No se pudo actualizar la maquina')
}

/** Prende o apaga la maquina. Apagada deja de ofrecerse en los selectores. */
export async function setEquipmentActivo(codigo: string, activo: boolean): Promise<void> {
  const { error } = await supabase.from('equipos')
    .update({ activo, updated_at: new Date().toISOString() }).eq('codigo', codigo)
  if (error) throw new Error(error.message || 'No se pudo cambiar el estado')
}

/** Cuanto historial cuelga de una maquina: decide si se puede borrar o solo apagar. */
export async function contarUsoEquipo(codigo: string): Promise<{
  asignaciones: number; kardex: number; horas: number; combustible: number; total: number
}> {
  const cuenta = async (tabla: string) => {
    const { count } = await supabase.from(tabla)
      .select('*', { count: 'exact', head: true }).eq('equipo_codigo', codigo)
    return count ?? 0
  }
  const [asignaciones, kardex, horas, combustible] = await Promise.all([
    cuenta('asignaciones'), cuenta('insumos_kardex'),
    cuenta('equipo_horas_mes'), cuenta('combustible_externo'),
  ])
  return {
    asignaciones, kardex, horas, combustible,
    total: asignaciones + kardex + horas + combustible,
  }
}

/**
 * Borra la maquina DE VERDAD, y solo si nunca se uso.
 *
 * No es paranoia: `equipo_metas` (la referencia 2025) y `equipo_horas_mes` (el
 * cierre mensual de horometros) cuelgan con ON DELETE CASCADE, asi que borrar
 * una maquina con historial se lleva por delante justo los datos que mas
 * costaron. Y `asignaciones` la nombra SIN FK: quedarian labores apuntando a un
 * codigo que ya no existe, sin que nada avise.
 *
 * Por eso lo normal es DESACTIVAR. Borrar es para la maquina que se creo con un
 * dedazo hace cinco minutos.
 */
export async function deleteEquipment(codigo: string): Promise<void> {
  const uso = await contarUsoEquipo(codigo)
  if (uso.total > 0) {
    throw new Error(
      `Esta maquina ya tiene historial (${uso.asignaciones} labores, ${uso.kardex} movimientos de inventario). `
      + 'No se puede borrar sin perderlo: desactivala en vez de borrarla.',
    )
  }
  const { error } = await supabase.from('equipos').delete().eq('codigo', codigo)
  if (error) throw new Error(error.message || 'No se pudo eliminar la maquina')
}


// ───────────────────────── Catálogo de labores (CRUD) ─────────────────────────
// La tabla `labores` la crea la migración 20260615_labores_catalogo. El cliente
// usa el anon_key. Las inactivas (activa=false) dejan de ofrecerse en pickers.

function mapLabor(row: Record<string, unknown>): Labor {
  const tipo = String(row.tipo ?? 'MECANIZADA').trim().toUpperCase()
  return {
    id: String(row.id),
    nombre: String(row.nombre ?? ''),
    activa: row.activa == null ? true : Boolean(row.activa),
    tipo: tipo === 'MANUAL' ? 'MANUAL' : 'MECANIZADA',
    metaHaDia: row.meta_ha_dia == null ? null : Number(row.meta_ha_dia),
    unidad: String(row.unidad ?? 'ha').toLowerCase() === 'hm' ? 'hm' : 'ha',
  }
}

export async function loadLabores(): Promise<{ data: Labor[]; source: Source }> {
  try {
    // `*` para no romper si la columna meta_ha_dia aún no está migrada.
    const { data, error } = await supabase
      .from('labores_catalogo')
      .select('*')
      .order('nombre')

    if (error || !data) throw error ?? new Error('empty')

    const mapped = data.map(mapLabor)
    void db.labores.clear().then(() => db.labores.bulkPut(mapped))
    return { data: mapped, source: 'supabase' }
  } catch {
    const cached = await db.labores.toArray()
    return { data: cached, source: 'fallback' }
  }
}

export async function createLabor(
  nombre: string,
  tipo: LaborTipo = 'MECANIZADA',
): Promise<Labor> {
  const { data, error } = await supabase
    .from('labores_catalogo')
    .insert({ nombre: nombre.trim().toUpperCase(), tipo })
    .select('*')
    .single()

  if (error || !data) throw error ?? new Error('No se pudo crear la labor')
  const labor = mapLabor(data)
  void db.labores.put(labor)
  return labor
}

export async function updateLabor(
  id: string,
  patch: { nombre?: string; activa?: boolean; tipo?: LaborTipo; metaHaDia?: number | null },
): Promise<Labor> {
  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (patch.nombre !== undefined) payload.nombre = patch.nombre.trim().toUpperCase()
  if (patch.activa !== undefined) payload.activa = patch.activa
  if (patch.tipo !== undefined) payload.tipo = patch.tipo
  if (patch.metaHaDia !== undefined) payload.meta_ha_dia = patch.metaHaDia

  const { data, error } = await supabase
    .from('labores_catalogo')
    .update(payload)
    .eq('id', id)
    .select('*')
    .single()

  if (error || !data) throw error ?? new Error('No se pudo actualizar la labor')
  const labor = mapLabor(data)
  void db.labores.put(labor)
  return labor
}

export async function deleteLabor(id: string): Promise<void> {
  const { error } = await supabase.from('labores_catalogo').delete().eq('id', id)
  if (error) throw new Error(error.message || 'No se pudo eliminar la labor')
  void db.labores.delete(id)
}

// ───────────── Mapas offline (migración 20260717120000) ─────────────
// Config de mapas para el visor tipo Avenza. Se carga ON-DEMAND al abrir el
// visor (nunca en el arranque). Los tiles viven en el bucket público de
// FieldMaps; ASM no genera ni sirve tiles.
export async function loadMapas(): Promise<MapaConfig[]> {
  const { data, error } = await supabase
    .from('mapas')
    .select('*')
    // El orden lo manda el jefe; el nombre solo desempata y ubica a los que
    // todavia no tienen posicion (van de ultimos, no de primeros).
    .eq('activo', true)
    .order('orden', { ascending: true, nullsFirst: false })
    .order('nombre')
  if (error || !data) return []
  return (data as Record<string, unknown>[]).map((row) => {
    const b = Array.isArray(row.bounds) ? (row.bounds as number[]) : [0, 0, 0, 0]
    return {
      id: String(row.id),
      nombre: String(row.nombre ?? ''),
      tilesBase: String(row.tiles_base ?? '').replace(/\/$/, ''),
      bounds: [Number(b[0]), Number(b[1]), Number(b[2]), Number(b[3])] as [number, number, number, number],
      minzoom: Number(row.minzoom ?? 10),
      maxzoom: Number(row.maxzoom ?? 16),
      activo: row.activo == null ? true : Boolean(row.activo),
      orden: row.orden == null ? null : Number(row.orden),
    }
  })
}

export async function createMapa(input: {
  nombre: string
  tilesBase: string
  bounds: [number, number, number, number]
  minzoom: number
  maxzoom: number
}): Promise<MapaConfig> {
  const { data, error } = await supabase
    .from('mapas')
    .insert({
      nombre: input.nombre.trim(),
      tiles_base: input.tilesBase.trim().replace(/\/$/, ''),
      bounds: input.bounds,
      minzoom: input.minzoom,
      maxzoom: input.maxzoom,
    })
    .select('*')
    .single()
  if (error) {
    if (error.code === '23505') throw new Error('Ya existe un mapa con esa URL de tiles.')
    throw new Error(error.message || 'No se pudo crear el mapa')
  }
  const b = Array.isArray(data.bounds) ? (data.bounds as number[]) : input.bounds
  return {
    id: String(data.id), nombre: String(data.nombre), tilesBase: String(data.tiles_base),
    bounds: [Number(b[0]), Number(b[1]), Number(b[2]), Number(b[3])],
    minzoom: Number(data.minzoom), maxzoom: Number(data.maxzoom), activo: Boolean(data.activo ?? true),
    // Un mapa recien creado no tiene posicion: se va al final hasta que el jefe
    // lo ubique. Nace en null a proposito, no en un numero inventado.
    orden: data.orden == null ? null : Number(data.orden),
  }
}

// Actualiza un mapa. Permite REEMPLAZAR la cartografía (tiles_base/bounds/zooms)
// cuando sale una versión nueva del plano: el mapa conserva su identidad (id y
// nombre) y los visores detectan el cambio de URL para pedir re-descarga offline.
export async function updateMapa(
  id: string,
  patch: {
    nombre?: string
    activo?: boolean
    tilesBase?: string
    bounds?: [number, number, number, number]
    minzoom?: number
    maxzoom?: number
  },
): Promise<void> {
  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (patch.nombre !== undefined) payload.nombre = patch.nombre.trim()
  if (patch.activo !== undefined) payload.activo = patch.activo
  if (patch.tilesBase !== undefined) payload.tiles_base = patch.tilesBase.trim().replace(/\/$/, '')
  if (patch.bounds !== undefined) payload.bounds = patch.bounds
  if (patch.minzoom !== undefined) payload.minzoom = patch.minzoom
  if (patch.maxzoom !== undefined) payload.maxzoom = patch.maxzoom
  const { error } = await supabase.from('mapas').update(payload).eq('id', id)
  if (error) {
    if (error.code === '23505') throw new Error('Ya existe otro mapa con esa URL de tiles.')
    throw new Error(error.message || 'No se pudo actualizar el mapa')
  }
}

/**
 * Cartografias que NO deben volver a ofrecerse en "Listos para agregar".
 *
 * Al reemplazar el plano de un mapa, el anterior deja de estar referenciado en
 * `mapas` y la reconciliacion lo ve como recien llegado: lo ofrece otra vez, con
 * su nombre viejo. Ya paso con los dos planos de PICHICHI, que volvieron a
 * agregarse minutos despues de reemplazarlos.
 *
 * Si la tabla no responde se devuelve vacio: quedarse sin esta lista solo hace
 * que se ofrezca un plano de mas, mientras que romper la pantalla deja al jefe
 * sin poder registrar ninguno.
 */
export async function loadCartografiasDescartadas(): Promise<Set<string>> {
  try {
    const { data, error } = await supabase.from('mapas_descartados').select('tiles_base')
    if (error || !data) return new Set()
    return new Set((data as { tiles_base: string }[]).map((r) => String(r.tiles_base).replace(/\/$/, '')))
  } catch { return new Set() }
}

export async function descartarCartografia(
  tilesBase: string, nombre?: string, motivo?: string,
): Promise<void> {
  const { error } = await supabase.from('mapas_descartados')
    .upsert({ tiles_base: tilesBase.trim().replace(/\/$/, ''), nombre: nombre ?? null, motivo: motivo ?? null },
            { onConflict: 'tiles_base' })
  if (error) throw new Error(error.message || 'No se pudo ocultar el plano')
}

export async function deleteMapa(id: string): Promise<void> {
  const { error } = await supabase.from('mapas').delete().eq('id', id)
  if (error) throw new Error(error.message || 'No se pudo eliminar el mapa')
}

// Carga TODOS los mapas (incluidos inactivos) para la pestaña de gestión.
export async function loadMapasAdmin(): Promise<MapaConfig[]> {
  const { data, error } = await supabase.from('mapas').select('*')
    .order('orden', { ascending: true, nullsFirst: false }).order('nombre')
  if (error || !data) return []
  return (data as Record<string, unknown>[]).map((row) => {
    const b = Array.isArray(row.bounds) ? (row.bounds as number[]) : [0, 0, 0, 0]
    return {
      id: String(row.id), nombre: String(row.nombre ?? ''),
      tilesBase: String(row.tiles_base ?? '').replace(/\/$/, ''),
      bounds: [Number(b[0]), Number(b[1]), Number(b[2]), Number(b[3])] as [number, number, number, number],
      minzoom: Number(row.minzoom ?? 10), maxzoom: Number(row.maxzoom ?? 16),
      activo: row.activo == null ? true : Boolean(row.activo),
      orden: row.orden == null ? null : Number(row.orden),
    }
  })
}

/**
 * Guarda el orden de la lista completa: cada mapa queda en `(posicion+1) * 10`.
 *
 * Se renumera TODA la lista y no se intercambian dos valores, porque los mapas
 * recien agregados llegan con `orden` en null y un intercambio entre un numero y
 * un null deja la lista a medio ordenar. Solo se escriben las filas que de
 * verdad cambiaron: son ocho, pero es la diferencia entre un toque y ocho.
 */
export async function guardarOrdenMapas(mapas: MapaConfig[]): Promise<void> {
  const cambios = mapas
    .map((m, i) => ({ id: m.id, orden: (i + 1) * 10, antes: m.orden }))
    .filter((c) => c.orden !== c.antes)
  for (const c of cambios) {
    const { error } = await supabase.from('mapas').update({ orden: c.orden }).eq('id', c.id)
    if (error) throw new Error(error.message || 'No se pudo guardar el orden de los mapas')
  }
}

// ─────────── Motivación / rendimiento (migración 20260712120000) ───────────
const MOTIVACION_DEFAULT: Motivacion = { mensaje: '¡Vas muy bien! Sigue así 💪', imagenUrl: null, umbral: 100, activo: true, metaDiaRef: 15 }

function mapMotivacion(row: Record<string, unknown> | null | undefined): Motivacion {
  if (!row) return MOTIVACION_DEFAULT
  return {
    mensaje: row.mensaje ? String(row.mensaje) : MOTIVACION_DEFAULT.mensaje,
    imagenUrl: row.imagen_url ? String(row.imagen_url) : null,
    umbral: row.umbral == null ? 100 : Number(row.umbral),
    activo: row.activo == null ? true : Boolean(row.activo),
    metaDiaRef: row.meta_dia_ref == null ? 15 : Number(row.meta_dia_ref),
  }
}

export async function loadMotivacion(): Promise<Motivacion> {
  try {
    const { data, error } = await supabase.from('motivacion').select('*').eq('id', 'default').maybeSingle()
    if (error) throw error
    return mapMotivacion(data as Record<string, unknown> | null)
  } catch {
    return MOTIVACION_DEFAULT
  }
}

export async function saveMotivacion(patch: Partial<Motivacion>): Promise<Motivacion> {
  const payload: Record<string, unknown> = { id: 'default', updated_at: new Date().toISOString() }
  if (patch.mensaje !== undefined) payload.mensaje = patch.mensaje
  if (patch.imagenUrl !== undefined) payload.imagen_url = patch.imagenUrl
  if (patch.umbral !== undefined) payload.umbral = patch.umbral
  if (patch.activo !== undefined) payload.activo = patch.activo
  if (patch.metaDiaRef !== undefined) payload.meta_dia_ref = patch.metaDiaRef
  const { data, error } = await supabase.from('motivacion').upsert(payload).select('*').single()
  if (error || !data) throw error ?? new Error('No se pudo guardar la motivación')
  return mapMotivacion(data as Record<string, unknown>)
}

// Sube la imagen/GIF motivacional al bucket `avatars` y devuelve su URL pública.
// Comprime si es imagen estática; los GIF (animados) se suben tal cual.
export async function uploadMotivacionImagen(file: File): Promise<string> {
  const liviana = await comprimirImagen(file, PERFIL_IMAGEN.motivacion)
  const ext = (liviana.name.split('.').pop() || 'png').toLowerCase()
  const path = `motivacion/hit-${Date.now()}.${ext}`
  const { error } = await supabase.storage
    .from('avatars')
    .upload(path, liviana, { upsert: true, contentType: liviana.type || 'image/png' })
  if (error) throw error
  const { data } = supabase.storage.from('avatars').getPublicUrl(path)
  return data.publicUrl
}

// ───────────────────────────────────────────────────────────────────────────
// Catálogos EMPRESAS y TERCEROS (migración 20260619120000_empresas_terceros).
// Son catálogos de administración (anon_key, RLS abierta). No se cachean en
// Dexie: si está offline, la carga cae a lista vacía y se reintenta al volver.

function mapNamed(row: Record<string, unknown>): { id: string; nombre: string; activo: boolean } {
  return {
    id: String(row.id),
    nombre: String(row.nombre ?? ''),
    activo: row.activo == null ? true : Boolean(row.activo),
  }
}

export async function loadEmpresas(): Promise<{ data: Empresa[]; source: Source }> {
  try {
    const { data, error } = await supabase.from('empresas').select('id,nombre,activo').order('nombre')
    if (error || !data) throw error ?? new Error('empty')
    return { data: data.map(mapNamed), source: 'supabase' }
  } catch {
    return { data: [], source: 'fallback' }
  }
}

export async function createEmpresa(nombre: string): Promise<Empresa> {
  const { data, error } = await supabase
    .from('empresas')
    .insert({ nombre: nombre.trim().toUpperCase() })
    .select('id,nombre,activo')
    .single()
  if (error || !data) throw error ?? new Error('No se pudo crear la empresa')
  return mapNamed(data)
}

export async function updateEmpresa(
  id: string,
  patch: { nombre?: string; activo?: boolean },
): Promise<Empresa> {
  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (patch.nombre !== undefined) payload.nombre = patch.nombre.trim().toUpperCase()
  if (patch.activo !== undefined) payload.activo = patch.activo
  const { data, error } = await supabase
    .from('empresas')
    .update(payload)
    .eq('id', id)
    .select('id,nombre,activo')
    .single()
  if (error || !data) throw error ?? new Error('No se pudo actualizar la empresa')
  return mapNamed(data)
}

export async function deleteEmpresa(id: string): Promise<void> {
  const { error } = await supabase.from('empresas').delete().eq('id', id)
  if (error) throw new Error(error.message || 'No se pudo eliminar la empresa')
}

// ───────────── Catálogo INGENIOS/compradores (migración 20260708120000) ─────────────
// El `id` es un slug estable (amarra maestro.ingenio_id) derivado del nombre al
// crear. Renombrar cambia solo el nombre; el id NO se toca.
export async function loadIngenios(): Promise<{ data: Ingenio[]; source: Source }> {
  try {
    const { data, error } = await supabase.from('ingenios').select('id,nombre,activo').order('nombre')
    if (error || !data) throw error ?? new Error('empty')
    return { data: data.map(mapNamed), source: 'supabase' }
  } catch {
    return { data: [], source: 'fallback' }
  }
}

export async function createIngenio(nombre: string): Promise<Ingenio> {
  const nom = nombre.trim()
  const id = slugIngenio(nom)
  if (!id) throw new Error('El nombre del ingenio no es válido.')
  const { data, error } = await supabase
    .from('ingenios')
    .insert({ id, nombre: nom })
    .select('id,nombre,activo')
    .single()
  if (error) {
    if (error.code === '23505') throw new Error(`Ya existe un ingenio con id "${id}".`)
    throw new Error(error.message || 'No se pudo crear el ingenio')
  }
  if (!data) throw new Error('No se pudo crear el ingenio')
  return mapNamed(data)
}

export async function updateIngenio(
  id: string,
  patch: { nombre?: string; activo?: boolean },
): Promise<Ingenio> {
  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (patch.nombre !== undefined) payload.nombre = patch.nombre.trim()
  if (patch.activo !== undefined) payload.activo = patch.activo
  const { data, error } = await supabase
    .from('ingenios')
    .update(payload)
    .eq('id', id)
    .select('id,nombre,activo')
    .single()
  if (error || !data) throw error ?? new Error('No se pudo actualizar el ingenio')
  return mapNamed(data)
}

export async function deleteIngenio(id: string): Promise<void> {
  const { error } = await supabase.from('ingenios').delete().eq('id', id)
  if (error) throw new Error(error.message || 'No se pudo eliminar el ingenio')
}

export async function loadTerceros(): Promise<{ data: Tercero[]; source: Source }> {
  try {
    const { data, error } = await supabase.from('terceros').select('id,nombre,activo').order('nombre')
    if (error || !data) throw error ?? new Error('empty')
    return { data: data.map(mapNamed), source: 'supabase' }
  } catch {
    return { data: [], source: 'fallback' }
  }
}

export async function createTercero(nombre: string): Promise<Tercero> {
  const { data, error } = await supabase
    .from('terceros')
    .insert({ nombre: nombre.trim().toUpperCase() })
    .select('id,nombre,activo')
    .single()
  if (error || !data) throw error ?? new Error('No se pudo crear el tercero')
  return mapNamed(data)
}

export async function updateTercero(
  id: string,
  patch: { nombre?: string; activo?: boolean },
): Promise<Tercero> {
  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (patch.nombre !== undefined) payload.nombre = patch.nombre.trim().toUpperCase()
  if (patch.activo !== undefined) payload.activo = patch.activo
  const { data, error } = await supabase
    .from('terceros')
    .update(payload)
    .eq('id', id)
    .select('id,nombre,activo')
    .single()
  if (error || !data) throw error ?? new Error('No se pudo actualizar el tercero')
  return mapNamed(data)
}

export async function deleteTercero(id: string): Promise<void> {
  const { error } = await supabase.from('terceros').delete().eq('id', id)
  if (error) throw new Error(error.message || 'No se pudo eliminar el tercero')
}

// ───────────────────────────────────────────────────────────────────────────
// Catálogo de ZONAS (migración 20260621120000_zonas_supervisor). codigo = valor
// guardado (NORTE/SUR y futuros); nombre = etiqueta. Sin caché Dexie.

function mapZona(row: Record<string, unknown>): Zona {
  return {
    id: String(row.id),
    codigo: String(row.codigo ?? ''),
    nombre: String(row.nombre ?? ''),
    activo: row.activo == null ? true : Boolean(row.activo),
  }
}

// Deriva un código a partir del nombre (mayúsculas, sin acentos ni espacios).
function zonaCodigoFromNombre(nombre: string): string {
  return nombre
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .trim().toUpperCase().replace(/\s+/g, '_').replace(/[^A-Z0-9_]/g, '')
}

export async function loadZonas(): Promise<{ data: Zona[]; source: Source }> {
  try {
    const { data, error } = await supabase.from('zonas').select('id,codigo,nombre,activo').order('nombre')
    if (error || !data) throw error ?? new Error('empty')
    return { data: data.map(mapZona), source: 'supabase' }
  } catch {
    return { data: [], source: 'fallback' }
  }
}

export async function createZona(nombre: string): Promise<Zona> {
  const codigo = zonaCodigoFromNombre(nombre)
  const { data, error } = await supabase
    .from('zonas')
    .insert({ codigo, nombre: nombre.trim() })
    .select('id,codigo,nombre,activo')
    .single()
  if (error || !data) throw error ?? new Error('No se pudo crear la zona')
  return mapZona(data)
}

export async function updateZona(
  id: string,
  patch: { nombre?: string; activo?: boolean },
): Promise<Zona> {
  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (patch.nombre !== undefined) payload.nombre = patch.nombre.trim()
  if (patch.activo !== undefined) payload.activo = patch.activo
  const { data, error } = await supabase
    .from('zonas')
    .update(payload)
    .eq('id', id)
    .select('id,codigo,nombre,activo')
    .single()
  if (error || !data) throw error ?? new Error('No se pudo actualizar la zona')
  return mapZona(data)
}

export async function deleteZona(id: string): Promise<void> {
  const { error } = await supabase.from('zonas').delete().eq('id', id)
  if (error) throw new Error(error.message || 'No se pudo eliminar la zona')
}

// ───────────────────────────────────────────────────────────────────────────
// MÓDULO INSUMOS — catálogo + inventario (kardex). Migración 20260622120000.
// Sin caché Dexie (lo usan supervisor de insumos / owner / admin, en línea).

function mapInsumo(row: Record<string, unknown>): Insumo {
  const cat = String(row.categoria ?? 'MATERIAL').trim().toUpperCase()
  return {
    id: String(row.id),
    nombre: String(row.nombre ?? ''),
    categoria: cat === 'COMBUSTIBLE' ? 'COMBUSTIBLE' : 'MATERIAL',
    unidad: String(row.unidad ?? 'unidad'),
    stock: Number(row.stock ?? 0),
    stockMinimo: Number(row.stock_minimo ?? 0),
    frecuente: Boolean(row.frecuente ?? false),
    activo: row.activo == null ? true : Boolean(row.activo),
    codigo: row.codigo ? String(row.codigo) : undefined,
    familia: row.familia ? String(row.familia) : undefined,
    descripcion: row.descripcion ? String(row.descripcion) : undefined,
    esRepuesto: Boolean(row.es_repuesto ?? false),
    referencia: row.referencia ? String(row.referencia) : undefined,
    marca: row.marca ? String(row.marca) : undefined,
    numeroParte: row.numero_parte ? String(row.numero_parte) : undefined,
    ubicacion: row.ubicacion ? String(row.ubicacion) : undefined,
    stockMaximo: row.stock_maximo == null ? undefined : Number(row.stock_maximo),
    stockSeguridad: row.stock_seguridad == null ? undefined : Number(row.stock_seguridad),
    costoPromedio: row.costo_promedio == null ? undefined : Number(row.costo_promedio),
    fichaUrl: row.ficha_url ? String(row.ficha_url) : undefined,
  }
}

/**
 * Catálogo de insumos, con respaldo en el equipo.
 *
 * 🔴 Antes devolvía una lista VACÍA cuando fallaba la red. El supervisor abría
 * la pantalla sin señal y no tenía nada que despachar: podía guardar (el
 * outbox) pero no había de dónde escoger. Guardar sin poder leer no sirve.
 */
export async function loadInsumos(): Promise<{ data: Insumo[]; source: Source }> {
  try {
    // `*` a propósito: así la carga NO se rompe si la migración de una columna
    // nueva (ej. stock_minimo) aún no se ha corrido (lección factura_numero).
    const { data, error } = await supabase.from('insumos').select('*').order('nombre')
    if (error || !data) throw error ?? new Error('empty')
    const mapped = data.map(mapInsumo)
    void db.insumosCat.clear().then(() => db.insumosCat.bulkPut(mapped))
    return { data: mapped, source: 'supabase' }
  } catch {
    const cache = await db.insumosCat.toArray()
    return {
      data: cache.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' })),
      source: 'fallback',
    }
  }
}

export async function createInsumo(
  nombre: string,
  categoria: InsumoCategoria,
  unidad: string,
  stockMinimo = 0,
): Promise<Insumo> {
  const { data, error } = await supabase
    .from('insumos')
    .insert({ nombre: nombre.trim().toUpperCase(), categoria, unidad: unidad.trim() || 'unidad', stock_minimo: stockMinimo })
    .select('*')
    .single()
  if (error || !data) throw error ?? new Error('No se pudo crear el insumo')
  return mapInsumo(data)
}

export async function updateInsumo(
  id: string,
  patch: { nombre?: string; categoria?: InsumoCategoria; unidad?: string; activo?: boolean; stockMinimo?: number; frecuente?: boolean },
): Promise<Insumo> {
  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (patch.nombre !== undefined) payload.nombre = patch.nombre.trim().toUpperCase()
  if (patch.categoria !== undefined) payload.categoria = patch.categoria
  if (patch.unidad !== undefined) payload.unidad = patch.unidad.trim() || 'unidad'
  if (patch.activo !== undefined) payload.activo = patch.activo
  if (patch.stockMinimo !== undefined) payload.stock_minimo = patch.stockMinimo
  if (patch.frecuente !== undefined) payload.frecuente = patch.frecuente
  const { data, error } = await supabase
    .from('insumos')
    .update(payload)
    .eq('id', id)
    .select('*')
    .single()
  if (error || !data) throw error ?? new Error('No se pudo actualizar el insumo')
  return mapInsumo(data)
}

/**
 * Ajuste de inventario por CONTEO FÍSICO: fija el stock al valor real contado y
 * registra la diferencia como movimiento AJUSTE en el kardex (cantidad con
 * signo: negativa si sobraba en el sistema, positiva si faltaba). No pasa por
 * registrarMovimientoInsumo porque este solo suma/resta en un sentido.
 */
export async function ajustarStockInsumo(input: {
  insumoId: string
  nuevoStock: number
  motivo?: string
  creadoPor?: string
  bodegaId?: string
}): Promise<Insumo> {
  let bodegaId = input.bodegaId
  if (!bodegaId) {
    const p = await bodegaPrincipal()
    if (!p) throw new Error('No hay bodega principal configurada')
    bodegaId = p.id
  }

  const nuevo = redondear2(Number(input.nuevoStock))
  const actual = await stockEnBodega(input.insumoId, bodegaId)
  const delta = redondear2(nuevo - actual)

  const { error: e2 } = await supabase.from('insumos_kardex').insert({
    insumo_id: input.insumoId,
    bodega_id: bodegaId,
    tipo: 'AJUSTE',
    cantidad: delta, // con signo: refleja la corrección exacta
    saldo: nuevo,
    motivo: input.motivo?.trim() || 'Ajuste por conteo físico',
    creado_por: input.creadoPor ?? null,
  })
  if (e2) throw new Error(e2.message || 'No se pudo registrar el ajuste')

  const { error: e3 } = await supabase
    .from('insumos_stock')
    .upsert({ insumo_id: input.insumoId, bodega_id: bodegaId, stock: nuevo, updated_at: new Date().toISOString() },
            { onConflict: 'insumo_id,bodega_id' })
  if (e3) throw new Error(e3.message || 'No se pudo actualizar el stock')

  const upd = await refrescarTotalInsumo(input.insumoId)
  if (!upd) throw new Error('No se pudo actualizar el stock')
  return upd
}

export async function deleteInsumo(id: string): Promise<void> {
  const { error } = await supabase.from('insumos').delete().eq('id', id)
  if (error) throw new Error(error.message || 'No se pudo eliminar el insumo')
}

function mapKardex(row: Record<string, unknown>): InsumoKardex {
  const tipo = String(row.tipo ?? 'ENTRADA').trim().toUpperCase()
  return {
    id: String(row.id),
    insumoId: String(row.insumo_id),
    tipo: tipo === 'SALIDA' ? 'SALIDA' : tipo === 'AJUSTE' ? 'AJUSTE' : 'ENTRADA',
    cantidad: Number(row.cantidad ?? 0),
    saldo: Number(row.saldo ?? 0),
    motivo: row.motivo ? String(row.motivo) : undefined,
    referencia: row.referencia ? String(row.referencia) : undefined,
    creadoPor: row.creado_por ? String(row.creado_por) : undefined,
    // `createdAt` = la fecha EFECTIVA, no la de registro. Los reportes ya leen
    // este campo, así que editar la fecha de un despacho se propaga sola a
    // Reportes, al Excel, al consumo por máquina y al informe semanal.
    // `created_at` es el respaldo para las filas viejas (todas se rellenaron en
    // la migración, pero una inserción sin la columna no debe quedar sin fecha).
    createdAt: String(row.fecha_efectiva ?? row.created_at ?? ''),
    registradoEn: row.created_at ? String(row.created_at) : undefined,
    equipoCodigo: row.equipo_codigo ? String(row.equipo_codigo) : undefined,
    bodegaId: row.bodega_id ? String(row.bodega_id) : undefined,
  }
}

// Carga movimientos del kardex (de un insumo, o todos), recientes primero.
export async function loadKardex(insumoId?: string, limit = 200): Promise<InsumoKardex[]> {
  let query = supabase
    .from('insumos_kardex')
    .select('id,insumo_id,tipo,cantidad,saldo,motivo,referencia,creado_por,created_at,fecha_efectiva,equipo_codigo,bodega_id')
    .order('fecha_efectiva', { ascending: false })
    .limit(limit)
  if (insumoId) query = query.eq('insumo_id', insumoId)
  const { data, error } = await query
  if (error || !data) return []
  return data.map(mapKardex)
}

// Carga TODOS los movimientos del kardex cargados a un equipo concreto.
export async function loadKardexDeEquipo(equipoCodigo: string, limit = 500): Promise<InsumoKardex[]> {
  const { data, error } = await supabase
    .from('insumos_kardex')
    .select('id,insumo_id,tipo,cantidad,saldo,motivo,referencia,creado_por,created_at,fecha_efectiva,equipo_codigo,bodega_id')
    .eq('equipo_codigo', equipoCodigo)
    .order('fecha_efectiva', { ascending: false })
    .limit(limit)
  if (error || !data) return []
  return data.map(mapKardex)
}

// Carga los movimientos del kardex con máquina asignada (para el reporte de
// consumo por equipo / acumulador de costos por tractor). Incluye SALIDAS
// (despachos) y ENTRADAS (devoluciones por diferencia confirmada por el
// operario) — el consumo neto de la máquina = salidas − devoluciones.
export async function loadKardexSalidasEquipo(limit = 1000): Promise<InsumoKardex[]> {
  const { data, error } = await supabase
    .from('insumos_kardex')
    .select('id,insumo_id,tipo,cantidad,saldo,motivo,referencia,creado_por,created_at,fecha_efectiva,equipo_codigo,bodega_id')
    .in('tipo', ['SALIDA', 'ENTRADA'])
    .not('equipo_codigo', 'is', null)
    .order('fecha_efectiva', { ascending: false })
    .limit(limit)
  if (error || !data) return []
  return data.map(mapKardex)
}

// ── BODEGAS (principal + satélites) ─────────────────────────────────────────

/** PRINCIPAL | SATELITE | TALLER; cualquier otra cosa cae en SATELITE. */
function bodegaTipoDe(v: unknown): BodegaTipo {
  const t = String(v ?? 'SATELITE').toUpperCase()
  return t === 'PRINCIPAL' || t === 'TALLER' ? (t as BodegaTipo) : 'SATELITE'
}

function mapBodega(row: Record<string, unknown>): Bodega {
  return {
    id: String(row.id),
    nombre: String(row.nombre ?? ''),
    tipo: bodegaTipoDe(row.tipo),
    responsableId: row.responsable_id ? String(row.responsable_id) : undefined,
    vehiculo: row.vehiculo ? String(row.vehiculo) : undefined,
    activo: row.activo == null ? true : Boolean(row.activo),
  }
}

/** Bodegas, con respaldo local: sin ellas el supervisor no sabe de dónde saca. */
export async function loadBodegas(): Promise<Bodega[]> {
  try {
    const { data, error } = await supabase.from('bodegas').select('*').order('tipo').order('nombre')
    if (error || !data) throw error ?? new Error('empty')
    const mapped = (data as Record<string, unknown>[]).map(mapBodega)
    void db.bodegas.clear().then(() => db.bodegas.bulkPut(mapped))
    return mapped
  } catch {
    return db.bodegas.toArray()
  }
}

export async function createBodega(input: { nombre: string; tipo: BodegaTipo; responsableId?: string; vehiculo?: string }): Promise<Bodega> {
  const { data, error } = await supabase
    .from('bodegas')
    .insert({
      nombre: input.nombre.trim().toUpperCase(),
      tipo: input.tipo,
      responsable_id: input.responsableId ?? null,
      vehiculo: input.vehiculo?.trim() || null,
    })
    .select('*')
    .single()
  if (error || !data) throw error ?? new Error('No se pudo crear la bodega')
  return mapBodega(data)
}

export async function updateBodega(id: string, patch: { nombre?: string; responsableId?: string | null; vehiculo?: string | null; activo?: boolean }): Promise<void> {
  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (patch.nombre !== undefined) payload.nombre = patch.nombre.trim().toUpperCase()
  if (patch.responsableId !== undefined) payload.responsable_id = patch.responsableId
  if (patch.vehiculo !== undefined) payload.vehiculo = patch.vehiculo
  if (patch.activo !== undefined) payload.activo = patch.activo
  const { error } = await supabase.from('bodegas').update(payload).eq('id', id)
  if (error) throw new Error(error.message || 'No se pudo actualizar la bodega')
}

/** Bodega satélite de un supervisor de insumos (su vehículo). */
export async function bodegaDeResponsable(userId: string): Promise<Bodega | null> {
  const { data, error } = await supabase.from('bodegas').select('*').eq('responsable_id', userId).eq('activo', true).limit(1)
  if (error || !data || data.length === 0) return null
  return mapBodega(data[0] as Record<string, unknown>)
}

export async function bodegaPrincipal(): Promise<Bodega | null> {
  const { data, error } = await supabase.from('bodegas').select('*').eq('tipo', 'PRINCIPAL').limit(1)
  if (error || !data || data.length === 0) return null
  return mapBodega(data[0] as Record<string, unknown>)
}

/** Stock por bodega. Sin `bodegaId` devuelve el de todas. */
/**
 * Stock por bodega, con respaldo local.
 *
 * Sin esto, el supervisor sin señal veía su carro en CERO y la validación
 * ("no tienes suficiente") le bloqueaba cualquier despacho. El respaldo es del
 * último momento con señal: puede estar un poco viejo, pero es infinitamente
 * mejor que un cero que miente.
 */
export async function loadStockBodega(bodegaId?: string): Promise<StockBodega[]> {
  try {
    let q = supabase.from('insumos_stock').select('insumo_id,bodega_id,stock')
    if (bodegaId) q = q.eq('bodega_id', bodegaId)
    const { data, error } = await q
    if (error || !data) throw error ?? new Error('empty')
    const mapped = data.map((r) => ({
      insumoId: String(r.insumo_id), bodegaId: String(r.bodega_id), stock: Number(r.stock ?? 0),
    }))
    void (async () => {
      // Solo se reemplaza lo de las bodegas que vinieron, para no borrar el
      // respaldo de las demás cuando la consulta trae una sola.
      const bodegasTraidas = new Set(mapped.map((m) => m.bodegaId))
      const viejos = await db.stockBodega.toArray()
      await db.stockBodega.bulkDelete(
        viejos.filter((v) => bodegasTraidas.has(v.bodegaId)).map((v) => v.clave),
      )
      await db.stockBodega.bulkPut(mapped.map((m) => ({ ...m, clave: `${m.insumoId}|${m.bodegaId}` })))
    })()
    return mapped
  } catch {
    const cache = await db.stockBodega.toArray()
    const filtrado = bodegaId ? cache.filter((c) => c.bodegaId === bodegaId) : cache
    return filtrado.map((c) => ({ insumoId: c.insumoId, bodegaId: c.bodegaId, stock: c.stock }))
  }
}

/** Stock actual de un insumo en una bodega (0 si no tiene fila todavía). */
async function stockEnBodega(insumoId: string, bodegaId: string): Promise<number> {
  const { data } = await supabase
    .from('insumos_stock').select('stock')
    .eq('insumo_id', insumoId).eq('bodega_id', bodegaId).maybeSingle()
  return Number(data?.stock ?? 0)
}

/** Recalcula `insumos.stock` como la suma de todas las bodegas (consolidado). */
async function refrescarTotalInsumo(insumoId: string): Promise<Insumo | null> {
  const { data } = await supabase.from('insumos_stock').select('stock').eq('insumo_id', insumoId)
  const total = redondear2((data ?? []).reduce((a, r) => a + Number(r.stock ?? 0), 0))
  const { data: upd } = await supabase
    .from('insumos').update({ stock: total, updated_at: new Date().toISOString() })
    .eq('id', insumoId).select('*').single()
  return upd ? mapInsumo(upd) : null
}

/**
 * Registra un movimiento de inventario EN UNA BODEGA y actualiza su stock.
 * ENTRADA/AJUSTE(+) suman; SALIDA resta. `insumos.stock` queda como el total
 * consolidado de todas las bodegas. Sin `bodegaId` usa la PRINCIPAL (compat).
 * Nota: sin transacción (dos pasos); suficiente para el volumen actual.
 */
export async function registrarMovimientoInsumo(input: {
  insumoId: string
  tipo: KardexTipo
  cantidad: number
  motivo?: string
  referencia?: string
  creadoPor?: string
  equipoCodigo?: string
  bodegaId?: string
}): Promise<Insumo> {
  let bodegaId = input.bodegaId
  if (!bodegaId) {
    const p = await bodegaPrincipal()
    if (!p) throw new Error('No hay bodega principal configurada')
    bodegaId = p.id
  }

  // Redondeo a 2 decimales: sin esto, sumar/restar en punto flotante deja
  // colas absurdas en el stock (1020.4100000000001).
  const cant = redondear2(Math.abs(Number(input.cantidad)))
  const delta = input.tipo === 'SALIDA' ? -cant : cant
  const saldo = redondear2((await stockEnBodega(input.insumoId, bodegaId)) + delta)

  const { error: e2 } = await supabase
    .from('insumos_kardex')
    .insert({
      insumo_id: input.insumoId,
      bodega_id: bodegaId,
      tipo: input.tipo,
      cantidad: cant,
      saldo,
      motivo: input.motivo ?? null,
      referencia: input.referencia ?? null,
      creado_por: input.creadoPor ?? null,
      equipo_codigo: input.equipoCodigo ?? null,
    })
  if (e2) throw new Error(e2.message || 'No se pudo registrar el movimiento')

  const { error: e3 } = await supabase
    .from('insumos_stock')
    .upsert({ insumo_id: input.insumoId, bodega_id: bodegaId, stock: saldo, updated_at: new Date().toISOString() },
            { onConflict: 'insumo_id,bodega_id' })
  if (e3) throw new Error(e3.message || 'No se pudo actualizar el stock de la bodega')

  const upd = await refrescarTotalInsumo(input.insumoId)
  if (!upd) throw new Error('No se pudo actualizar el stock')
  return upd
}

// ── TRASLADOS principal → satélite (con aval de quien recibe) ───────────────

function mapTraslado(row: Record<string, unknown>): Traslado {
  const est = String(row.estado ?? 'EN_TRANSITO').toUpperCase()
  const raw = Array.isArray(row.items) ? (row.items as Record<string, unknown>[]) : []
  return {
    id: String(row.id),
    createdAt: String(row.created_at ?? ''),
    origenId: String(row.origen_id),
    destinoId: String(row.destino_id),
    estado: est === 'RECIBIDO' ? 'RECIBIDO' : est === 'ANULADO' ? 'ANULADO' : 'EN_TRANSITO',
    enviadoPor: row.enviado_por ? String(row.enviado_por) : undefined,
    nota: row.nota ? String(row.nota) : undefined,
    evidenciaUrl: row.evidencia_url ? String(row.evidencia_url) : undefined,
    recibidoEn: row.recibido_en ? String(row.recibido_en) : undefined,
    recibidoPor: row.recibido_por ? String(row.recibido_por) : undefined,
    conforme: row.conforme == null ? null : Boolean(row.conforme),
    notaRecepcion: row.nota_recepcion ? String(row.nota_recepcion) : undefined,
    autoservicio: Boolean(row.autoservicio),
    avalEstado: row.aval_estado ? (String(row.aval_estado).toUpperCase() as 'PENDIENTE' | 'APROBADO' | 'RECHAZADO') : undefined,
    avaladoPor: row.avalado_por ? String(row.avalado_por) : undefined,
    avaladoNombre: row.avalado_nombre ? String(row.avalado_nombre) : undefined,
    avaladoEn: row.avalado_en ? String(row.avalado_en) : undefined,
    avalNota: row.aval_nota ? String(row.aval_nota) : undefined,
    anuladoNombre: row.anulado_nombre ? String(row.anulado_nombre) : undefined,
    anuladoEn: row.anulado_en ? String(row.anulado_en) : undefined,
    anuladoMotivo: row.anulado_motivo ? String(row.anulado_motivo) : undefined,
    anuladoRol: row.anulado_rol === 'RECIBE' ? 'RECIBE' : row.anulado_rol === 'ENVIA' ? 'ENVIA' : undefined,
    items: raw.map((it) => ({
      id: String(it.id),
      insumoId: String(it.insumo_id),
      insumoNombre: String(it.insumo_nombre ?? ''),
      unidad: String(it.unidad ?? ''),
      cantidad: Number(it.cantidad ?? 0),
      cantidadRecibida: it.cantidad_recibida == null ? undefined : Number(it.cantidad_recibida),
      agregadoEn: it.agregado_en ? String(it.agregado_en) : undefined,
      agregadoPor: it.agregado_por ? String(it.agregado_por) : undefined,
    })),
  }
}

export async function loadTraslados(opts?: { destinoId?: string; estados?: string[]; limit?: number }): Promise<Traslado[]> {
  let q = supabase
    .from('insumos_traslados')
    .select('*,items:insumos_traslado_items(*)')
    .order('created_at', { ascending: false })
    .limit(opts?.limit ?? 200)
  if (opts?.destinoId) q = q.eq('destino_id', opts.destinoId)
  if (opts?.estados?.length) q = q.in('estado', opts.estados)
  const { data, error } = await q
  if (error || !data) return []
  return (data as Record<string, unknown>[]).map(mapTraslado)
}

/**
 * Surtir un satélite: DESCUENTA de la principal de una vez (la mercancía ya
 * salió) y deja el traslado EN_TRANSITO. El satélite NO suma hasta que su
 * responsable confirme lo que recibió (aval) — así un faltante en el camino
 * queda visible en vez de aparecer como stock que no existe.
 */
export async function crearTraslado(input: {
  origenId: string
  destinoId: string
  enviadoPor?: string
  nota?: string
  evidenciaUrl?: string
  items: TrasladoItem[]
}): Promise<Traslado> {
  const { data: tr, error: e1 } = await supabase
    .from('insumos_traslados')
    .insert({
      origen_id: input.origenId,
      destino_id: input.destinoId,
      enviado_por: input.enviadoPor ?? null,
      nota: input.nota ?? null,
      evidencia_url: input.evidenciaUrl ?? null,
    })
    .select('*')
    .single()
  if (e1 || !tr) throw e1 ?? new Error('No se pudo crear el traslado')

  const rows = input.items.map((it) => ({
    traslado_id: tr.id,
    insumo_id: it.insumoId,
    insumo_nombre: it.insumoNombre,
    unidad: it.unidad,
    cantidad: it.cantidad,
  }))
  if (rows.length) {
    const { error: e2 } = await supabase.from('insumos_traslado_items').insert(rows)
    if (e2) throw new Error(e2.message || 'No se pudieron guardar los ítems')
  }

  // Salida de la bodega de origen (principal).
  for (const it of input.items) {
    if (it.cantidad > 0) {
      await registrarMovimientoInsumo({
        insumoId: it.insumoId,
        tipo: 'SALIDA',
        cantidad: it.cantidad,
        motivo: 'Traslado a satélite',
        referencia: tr.id,
        creadoPor: input.enviadoPor,
        bodegaId: input.origenId,
      })
    }
  }
  return mapTraslado({ ...tr, items: rows.map((r, i) => ({ id: `tmp-${i}`, ...r })) })
}

/**
 * Aval del satélite: confirma lo que realmente recibió. Cada ítem SUMA al
 * satélite por la cantidad recibida; si recibió menos de lo enviado, la
 * diferencia REGRESA a la principal (no se pierde ni queda fantasma).
 */
export async function confirmarTraslado(input: {
  trasladoId: string
  origenId: string
  destinoId: string
  recibidoPor: string
  conforme: boolean
  nota?: string
  items: { itemId?: string; insumoId: string; cantidadEnviada: number; cantidadRecibida: number }[]
}): Promise<void> {
  for (const it of input.items) {
    const recibida = Math.max(0, Math.min(Number(it.cantidadRecibida) || 0, it.cantidadEnviada))
    if (it.itemId) {
      await supabase.from('insumos_traslado_items').update({ cantidad_recibida: recibida }).eq('id', it.itemId)
    }
    if (recibida > 0) {
      await registrarMovimientoInsumo({
        insumoId: it.insumoId, tipo: 'ENTRADA', cantidad: recibida,
        motivo: 'Recepción de traslado', referencia: input.trasladoId,
        creadoPor: input.recibidoPor, bodegaId: input.destinoId,
      })
    }
    const faltante = it.cantidadEnviada - recibida
    if (faltante > 0) {
      await registrarMovimientoInsumo({
        insumoId: it.insumoId, tipo: 'ENTRADA', cantidad: faltante,
        motivo: 'Devolución por faltante en traslado', referencia: input.trasladoId,
        creadoPor: input.recibidoPor, bodegaId: input.origenId,
      })
    }
  }

  const { error } = await supabase
    .from('insumos_traslados')
    .update({
      estado: 'RECIBIDO',
      recibido_en: new Date().toISOString(),
      recibido_por: input.recibidoPor,
      conforme: input.conforme,
      nota_recepcion: input.nota?.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.trasladoId)
  if (error) throw new Error(error.message || 'No se pudo confirmar el traslado')
}

/**
 * Anula un traslado EN TRÁNSITO y devuelve TODO a la bodega de origen.
 *
 * Cuando se despacha, el material sale de la principal de una vez. Si el
 * traslado no debía existir, ese stock queda en el aire: ni en la principal ni
 * en el carro. Aquí se devuelve entero, con su movimiento de kardex, para que
 * el saldo cuadre y quede el rastro de por qué volvió.
 *
 * Dos caminos, mismo efecto sobre el inventario:
 *  · rol ENVIA  — quien lo despachó se equivocó.
 *  · rol RECIBE — el supervisor destino dice que no le corresponde.
 *
 * ⚠️ Solo aplica sobre EN_TRANSITO. El `.eq('estado', ...)` + `.select()` es el
 * seguro contra la doble anulación: si dos personas tocan el botón a la vez,
 * el segundo update afecta 0 filas y aquí se convierte en error — sin eso, el
 * material se devolvería dos veces.
 */
export async function anularTraslado(input: {
  trasladoId: string
  origenId: string
  items: { insumoId: string; cantidad: number }[]
  anuladoPor?: string
  anuladoNombre?: string
  rol: 'ENVIA' | 'RECIBE'
  motivo?: string
}): Promise<void> {
  const { data, error } = await supabase
    .from('insumos_traslados')
    .update({
      estado: 'ANULADO',
      anulado_por: input.anuladoPor ?? null,
      anulado_nombre: input.anuladoNombre ?? null,
      anulado_en: new Date().toISOString(),
      anulado_motivo: input.motivo?.trim() || null,
      anulado_rol: input.rol,
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.trasladoId)
    .eq('estado', 'EN_TRANSITO')
    .select('id')
  if (error) throw new Error(error.message)
  if (!data || data.length === 0) {
    throw new Error('Este traslado ya fue recibido o anulado por otra persona.')
  }

  // Se BORRAN las salidas, no se compensan con una entrada.
  //
  // Un traslado en tránsito que se anula nunca ocurrió: el material no se
  // gastó ni se movió a ningún lado. Dejar la salida y una devolución que la
  // compensa deja el saldo bien pero ensucia el kardex con dos movimientos
  // físicos que nadie hizo — y la salida sigue apareciendo como consumo de la
  // principal, que fue justo lo que el cliente no quería ver.
  //
  // El rastro de la equivocación no se pierde: vive en el traslado, que queda
  // ANULADO con quién, cuándo y por qué. Lo que se limpia es el libro de
  // inventario, que solo debe contar movimientos reales.
  const { error: eBorrar } = await supabase
    .from('insumos_kardex')
    .delete()
    .eq('referencia', input.trasladoId)
  if (eBorrar) throw new Error(eBorrar.message || 'No se pudo limpiar el movimiento')

  // Los saldos se recalculan desde cero por bodega: el `saldo` que llevaba
  // cada fila borrada ya no sirve de referencia.
  const insumosTocados = [...new Set(input.items.map((it) => it.insumoId))]
  for (const insumoId of insumosTocados) {
    await recalcularStockBodega(insumoId, input.origenId)
  }
}

/**
 * Recalcula el stock de un insumo en una bodega sumando su kardex.
 *
 * Se usa cuando se BORRAN movimientos: el stock guardado venía del último
 * `saldo`, y si esa fila desapareció hay que rehacer la cuenta desde el
 * principio en vez de confiar en un acumulado que ya no existe.
 */
export async function recalcularStockBodega(insumoId: string, bodegaId: string): Promise<void> {
  const { data, error } = await supabase
    .from('insumos_kardex')
    .select('tipo,cantidad,saldo,created_at,fecha_efectiva')
    .eq('insumo_id', insumoId)
    .eq('bodega_id', bodegaId)
    .order('fecha_efectiva', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) throw new Error(error.message)

  let saldo = 0
  for (const r of (data ?? []) as { tipo: string; cantidad: number; saldo: number }[]) {
    // El AJUSTE no suma ni resta: FIJA el saldo al conteo físico.
    if (r.tipo === 'AJUSTE') saldo = Number(r.saldo)
    else saldo += (r.tipo === 'SALIDA' ? -1 : 1) * Number(r.cantidad)
  }
  saldo = redondear2(saldo)

  const { error: e2 } = await supabase
    .from('insumos_stock')
    .upsert({ insumo_id: insumoId, bodega_id: bodegaId, stock: saldo, updated_at: new Date().toISOString() },
            { onConflict: 'insumo_id,bodega_id' })
  if (e2) throw new Error(e2.message)
  await refrescarTotalInsumo(insumoId)
}

// ── COMBUSTIBLE de bomba externa ────────────────────────────────────────────

function destinoDe(v: unknown): CombustibleDestino {
  const d = String(v ?? 'MAQUINA').toUpperCase()
  return d === 'CARRO' || d === 'VEHICULO' || d === 'PIMPINAS' ? (d as CombustibleDestino) : 'MAQUINA'
}
function estadoDe(v: unknown): CombustibleEstado {
  const e = String(v ?? 'APROBADO').toUpperCase()
  return e === 'PENDIENTE' || e === 'RECHAZADO' ? (e as CombustibleEstado) : 'APROBADO'
}

function mapCombustible(row: Record<string, unknown>): CombustibleExterno {
  const s = (v: unknown) => (v == null || v === '' ? undefined : String(v))
  return {
    id: String(row.id),
    createdAt: String(row.created_at ?? ''),
    fecha: String(row.fecha ?? ''),
    origen: String(row.origen ?? 'ESTACION').toUpperCase() === 'SEDE' ? 'SEDE' : 'ESTACION',
    destino: destinoDe(row.destino),
    estado: estadoDe(row.estado),
    bodegaId: s(row.bodega_id),
    bodegaOrigenId: s(row.bodega_origen_id),
    placa: s(row.placa),
    pimpinasCantidad: row.pimpinas_cantidad == null ? undefined : Number(row.pimpinas_cantidad),
    pimpinasCapacidad: row.pimpinas_capacidad == null ? undefined : Number(row.pimpinas_capacidad),
    revisadoPor: s(row.revisado_por),
    revisadoNombre: s(row.revisado_nombre),
    revisadoEn: s(row.revisado_en),
    revisionNota: s(row.revision_nota),
    equipoCodigo: s(row.equipo_codigo),
    horometro: row.horometro == null ? undefined : Number(row.horometro),
    insumoId: s(row.insumo_id),
    galones: Number(row.galones ?? 0),
    valor: row.valor == null ? undefined : Number(row.valor),
    estacion: s(row.estacion),
    factura: s(row.factura),
    tirillaUrl: s(row.tirilla_url),
    registradoPor: s(row.registrado_por),
    registradoNombre: s(row.registrado_nombre),
    nota: s(row.nota),
    operarioId: s(row.operario_id),
    operarioNombre: s(row.operario_nombre),
    confirmadoEn: s(row.confirmado_en),
    confirmadoPor: s(row.confirmado_por),
    conforme: row.conforme == null ? null : Boolean(row.conforme),
    confirmacionNota: s(row.confirmacion_nota),
  }
}

export async function loadCombustibleExterno(opts?: {
  desde?: string; hasta?: string
  destino?: CombustibleDestino
  origen?: CombustibleOrigen
  estado?: CombustibleEstado
  registradoPor?: string
  limit?: number
}): Promise<CombustibleExterno[]> {
  let q = supabase.from('combustible_externo').select('*').order('fecha', { ascending: false }).limit(opts?.limit ?? 500)
  if (opts?.desde) q = q.gte('fecha', opts.desde)
  if (opts?.hasta) q = q.lte('fecha', opts.hasta)
  if (opts?.destino) q = q.eq('destino', opts.destino)
  if (opts?.origen) q = q.eq('origen', opts.origen)
  if (opts?.estado) q = q.eq('estado', opts.estado)
  if (opts?.registradoPor) q = q.eq('registrado_por', opts.registradoPor)
  const { data, error } = await q
  if (error || !data) return []
  return (data as Record<string, unknown>[]).map(mapCombustible)
}

// ── Catálogo de placas ──────────────────────────────────────────────────────

function mapVehiculo(row: Record<string, unknown>): Vehiculo {
  return {
    id: String(row.id),
    placa: String(row.placa ?? '').trim().toUpperCase(),
    descripcion: row.descripcion ? String(row.descripcion) : undefined,
    tipo: String(row.tipo ?? 'VEHICULO'),
    frecuente: Boolean(row.frecuente),
    activo: row.activo == null ? true : Boolean(row.activo),
  }
}

export async function loadVehiculos(): Promise<Vehiculo[]> {
  const { data, error } = await supabase.from('vehiculos').select('*').order('placa')
  if (error || !data) return []
  return (data as Record<string, unknown>[]).map(mapVehiculo).filter((v) => v.activo)
}

export async function createVehiculo(input: { placa: string; descripcion?: string; frecuente?: boolean }): Promise<Vehiculo> {
  const { data, error } = await supabase
    .from('vehiculos')
    .insert({
      placa: input.placa.trim().toUpperCase(),
      descripcion: input.descripcion?.trim() || null,
      frecuente: input.frecuente ?? false,
    })
    .select('*').single()
  if (error || !data) throw new Error(error?.message || 'No se pudo crear la placa')
  return mapVehiculo(data)
}

export async function updateVehiculo(id: string, patch: { placa?: string; descripcion?: string; frecuente?: boolean; activo?: boolean }): Promise<void> {
  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (patch.placa !== undefined) payload.placa = patch.placa.trim().toUpperCase()
  if (patch.descripcion !== undefined) payload.descripcion = patch.descripcion.trim() || null
  if (patch.frecuente !== undefined) payload.frecuente = patch.frecuente
  if (patch.activo !== undefined) payload.activo = patch.activo
  const { error } = await supabase.from('vehiculos').update(payload).eq('id', id)
  if (error) throw new Error(error.message || 'No se pudo actualizar la placa')
}

/**
 * Registra un evento de combustible y lo deja PENDIENTE del aval del analista.
 *
 * Dos ejes independientes:
 *   origen  ESTACION → se compró en la bomba: no sale de ninguna bodega.
 *           SEDE     → salió de la bodega PRINCIPAL: se descuenta de una vez,
 *                      porque físicamente ya se lo llevaron. Diego valida después
 *                      y, si rechaza, la reversa devuelve todo a su sitio.
 *   destino CARRO / PIMPINAS → suma al inventario del satélite (es material que
 *                      queda para distribuir).
 *           VEHICULO / MAQUINA → NO toca inventario: es consumo. Se identifica
 *                      con la placa o con el equipo + horómetro para el costeo.
 *
 * El supervisor de insumos ya NO tiene "+ Entrada" en Inventario: todo lo que
 * entra a su carro pasa por aquí y por el aval.
 */
export async function registrarCombustibleExterno(input: {
  fecha: string
  origen?: CombustibleOrigen
  destino: CombustibleDestino
  /** Satélite que recibe (CARRO / PIMPINAS). */
  bodegaId?: string
  equipoCodigo?: string
  horometro?: number
  placa?: string
  pimpinasCantidad?: number
  pimpinasCapacidad?: number
  insumoId?: string
  galones: number
  valor?: number
  estacion?: string
  factura?: string
  tirillaUrl?: string
  registradoPor?: string
  registradoNombre?: string
  nota?: string
  /** Operario que recibe. Solo se guarda en destino=MAQUINA. */
  operarioId?: string
  operarioNombre?: string
}): Promise<void> {
  const origen: CombustibleOrigen = input.origen ?? 'ESTACION'
  const galones = redondear2(Number(input.galones))
  const alInventario = input.destino === 'CARRO' || input.destino === 'PIMPINAS'

  // De la sede sale de la principal; hay que saber cuál es antes de registrar.
  let principalId: string | undefined
  if (origen === 'SEDE') {
    const p = await bodegaPrincipal()
    if (!p) throw new Error('No hay bodega principal configurada')
    principalId = p.id
  }

  const { data, error } = await supabase
    .from('combustible_externo')
    .insert({
      fecha: input.fecha,
      origen,
      destino: input.destino,
      estado: 'PENDIENTE',
      bodega_id: alInventario ? (input.bodegaId ?? null) : null,
      bodega_origen_id: principalId ?? null,
      equipo_codigo: input.destino === 'MAQUINA' ? (input.equipoCodigo ?? null) : null,
      horometro: input.destino === 'MAQUINA' ? (input.horometro ?? null) : null,
      placa: input.destino === 'VEHICULO' ? (input.placa?.trim().toUpperCase() ?? null) : null,
      pimpinas_cantidad: input.destino === 'PIMPINAS' ? (input.pimpinasCantidad ?? null) : null,
      pimpinas_capacidad: input.destino === 'PIMPINAS' ? (input.pimpinasCapacidad ?? null) : null,
      insumo_id: input.insumoId ?? null,
      galones,
      valor: input.valor ?? 0,
      estacion: input.estacion ?? null,
      factura: input.factura ?? null,
      tirilla_url: input.tirillaUrl ?? null,
      registrado_por: input.registradoPor ?? null,
      registrado_nombre: input.registradoNombre ?? null,
      nota: input.nota ?? null,
      // Solo la máquina tiene operario que confirme. El vehículo todavía no
      // (decisión del cliente): guardarlo ahí crearía un aval que nadie espera.
      operario_id: input.destino === 'MAQUINA' ? (input.operarioId ?? null) : null,
      operario_nombre: input.destino === 'MAQUINA' ? (input.operarioNombre ?? null) : null,
    })
    .select('id')
    .single()
  if (error || !data) throw error ?? new Error('No se pudo registrar el tanqueo')

  const ref = String(data.id)
  if (!input.insumoId || galones <= 0) return

  if (origen === 'SEDE' && principalId) {
    await registrarMovimientoInsumo({
      insumoId: input.insumoId,
      tipo: 'SALIDA',
      cantidad: galones,
      motivo: `Abastecimiento en sede · ${DESTINO_LABEL[input.destino]}`,
      referencia: ref,
      creadoPor: input.registradoPor,
      equipoCodigo: input.destino === 'MAQUINA' ? input.equipoCodigo : undefined,
      bodegaId: principalId,
    })
  }

  if (alInventario && input.bodegaId) {
    await registrarMovimientoInsumo({
      insumoId: input.insumoId,
      tipo: 'ENTRADA',
      cantidad: galones,
      motivo: origen === 'SEDE'
        ? `Cargue en sede · ${DESTINO_LABEL[input.destino]}`
        : `Carga en estación${input.estacion ? ` (${input.estacion})` : ''}`,
      referencia: ref,
      creadoPor: input.registradoPor,
      bodegaId: input.bodegaId,
    })
  }
}

/**
 * Aval del analista de insumos. Aprobar solo sella el evento (el inventario ya
 * se movió al registrarlo); rechazar REVERSA los movimientos para que el stock
 * vuelva a lo que era.
 */
export async function revisarCombustible(input: {
  evento: CombustibleExterno
  aprobar: boolean
  revisadoPor: string
  revisadoNombre: string
  nota?: string
}): Promise<void> {
  const { evento } = input
  if (evento.estado !== 'PENDIENTE') throw new Error('Este registro ya fue revisado')

  const { data, error } = await supabase
    .from('combustible_externo')
    .update({
      estado: input.aprobar ? 'APROBADO' : 'RECHAZADO',
      revisado_por: input.revisadoPor,
      revisado_nombre: input.revisadoNombre,
      revisado_en: new Date().toISOString(),
      revision_nota: input.nota?.trim() || null,
    })
    .eq('id', evento.id)
    .eq('estado', 'PENDIENTE')
    .select('id')
  if (error) throw new Error(error.message || 'No se pudo registrar el aval')
  // Misma guarda que en el autoabastecimiento: sin comprobar que el UPDATE
  // tocó una fila, un doble aval reversaría el combustible dos veces.
  if (!data || data.length === 0) throw new Error('Este registro ya fue revisado por otra persona')

  if (input.aprobar || !evento.insumoId || evento.galones <= 0) return

  // Reversa: exactamente los movimientos contrarios a los del registro.
  const motivo = `Reversa por rechazo del aval`
  if (evento.origen === 'SEDE' && evento.bodegaOrigenId) {
    await registrarMovimientoInsumo({
      insumoId: evento.insumoId,
      tipo: 'ENTRADA',
      cantidad: evento.galones,
      motivo,
      referencia: evento.id,
      creadoPor: input.revisadoPor,
      // 🔴 La maquina va TAMBIEN en la reversa. Sin ella el stock volvia a su
      // sitio pero el consumo quedaba cargado al equipo para siempre: el
      // reporte neta salidas menos entradas POR MAQUINA, y la entrada sin
      // equipo no cancelaba nada.
      equipoCodigo: evento.destino === 'MAQUINA' ? evento.equipoCodigo : undefined,
      bodegaId: evento.bodegaOrigenId,
    })
  }
  if ((evento.destino === 'CARRO' || evento.destino === 'PIMPINAS') && evento.bodegaId) {
    await registrarMovimientoInsumo({
      insumoId: evento.insumoId,
      tipo: 'SALIDA',
      cantidad: evento.galones,
      motivo,
      referencia: evento.id,
      creadoPor: input.revisadoPor,
      bodegaId: evento.bodegaId,
    })
  }
}

// ── Solicitudes de insumos (fase 2) ─────────────────────────────────────────

function mapSolicitud(row: Record<string, unknown>): SolicitudInsumo {
  const estado = String(row.estado ?? 'PENDIENTE').trim().toUpperCase() as SolicitudEstado
  const rawItems = Array.isArray(row.items) ? (row.items as Record<string, unknown>[]) : []
  return {
    id: String(row.id),
    operarioId: String(row.operario_id),
    operarioNombre: row.operario_nombre ? String(row.operario_nombre) : undefined,
    estado: (['PENDIENTE', 'PROGRAMADA', 'ENTREGADA', 'RECHAZADA', 'CANCELADA'] as string[]).includes(estado) ? estado : 'PENDIENTE',
    origen: String(row.origen ?? 'OPERARIO').trim().toUpperCase() === 'DIRECTA' ? 'DIRECTA' : 'OPERARIO',
    nota: row.nota ? String(row.nota) : undefined,
    zona: row.zona ? String(row.zona) : undefined,
    motivoRechazo: row.motivo_rechazo ? String(row.motivo_rechazo) : undefined,
    createdAt: String(row.created_at ?? ''),
    requeridoPara: row.requerido_para ? String(row.requerido_para) : undefined,
    entregadoEn: row.entregado_en ? String(row.entregado_en) : undefined,
    despachadoPor: row.despachado_por ? String(row.despachado_por) : undefined,
    ruta: row.ruta ? String(row.ruta) : undefined,
    evidenciaUrls: Array.isArray(row.evidencia_urls) ? (row.evidencia_urls as unknown[]).map(String) : undefined,
    horometro: row.horometro == null ? undefined : Number(row.horometro),
    equipoCodigo: row.equipo_codigo ? String(row.equipo_codigo) : undefined,
    bodegaId: row.bodega_id ? String(row.bodega_id) : undefined,
    confirmadoEn: row.confirmado_en ? String(row.confirmado_en) : undefined,
    confirmadoPor: row.confirmado_por ? String(row.confirmado_por) : undefined,
    conforme: row.conforme == null ? null : Boolean(row.conforme),
    confirmacionNota: row.confirmacion_nota ? String(row.confirmacion_nota) : undefined,
    engraso: row.engraso == null ? undefined : Boolean(row.engraso),
    items: rawItems.map((it) => ({
      id: String(it.id),
      insumoId: it.insumo_id ? String(it.insumo_id) : undefined,
      insumoNombre: String(it.insumo_nombre ?? ''),
      unidad: String(it.unidad ?? ''),
      cantidad: Number(it.cantidad ?? 0),
      cantidadDespachada: it.cantidad_despachada == null ? undefined : Number(it.cantidad_despachada),
      cantidadRecibida: it.cantidad_recibida == null ? undefined : Number(it.cantidad_recibida),
    })),
  }
}

export async function createSolicitud(input: {
  operarioId: string
  operarioNombre?: string
  nota?: string
  zona?: string
  requeridoPara?: string
  items: SolicitudItem[]
}): Promise<SolicitudInsumo> {
  const { data: sol, error: e1 } = await supabase
    .from('insumos_solicitudes')
    .insert({
      operario_id: input.operarioId,
      operario_nombre: input.operarioNombre ?? null,
      nota: input.nota ?? null,
      zona: input.zona ?? null,
      requerido_para: input.requeridoPara ?? null,
    })
    .select('*')
    .single()
  if (e1 || !sol) throw e1 ?? new Error('No se pudo crear la solicitud')

  const rows = input.items.map((it) => ({
    solicitud_id: sol.id,
    insumo_id: it.insumoId ?? null,
    insumo_nombre: it.insumoNombre,
    unidad: it.unidad,
    cantidad: it.cantidad,
  }))
  if (rows.length) {
    const { error: e2 } = await supabase.from('insumos_solicitud_items').insert(rows)
    if (e2) throw new Error(e2.message || 'No se pudieron guardar los ítems')
  }
  return mapSolicitud({ ...sol, items: rows.map((r, i) => ({ id: `tmp-${i}`, ...r })) })
}

/**
 * ENTREGA DIRECTA: el supervisor entrega insumos a un operario SIN solicitud
 * previa. Crea la solicitud ya ENTREGADA con origen='DIRECTA', sus ítems (la
 * cantidad pedida = la despachada, la pone el supervisor), y registra la SALIDA
 * del kardex por ítem. El operario igual debe dar su aval (queda ENTREGADA sin
 * confirmar → le aparece la tarjeta "¿Recibiste?"). Devuelve los insumos con el
 * stock actualizado para refrescar el contexto.
 */
export async function entregarDirecto(input: {
  operarioId: string
  operarioNombre?: string
  despachadoPor?: string
  equipoCodigo: string
  horometro?: number
  ruta?: string
  nota?: string
  evidenciaUrls: string[]
  /** Bodega de la que sale el material (el satélite del supervisor). */
  bodegaId?: string
  /** ¿Engrasó la máquina? `undefined` = no se preguntó. */
  engraso?: boolean
  items: { insumoId: string; insumoNombre: string; unidad: string; cantidad: number }[]
}): Promise<{ solicitudId: string; insumos: Insumo[] }> {
  const ahora = new Date().toISOString()
  const { data: sol, error: e1 } = await supabase
    .from('insumos_solicitudes')
    .insert({
      operario_id: input.operarioId,
      operario_nombre: input.operarioNombre ?? null,
      nota: input.nota ?? null,
      origen: 'DIRECTA',
      estado: 'ENTREGADA',
      entregado_en: ahora,
      despachado_por: input.despachadoPor ?? null,
      ruta: input.ruta ?? null,
      horometro: input.horometro ?? null,
      equipo_codigo: input.equipoCodigo,
      bodega_id: input.bodegaId ?? null,
      evidencia_urls: input.evidenciaUrls,
      engraso: input.engraso ?? null,
    })
    .select('id')
    .single()
  if (e1 || !sol) throw e1 ?? new Error('No se pudo crear la entrega directa')

  const itemRows = input.items.map((it) => ({
    solicitud_id: sol.id,
    insumo_id: it.insumoId,
    insumo_nombre: it.insumoNombre,
    unidad: it.unidad,
    cantidad: it.cantidad,
    cantidad_despachada: it.cantidad,
  }))
  if (itemRows.length) {
    const { error: e2 } = await supabase.from('insumos_solicitud_items').insert(itemRows)
    if (e2) throw new Error(e2.message || 'No se pudieron guardar los ítems')
  }

  const insumos: Insumo[] = []
  for (const it of input.items) {
    if (it.insumoId && it.cantidad > 0) {
      const upd = await registrarMovimientoInsumo({
        insumoId: it.insumoId,
        tipo: 'SALIDA',
        cantidad: it.cantidad,
        motivo: 'Entrega directa',
        referencia: sol.id,
        creadoPor: input.despachadoPor,
        equipoCodigo: input.equipoCodigo,
        bodegaId: input.bodegaId,
      })
      insumos.push(upd)
    }
  }
  return { solicitudId: sol.id, insumos }
}

/**
 * Kardex para el REPORTE de consumo (todos los tipos, con nombre de insumo y
 * máquina). Filtra por rango de fechas si se pasa. Se une a `insumos` para el
 * nombre/unidad sin depender del contexto.
 */
export async function loadKardexReporte(opts?: { desde?: string; hasta?: string; limit?: number }): Promise<InsumoKardex[]> {
  let query = supabase
    .from('insumos_kardex')
    .select('id,insumo_id,tipo,cantidad,saldo,motivo,referencia,creado_por,created_at,fecha_efectiva,equipo_codigo,bodega_id')
    .order('fecha_efectiva', { ascending: false })
    .limit(opts?.limit ?? 5000)
  // Por fecha EFECTIVA: si el supervisor corrigió la fecha de un despacho, el
  // movimiento tiene que caer en el mes en que de verdad ocurrió.
  if (opts?.desde) query = query.gte('fecha_efectiva', opts.desde)
  if (opts?.hasta) query = query.lte('fecha_efectiva', opts.hasta)
  const { data, error } = await query
  if (error || !data) return []
  return data.map(mapKardex)
}

export async function loadSolicitudes(opts?: {
  operarioId?: string
  estados?: SolicitudEstado[]
  limit?: number
}): Promise<SolicitudInsumo[]> {
  // `*` a propósito (no lista explícita): así la carga NO se rompe si una
  // migración de columna nueva (ej. confirmación fase 4) aún no se ha corrido.
  let query = supabase
    .from('insumos_solicitudes')
    .select('*,items:insumos_solicitud_items(*)')
    .order('created_at', { ascending: false })
    .limit(opts?.limit ?? 200)
  if (opts?.operarioId) query = query.eq('operario_id', opts.operarioId)
  if (opts?.estados && opts.estados.length) query = query.in('estado', opts.estados)
  try {
    const { data, error } = await query
    if (error || !data) throw error ?? new Error('empty')
    const mapped = (data as Record<string, unknown>[]).map(mapSolicitud)
    // Se guarda TODO lo que llega para que sin senal el supervisor siga viendo
    // las solicitudes que le tocaba despachar. Sin esto la bandeja salia vacia.
    void db.solicitudes.bulkPut(mapped)
    return mapped
  } catch {
    let cache = await db.solicitudes.toArray()
    if (opts?.operarioId) cache = cache.filter((x) => x.operarioId === opts.operarioId)
    if (opts?.estados && opts.estados.length) cache = cache.filter((x) => opts.estados!.includes(x.estado))
    return cache
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, opts?.limit ?? 200)
  }
}

export async function updateSolicitudEstado(
  id: string,
  estado: SolicitudEstado,
  motivoRechazo?: string,
): Promise<void> {
  const payload: Record<string, unknown> = { estado, updated_at: new Date().toISOString() }
  if (motivoRechazo !== undefined) payload.motivo_rechazo = motivoRechazo || null
  const { error } = await supabase.from('insumos_solicitudes').update(payload).eq('id', id)
  if (error) throw new Error(error.message || 'No se pudo actualizar la solicitud')
}

// AVAL DEL OPERARIO (fase 4): confirma la recepción de una solicitud ENTREGADA.
// conforme=true → recibió todo; false → reporta diferencia (nota con el motivo).
// Si viene `items` (rectificación de cantidades), por cada ítem con recibida <
// despachada se registra una DEVOLUCIÓN al kardex (ENTRADA con referencia a la
// solicitud y la misma máquina) — el despacho original NO se toca; el consumo
// neto queda por lo realmente recibido. Solo el operario dispara esto.
// Requiere la migración 20260711120000; si no está, falla SOLO esta acción
// (la carga y el despacho no dependen de las columnas nuevas).
export async function confirmarRecepcion(input: {
  solicitudId: string
  operarioId: string
  conforme: boolean
  nota?: string
  equipoCodigo?: string
  /** Bodega de la que salió el despacho: la devolución regresa ahí. */
  bodegaId?: string
  items?: { itemId?: string; insumoId?: string; insumoNombre: string; unidad: string; cantidadDespachada: number; cantidadRecibida: number }[]
}): Promise<void> {
  const { error } = await supabase
    .from('insumos_solicitudes')
    .update({
      confirmado_en: new Date().toISOString(),
      confirmado_por: input.operarioId,
      conforme: input.conforme,
      confirmacion_nota: input.nota?.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.solicitudId)
    .eq('estado', 'ENTREGADA')
  if (error) throw new Error(error.message || 'No se pudo confirmar la recepción')

  for (const it of input.items ?? []) {
    // Clamp defensivo: recibida entre 0 y lo despachado.
    const recibida = Math.max(0, Math.min(Number(it.cantidadRecibida) || 0, it.cantidadDespachada))
    if (it.itemId) {
      const { error: eIt } = await supabase
        .from('insumos_solicitud_items')
        .update({ cantidad_recibida: recibida })
        .eq('id', it.itemId)
      if (eIt) throw new Error(eIt.message || 'No se pudo guardar la cantidad recibida')
    }
    const diff = Number((it.cantidadDespachada - recibida).toFixed(2))
    if (it.insumoId && diff > 0) {
      // Evento NUEVO de devolución (no se edita la salida original del despacho).
      await registrarMovimientoInsumo({
        insumoId: it.insumoId,
        tipo: 'ENTRADA',
        cantidad: diff,
        motivo: `Devolución: operario confirmó ${recibida} de ${it.cantidadDespachada} ${it.unidad}`,
        referencia: input.solicitudId,
        creadoPor: input.operarioId,
        equipoCodigo: input.equipoCodigo,
        bodegaId: input.bodegaId,
      })
    }
  }
}

// Sube una foto de evidencia de despacho al bucket `avatars` (público) y
// devuelve su URL. Reutiliza el mismo storage de las fotos de usuario.
export async function uploadEvidencia(solicitudId: string, file: File, idx: number): Promise<string> {
  // La tirilla de la bomba entra por aquí igual que una foto de campo, pero de
  // ella hay que poder LEER el número: va con el perfil de documento.
  const esDocumento = solicitudId.startsWith('tanqueo-')
  const liviana = await comprimirImagen(file, esDocumento ? PERFIL_IMAGEN.documento : PERFIL_IMAGEN.evidencia)
  const ext = (liviana.name.split('.').pop() || 'jpg').toLowerCase()
  const path = `despachos/${solicitudId}-${idx}-${Date.now()}.${ext}`
  const { error } = await supabase.storage
    .from('avatars')
    .upload(path, liviana, { upsert: true, contentType: liviana.type || 'image/jpeg' })
  if (error) throw error
  const { data } = supabase.storage.from('avatars').getPublicUrl(path)
  return data.publicUrl
}

/**
 * Entrega (despacha) una solicitud: por cada ítem genera una SALIDA en el kardex
 * y descuenta el stock; guarda evidencia/ruta/quién y marca la solicitud como
 * ENTREGADA. Devuelve los insumos actualizados (para refrescar el inventario).
 */
export async function entregarSolicitud(input: {
  solicitudId: string
  despachadoPor?: string
  ruta?: string
  horometro?: number
  equipoCodigo?: string
  evidenciaUrls: string[]
  /** Bodega de la que sale el material (el satélite del supervisor). */
  bodegaId?: string
  /** ¿Engrasó la máquina? `undefined` = no se preguntó. */
  engraso?: boolean
  /**
   * Lo que se entrega. Un ítem SIN `itemId` es adicional: el operario no lo
   * pidió pero el supervisor se lo lleva de una — pasa todo el tiempo, y antes
   * tocaba hacer una entrega directa aparte para lo mismo.
   */
  items: { itemId?: string; insumoId?: string; insumoNombre?: string; unidad?: string; cantidadDespachada: number }[]
}): Promise<Insumo[]> {
  const actualizados: Insumo[] = []
  for (const it of input.items) {
    if (it.insumoId && it.cantidadDespachada > 0) {
      const upd = await registrarMovimientoInsumo({
        insumoId: it.insumoId,
        tipo: 'SALIDA',
        cantidad: it.cantidadDespachada,
        motivo: 'Despacho de solicitud',
        referencia: input.solicitudId,
        creadoPor: input.despachadoPor,
        equipoCodigo: input.equipoCodigo,
        bodegaId: input.bodegaId,
      })
      actualizados.push(upd)
    }
    if (it.itemId) {
      await supabase
        .from('insumos_solicitud_items')
        .update({ cantidad_despachada: it.cantidadDespachada })
        .eq('id', it.itemId)
    } else if (it.insumoId && it.cantidadDespachada > 0) {
      // Adicional: entra a la solicitud con `cantidad = 0` porque no se pidió,
      // y `cantidad_despachada` con lo que se llevó. Así el operario lo ve en
      // su tarjeta de aval y queda claro que fue de más, no que pidió eso.
      await supabase.from('insumos_solicitud_items').insert({
        solicitud_id: input.solicitudId,
        insumo_id: it.insumoId,
        insumo_nombre: it.insumoNombre ?? '',
        unidad: it.unidad ?? '',
        cantidad: 0,
        cantidad_despachada: it.cantidadDespachada,
      })
    }
  }

  const { error } = await supabase
    .from('insumos_solicitudes')
    .update({
      estado: 'ENTREGADA',
      entregado_en: new Date().toISOString(),
      despachado_por: input.despachadoPor ?? null,
      ruta: input.ruta ?? null,
      horometro: input.horometro ?? null,
      equipo_codigo: input.equipoCodigo ?? null,
      bodega_id: input.bodegaId ?? null,
      evidencia_urls: input.evidenciaUrls,
      engraso: input.engraso ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.solicitudId)
  if (error) throw new Error(error.message || 'No se pudo registrar la entrega')

  return actualizados
}

/**
 * Corrige un despacho YA entregado: fecha, máquina y cantidades.
 *
 * Existe porque el registro y el hecho no ocurren al mismo tiempo. El supervisor
 * entrega a las 6 de la mañana en el lote y registra a las 4 de la tarde cuando
 * vuelve a tener señal; se equivoca de máquina entre dos que están juntas; anota
 * 20 galones donde eran 25. Sin esto, el reporte queda mal para siempre.
 *
 * **Las dos fechas.** `created_at` no se toca nunca: es cuándo se tecleó, y es la
 * evidencia que permite detectar a alguien retrofechando movimientos.
 * `fecha_efectiva` es cuándo ocurrió de verdad, y es la que usan todos los
 * reportes. Editar cambia la segunda y deja intacta la primera.
 *
 * **Se corrige en su sitio, no se compensa.** Igual que al anular un traslado: un
 * despacho que fue de 25 galones siempre fue de 25, y dejar una salida de 20 más
 * un ajuste de 5 mete en el libro un movimiento físico que nadie hizo. El rastro
 * de la corrección vive en `insumos_despachos_auditoria`, no en el inventario.
 *
 * ⚠️ Solo toca las filas **SALIDA** de este despacho. La ENTRADA que genera el
 * aval del operario cuando reclama una diferencia es un hecho suyo, aparte, y
 * pisarla borraría su reclamo.
 */
export async function editarDespacho(input: {
  solicitudId: string
  /** Nueva fecha efectiva (ISO). Si no viene, la fecha no cambia. */
  entregadoEn?: string
  equipoCodigo?: string
  /**
   * Lectura del horómetro al entregar.
   *
   * ⚠️ OJO con dónde pesa: `equipo_horometro_v` NO lee de aquí (solo de
   * `asignaciones` y `combustible_externo`), así que corregirlo no mueve el
   * horómetro oficial de la máquina ni el preventivo. Donde sí manda es en el
   * **informe semanal**, que calcula las horas trabajadas restando el horómetro
   * de una entrega contra el de la siguiente — un dedazo ahí deja la semana
   * entera sin horas.
   */
  horometro?: number | null
  /** Bodega de la que salió: se necesita para rehacer el saldo. */
  bodegaId?: string
  items: { itemId: string; insumoId: string; cantidadDespachada: number }[]
  /**
   * Materiales que se SUMAN al despacho ahora, no los que ya estaban.
   *
   * Quedan marcados con `agregado_en` = el momento exacto, y con `cantidad: 0`
   * porque el operario no los pidió — igual que los adicionales de la entrega.
   * Descuentan stock de verdad: es material que sale de la bodega.
   */
  nuevos?: { insumoId: string; insumoNombre: string; unidad: string; cantidad: number }[]
  editadoPor?: string
}): Promise<Insumo[]> {
  // El estado ANTERIOR, para la auditoría. Sin esto solo quedaría el valor
  // nuevo, que no responde la pregunta que se le hace a una auditoría.
  const { data: antesRow, error: eLeer } = await supabase
    .from('insumos_solicitudes')
    .select('*,items:insumos_solicitud_items(*)')
    .eq('id', input.solicitudId)
    .maybeSingle()
  if (eLeer) throw new Error(eLeer.message)
  if (!antesRow) throw new Error('No se encontró el despacho')

  const antes = mapSolicitud(antesRow as Record<string, unknown>)
  if (antes.estado !== 'ENTREGADA') {
    throw new Error('Solo se puede editar un despacho ya entregado')
  }

  const cambios: Record<string, { antes: unknown; despues: unknown }> = {}
  const bodegaId = input.bodegaId ?? antes.bodegaId
  const actualizados: Insumo[] = []

  // ── 1. La cabecera ────────────────────────────────────────────────────────
  const parche: Record<string, unknown> = { updated_at: new Date().toISOString() }

  if (input.entregadoEn && input.entregadoEn !== antes.entregadoEn) {
    parche.entregado_en = input.entregadoEn
    cambios.fecha = { antes: antes.entregadoEn, despues: input.entregadoEn }
  }
  if (input.equipoCodigo && input.equipoCodigo !== antes.equipoCodigo) {
    parche.equipo_codigo = input.equipoCodigo
    cambios.maquina = { antes: antes.equipoCodigo, despues: input.equipoCodigo }
  }
  // `undefined` = no se tocó · `null` = se borró a propósito. Son distintos: un
  // horómetro que nadie anotó no es lo mismo que uno que se borró por errado.
  if (input.horometro !== undefined && input.horometro !== antes.horometro) {
    parche.horometro = input.horometro
    cambios.horometro = { antes: antes.horometro ?? null, despues: input.horometro }
  }
  if (Object.keys(parche).length > 1) {
    const { error } = await supabase
      .from('insumos_solicitudes').update(parche).eq('id', input.solicitudId)
    if (error) throw new Error(error.message || 'No se pudo guardar el cambio')
  }

  // ── 2. Las cantidades, ítem por ítem ──────────────────────────────────────
  const insumosTocados = new Set<string>()

  for (const it of input.items) {
    const previo = antes.items.find((x) => x.id === it.itemId)
    const cantAntes = previo?.cantidadDespachada ?? 0
    const cantNueva = redondear2(it.cantidadDespachada)
    if (previo && cantAntes === cantNueva) continue

    await supabase
      .from('insumos_solicitud_items')
      .update({ cantidad_despachada: cantNueva })
      .eq('id', it.itemId)

    cambios[`cantidad:${previo?.insumoNombre ?? it.insumoId}`] = { antes: cantAntes, despues: cantNueva }
    insumosTocados.add(it.insumoId)

    // La fila del kardex se corrige, no se compensa. En cero se borra: un
    // movimiento de cero unidades no es un hecho, es ruido en el libro.
    const filtro = supabase
      .from('insumos_kardex')
      .select('id')
      .eq('referencia', input.solicitudId)
      .eq('insumo_id', it.insumoId)
      .eq('tipo', 'SALIDA')
    const { data: filas } = await filtro
    const ids = (filas ?? []).map((f) => String((f as { id: unknown }).id))

    if (ids.length) {
      if (cantNueva > 0) {
        await supabase.from('insumos_kardex').update({ cantidad: cantNueva }).in('id', ids)
      } else {
        await supabase.from('insumos_kardex').delete().in('id', ids)
      }
    }
  }

  // ── 3. Fecha y máquina en el kardex ───────────────────────────────────────
  // Sin esto la corrección se queda en la solicitud y los reportes —que leen el
  // kardex— seguirían mostrando lo viejo. Es el error que hace que dos pantallas
  // de la misma app den números distintos.
  const parcheKardex: Record<string, unknown> = {}
  if (cambios.fecha) parcheKardex.fecha_efectiva = input.entregadoEn
  if (cambios.maquina) parcheKardex.equipo_codigo = input.equipoCodigo
  if (Object.keys(parcheKardex).length) {
    await supabase
      .from('insumos_kardex')
      .update(parcheKardex)
      .eq('referencia', input.solicitudId)
      .eq('tipo', 'SALIDA')
  }

  // ── 4. Rehacer el saldo ───────────────────────────────────────────────────
  // ⚠️ `recalcularStockBodega` trata el AJUSTE como "fija el saldo". Si el par
  // insumo/bodega tiene ajustes, verificar el resultado: ya mordió una vez.
  if (bodegaId) {
    for (const insumoId of insumosTocados) {
      await recalcularStockBodega(insumoId, bodegaId)
      const { data } = await supabase.from('insumos').select('*').eq('id', insumoId).maybeSingle()
      if (data) actualizados.push(mapInsumo(data as Record<string, unknown>))
    }
  }

  // ── 4b. Materiales que se suman AHORA ─────────────────────────────────────
  // Van con la hora exacta en que se agregaron: es lo que permite distinguir
  // "salió con el despacho" de "se sumó tres horas después", que para el cliente
  // son dos hechos distintos.
  for (const nu of input.nuevos ?? []) {
    const cant = redondear2(nu.cantidad)
    if (!nu.insumoId || cant <= 0) continue
    const cuando = new Date().toISOString()

    await supabase.from('insumos_solicitud_items').insert({
      solicitud_id: input.solicitudId,
      insumo_id: nu.insumoId,
      insumo_nombre: nu.insumoNombre,
      unidad: nu.unidad,
      // Pedido = 0: el operario no lo pidió. Lo entregado es lo que se ve.
      cantidad: 0,
      cantidad_despachada: cant,
      agregado_en: cuando,
      agregado_por: input.editadoPor ?? null,
    })

    // Sale de la bodega de verdad, así que mueve inventario.
    const upd = await registrarMovimientoInsumo({
      insumoId: nu.insumoId,
      tipo: 'SALIDA',
      cantidad: cant,
      motivo: 'Material agregado al despacho',
      referencia: input.solicitudId,
      creadoPor: input.editadoPor,
      equipoCodigo: input.equipoCodigo ?? antes.equipoCodigo,
      bodegaId,
    })
    actualizados.push(upd)
    cambios[`agregado:${nu.insumoNombre}`] = { antes: null, despues: `${cant} ${nu.unidad}` }
  }

  // ── 5. La auditoría ───────────────────────────────────────────────────────
  if (Object.keys(cambios).length) {
    await supabase.from('insumos_despachos_auditoria').insert({
      solicitud_id: input.solicitudId,
      accion: 'EDITAR',
      cambios,
      editado_por: input.editadoPor ?? null,
    })
  }

  return actualizados
}

/**
 * Elimina un despacho que nunca debió existir: se entregó a la máquina
 * equivocada, se registró dos veces, o simplemente no pasó.
 *
 * **Borra, no compensa** — la misma decisión que en `anularTraslado`, y por el
 * mismo motivo que el cliente ya explicó una vez: registrar una devolución deja
 * el saldo cuadrado pero mete en el libro dos movimientos físicos que nadie
 * hizo, y la salida original sigue contando como consumo de la máquina en todos
 * los reportes. Un despacho que no ocurrió no ocurrió.
 *
 * **Nada se pierde.** El despacho completo —con sus ítems, su evidencia y su
 * aval— queda guardado en `insumos_despachos_auditoria` antes de borrarse. El
 * rastro de la equivocación vive ahí, no en el inventario.
 *
 * **A dónde vuelve la solicitud.** Si la pidió un operario, vuelve a
 * `PROGRAMADA`: él sigue necesitando ese material y borrar la entrega mal hecha
 * no borra su necesidad — reaparece en la bandeja para despacharla bien. Una
 * entrega DIRECTA no tiene pedido detrás, así que queda `CANCELADA`.
 */
export async function eliminarDespacho(input: {
  solicitudId: string
  motivo: string
  eliminadoPor?: string
}): Promise<Insumo[]> {
  const { data: row, error: eLeer } = await supabase
    .from('insumos_solicitudes')
    .select('*,items:insumos_solicitud_items(*)')
    .eq('id', input.solicitudId)
    .maybeSingle()
  if (eLeer) throw new Error(eLeer.message)
  if (!row) throw new Error('No se encontró el despacho')

  const desp = mapSolicitud(row as Record<string, unknown>)
  if (desp.estado !== 'ENTREGADA') {
    throw new Error('Solo se puede eliminar un despacho ya entregado')
  }

  // 1. La copia ANTES de tocar nada. Si algo falla después, esta fila es lo
  //    único que permitiría reconstruir lo que había.
  await supabase.from('insumos_despachos_auditoria').insert({
    solicitud_id: input.solicitudId,
    accion: 'ELIMINAR',
    cambios: { motivo: input.motivo, despacho: row },
    editado_por: input.eliminadoPor ?? null,
  })

  // 2. Fuera del libro de inventario — TODAS las filas, no solo las SALIDA.
  //    Aquí sí entra la ENTRADA del aval: si el despacho no ocurrió, la
  //    devolución por diferencia tampoco tiene de qué ser devolución.
  const { error: eBorrar } = await supabase
    .from('insumos_kardex').delete().eq('referencia', input.solicitudId)
  if (eBorrar) throw new Error(eBorrar.message || 'No se pudo limpiar el movimiento')

  // 3. Rehacer el saldo de cada material que tocaba.
  const actualizados: Insumo[] = []
  if (desp.bodegaId) {
    const insumosTocados = [...new Set(desp.items.map((it) => it.insumoId).filter(Boolean))] as string[]
    for (const insumoId of insumosTocados) {
      await recalcularStockBodega(insumoId, desp.bodegaId)
      const { data } = await supabase.from('insumos').select('*').eq('id', insumoId).maybeSingle()
      if (data) actualizados.push(mapInsumo(data as Record<string, unknown>))
    }
  }

  // 4. La solicitud vuelve a donde estaba antes de la entrega. Se limpia el
  //    aval además de la entrega: si no, al re-despacharla el operario vería su
  //    confirmación vieja sobre material que no ha recibido.
  const directa = desp.origen === 'DIRECTA'
  const { error: eEstado } = await supabase
    .from('insumos_solicitudes')
    .update({
      estado: directa ? 'CANCELADA' : 'PROGRAMADA',
      motivo_rechazo: directa ? input.motivo : null,
      entregado_en: null,
      despachado_por: null,
      horometro: null,
      evidencia_urls: [],
      engraso: null,
      confirmado_en: null,
      confirmado_por: null,
      conforme: null,
      confirmacion_nota: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.solicitudId)
  if (eEstado) throw new Error(eEstado.message || 'No se pudo actualizar la solicitud')

  // Lo despachado se limpia; lo PEDIDO no se toca — es lo que el operario sigue
  // necesitando y es lo que precarga el próximo despacho.
  await supabase
    .from('insumos_solicitud_items')
    .update({ cantidad_despachada: null, cantidad_recibida: null })
    .eq('solicitud_id', input.solicitudId)

  return actualizados
}

/** Las ediciones de un despacho, la más reciente primero. */
export async function loadEdicionesDespacho(solicitudId: string): Promise<EdicionDespacho[]> {
  const { data, error } = await supabase
    .from('insumos_despachos_auditoria')
    .select('*')
    .eq('solicitud_id', solicitudId)
    .order('editado_en', { ascending: false })
  if (error || !data) return []
  return data.map((r) => ({
    id: Number((r as { id: unknown }).id),
    solicitudId: String((r as { solicitud_id: unknown }).solicitud_id),
    cambios: ((r as { cambios: unknown }).cambios ?? {}) as EdicionDespacho['cambios'],
    editadoPor: (r as { editado_por?: unknown }).editado_por
      ? String((r as { editado_por: unknown }).editado_por) : undefined,
    editadoEn: String((r as { editado_en: unknown }).editado_en ?? ''),
  }))
}

// ──────────────────── Marcas de "revisado" de la Planilla ────────────────────
// Cada fila = una celda (operario × día) marcada como revisada por el propietario.
// La tabla la crea la migración 20260615_planilla_revisiones. Toggle = upsert/delete.

// Color de resaltado de una celda (tonos pastel en la UI).
export type HighlightColor = 'azul' | 'rojo' | 'amarillo' | 'verde'

export interface PlanillaRevision {
  operadorId: string
  fecha: string
  color: HighlightColor
}

function normalizeColor(value: unknown): HighlightColor {
  const v = String(value ?? 'azul').toLowerCase()
  return v === 'rojo' || v === 'amarillo' || v === 'verde' ? v : 'azul'
}

export async function loadPlanillaRevisiones(): Promise<PlanillaRevision[]> {
  const { data, error } = await supabase
    .from('planilla_revisiones')
    .select('operador_id,fecha,color')
  if (error || !data) return []
  return data.map((r) => ({
    operadorId: String(r.operador_id),
    fecha: String(r.fecha),
    color: normalizeColor(r.color),
  }))
}

// color = null → quita la marca; un color → la pinta/repinta de ese color.
export async function setPlanillaRevision(
  operadorId: string,
  fecha: string,
  color: HighlightColor | null,
  revisadoPor?: string,
): Promise<void> {
  if (color) {
    const { error } = await supabase
      .from('planilla_revisiones')
      .upsert(
        { operador_id: operadorId, fecha, color, revisado_por: revisadoPor ?? null },
        { onConflict: 'operador_id,fecha' },
      )
    if (error) throw new Error(error.message || 'No se pudo marcar la casilla')
  } else {
    const { error } = await supabase
      .from('planilla_revisiones')
      .delete()
      .eq('operador_id', operadorId)
      .eq('fecha', fecha)
    if (error) throw new Error(error.message || 'No se pudo desmarcar la casilla')
  }
}

// ─────────────────── Marcas de "revisado" de la pestaña Labores ───────────────────
// Cada fila = una labor (asignación) marcada como revisada. Toggle = upsert/delete.

export async function loadLaborRevisiones(): Promise<string[]> {
  const { data, error } = await supabase
    .from('labor_revisiones')
    .select('asignacion_id')
  if (error || !data) return []
  return data.map((r) => String(r.asignacion_id))
}

export async function setLaborRevision(
  asignacionId: string,
  revisado: boolean,
  revisadoPor?: string,
): Promise<void> {
  if (revisado) {
    const { error } = await supabase
      .from('labor_revisiones')
      .upsert({ asignacion_id: asignacionId, revisado_por: revisadoPor ?? null }, { onConflict: 'asignacion_id' })
    if (error) throw new Error(error.message || 'No se pudo marcar la labor')
  } else {
    const { error } = await supabase
      .from('labor_revisiones')
      .delete()
      .eq('asignacion_id', asignacionId)
    if (error) throw new Error(error.message || 'No se pudo desmarcar la labor')
  }
}

export async function clearAllLaborRevisiones(): Promise<void> {
  const { error } = await supabase
    .from('labor_revisiones')
    .delete()
    .neq('asignacion_id', '__none__')
  if (error) throw new Error(error.message || 'No se pudieron limpiar las marcas')
}

// ──────────── Novedades del operario (disponibilidad) → Planilla ────────────
// Cada fila = un día marcado para un operario con un tipo de novedad.
//   V = Vacaciones · T = Taller · NP = No programado · D = Descanso
//   P = Permiso    · C = Camioneta

// Camioneta se reporta con turno: CD = día, CN = noche (misma letra "C" en la
// planilla, color distinto). 'C' pelado = legado (datos anteriores). 'E' = Enfermedad.
export type NovedadTipo = 'V' | 'T' | 'NP' | 'D' | 'P' | 'E' | 'C' | 'CD' | 'CN' | 'MV' | 'F' | 'OV' | 'MT' | 'IN' | 'SP' | 'LL'
// Tipos ofrecidos en los botones (C se reporta como CD/CN).
export const NOVEDAD_TIPOS: NovedadTipo[] = ['V', 'T', 'NP', 'D', 'P', 'E', 'IN', 'F', 'OV', 'MV', 'MT', 'SP', 'LL', 'CD', 'CN']
const ALL_NOVEDAD: NovedadTipo[] = ['V', 'T', 'NP', 'D', 'P', 'E', 'C', 'CD', 'CN', 'MV', 'F', 'OV', 'MT', 'IN', 'SP', 'LL']
export const NOVEDAD_LABEL: Record<NovedadTipo, string> = {
  V: 'Vacaciones',
  T: 'Taller',
  NP: 'No programado',
  D: 'Descanso',
  P: 'Permiso',
  E: 'Enfermedad',
  C: 'Camioneta',
  CD: 'Camioneta día',
  CN: 'Camioneta noche',
  MV: 'Máquina varada',
  F: 'Falta sin justa causa',
  OV: 'Oficios varios',
  MT: 'Máquina en traslado',
  IN: 'Incapacidad',
  SP: 'Supervisor',
  LL: 'Lluvia',
}

// Letra/código que se muestra en la celda de la Planilla. Se muestra tal cual
// (CD = camioneta día, CN = camioneta noche), todo en el mismo color.
export function novLetter(tipo: NovedadTipo): string {
  return tipo
}

function normalizeNovedad(value: unknown): NovedadTipo {
  const v = String(value ?? '').trim().toUpperCase()
  return (ALL_NOVEDAD as string[]).includes(v) ? (v as NovedadTipo) : 'V'
}

export interface OperarioNovedad {
  operadorId: string
  fecha: string
  tipo: NovedadTipo
}

export async function loadOperarioNovedades(operadorId?: string): Promise<OperarioNovedad[]> {
  let query = supabase.from('operario_novedades').select('operador_id,fecha,tipo')
  // Filtro opcional: la vista del operario solo necesita SUS novedades.
  if (operadorId) query = query.eq('operador_id', operadorId)
  const { data, error } = await query
  if (error || !data) return []
  return data.map((r) => ({
    operadorId: String(r.operador_id),
    fecha: String(r.fecha),
    tipo: normalizeNovedad(r.tipo),
  }))
}

// Marca (upsert) un rango de días con un tipo de novedad para un operario.
export async function setOperarioNovedades(
  operadorId: string,
  fechas: string[],
  tipo: NovedadTipo,
): Promise<void> {
  if (fechas.length === 0) return
  const rows = fechas.map((fecha) => ({ operador_id: operadorId, fecha, tipo }))
  const { error } = await supabase
    .from('operario_novedades')
    .upsert(rows, { onConflict: 'operador_id,fecha' })
  if (error) throw new Error(error.message || 'No se pudo registrar la novedad')
}

// Borra las novedades de un operario en un rango (para corregir un reporte).
export async function clearOperarioNovedades(operadorId: string, fechas: string[]): Promise<void> {
  if (fechas.length === 0) return
  const { error } = await supabase
    .from('operario_novedades')
    .delete()
    .eq('operador_id', operadorId)
    .in('fecha', fechas)
  if (error) throw new Error(error.message || 'No se pudo quitar la novedad')
}

export async function clearAllPlanillaRevisiones(): Promise<void> {
  // Borra TODAS las marcas. El filtro neq(sentinela) hace match de todas las filas
  // (Supabase exige un filtro en delete).
  const { error } = await supabase
    .from('planilla_revisiones')
    .delete()
    .neq('operador_id', '__none__')
  if (error) throw new Error(error.message || 'No se pudieron limpiar las marcas')
}

export async function appLogin(userId: string, pin: string) {
  const { data, error } = await supabase.rpc('app_login', {
    p_user_id: userId,
    p_pin: pin,
  })

  if (error || !data?.length) {
    throw error ?? new Error('Credenciales invalidas')
  }

  const row = data[0]

  const { data: fotoRow } = await supabase
    .from('app_usuarios')
    .select('foto_url')
    .eq('id', row.id)
    .maybeSingle()

  return {
    id: String(row.id),
    name: String(row.nombre_completo),
    role: mapRole(row.rol),
    equipmentCode: String(row.equipo_codigo ?? ''),
    photoUrl: fotoRow?.foto_url ? String(fotoRow.foto_url) : undefined,
  } as UserProfile
}

export async function uploadUserPhoto(userId: string, file: File): Promise<string> {
  const liviana = await comprimirImagen(file, PERFIL_IMAGEN.avatar)
  const ext = (liviana.name.split('.').pop() || 'jpg').toLowerCase()
  const path = `${userId}.${ext}`

  const { error: uploadError } = await supabase.storage
    .from('avatars')
    .upload(path, liviana, { upsert: true, contentType: liviana.type || 'image/jpeg' })

  if (uploadError) throw uploadError

  const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path)
  const url = `${urlData.publicUrl}?t=${Date.now()}`

  const { error: updateError } = await supabase
    .from('app_usuarios')
    .update({ foto_url: url })
    .eq('id', userId)

  if (updateError) throw updateError

  return url
}

// ── Módulo Flota / Escolta (CDA-F-68) ───────────────────────────────────────

function mapFlota(row: Record<string, unknown>): FlotaServicio {
  const n = (v: unknown) => (v == null ? undefined : Number(v))
  const s = (v: unknown) => (v == null || v === '' ? undefined : String(v))
  const estado = String(row.estado ?? 'REGISTRADO').toUpperCase()
  return {
    id: String(row.id),
    createdAt: String(row.created_at ?? ''),
    fecha: String(row.fecha ?? ''),
    vehiculo: s(row.vehiculo),
    tipoServicio: s(row.tipo_servicio),
    centroCosto: s(row.centro_costo),
    procesoSolicitante: s(row.proceso_solicitante),
    nombrePasajero: s(row.nombre_pasajero),
    origen: s(row.origen),
    destino: s(row.destino),
    horaSalidaOrigen: s(row.hora_salida_origen),
    horaLlegadaDestino: s(row.hora_llegada_destino),
    horaSalidaDestino: s(row.hora_salida_destino),
    horaLlegadaOrigen: s(row.hora_llegada_origen),
    horaEspera: s(row.hora_espera),
    numPeajes: n(row.num_peajes),
    otrosGastos: n(row.otros_gastos),
    totalKm: n(row.total_km),
    observacion: s(row.observacion),
    conductorId: s(row.conductor_id),
    conductorNombre: s(row.conductor_nombre),
    firmaUrl: s(row.firma_url),
    firmaNombre: s(row.firma_nombre),
    evidenciaUrl: s(row.evidencia_url),
    estado: estado === 'ANULADO' ? 'ANULADO' : 'REGISTRADO',
  }
}

/** Sube una imagen (firma o evidencia) del módulo flota, comprimida y liviana. */
export async function uploadImagenFlota(prefijoId: string, file: File, etiqueta: 'firma' | 'evidencia'): Promise<string> {
  const liviana = await comprimirImagen(file, PERFIL_IMAGEN.evidencia)
  const path = `flota/${prefijoId}-${etiqueta}-${Date.now()}.jpg`
  const { error } = await supabase.storage
    .from('avatars')
    .upload(path, liviana, { upsert: true, contentType: 'image/jpeg' })
  if (error) throw error
  const { data } = supabase.storage.from('avatars').getPublicUrl(path)
  return data.publicUrl
}

export async function loadFlotaServicios(opts?: { conductorId?: string; desde?: string; hasta?: string; limit?: number }): Promise<FlotaServicio[]> {
  // `*` a propósito: resiliente si una columna nueva aún no se migró.
  let q = supabase.from('flota_servicios').select('*').order('fecha', { ascending: false }).order('created_at', { ascending: false }).limit(opts?.limit ?? 500)
  if (opts?.conductorId) q = q.eq('conductor_id', opts.conductorId)
  if (opts?.desde) q = q.gte('fecha', opts.desde)
  if (opts?.hasta) q = q.lte('fecha', opts.hasta)
  const { data, error } = await q
  if (error || !data) return []
  return (data as Record<string, unknown>[]).map(mapFlota)
}

export async function createFlotaServicio(input: CreateFlotaServicioInput): Promise<FlotaServicio> {
  const { data, error } = await supabase
    .from('flota_servicios')
    .insert({
      fecha: input.fecha,
      vehiculo: input.vehiculo ?? null,
      tipo_servicio: input.tipoServicio ?? null,
      centro_costo: input.centroCosto ?? null,
      proceso_solicitante: input.procesoSolicitante ?? null,
      nombre_pasajero: input.nombrePasajero ?? null,
      origen: input.origen ?? null,
      destino: input.destino ?? null,
      hora_salida_origen: input.horaSalidaOrigen ?? null,
      hora_llegada_destino: input.horaLlegadaDestino ?? null,
      hora_salida_destino: input.horaSalidaDestino ?? null,
      hora_llegada_origen: input.horaLlegadaOrigen ?? null,
      hora_espera: input.horaEspera ?? null,
      num_peajes: input.numPeajes ?? 0,
      otros_gastos: input.otrosGastos ?? 0,
      total_km: input.totalKm ?? 0,
      observacion: input.observacion ?? null,
      conductor_id: input.conductorId ?? null,
      conductor_nombre: input.conductorNombre ?? null,
      firma_url: input.firmaUrl ?? null,
      firma_nombre: input.firmaNombre ?? null,
      evidencia_url: input.evidenciaUrl ?? null,
    })
    .select('*')
    .single()
  if (error || !data) throw error ?? new Error('No se pudo registrar el servicio')
  return mapFlota(data)
}

export async function anularFlotaServicio(id: string): Promise<void> {
  const { error } = await supabase.from('flota_servicios').update({ estado: 'ANULADO', updated_at: new Date().toISOString() }).eq('id', id)
  if (error) throw new Error(error.message || 'No se pudo anular el servicio')
}

export async function appChangePin(userId: string, currentPin: string, newPin: string) {
  const { error } = await supabase.rpc('app_change_pin', {
    p_user_id: userId,
    p_current_pin: currentPin,
    p_new_pin: newPin,
  })

  if (error) {
    throw new Error(error.message || 'Error al cambiar PIN')
  }

  return true
}

export async function createAppUser(input: {
  id: string
  nombreCompleto: string
  rol: string
  pin: string
  equipoCodigo: string
  zona?: string
}) {
  const { error } = await supabase.rpc('app_create_user', {
    p_id: input.id.toUpperCase(),
    p_nombre: input.nombreCompleto,
    p_rol: input.rol,
    p_pin: input.pin,
    p_equipo_codigo: input.equipoCodigo || null,
    p_zona: input.zona || null,
  })

  if (error) {
    throw new Error(error.message || 'No se pudo crear el usuario')
  }

  return true
}

export async function updateAppUser(input: {
  id: string
  nombreCompleto: string
  rol: string
  pin: string
  equipoCodigo: string
  zona?: string
}) {
  const { error } = await supabase.rpc('app_update_user', {
    p_id: input.id.toUpperCase(),
    p_nombre: input.nombreCompleto,
    p_rol: input.rol,
    p_pin: input.pin || null,
    p_equipo_codigo: input.equipoCodigo || null,
    p_zona: input.zona || null,
  })

  if (error) {
    throw new Error(error.message || 'No se pudo actualizar el usuario')
  }

  return true
}

/**
 * Elimina un usuario. La RPC `app_delete_user` hace soft-delete (activo=false),
 * así que deja de aparecer (loadAppUsers filtra activo=true) y no puede iniciar
 * sesión, pero se conserva la integridad histórica de sus asignaciones.
 */
export async function deleteAppUser(id: string) {
  const { error } = await supabase.rpc('app_delete_user', { p_id: id.toUpperCase() })
  if (error) {
    throw new Error(error.message || 'No se pudo eliminar el usuario')
  }
  return true
}

// Activa/desactiva un usuario (RPC app_set_user_activo, migración 20260623160000).
// Reactivar un nombre que ya tiene otro usuario ACTIVO falla por el índice único
// app_usuarios_nombre_activo_uniq — se traduce a un mensaje claro.
export async function setAppUserActivo(id: string, activo: boolean) {
  const { error } = await supabase.rpc('app_set_user_activo', { p_id: id.toUpperCase(), p_activo: activo })
  if (error) {
    if ((error as { code?: string }).code === '23505' || /unique|duplicate/i.test(error.message || '')) {
      throw new Error('Ya existe un usuario ACTIVO con ese nombre. Desactiva o renombra el otro primero.')
    }
    throw new Error(error.message || 'No se pudo cambiar el estado del usuario')
  }
  return true
}

// Traduce los errores del blindaje de BD a mensajes accionables para el usuario.
export function traducirErrorAsignacion(error: unknown): Error {
  const e = error as { message?: string; details?: string; hint?: string; code?: string }
  // Los errores de Supabase NO son instancias de Error → hay que leer el objeto.
  const blob = `${e?.message ?? ''} ${e?.details ?? ''} ${e?.hint ?? ''}`
  const code = e?.code ?? ''
  if (blob.includes('AREA_EXCEDIDA')) {
    return new Error(
      'Esta suerte ya tiene su área registrada en el ciclo; este registro EXCEDERÍA el área de la suerte. Probablemente es un duplicado — revísalo.',
    )
  }
  if (code === '23505' && blob.includes('asignaciones_activa_uniq')) {
    return new Error(
      'Ya existe una labor ACTIVA idéntica (misma suerte, labor y operario). Continúala/reasígnala en vez de crear otra.',
    )
  }
  // Falta de columna (migración sin correr) u otro error → mostrar el mensaje
  // REAL para no esconder la causa (antes caía a un genérico inútil).
  if (code === '42703' || blob.toLowerCase().includes('column')) {
    return new Error(`Falta una columna en la base de datos (¿migración sin correr?). Detalle: ${e?.message ?? blob}`)
  }
  if (error instanceof Error) return error
  if (e?.message) return new Error(e.message)
  return new Error('No se pudo guardar la asignación.')
}

export async function createAssignment(input: CreateAssignmentInput) {
  const { data, error } = await supabase
    .from('asignaciones')
    .insert(mapAssignmentPayload(input))
    .select('*')
    .single()

  if (error || !data) {
    throw traducirErrorAsignacion(error ?? new Error('No se pudo crear la asignacion'))
  }

  return mapAssignment(data as Record<string, unknown>)
}

export interface RegistrarLaborInput {
  haciendaCode: string
  haciendaName: string
  suerte: string
  labor: string
  operatorId: string
  operatorName: string
  supervisorId: string
  supervisorName: string
  equipmentCode: string
  equipmentName: string
  area: number
  horometroInicial: number | null
  horometroFinal: number | null
  cliente: 'ingenios' | 'proveedores'
  zone: Zone | null
  notes?: string
}

/**
 * Registro RÁPIDO por el supervisor de una labor YA REALIZADA por un operario
 * (los ~5% poco afines a la tecnología). Un solo INSERT que nace COMPLETADA y
 * APROBADA, con horómetro inicial+final y área ejecutada en una sola pantalla.
 * Supervisor y zona vienen del supervisor logueado (no se piden). area_asignada
 * = area_realizada = hectáreas registradas.
 */
export async function registrarLaborRealizada(input: RegistrarLaborInput) {
  const now = new Date().toISOString()
  const payload = {
    suerte_codigo: `${input.haciendaCode}-${input.suerte}`,
    numero_suerte: input.suerte,
    codigo_hacienda: input.haciendaCode,
    nombre_hacienda: input.haciendaName,
    labor_nombre: input.labor,
    tractor: input.equipmentName || input.equipmentCode,
    equipo_codigo: input.equipmentCode,
    equipo_nombre: input.equipmentName || input.equipmentCode,
    area_asignada: input.area,
    area_realizada: input.area,
    estado: 'COMPLETADA',
    fecha_inicio: now,
    fecha_fin: now,
    horometro_inicial: input.horometroInicial,
    horometro_final: input.horometroFinal,
    tipo_area: 'NETA',
    observaciones: input.notes ?? '',
    supervisor_id: input.supervisorId,
    supervisor_nombre: input.supervisorName,
    operador_id: input.operatorId,
    operador_nombre: input.operatorName,
    tipo_registro: 'ASIGNADA',
    cliente: input.cliente,
    aprobacion: 'APROBADA',
    aprobada_por: input.supervisorId,
    aprobada_en: now,
    zona: input.zone,
    editado_por: input.supervisorId,
  }
  const { data, error } = await supabase
    .from('asignaciones')
    .insert(payload)
    .select('*')
    .single()
  if (error || !data) throw traducirErrorAsignacion(error ?? new Error('No se pudo registrar la labor'))
  const created = mapAssignment(data as Record<string, unknown>)
  // Traza en labor_sesiones (horas-máquina / eficiencia), igual que un cierre
  // normal — antes el registro rápido no aparecía en esos reportes.
  const horas =
    input.horometroInicial != null && input.horometroFinal != null
      ? Number((input.horometroFinal - input.horometroInicial).toFixed(2))
      : null
  void createLaborSesion({
    asignacionId: created.id,
    suerteCodigo: created.suerteCode,
    numeroSuerte: created.suerte,
    nombreHacienda: created.haciendaName,
    laborNombre: created.labor,
    operadorId: created.operatorId,
    operadorNombre: created.operatorName,
    equipoCodigo: created.equipmentCode,
    equipoNombre: created.equipmentName,
    fecha: dayKey(now),
    horometroInicial: input.horometroInicial,
    horometroFinal: input.horometroFinal,
    horas,
    areaEjecutada: input.area,
  }).catch(() => { /* la traza no bloquea el registro */ })
  return created
}

/**
 * Asigna (o quita) un N° de factura a VARIAS labores de una vez. `facturaNumero`
 * null/'' = desfacturar. Estampa `editado_por` (queda en la auditoría). En chunks
 * para no exceder el largo de URL de PostgREST.
 */
export async function setFacturaBulk(
  ids: string[],
  facturaNumero: string | null,
  editadoPor?: string,
): Promise<void> {
  if (ids.length === 0) return
  const payload: Record<string, unknown> = { factura_numero: facturaNumero || null }
  if (editadoPor) payload.editado_por = editadoPor
  const CHUNK = 100
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { error } = await supabase
      .from('asignaciones')
      .update(payload)
      .in('id', ids.slice(i, i + CHUNK))
    if (error) throw traducirErrorAsignacion(error)
  }
}

export interface AsignacionAuditoria {
  id: number
  accion: 'INSERT' | 'UPDATE'
  cambios: Record<string, unknown> | null
  editadoPor: string | null
  editadoEn: string
}

/** Historial de cambios (auditoría) de una labor, más reciente primero. */
export async function loadAuditoria(assignmentId: string): Promise<AsignacionAuditoria[]> {
  const { data, error } = await supabase
    .from('asignaciones_auditoria')
    .select('id,accion,cambios,editado_por,editado_en')
    .eq('asignacion_id', assignmentId)
    .order('editado_en', { ascending: false })
  if (error || !data) return []
  return data.map((r) => ({
    id: Number(r.id),
    accion: r.accion === 'INSERT' ? 'INSERT' : 'UPDATE',
    cambios: (r.cambios ?? null) as Record<string, unknown> | null,
    editadoPor: r.editado_por ? String(r.editado_por) : null,
    editadoEn: String(r.editado_en ?? ''),
  }))
}

export async function updateAssignment(
  assignmentId: string,
  input: UpdateAssignmentInput,
) {
  const payload: Record<string, unknown> = {}

  if (input.status) payload.estado = input.status
  if (input.startedAt !== undefined) payload.fecha_inicio = input.startedAt
  if (input.finishedAt !== undefined) payload.fecha_fin = input.finishedAt
  if (input.executedArea !== undefined) payload.area_realizada = input.executedArea
  if (input.notes !== undefined) payload.observaciones = input.notes
  if (input.equipmentCode !== undefined) payload.equipo_codigo = input.equipmentCode
  if (input.equipmentName !== undefined) {
    payload.equipo_nombre = input.equipmentName
    payload.tractor = input.equipmentName
  }
  if (input.horometroInicial !== undefined) payload.horometro_inicial = input.horometroInicial
  if (input.horometroFinal !== undefined) payload.horometro_final = input.horometroFinal
  if (input.approval !== undefined) payload.aprobacion = input.approval
  if (input.approvedBy !== undefined) payload.aprobada_por = input.approvedBy
  if (input.approvedAt !== undefined) payload.aprobada_en = input.approvedAt
  if (input.operatorId !== undefined) payload.operador_id = input.operatorId
  if (input.operatorName !== undefined) payload.operador_nombre = input.operatorName
  if (input.supervisorId !== undefined) payload.supervisor_id = input.supervisorId
  if (input.supervisorName !== undefined) payload.supervisor_nombre = input.supervisorName
  if (input.liberada !== undefined) payload.liberada = input.liberada
  if (input.cliente !== undefined) payload.cliente = input.cliente
  if (input.zone !== undefined) payload.zona = input.zone
  if (input.createdAt !== undefined) payload.created_at = input.createdAt
  if (input.editadoPor !== undefined) payload.editado_por = input.editadoPor
  if (input.facturaNumero !== undefined) payload.factura_numero = input.facturaNumero || null

  const { data, error } = await supabase
    .from('asignaciones')
    .update(payload)
    .eq('id', assignmentId)
    .select('*')
    .single()

  if (error || !data) {
    throw traducirErrorAsignacion(error ?? new Error('No se pudo actualizar la asignacion'))
  }

  return mapAssignment(data as Record<string, unknown>)
}

export async function approveAssignment(assignmentId: string, supervisorId: string) {
  return updateAssignment(assignmentId, {
    approval: 'APROBADA',
    approvedBy: supervisorId,
    approvedAt: new Date().toISOString(),
  })
}

export async function rejectAssignment(assignmentId: string, supervisorId: string) {
  return updateAssignment(assignmentId, {
    approval: 'RECHAZADA',
    approvedBy: supervisorId,
    approvedAt: new Date().toISOString(),
  })
}

export function summarizeAssignments(
  assignments: Assignment[],
  targetDate: string,
): DashboardMetrics {
  // Include assignments created today OR completed/parcial today (prior-day carryovers).
  const relevant = assignments.filter(
    (a) =>
      a.status !== 'CANCELADA' &&
      (a.dateKey === targetDate ||
        ((a.status === 'COMPLETADA' || a.status === 'PARCIAL') &&
          dayKey(a.finishedAt) === targetDate)),
  )
  // plannedArea DEDUP por suerte+labor: el split de cruce-de-día y el
  // multi-operario crean varias filas con el ÁREA COMPLETA de la misma suerte;
  // sumarlas duplica el planificado. Se toma el MAX por suerte+labor (el área
  // real de la suerte, una sola vez). executedArea SÍ se suma (cada aporte real).
  const plannedBySuerte = new Map<string, number>()
  for (const a of relevant) {
    const key = `${a.suerteCode}|${a.labor.trim().toUpperCase()}`
    plannedBySuerte.set(key, Math.max(plannedBySuerte.get(key) ?? 0, a.area))
  }
  const plannedArea = [...plannedBySuerte.values()].reduce((s, v) => s + v, 0)
  // Misma fórmula en TODAS las vistas (Resumen/Reporte/Hoy): una COMPLETADA/
  // PARCIAL sin área ejecutada registrada cuenta su área planificada.
  const execDe = (a: Assignment) => (a.executedArea > 0 ? a.executedArea : a.area)
  const executedArea = relevant
    .filter((a) => a.status === 'COMPLETADA' || a.status === 'PARCIAL')
    .reduce((sum, a) => sum + execDe(a), 0)
  const inProgress = relevant.filter((a) => a.status === 'EN_PROCESO').length
  // Área facturada: área ejecutada de labores que YA tienen N° de factura.
  const billedArea = relevant
    .filter((a) => (a.status === 'COMPLETADA' || a.status === 'PARCIAL') && !!(a.facturaNumero && a.facturaNumero.trim()))
    .reduce((sum, a) => sum + execDe(a), 0)

  return {
    plannedArea,
    executedArea,
    completion: plannedArea ? Math.round((executedArea / plannedArea) * 100) : 0,
    inProgress,
    billedArea,
  }
}

// Fecha "efectiva" para agrupación por quincena / mes (Resumen, Historial, Tablero).
// Una labor asignada el 14-may pero TERMINADA el 16-may debe contar como del 16-may
// para el cliente: lo importante operacionalmente es CUÁNDO se ejecutó, no cuándo se planeó.
//
//   COMPLETADA → fecha_fin
//   EN_PROCESO → fecha_inicio
//   PENDIENTE / CANCELADA → created_at (no hay ejecución todavía / fue cancelada)
//
// El display "Programada en X" sigue mostrando `dateKey` (= creación) intacto en otras
// partes de la UI. Esta función solo se usa donde se quiere agrupar por "ejecución".
export function executionDateKey(a: Assignment): string {
  if ((a.status === 'COMPLETADA' || a.status === 'PARCIAL') && a.finishedAt) return dayKey(a.finishedAt)
  if (a.status === 'EN_PROCESO' && a.startedAt) return dayKey(a.startedAt)
  return a.dateKey
}

export interface LaborSesionInput {
  asignacionId: string
  suerteCodigo: string
  numeroSuerte: string
  nombreHacienda: string
  laborNombre: string
  operadorId: string
  operadorNombre: string
  equipoCodigo: string
  equipoNombre: string
  fecha: string
  horometroInicial: number | null
  horometroFinal: number | null
  horas: number | null
  areaEjecutada: number
}

// Inserta una fila INMUTABLE en labor_sesiones: registro evento-a-evento de cada
// cierre/parcial (no se actualiza nunca). Es el detalle "uno a uno" para reportes
// de horómetros, horas-máquina y eficiencias. La tabla la crea la migración
// 20260614_labor_sesiones.
export async function createLaborSesion(input: LaborSesionInput) {
  const { error } = await supabase.from('labor_sesiones').insert({
    asignacion_id: input.asignacionId,
    suerte_codigo: input.suerteCodigo,
    numero_suerte: input.numeroSuerte,
    nombre_hacienda: input.nombreHacienda,
    labor_nombre: input.laborNombre,
    operador_id: input.operadorId,
    operador_nombre: input.operadorNombre,
    equipo_codigo: input.equipoCodigo,
    equipo_nombre: input.equipoNombre,
    fecha: input.fecha,
    horometro_inicial: input.horometroInicial,
    horometro_final: input.horometroFinal,
    horas: input.horas,
    area_ejecutada: input.areaEjecutada,
  })
  if (error) throw new Error(error.message || 'No se pudo registrar la sesión')
}

// Cancela en BLOQUE (estado=CANCELADA) las asignaciones cuyos ids se pasan.
// Sirve para depurar pendientes viejas sin iniciar. Es REVERSIBLE (no borra;
// solo cambia el estado). El cliente decide QUÉ ids (las que mostró el conteo).
export async function cancelAssignmentsBulk(ids: string[]) {
  if (ids.length === 0) return
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200)
    const { error } = await supabase
      .from('asignaciones')
      .update({ estado: 'CANCELADA' })
      .in('id', chunk)
    if (error) throw new Error(error.message || 'No se pudieron cancelar las asignaciones')
  }
}

// Política de ciclo de vida (migración 20260708130000): cancela PENDIENTE y
// EN_PROCESO sin área ejecutada con +3d (abandonadas) y purga canceladas sin
// trabajo con +3d. NUNCA toca COMPLETADA/PARCIAL ni EN_PROCESO con avance real.
// Lo dispara el cliente 1 vez al día (throttle en el contexto).
export async function runRetention(): Promise<{ canceladas: number; borradas: number }> {
  const { data, error } = await supabase.rpc('sam_run_retention')
  if (error) throw new Error(error.message || 'No se pudo correr la limpieza automática')
  const d = (data ?? {}) as { canceladas?: number; borradas?: number }
  return { canceladas: Number(d.canceladas ?? 0), borradas: Number(d.borradas ?? 0) }
}

// Borrado REAL (DELETE) de una asignación. Irreversible. Solo para ajustes de
// liquidación por dueño/administración desde el Reporte. La cache local se
// limpia en el llamador (setAssignments + db.assignments.delete).
export async function deleteAssignment(id: string): Promise<void> {
  const { error } = await supabase.from('asignaciones').delete().eq('id', id)
  if (error) throw new Error(error.message || 'No se pudo eliminar la labor')
}

export function formatTime(value: string | null) {
  if (!value) return '-'

  return new Date(value).toLocaleTimeString('es-CO', {
    timeZone: 'America/Bogota',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Fecha "de realizado" para los Historiales (operario y propietario/admin).
 * Para COMPLETADA/PARCIAL usa el timestamp real de cierre (finishedAt) en tz
 * Bogota; para el resto (ej. CANCELADA) cae al dateKey de ejecucion, parseado
 * POR PARTES para evitar el corrimiento de un dia de `new Date('YYYY-MM-DD')`
 * (interpreta UTC y en Bogota -05 retrocede al dia anterior).
 * Devuelve algo como "04 jun 2026".
 */
export function formatExecutionDate(a: Assignment): string {
  const iso = a.status === 'COMPLETADA' || a.status === 'PARCIAL' ? a.finishedAt : null
  if (iso) {
    return new Date(iso).toLocaleDateString('es-CO', {
      timeZone: 'America/Bogota',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    })
  }
  const [y, m, d] = executionDateKey(a).split('-').map(Number)
  if (!y || !m || !d) return ''
  return new Date(y, m - 1, d).toLocaleDateString('es-CO', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

/**
 * El supervisor toma material de la principal por su cuenta.
 *
 * Existe por un motivo concreto de la operación: el supervisor de insumos llega
 * a las 5:30 de la mañana y el analista entra a las 7:00. Antes solo podía
 * servirse solo el combustible; los materiales dependían de que administración
 * le enviara un traslado, así que si no había nadie se quedaba sin ganchos —
 * o se los llevaba sin registrar, que es peor.
 *
 * El movimiento se hace de UNA (ya se lo llevó físicamente) y el traslado nace
 * `RECIBIDO` porque quien saca y quien recibe son la misma persona: pedirle que
 * "confirme" lo que él mismo tomó sería un paso vacío. Lo que sí queda es el
 * aval del analista, igual que con el combustible.
 */
export async function autoAbastecer(input: {
  bodegaDestinoId: string
  supervisorId: string
  supervisorNombre?: string
  nota?: string
  items: { insumoId: string; insumoNombre: string; unidad: string; cantidad: number }[]
}): Promise<void> {
  const principal = await bodegaPrincipal()
  if (!principal) throw new Error('No hay bodega principal configurada')
  if (principal.id === input.bodegaDestinoId) throw new Error('No puedes abastecerte de tu propia bodega')

  const items = input.items.filter((i) => i.insumoId && i.cantidad > 0)
  if (items.length === 0) throw new Error('Elige al menos un insumo con cantidad')

  const { data, error } = await supabase
    .from('insumos_traslados')
    .insert({
      origen_id: principal.id,
      destino_id: input.bodegaDestinoId,
      estado: 'RECIBIDO',
      enviado_por: input.supervisorId,
      nota: input.nota?.trim() || null,
      recibido_en: new Date().toISOString(),
      recibido_por: input.supervisorId,
      conforme: true,
      autoservicio: true,
      aval_estado: 'PENDIENTE',
    })
    .select('id')
    .single()
  if (error || !data) throw error ?? new Error('No se pudo registrar el abastecimiento')
  const trasladoId = String(data.id)

  const { error: e2 } = await supabase.from('insumos_traslado_items').insert(
    items.map((i) => ({
      traslado_id: trasladoId,
      insumo_id: i.insumoId,
      insumo_nombre: i.insumoNombre,
      unidad: i.unidad,
      cantidad: redondear2(i.cantidad),
      cantidad_recibida: redondear2(i.cantidad),
    })),
  )
  if (e2) throw new Error(e2.message || 'No se pudieron guardar los ítems')

  // Sale de la principal y entra al carro, en el mismo acto.
  for (const i of items) {
    await registrarMovimientoInsumo({
      insumoId: i.insumoId,
      tipo: 'SALIDA',
      cantidad: i.cantidad,
      motivo: 'Autoabastecimiento del satélite (pendiente de aval)',
      referencia: trasladoId,
      creadoPor: input.supervisorId,
      bodegaId: principal.id,
    })
    await registrarMovimientoInsumo({
      insumoId: i.insumoId,
      tipo: 'ENTRADA',
      cantidad: i.cantidad,
      motivo: 'Autoabastecimiento del satélite (pendiente de aval)',
      referencia: trasladoId,
      creadoPor: input.supervisorId,
      bodegaId: input.bodegaDestinoId,
    })
  }
}

/** Autoabastecimientos por estado de aval (la bandeja del analista). */
export async function loadAutoabastecimientos(estado?: 'PENDIENTE' | 'APROBADO' | 'RECHAZADO'): Promise<Traslado[]> {
  let q = supabase
    .from('insumos_traslados')
    .select('*, items:insumos_traslado_items(*)')
    .eq('autoservicio', true)
    .order('created_at', { ascending: false })
    .limit(200)
  if (estado) q = q.eq('aval_estado', estado)
  const { data, error } = await q
  if (error || !data) return []
  return (data as Record<string, unknown>[]).map(mapTraslado)
}

/**
 * Aval del analista sobre un autoabastecimiento.
 *
 * Aprobar solo lo sella: el material ya se movió al registrarlo. Rechazar
 * REVERSA — el material regresa a la principal y sale del carro — con la misma
 * simetría que la reversa del combustible.
 */
export async function revisarAutoabastecimiento(input: {
  traslado: Traslado
  aprobar: boolean
  revisadoPor: string
  revisadoNombre: string
  nota?: string
}): Promise<void> {
  const { traslado } = input
  if (traslado.avalEstado !== 'PENDIENTE') throw new Error('Este abastecimiento ya fue revisado')

  const { data, error } = await supabase
    .from('insumos_traslados')
    .update({
      aval_estado: input.aprobar ? 'APROBADO' : 'RECHAZADO',
      avalado_por: input.revisadoPor,
      avalado_nombre: input.revisadoNombre,
      avalado_en: new Date().toISOString(),
      aval_nota: input.nota?.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', traslado.id)
    .eq('aval_estado', 'PENDIENTE')
    .select('id')
  if (error) throw new Error(error.message || 'No se pudo registrar el aval')
  // 🔴 Hay que comprobar que el UPDATE de verdad tocó una fila. Sin `.select`,
  // avalar algo ya avalado no falla —simplemente no coincide ninguna fila— y la
  // reversa de abajo se ejecutaría igual, descontando el material DOS VECES.
  if (!data || data.length === 0) throw new Error('Este abastecimiento ya fue revisado por otra persona')

  if (input.aprobar) return

  for (const it of traslado.items) {
    const cant = it.cantidadRecibida ?? it.cantidad
    if (cant <= 0) continue
    await registrarMovimientoInsumo({
      insumoId: it.insumoId,
      tipo: 'SALIDA',
      cantidad: cant,
      motivo: 'Reversa por rechazo del aval',
      referencia: traslado.id,
      creadoPor: input.revisadoPor,
      bodegaId: traslado.destinoId,
    })
    await registrarMovimientoInsumo({
      insumoId: it.insumoId,
      tipo: 'ENTRADA',
      cantidad: cant,
      motivo: 'Reversa por rechazo del aval',
      referencia: traslado.id,
      creadoPor: input.revisadoPor,
      bodegaId: traslado.origenId,
    })
  }
}

// ─────────────────────── Listas de los formularios ───────────────────────

function mapValorCatalogo(r: Record<string, unknown>): ValorCatalogo {
  return {
    id: String(r.id),
    tipo: String(r.tipo),
    valor: String(r.valor),
    descripcion: (r.descripcion as string) ?? undefined,
    frecuente: Boolean(r.frecuente),
    activo: r.activo !== false,
    orden: Number(r.orden ?? 0),
  }
}

/**
 * Valores de una lista. `soloActivos` para los formularios; la pantalla de
 * catálogos los pide todos, porque ahí sí hay que ver los desactivados para
 * poder volver a activarlos.
 */
export async function loadCatalogo(tipo: string, soloActivos = true): Promise<ValorCatalogo[]> {
  let q = supabase.from('catalogos_valores').select('*').eq('tipo', tipo)
  if (soloActivos) q = q.eq('activo', true)
  const { data, error } = await q.order('orden').order('valor')
  if (error || !data) return []
  return (data as Record<string, unknown>[]).map(mapValorCatalogo)
}

export async function crearValorCatalogo(input: {
  tipo: string; valor: string; descripcion?: string; frecuente?: boolean; orden?: number
}): Promise<ValorCatalogo> {
  const { data, error } = await supabase
    .from('catalogos_valores')
    .insert({
      tipo: input.tipo,
      valor: input.valor.trim(),
      descripcion: input.descripcion?.trim() || null,
      frecuente: input.frecuente ?? false,
      orden: input.orden ?? 0,
    })
    .select('*').single()
  // El índice único es por (tipo, upper(valor)): repetir uno no es un error de
  // sistema, es que ya está en la lista.
  if (error?.code === '23505') throw new Error('Ese valor ya está en la lista.')
  if (error || !data) throw new Error(error?.message || 'No se pudo guardar')
  return mapValorCatalogo(data)
}

export async function actualizarValorCatalogo(id: string, patch: {
  valor?: string; descripcion?: string; frecuente?: boolean; activo?: boolean; orden?: number
}): Promise<void> {
  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (patch.valor !== undefined) payload.valor = patch.valor.trim()
  if (patch.descripcion !== undefined) payload.descripcion = patch.descripcion.trim() || null
  if (patch.frecuente !== undefined) payload.frecuente = patch.frecuente
  if (patch.activo !== undefined) payload.activo = patch.activo
  if (patch.orden !== undefined) payload.orden = patch.orden
  const { error } = await supabase.from('catalogos_valores').update(payload).eq('id', id)
  if (error?.code === '23505') throw new Error('Ese valor ya está en la lista.')
  if (error) throw new Error(error.message)
}

export async function eliminarValorCatalogo(id: string): Promise<void> {
  const { error } = await supabase.from('catalogos_valores').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

/**
 * Carga varios valores de una sola vez, pegando una lista completa.
 *
 * Cargar treinta estaciones de a una por el celular no lo hace nadie. Se pega
 * la lista —una por línea— y las repetidas se ignoran en silencio.
 */
export async function cargarListaCatalogo(tipo: string, texto: string): Promise<{ nuevos: number; repetidos: number }> {
  const yaEstan = new Set((await loadCatalogo(tipo, false)).map((v) => v.valor.toUpperCase()))
  const vistos = new Set<string>()
  const nuevos: string[] = []
  for (const linea of texto.split(/\r?\n/)) {
    // Se aceptan viñetas y guiones al principio: la lista suele venir pegada
    // de una nota o un WhatsApp.
    const v = linea.replace(/^[\s\-•*·]+/, '').trim()
    if (!v) continue
    const clave = v.toUpperCase()
    if (yaEstan.has(clave) || vistos.has(clave)) continue
    vistos.add(clave)
    nuevos.push(clave)
  }
  if (nuevos.length === 0) return { nuevos: 0, repetidos: vistos.size }
  const { error } = await supabase.from('catalogos_valores').insert(
    nuevos.map((valor, i) => ({ tipo, valor, frecuente: false, orden: i })),
  )
  if (error) throw new Error(error.message)
  return { nuevos: nuevos.length, repetidos: 0 }
}

/**
 * Una sola entrega, por su id.
 *
 * El detalle de un despacho se abre desde varias pantallas, y no todas cargan
 * la lista completa de solicitudes. Traer solo la que se va a mirar es más
 * barato que obligar a cada pantalla a cargarlas todas por si acaso.
 */
export async function loadSolicitudPorId(id: string): Promise<SolicitudInsumo | null> {
  const { data, error } = await supabase
    .from('insumos_solicitudes')
    .select('*,items:insumos_solicitud_items(*)')
    .eq('id', id)
    .maybeSingle()
  if (error || !data) return null
  return mapSolicitud(data as Record<string, unknown>)
}

/** Un tanqueo por su id: el kardex del abastecimiento en sede apunta acá. */
export async function loadCombustiblePorId(id: string): Promise<CombustibleExterno | null> {
  const { data, error } = await supabase
    .from('combustible_externo')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error || !data) return null
  return mapCombustible(data as Record<string, unknown>)
}

/**
 * Tanqueos a la máquina de este operario que esperan SU confirmación.
 *
 * Los materiales le llegan por `insumos_solicitudes`; el combustible que le
 * tanquearon la máquina vive en otra tabla y hasta ahora nadie lo confirmaba.
 * Es la misma pregunta —"¿esto llegó?"— desde otro lado.
 */
export async function loadTanqueosPorConfirmar(operarioId: string): Promise<CombustibleExterno[]> {
  const { data, error } = await supabase
    .from('combustible_externo')
    .select('*')
    .eq('operario_id', operarioId)
    .is('confirmado_en', null)
    .neq('estado', 'RECHAZADO')
    .order('created_at', { ascending: false })
    .limit(50)
  if (error || !data) return []
  return (data as Record<string, unknown>[]).map(mapCombustible)
}

/**
 * El operario confirma —o reporta problema con— un tanqueo a su máquina.
 *
 * A diferencia del material, aquí NO se reversa inventario cuando dice que no:
 * el combustible ya se quemó o ya salió de la bodega, y lo que hay que corregir
 * es el registro, no el stock. Por eso queda marcado y lo revisa quien avala.
 */
export async function confirmarTanqueo(input: {
  id: string
  conforme: boolean
  nota?: string
  operarioId?: string
}): Promise<void> {
  const { data, error } = await supabase
    .from('combustible_externo')
    .update({
      confirmado_en: new Date().toISOString(),
      confirmado_por: input.operarioId ?? null,
      conforme: input.conforme,
      confirmacion_nota: input.nota?.trim() || null,
    })
    .eq('id', input.id)
    // Sin esto, dos toques seguidos pisan la primera respuesta.
    .is('confirmado_en', null)
    .select('id')
  if (error) throw new Error(error.message)
  if (!data || data.length === 0) throw new Error('Este tanqueo ya fue confirmado')
}
