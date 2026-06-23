export type Role = 'supervisor' | 'operador' | 'owner' | 'administracion' | 'soporte' | 'supervisor_insumos'

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
  // Zona asignada (solo aplica a supervisores). Es el `codigo` del catálogo
  // `zonas`; se usa para auto-llenar la zona al aprobar labores.
  zona?: string
  // Activo/inactivo. La gestión de Usuarios carga TODOS; los selectores y la
  // asignación solo usan los activos (operators/supervisors filtran active).
  active?: boolean
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

// Catálogo de labores (CRUD). Vive en la tabla `labores`. Las inactivas dejan
// de ofrecerse en los selectores; el histórico que las usa se conserva.
// `tipo`: MECANIZADA (con tractor) o MANUAL (a mano). El operador de tractor
// solo ve mecanizadas al tomar en campo.
export type LaborTipo = 'MECANIZADA' | 'MANUAL'
export interface Labor {
  id: string
  nombre: string
  activa: boolean
  tipo: LaborTipo
}

// Catálogo de empresas (compañías operadas en el aplicativo). Solo CRUD por ahora.
export interface Empresa {
  id: string
  nombre: string
  activo: boolean
}

// Catálogo de terceros (clientes a los que se presta la labor). Los ingenios
// son terceros; se pueden crear más y asignarse a suertes del maestro.
export interface Tercero {
  id: string
  nombre: string
  activo: boolean
}

// Catálogo de zonas. `codigo` es el valor que se guarda (NORTE/SUR y futuros);
// `nombre` es la etiqueta visible. Se asigna a supervisores para auto-llenar la
// zona al aprobar.
export interface Zona {
  id: string
  codigo: string
  nombre: string
  activo: boolean
}

// ── Módulo Insumos y Combustible ───────────────────────────────────────────
export type InsumoCategoria = 'COMBUSTIBLE' | 'MATERIAL'

// Catálogo de insumos con stock actual (combustibles y materiales).
export interface Insumo {
  id: string
  nombre: string
  categoria: InsumoCategoria
  unidad: string
  stock: number
  activo: boolean
}

export type KardexTipo = 'ENTRADA' | 'SALIDA' | 'AJUSTE'

// Un movimiento de inventario (kardex). `saldo` = stock del insumo tras el mov.
export interface InsumoKardex {
  id: string
  insumoId: string
  tipo: KardexTipo
  cantidad: number
  saldo: number
  motivo?: string
  referencia?: string
  creadoPor?: string
  createdAt: string
  // Máquina/tractor a la que se cargó el movimiento (acumulador de costos).
  equipoCodigo?: string
}

// Solicitud de insumos del operario (fase 2). PENDIENTE→PROGRAMADA/RECHAZADA;
// ENTREGADA la marca el despacho (fase 3).
export type SolicitudEstado = 'PENDIENTE' | 'PROGRAMADA' | 'ENTREGADA' | 'RECHAZADA' | 'CANCELADA'

export interface SolicitudItem {
  id?: string
  insumoId?: string
  insumoNombre: string
  unidad: string
  cantidad: number
  // Cantidad realmente despachada al entregar (fase 3); puede diferir de la pedida.
  cantidadDespachada?: number
}

export interface SolicitudInsumo {
  id: string
  operarioId: string
  operarioNombre?: string
  estado: SolicitudEstado
  nota?: string
  zona?: string
  motivoRechazo?: string
  createdAt: string
  items: SolicitudItem[]
  // Entrega / despacho (fase 3)
  entregadoEn?: string
  despachadoPor?: string
  ruta?: string
  evidenciaUrls?: string[]
  horometro?: number
  // Máquina/tractor a la que se cargó la entrega (acumulador de costos).
  equipoCodigo?: string
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
  // Opcional: las labores tomadas EN CAMPO (LIBRE) ya no piden cliente al
  // operario — el supervisor lo diligencia al aprobar. Las ASIGNADAS sí lo traen.
  cliente?: 'ingenios' | 'proveedores'
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
  // El supervisor diligencia cliente y zona al APROBAR una labor de campo.
  cliente?: 'ingenios' | 'proveedores'
  zone?: Zone | null
}
