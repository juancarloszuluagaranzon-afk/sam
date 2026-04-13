import Dexie, { type Table } from 'dexie'
import type { Assignment, Equipment, MaestroRow, UserProfile } from '../domain/sam'
import type { UpdateAssignmentInput } from '../domain/sam'

export interface OutboxItem {
  id?: number
  assignmentId: string
  type: 'START' | 'FINISH'
  payload: UpdateAssignmentInput
  queuedAt: string
  status: 'pending' | 'error'
  errorMessage?: string
}

class SamDb extends Dexie {
  assignments!: Table<Assignment>
  maestro!: Table<MaestroRow>
  users!: Table<UserProfile>
  equipment!: Table<Equipment>
  outbox!: Table<OutboxItem>
  meta!: Table<{ key: string; value: string }>

  constructor() {
    super('sam-offline-v1')
    this.version(1).stores({
      assignments: 'id, status, dateKey, operatorId, suerteCode',
      maestro: '[haciendaCode+suerte], haciendaCode',
      users: 'id',
      equipment: 'code',
      outbox: '++id, assignmentId, status, queuedAt',
      meta: 'key',
    })
  }
}

export const db = new SamDb()
