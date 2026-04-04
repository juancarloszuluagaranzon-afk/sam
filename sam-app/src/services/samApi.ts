import { LOCAL_MAESTRO } from '../data/constants'
import type {
  Assignment,
  AssignmentStatus,
  CreateAssignmentInput,
  DashboardMetrics,
  Equipment,
  MaestroRow,
  UpdateAssignmentInput,
  UserProfile,
} from '../domain/sam'
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

function mapAssignment(row: Record<string, unknown>): Assignment {
  const suerteCode = String(row.suerte_codigo ?? '')
  const parts = suerteCode.includes('-') ? suerteCode.split('-') : []
  const haciendaCode = Number(row.codigo_hacienda ?? parts[0] ?? 0)
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
    kind: String(row.tipo_registro ?? 'ASIGNADA'),
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
  }
}

export async function loadMaestro(): Promise<{
  data: MaestroRow[]
  source: Source
}> {
  const { data, error } = await supabase
    .from('maestro_risaralda')
    .select('hacienda,nombre_hacienda,suerte,area_neta')
    .eq('activo', true)
    .order('hacienda')
    .order('suerte')

  if (error || !data?.length) {
    return { data: LOCAL_MAESTRO, source: 'fallback' }
  }

  return {
    data: data.map((row) => ({
      haciendaCode: Number(row.hacienda),
      haciendaName: row.nombre_hacienda,
      suerte: row.suerte,
      area: Number(row.area_neta),
    })),
    source: 'supabase',
  }
}

export async function loadAssignments(): Promise<{
  data: Assignment[]
  source: Source
}> {
  const { data, error } = await supabase
    .from('asignaciones')
    .select('*')
    .order('created_at', { ascending: false })

  if (error || !data) {
    return { data: [], source: 'fallback' }
  }

  return {
    data: data.map((row) => mapAssignment(row as Record<string, unknown>)),
    source: 'supabase',
  }
}

export async function loadAppUsers(): Promise<{
  data: UserProfile[]
  source: Source
}> {
  const { data, error } = await supabase
    .from('app_usuarios')
    .select('id,nombre_completo,rol,equipo_codigo')
    .eq('activo', true)
    .order('orden')

  if (error || !data) {
    return { data: [], source: 'fallback' }
  }

  return {
    data: data.map((row) => ({
      id: String(row.id),
      name: String(row.nombre_completo),
      role: row.rol === 'supervisor' ? 'supervisor' : 'operador',
      equipmentCode: String(row.equipo_codigo ?? ''),
    })),
    source: 'supabase',
  }
}

export async function loadEquipment(): Promise<{
  data: Equipment[]
  source: Source
}> {
  const { data, error } = await supabase
    .from('equipos')
    .select('codigo,nombre')
    .eq('activo', true)
    .order('codigo')

  if (error || !data) {
    return { data: [], source: 'fallback' }
  }

  return {
    data: data.map((row) => ({
      code: String(row.codigo),
      name: String(row.nombre),
    })),
    source: 'supabase',
  }
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

  return {
    id: String(row.id),
    name: String(row.nombre_completo),
    role: row.rol === 'supervisor' ? 'supervisor' : 'operador',
    equipmentCode: String(row.equipo_codigo ?? ''),
  } as UserProfile
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

export function summarizeAssignments(
  assignments: Assignment[],
  targetDate: string,
): DashboardMetrics {
  const sameDay = assignments.filter(
    (assignment) =>
      assignment.dateKey === targetDate && assignment.status !== 'CANCELADA',
  )
  const plannedArea = sameDay.reduce((sum, assignment) => sum + assignment.area, 0)
  const executedArea = sameDay
    .filter((assignment) => assignment.status === 'COMPLETADA')
    .reduce((sum, assignment) => sum + assignment.executedArea, 0)
  const inProgress = sameDay.filter(
    (assignment) => assignment.status === 'EN_PROCESO',
  ).length

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
