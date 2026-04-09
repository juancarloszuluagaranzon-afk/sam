export type Role = 'supervisor' | 'operador'

export type UserId = 'U002' | 'U003' | 'U004'

export type AssignmentStatus =
  | 'PENDIENTE'
  | 'EN_PROCESO'
  | 'COMPLETADA'
  | 'CANCELADA'

export interface UserProfile {
  id: string
  name: string
  role: Role
  equipmentCode: string
}

export interface Equipment {
  code: string
  name: string
}

export interface MaestroRow {
  haciendaCode: number
  haciendaName: string
  suerte: string
  area: number
}

export interface Assignment {
  id: string
  createdAt: string
  dateKey: string
  haciendaCode: number
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
}

export interface DashboardMetrics {
  plannedArea: number
  executedArea: number
  completion: number
  inProgress: number
}

export interface CreateAssignmentInput {
  haciendaCode: number
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
  initialStatus: AssignmentStatus
  startedAt?: string | null
}

export interface UpdateAssignmentInput {
  status?: AssignmentStatus
  startedAt?: string | null
  finishedAt?: string | null
  executedArea?: number | null
  notes?: string
  equipmentCode?: string
  equipmentName?: string
}
