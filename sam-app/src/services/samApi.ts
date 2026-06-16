import { LOCAL_MAESTRO } from '../data/constants'
import type {
  ApprovalStatus,
  Assignment,
  AssignmentStatus,
  CreateEquipmentInput,
  CreateAssignmentInput,
  DashboardMetrics,
  Equipment,
  Labor,
  LaborTipo,
  MaestroRow,
  UpdateAssignmentInput,
  UserProfile,
  Zone,
} from '../domain/sam'
import { db } from '../lib/db'
import { supabase } from '../lib/supabase'

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
const INGENIO_NAMES: Record<string, string> = {
  risaralda: 'Ingenio Risaralda',
  pichichi: 'Ingenio Pichichi',
  mayaguez: 'Ingenio Mayagüez',
  san_carlos: 'Ingenio San Carlos',
  riopaila: 'Ingenio Riopaila',
}

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
  return INGENIO_NAMES[row.ingenio_id] ?? row.ingenio_id
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
  }
}

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
    let page = 0
    // Server-side max-rows en PostgREST capa el response. Si el VPS sube
    // PGRST_DB_MAX_ROWS a 20000+, todo el maestro entra en una sola request.
    // Si sigue capeado a 1000, este loop sigue paginando sin regresion.
    const limit = 20000

    while (hasMore) {
      const { data, error } = await supabase
        .from('maestro_risaralda')
        .select('hacienda,nombre_hacienda,suerte,area_neta,ingenio_id,creado_manual,creado_por')
        .eq('activo', true)
        .order('hacienda')
        .order('suerte')
        .range(page * limit, (page + 1) * limit - 1)

      if (error) throw error

      if (data && data.length > 0) {
        allData = allData.concat(data)
        if (data.length < limit) {
          hasMore = false
        } else {
          page++
        }
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

// IDs de asignaciones con un cambio local pendiente de enviar (outbox
// status='pending', type='UPDATE'). Los usamos en loadAssignments para NO
// sobrescribir esas filas con la version del servidor: si lo hicieramos,
// el cambio offline desapareceria visualmente en el siguiente sync hasta
// que syncOutbox lo envie y vuelva a traerlo. Aunque eventualmente convergen,
// el "parpadeo" confunde al operador. Esta proteccion lo elimina.
async function getPendingOutboxIds(): Promise<Set<string>> {
  const pending = await db.outbox.where('status').equals('pending').toArray()
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
        .select('*')
        .or(`updated_at.gte.${sinceTime},created_at.gte.${sinceTime}`)
        .order('created_at', { ascending: false })

      if (error) throw error

      const deltas = (data ?? []).map((row) => mapAssignment(row as Record<string, unknown>))
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

    // Sync completo (primera carga o cache vacio)
    const { data, error } = await supabase
      .from('asignaciones')
      .select('*')
      .order('created_at', { ascending: false })

    if (error || !data) throw error ?? new Error('empty')

    const mapped = data.map((row) => mapAssignment(row as Record<string, unknown>))

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

export async function loadAppUsers(): Promise<{
  data: UserProfile[]
  source: Source
}> {
  try {
    const { data, error } = await supabase
      .from('app_usuarios')
      .select('id,nombre_completo,rol,equipo_codigo,foto_url')
      .eq('activo', true)
      .order('orden')

    if (error || !data) throw error ?? new Error('empty')

    const mapped: UserProfile[] = data.map((row) => ({
      id: String(row.id),
      name: String(row.nombre_completo),
      role: row.rol === 'supervisor' ? 'supervisor' : row.rol === 'owner' ? 'owner' : row.rol === 'administracion' ? 'administracion' : row.rol === 'soporte' ? 'soporte' : 'operador',
      equipmentCode: String(row.equipo_codigo ?? ''),
      photoUrl: row.foto_url ? String(row.foto_url) : undefined,
    }))
    void db.users.clear().then(() => db.users.bulkPut(mapped))
    return { data: mapped, source: 'supabase' }
  } catch {
    const cached = await db.users.toArray()
    return { data: cached, source: 'fallback' }
  }
}

export async function loadEquipment(): Promise<{
  data: Equipment[]
  source: Source
}> {
  try {
    const { data, error } = await supabase
      .from('equipos')
      .select('codigo,nombre')
      .eq('activo', true)
      .order('codigo')

    if (error || !data) throw error ?? new Error('empty')

    const mapped: Equipment[] = data.map((row) => ({
      code: String(row.codigo),
      name: String(row.nombre),
    }))
    void db.equipment.clear().then(() => db.equipment.bulkPut(mapped))
    return { data: mapped, source: 'supabase' }
  } catch {
    const cached = await db.equipment.toArray()
    return { data: cached, source: 'fallback' }
  }
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
  }
}

export async function loadLabores(): Promise<{ data: Labor[]; source: Source }> {
  try {
    const { data, error } = await supabase
      .from('labores_catalogo')
      .select('id,nombre,activa,tipo')
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
    .select('id,nombre,activa,tipo')
    .single()

  if (error || !data) throw error ?? new Error('No se pudo crear la labor')
  const labor = mapLabor(data)
  void db.labores.put(labor)
  return labor
}

export async function updateLabor(
  id: string,
  patch: { nombre?: string; activa?: boolean; tipo?: LaborTipo },
): Promise<Labor> {
  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (patch.nombre !== undefined) payload.nombre = patch.nombre.trim().toUpperCase()
  if (patch.activa !== undefined) payload.activa = patch.activa
  if (patch.tipo !== undefined) payload.tipo = patch.tipo

  const { data, error } = await supabase
    .from('labores_catalogo')
    .update(payload)
    .eq('id', id)
    .select('id,nombre,activa,tipo')
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

// ──────────────────── Marcas de "revisado" de la Planilla ────────────────────
// Cada fila = una celda (operario × día) marcada como revisada por el propietario.
// La tabla la crea la migración 20260615_planilla_revisiones. Toggle = upsert/delete.

export interface PlanillaRevision {
  operadorId: string
  fecha: string
}

export async function loadPlanillaRevisiones(): Promise<PlanillaRevision[]> {
  const { data, error } = await supabase
    .from('planilla_revisiones')
    .select('operador_id,fecha')
  if (error || !data) return []
  return data.map((r) => ({ operadorId: String(r.operador_id), fecha: String(r.fecha) }))
}

export async function setPlanillaRevision(
  operadorId: string,
  fecha: string,
  revisado: boolean,
  revisadoPor?: string,
): Promise<void> {
  if (revisado) {
    const { error } = await supabase
      .from('planilla_revisiones')
      .upsert(
        { operador_id: operadorId, fecha, revisado_por: revisadoPor ?? null },
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
    role: row.rol === 'supervisor' ? 'supervisor' : row.rol === 'owner' ? 'owner' : row.rol === 'administracion' ? 'administracion' : row.rol === 'soporte' ? 'soporte' : 'operador',
    equipmentCode: String(row.equipo_codigo ?? ''),
    photoUrl: fotoRow?.foto_url ? String(fotoRow.foto_url) : undefined,
  } as UserProfile
}

export async function uploadUserPhoto(userId: string, file: File): Promise<string> {
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
  const path = `${userId}.${ext}`

  const { error: uploadError } = await supabase.storage
    .from('avatars')
    .upload(path, file, { upsert: true, contentType: file.type || 'image/jpeg' })

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
}) {
  const { error } = await supabase.rpc('app_create_user', {
    p_id: input.id.toUpperCase(),
    p_nombre: input.nombreCompleto,
    p_rol: input.rol,
    p_pin: input.pin,
    p_equipo_codigo: input.equipoCodigo || null,
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
}) {
  const { error } = await supabase.rpc('app_update_user', {
    p_id: input.id.toUpperCase(),
    p_nombre: input.nombreCompleto,
    p_rol: input.rol,
    p_pin: input.pin || null,
    p_equipo_codigo: input.equipoCodigo || null,
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

export async function createAssignment(input: CreateAssignmentInput) {
  const { data, error } = await supabase
    .from('asignaciones')
    .insert(mapAssignmentPayload(input))
    .select('*')
    .single()

  if (error || !data) {
    throw error ?? new Error('No se pudo crear la asignacion')
  }

  return mapAssignment(data as Record<string, unknown>)
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
  if (input.liberada !== undefined) payload.liberada = input.liberada
  if (input.cliente !== undefined) payload.cliente = input.cliente
  if (input.zone !== undefined) payload.zona = input.zone

  const { data, error } = await supabase
    .from('asignaciones')
    .update(payload)
    .eq('id', assignmentId)
    .select('*')
    .single()

  if (error || !data) {
    throw error ?? new Error('No se pudo actualizar la asignacion')
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
  const plannedArea = relevant.reduce((sum, a) => sum + a.area, 0)
  // PARCIAL aun esta activa, pero el area ya ejecutada cuenta para el
  // avance del dia (lo hecho es hecho aunque la labor siga abierta).
  const executedArea = relevant
    .filter((a) => a.status === 'COMPLETADA' || a.status === 'PARCIAL')
    .reduce((sum, a) => sum + a.executedArea, 0)
  const inProgress = relevant.filter((a) => a.status === 'EN_PROCESO').length

  return {
    plannedArea,
    executedArea,
    completion: plannedArea ? Math.round((executedArea / plannedArea) * 100) : 0,
    inProgress,
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
