import { LOCAL_MAESTRO } from '../data/constants'
import type {
  ApprovalStatus,
  Assignment,
  AssignmentStatus,
  CreateEquipmentInput,
  CreateAssignmentInput,
  DashboardMetrics,
  Empresa,
  Equipment,
  Insumo,
  InsumoCategoria,
  InsumoKardex,
  KardexTipo,
  SolicitudEstado,
  SolicitudInsumo,
  SolicitudItem,
  Labor,
  LaborTipo,
  MaestroRow,
  Tercero,
  Zona,
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
      role: row.rol === 'supervisor' ? 'supervisor' : row.rol === 'owner' ? 'owner' : row.rol === 'administracion' ? 'administracion' : row.rol === 'soporte' ? 'soporte' : row.rol === 'supervisor_insumos' ? 'supervisor_insumos' : 'operador',
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
    activo: row.activo == null ? true : Boolean(row.activo),
  }
}

export async function loadInsumos(): Promise<{ data: Insumo[]; source: Source }> {
  try {
    const { data, error } = await supabase.from('insumos').select('id,nombre,categoria,unidad,stock,activo').order('nombre')
    if (error || !data) throw error ?? new Error('empty')
    return { data: data.map(mapInsumo), source: 'supabase' }
  } catch {
    return { data: [], source: 'fallback' }
  }
}

export async function createInsumo(
  nombre: string,
  categoria: InsumoCategoria,
  unidad: string,
): Promise<Insumo> {
  const { data, error } = await supabase
    .from('insumos')
    .insert({ nombre: nombre.trim().toUpperCase(), categoria, unidad: unidad.trim() || 'unidad' })
    .select('id,nombre,categoria,unidad,stock,activo')
    .single()
  if (error || !data) throw error ?? new Error('No se pudo crear el insumo')
  return mapInsumo(data)
}

export async function updateInsumo(
  id: string,
  patch: { nombre?: string; categoria?: InsumoCategoria; unidad?: string; activo?: boolean },
): Promise<Insumo> {
  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (patch.nombre !== undefined) payload.nombre = patch.nombre.trim().toUpperCase()
  if (patch.categoria !== undefined) payload.categoria = patch.categoria
  if (patch.unidad !== undefined) payload.unidad = patch.unidad.trim() || 'unidad'
  if (patch.activo !== undefined) payload.activo = patch.activo
  const { data, error } = await supabase
    .from('insumos')
    .update(payload)
    .eq('id', id)
    .select('id,nombre,categoria,unidad,stock,activo')
    .single()
  if (error || !data) throw error ?? new Error('No se pudo actualizar el insumo')
  return mapInsumo(data)
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
    createdAt: String(row.created_at ?? ''),
    equipoCodigo: row.equipo_codigo ? String(row.equipo_codigo) : undefined,
  }
}

// Carga movimientos del kardex (de un insumo, o todos), recientes primero.
export async function loadKardex(insumoId?: string, limit = 200): Promise<InsumoKardex[]> {
  let query = supabase
    .from('insumos_kardex')
    .select('id,insumo_id,tipo,cantidad,saldo,motivo,referencia,creado_por,created_at,equipo_codigo')
    .order('created_at', { ascending: false })
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
    .select('id,insumo_id,tipo,cantidad,saldo,motivo,referencia,creado_por,created_at,equipo_codigo')
    .eq('equipo_codigo', equipoCodigo)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error || !data) return []
  return data.map(mapKardex)
}

// Carga las SALIDAS del kardex que tienen máquina asignada (para el reporte de
// consumo por equipo / acumulador de costos por tractor).
export async function loadKardexSalidasEquipo(limit = 1000): Promise<InsumoKardex[]> {
  const { data, error } = await supabase
    .from('insumos_kardex')
    .select('id,insumo_id,tipo,cantidad,saldo,motivo,referencia,creado_por,created_at,equipo_codigo')
    .eq('tipo', 'SALIDA')
    .not('equipo_codigo', 'is', null)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error || !data) return []
  return data.map(mapKardex)
}

/**
 * Registra un movimiento de inventario y actualiza el stock del insumo.
 * ENTRADA/AJUSTE(+) suman; SALIDA resta. Devuelve el insumo con el stock nuevo.
 * Nota: la consistencia stock↔kardex se hace en dos pasos (sin transacción);
 * suficiente para el volumen actual. Si se vuelve crítico, pasar a una RPC.
 */
export async function registrarMovimientoInsumo(input: {
  insumoId: string
  tipo: KardexTipo
  cantidad: number
  motivo?: string
  referencia?: string
  creadoPor?: string
  equipoCodigo?: string
}): Promise<Insumo> {
  const { data: actual, error: e1 } = await supabase
    .from('insumos')
    .select('id,nombre,categoria,unidad,stock,activo')
    .eq('id', input.insumoId)
    .single()
  if (e1 || !actual) throw e1 ?? new Error('Insumo no encontrado')

  const cant = Math.abs(Number(input.cantidad))
  const delta = input.tipo === 'SALIDA' ? -cant : cant
  const saldo = Number(actual.stock ?? 0) + delta

  const { error: e2 } = await supabase
    .from('insumos_kardex')
    .insert({
      insumo_id: input.insumoId,
      tipo: input.tipo,
      cantidad: cant,
      saldo,
      motivo: input.motivo ?? null,
      referencia: input.referencia ?? null,
      creado_por: input.creadoPor ?? null,
      equipo_codigo: input.equipoCodigo ?? null,
    })
  if (e2) throw new Error(e2.message || 'No se pudo registrar el movimiento')

  const { data: upd, error: e3 } = await supabase
    .from('insumos')
    .update({ stock: saldo, updated_at: new Date().toISOString() })
    .eq('id', input.insumoId)
    .select('id,nombre,categoria,unidad,stock,activo')
    .single()
  if (e3 || !upd) throw e3 ?? new Error('No se pudo actualizar el stock')
  return mapInsumo(upd)
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
    nota: row.nota ? String(row.nota) : undefined,
    zona: row.zona ? String(row.zona) : undefined,
    motivoRechazo: row.motivo_rechazo ? String(row.motivo_rechazo) : undefined,
    createdAt: String(row.created_at ?? ''),
    entregadoEn: row.entregado_en ? String(row.entregado_en) : undefined,
    despachadoPor: row.despachado_por ? String(row.despachado_por) : undefined,
    ruta: row.ruta ? String(row.ruta) : undefined,
    evidenciaUrls: Array.isArray(row.evidencia_urls) ? (row.evidencia_urls as unknown[]).map(String) : undefined,
    horometro: row.horometro == null ? undefined : Number(row.horometro),
    equipoCodigo: row.equipo_codigo ? String(row.equipo_codigo) : undefined,
    items: rawItems.map((it) => ({
      id: String(it.id),
      insumoId: it.insumo_id ? String(it.insumo_id) : undefined,
      insumoNombre: String(it.insumo_nombre ?? ''),
      unidad: String(it.unidad ?? ''),
      cantidad: Number(it.cantidad ?? 0),
      cantidadDespachada: it.cantidad_despachada == null ? undefined : Number(it.cantidad_despachada),
    })),
  }
}

export async function createSolicitud(input: {
  operarioId: string
  operarioNombre?: string
  nota?: string
  zona?: string
  items: SolicitudItem[]
}): Promise<SolicitudInsumo> {
  const { data: sol, error: e1 } = await supabase
    .from('insumos_solicitudes')
    .insert({
      operario_id: input.operarioId,
      operario_nombre: input.operarioNombre ?? null,
      nota: input.nota ?? null,
      zona: input.zona ?? null,
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

export async function loadSolicitudes(opts?: {
  operarioId?: string
  estados?: SolicitudEstado[]
  limit?: number
}): Promise<SolicitudInsumo[]> {
  let query = supabase
    .from('insumos_solicitudes')
    .select('id,operario_id,operario_nombre,estado,nota,zona,motivo_rechazo,created_at,entregado_en,despachado_por,ruta,evidencia_urls,horometro,equipo_codigo,items:insumos_solicitud_items(id,insumo_id,insumo_nombre,unidad,cantidad,cantidad_despachada)')
    .order('created_at', { ascending: false })
    .limit(opts?.limit ?? 200)
  if (opts?.operarioId) query = query.eq('operario_id', opts.operarioId)
  if (opts?.estados && opts.estados.length) query = query.in('estado', opts.estados)
  const { data, error } = await query
  if (error || !data) return []
  return (data as Record<string, unknown>[]).map(mapSolicitud)
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

// Sube una foto de evidencia de despacho al bucket `avatars` (público) y
// devuelve su URL. Reutiliza el mismo storage de las fotos de usuario.
export async function uploadEvidencia(solicitudId: string, file: File, idx: number): Promise<string> {
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
  const path = `despachos/${solicitudId}-${idx}-${Date.now()}.${ext}`
  const { error } = await supabase.storage
    .from('avatars')
    .upload(path, file, { upsert: true, contentType: file.type || 'image/jpeg' })
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
  items: { itemId?: string; insumoId?: string; cantidadDespachada: number }[]
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
      })
      actualizados.push(upd)
    }
    if (it.itemId) {
      await supabase
        .from('insumos_solicitud_items')
        .update({ cantidad_despachada: it.cantidadDespachada })
        .eq('id', it.itemId)
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
      evidencia_urls: input.evidenciaUrls,
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.solicitudId)
  if (error) throw new Error(error.message || 'No se pudo registrar la entrega')

  return actualizados
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
export type NovedadTipo = 'V' | 'T' | 'NP' | 'D' | 'P' | 'E' | 'C' | 'CD' | 'CN'
// Tipos ofrecidos en los botones (C se reporta como CD/CN).
export const NOVEDAD_TIPOS: NovedadTipo[] = ['V', 'T', 'NP', 'D', 'P', 'E', 'CD', 'CN']
const ALL_NOVEDAD: NovedadTipo[] = ['V', 'T', 'NP', 'D', 'P', 'E', 'C', 'CD', 'CN']
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
