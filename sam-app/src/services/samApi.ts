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

type Source = 'supabase' | 'fallback'

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

export async function loadMaestro(): Promise<{
  data: MaestroRow[]
  source: Source
}> {
  try {
    let allData: any[] = []
    let hasMore = true
    let page = 0
    const limit = 1000

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
    const data = allData

    const mapped: MaestroRow[] = data.map((row) => ({
      haciendaCode: String(row.hacienda),
      haciendaName: row.nombre_hacienda,
      suerte: row.suerte,
      area: Number(row.area_neta),
      ingenio_id: String(row.ingenio_id ?? 'risaralda'),
    }))
    void db.maestro.clear().then(() => db.maestro.bulkPut(mapped))
    return { data: mapped, source: 'supabase' }
  } catch {
    const cached = await db.maestro.toArray()
    if (cached.length) return { data: cached, source: 'fallback' }
    return { data: LOCAL_MAESTRO, source: 'fallback' }
  }
}

export async function loadAssignments(): Promise<{
  data: Assignment[]
  source: Source
}> {
  try {
    const { data, error } = await supabase
      .from('asignaciones')
      .select('*')
      .order('created_at', { ascending: false })

    if (error || !data) throw error ?? new Error('empty')

    const mapped = data.map((row) => mapAssignment(row as Record<string, unknown>))
    void db.assignments.clear().then(() => db.assignments.bulkPut(mapped))
    void db.meta.put({ key: 'assignments_synced_at', value: new Date().toISOString() })
    return { data: mapped, source: 'supabase' }
  } catch {
    const cached = await db.assignments.toArray()
    cached.sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1))
    return { data: cached, source: 'fallback' }
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
