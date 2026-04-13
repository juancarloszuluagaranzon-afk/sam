import Dexie, { type Table } from 'dexie'
import type {
  Assignment,
  CreateAssignmentInput,
  Equipment,
  MaestroRow,
  UpdateAssignmentInput,
  UserProfile,
} from '../domain/sam'

export interface OutboxItem {
  id?: number
  type: 'UPDATE' | 'CREATE'
  // For UPDATE (START, FINISH, CANCEL):
  assignmentId?: string            // real ID or temp ID
  updatePayload?: UpdateAssignmentInput
  // For CREATE (TakeFreeField, CreateAssignment):
  createInput?: CreateAssignmentInput
  tempId?: string                  // local temp ID resolved to real ID on sync
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

    // v1: initial schema
    this.version(1).stores({
      assignments: 'id, status, dateKey, operatorId, suerteCode',
      maestro: '[haciendaCode+suerte], haciendaCode',
      users: 'id',
      equipment: 'code',
      outbox: '++id, assignmentId, status, queuedAt',
      meta: 'key',
    })

    // v2: outbox gains type and tempId indexes; clear any v1 items (incompatible shape)
    this.version(2)
      .stores({
        outbox: '++id, type, assignmentId, tempId, status, queuedAt',
      })
      .upgrade((tx) => tx.table('outbox').clear())
  }
}

export const db = new SamDb()
