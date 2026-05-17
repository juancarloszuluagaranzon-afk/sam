import { LOCAL_MAESTRO } from '../data/constants'
import type {
  ApprovalStatus,
  Assignment,
  AssignmentStatus,
  CreateEquipmentInput,
  CreateAssignmentInput,
  DashboardMetrics,
  Equipment,
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
        .select('hacienda,nombre_hacienda,suerte,area_neta,ingenio_id')
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
      if (deltas.length > 0) {
        await db.assignments.bulkPut(deltas)
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
      await db.meta.put({ key: 'assignments_last_sync', value: now })
    } catch {
      // No bloqueamos el retorno por fallos de escritura local: el caller
      // igual recibe los datos. La proxima sincronizacion intentara escribir
      // de nuevo.
    }
    return { data: mapped, source: 'supabase', error: null }
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
      role: row.rol === 'supervisor' ? 'supervisor' : row.rol === 'owner' ? 'owner' : row.rol === 'administracion' ? 'administracion' : 'operador',
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
    role: row.rol === 'supervisor' ? 'supervisor' : row.rol === 'owner' ? 'owner' : row.rol === 'administracion' ? 'administracion' : 'operador',
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
  // Include assignments created today OR completed today (prior-day carryovers).
  const relevant = assignments.filter(
    (a) =>
      a.status !== 'CANCELADA' &&
      (a.dateKey === targetDate ||
        (a.status === 'COMPLETADA' && dayKey(a.finishedAt) === targetDate)),
  )
  const plannedArea = relevant.reduce((sum, a) => sum + a.area, 0)
  const executedArea = relevant
    .filter((a) => a.status === 'COMPLETADA')
    .reduce((sum, a) => sum + a.executedArea, 0)
  const inProgress = relevant.filter((a) => a.status === 'EN_PROCESO').length

  return {
    plannedArea,
    executedArea,
    completion: plannedArea ? Math.round((executedArea / plannedArea) * 100) : 0,
    inProgress,
  }
}

export function formatTime(value: string | null) {
  if (!value) return '-'

  return new Date(value).toLocaleTimeString('es-CO', {
    timeZone: 'America/Bogota',
    hour: '2-digit',
    minute: '2-digit',
  })
}
