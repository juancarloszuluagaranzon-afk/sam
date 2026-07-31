import Dexie, { type Table } from 'dexie'
import type {
  Assignment,
  CreateAssignmentInput,
  Equipment,
  Labor,
  MaestroRow,
  UpdateAssignmentInput,
  UserProfile,
} from '../domain/sam'

export interface OutboxItem {
  id?: number
  // INSUMO: operaciones del modulo de insumos hechas sin senal (despacho,
  // entrega directa, tanqueo, avales). Antes solo se encolaban labores y todo
  // lo de insumos se perdia sin cobertura.
  type: 'UPDATE' | 'CREATE' | 'INSUMO'
  // For UPDATE (START, FINISH, CANCEL):
  assignmentId?: string            // real ID or temp ID
  updatePayload?: UpdateAssignmentInput
  // For CREATE (TakeFreeField, CreateAssignment):
  createInput?: CreateAssignmentInput
  tempId?: string                  // local temp ID resolved to real ID on sync
  // For INSUMO: la INTENCION, no el resultado. El saldo se recalcula al
  // sincronizar contra el stock real de ese momento.
  insumoOp?: { kind: string; payload: unknown }
  queuedAt: string
  status: 'pending' | 'error'
  errorMessage?: string
}

/**
 * Foto tomada SIN señal, esperando para subirse.
 *
 * La evidencia se subia en el momento de tomarla; sin cobertura fallaba y el
 * supervisor se quedaba sin poder adjuntarla. Ahora se guarda el archivo aqui y
 * la operacion referencia `local://<localId>`, que el sincronizador resuelve
 * subiendo la foto y reemplazando la URL antes de mandar el registro.
 */
export interface FotoPendiente {
  localId: string
  blob: Blob
  nombre: string
  /** Prefijo del path en storage (id de solicitud, temp id de la directa...). */
  hint: string
  indice: number
  queuedAt: string
}

class SamDb extends Dexie {
  assignments!: Table<Assignment>
  maestro!: Table<MaestroRow>
  users!: Table<UserProfile>
  equipment!: Table<Equipment>
  labores!: Table<Labor>
  outbox!: Table<OutboxItem>
  fotos!: Table<FotoPendiente>
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

    // v3: clear maestro cache so users get full maestro_risaralda from Supabase
    this.version(3)
      .stores({})
      .upgrade((tx) => tx.table('maestro').clear())

    // v4: maestro gains ingenio_id; haciendaCode changes to string — clear cache
    this.version(4)
      .stores({})
      .upgrade((tx) => tx.table('maestro').clear())

    // v5: Phase 1 cleanup — wipe stale assignments + outbox so cada cliente
    // arranque sincronizado con el remoto (que solo tiene las 7 filas de hoy).
    this.version(5)
      .stores({})
      .upgrade((tx) =>
        Promise.all([tx.table('assignments').clear(), tx.table('outbox').clear()]).then(
          () => undefined,
        ),
      )

    // v6: borrar meta (en particular assignments_last_sync) ademas de assignments
    // y outbox. Sin esto, dispositivos con cache stale y lastSync viejo hacian
    // delta sync incompleto y NO veian asignaciones creadas para ellos por el
    // supervisor. Forzar full sync al proximo load garantiza estado consistente.
    this.version(6)
      .stores({})
      .upgrade((tx) =>
        Promise.all([
          tx.table('assignments').clear(),
          tx.table('outbox').clear(),
          tx.table('meta').clear(),
        ]).then(() => undefined),
      )

    // v7: catálogo de labores cacheado offline (CRUD activar/desactivar).
    this.version(7).stores({
      labores: 'id, nombre',
    })

    // v8: fotos de evidencia tomadas sin señal. Se suben al sincronizar.
    this.version(8).stores({
      fotos: 'localId, queuedAt',
    })
  }
}

export const db = new SamDb()
