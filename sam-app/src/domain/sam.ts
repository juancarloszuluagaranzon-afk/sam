export type Role = 'supervisor' | 'operador' | 'owner' | 'administracion'

export type UserId = 'U002' | 'U003' | 'U004'

export type AssignmentStatus =
  | 'PENDIENTE'
  | 'EN_PROCESO'
  | 'COMPLETADA'
  | 'CANCELADA'
  | 'PARCIAL'

export type ApprovalStatus = 'PENDIENTE' | 'APROBADA' | 'RECHAZADA'

export type Zone = 'NORTE' | 'SUR'

export interface UserProfile {
  id: string
  name: string
  role: Role
  equipmentCode: string
  photoUrl?: string
}

export interface Equipment {
  code: string
  name: string
}

export interface CreateEquipmentInput {
  code: string
  name: string
  type: 'tractor' | 'implemento' | 'vehiculo' | 'otro'
  state: 'activo' | 'en_mantenimiento' | 'inactivo'
  brand: string
  model: string
  year: number | null
  plate: string
  serialNumber: string
  notes: string
  active: boolean
}

export interface MaestroRow {
  haciendaCode: string
  haciendaName: string
  suerte: string
  area: number
  ingenio_id: string
  // Flag de auditoria: distingue suertes oficiales del ingenio (false)
  // de las creadas ad-hoc desde la app cuando el catalogo del ingenio
  // aun no las tiene (true). Cuando el ingenio sincronice, se puede
  // revisar y conciliar las marcadas como manuales.
  creadoManual?: boolean
  creadoPor?: string
}

// Input para crear una suerte ad-hoc desde la app. La completa el
// supervisor u operario en el modal "+ Nueva suerte" cuando una
// suerte que necesita aun no esta en el maestro oficial del ingenio.
export interface CreateMaestroRowInput {
  haciendaCode: string
  haciendaName: string
  suerte: string
  area: number
  ingenio_id: string
  createdBy: string
}

export interface Assignment {
  id: string
  createdAt: string
  dateKey: string
  haciendaCode: string
  haciendaName: string
  suerte: string
  suerteCode: string
  labor: string
  area: number
  status: AssignmentStatus
  operatorId: string
  operatorName: string
  supervisorId: string
  equipmentCode: string
  equipmentName: string
  startedAt: string | null
  finishedAt: string | null
  executedArea: number
  notes: string
  kind: string
  horometroInicial: number | null
  horometroFinal: number | null
  cliente?: 'ingenios' | 'proveedores'
  approval: ApprovalStatus
  approvedBy: string | null
  approvedAt: string | null
  zone: Zone | null
  // Flag de "liberada": el operario rechazo/solto este parcial porque no
  // lo va a terminar. Se oculta de SUS Activas pero la labor sigue abierta
  // (status sin cambiar) para que el supervisor la reasigne/cancele o el
  // operario la retome en campo. Al reasignar se vuelve a poner en false.
  liberada?: boolean
}

export interface DashboardMetrics {
  plannedArea: number
  executedArea: number
  completion: number
  inProgress: number
}

export interface CreateAssignmentInput {
  haciendaCode: string
  haciendaName: string
  suerte: string
  labor: string
  area: number
  supervisorId: string
  supervisorName: string
  operatorId: string
  operatorName: string
  equipmentCode: string
  equipmentName: string
  notes: string
  kind: string
  cliente: 'ingenios' | 'proveedores'
  initialStatus: AssignmentStatus
  startedAt?: string | null
  approval?: ApprovalStatus
  zone?: Zone | null
}

export interface UpdateAssignmentInput {
  status?: AssignmentStatus
  startedAt?: string | null
  finishedAt?: string | null
  executedArea?: number | null
  notes?: string
  equipmentCode?: string
  equipmentName?: string
  horometroInicial?: number | null
  horometroFinal?: number | null
  approval?: ApprovalStatus
  approvedBy?: string | null
  approvedAt?: string | null
  operatorId?: string
  operatorName?: string
  liberada?: boolean
}
