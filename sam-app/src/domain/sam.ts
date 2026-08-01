export type Role = 'supervisor' | 'operador' | 'owner' | 'administracion' | 'soporte' | 'supervisor_insumos' | 'conductor' | 'analista_insumos' | 'taller'

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
  // Marca y modelo hacen falta para que un plan preventivo definido POR MODELO
  // ("cambio de aceite cada 250 h en toda CASE JX95") encuentre sus maquinas, y
  // para decirle al proveedor a que equipo va un repuesto. Sin ellos el filtro
  // compara contra undefined y no aplica a nada, sin avisar.
  brand?: string
  model?: string
  serial?: string
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
  // Auditoría: última edición (lo estampa el trigger / el cliente).
  updatedAt?: string
  editadoPor?: string
  // Facturación: N° de factura asignado por administración (null = sin facturar).
  facturaNumero?: string | null
}

export interface DashboardMetrics {
  plannedArea: number
  executedArea: number
  completion: number
  inProgress: number
  // Área ejecutada que YA tiene factura asignada.
  billedArea: number
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
  // Meta de hectáreas por día (productividad esperada). Alimenta el KPI de
  // rendimiento quincenal del operario. null/0 = sin meta (no se mide).
  metaHaDia?: number | null
}

// Config del refuerzo motivacional que ve el operario cuando su rendimiento
// quincenal alcanza el `umbral` (%). La edita el dueño/administración.
export interface Motivacion {
  mensaje: string
  imagenUrl: string | null
  umbral: number
  activo: boolean
  // Referencia de ha/día para el indicador diario (promedio y último día). Un
  // día con ≥ este valor se considera "buen día" (default 15).
  metaDiaRef: number
}

// Mapa offline (tipo Avenza). Config que consume el visor: tiles ya generados
// por FieldMaps en su bucket público; ASM solo los muestra y los cachea.
export interface MapaConfig {
  id: string
  nombre: string
  tilesBase: string
  // [minLon, minLat, maxLon, maxLat] WGS84
  bounds: [number, number, number, number]
  minzoom: number
  maxzoom: number
  activo: boolean
}

// Catálogo de ingenios/compradores. El `id` es un slug estable (ej.
// 'trapiche_lucerna') porque amarra `maestro.ingenio_id`. Editable desde
// Catálogos → Ingenios (tabla `ingenios`, migración 20260708120000).
export interface Ingenio {
  id: string
  nombre: string
  activo: boolean
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

// ── Módulo Flota / Escolta (CDA-F-68) ──────────────────────────────────────
// Un servicio/viaje de una camioneta de escolta (flota no propia).
export interface FlotaServicio {
  id: string
  createdAt: string
  fecha: string
  vehiculo?: string
  tipoServicio?: string
  centroCosto?: string
  procesoSolicitante?: string
  nombrePasajero?: string
  origen?: string
  destino?: string
  horaSalidaOrigen?: string
  horaLlegadaDestino?: string
  horaSalidaDestino?: string
  horaLlegadaOrigen?: string
  horaEspera?: string
  numPeajes?: number
  otrosGastos?: number
  totalKm?: number
  observacion?: string
  conductorId?: string
  conductorNombre?: string
  firmaUrl?: string
  firmaNombre?: string
  evidenciaUrl?: string
  estado: 'REGISTRADO' | 'ANULADO'
}

export interface CreateFlotaServicioInput {
  fecha: string
  vehiculo?: string
  tipoServicio?: string
  centroCosto?: string
  procesoSolicitante?: string
  nombrePasajero?: string
  origen?: string
  destino?: string
  horaSalidaOrigen?: string
  horaLlegadaDestino?: string
  horaSalidaDestino?: string
  horaLlegadaOrigen?: string
  horaEspera?: string
  numPeajes?: number
  otrosGastos?: number
  totalKm?: number
  observacion?: string
  conductorId?: string
  conductorNombre?: string
  firmaUrl?: string
  firmaNombre?: string
  evidenciaUrl?: string
}

// ── Módulo Insumos y Combustible ───────────────────────────────────────────

// Bodegas: una PRINCIPAL (fija, compra y almacena) y varias SATELITE (el
// vehículo de cada supervisor de insumos, de donde consumen los operarios).
// TALLER: la bodega de repuestos. Es una bodega mas sobre el mismo kardex,
// no un inventario paralelo.
export type BodegaTipo = 'PRINCIPAL' | 'SATELITE' | 'TALLER'

export interface Bodega {
  id: string
  nombre: string
  tipo: BodegaTipo
  responsableId?: string
  vehiculo?: string
  activo: boolean
}

/** Stock de un insumo EN una bodega concreta. */
export interface StockBodega {
  insumoId: string
  bodegaId: string
  stock: number
}

// Traslado principal → satélite. Sale de la principal y queda EN_TRANSITO
// hasta que el supervisor del satélite confirma lo que recibió (aval).
export type TrasladoEstado = 'EN_TRANSITO' | 'RECIBIDO' | 'ANULADO'

export interface TrasladoItem {
  id?: string
  insumoId: string
  insumoNombre: string
  unidad: string
  cantidad: number
  cantidadRecibida?: number
}

export interface Traslado {
  id: string
  createdAt: string
  origenId: string
  destinoId: string
  estado: TrasladoEstado
  enviadoPor?: string
  nota?: string
  evidenciaUrl?: string
  recibidoEn?: string
  recibidoPor?: string
  conforme?: boolean | null
  notaRecepcion?: string
  // El supervisor lo tomo de la principal por su cuenta (llega a las 5:30 y el
  // analista entra a las 7:00). Va con aval posterior, como el combustible.
  autoservicio?: boolean
  avalEstado?: 'PENDIENTE' | 'APROBADO' | 'RECHAZADO'
  avaladoPor?: string
  avaladoNombre?: string
  avaladoEn?: string
  avalNota?: string
  items: TrasladoItem[]
}

// Tanqueo en bomba externa.
//  CARRO   → el supervisor tanquea su vehículo-tanque: ENTRA al satélite.
//  MAQUINA → el operario tanquea la máquina en la bomba: NO toca inventario,
//            pero el consumo/costo sí se carga a la máquina (exige horómetro).
/** A QUÉ se le echó el combustible. */
export type CombustibleDestino =
  | 'CARRO'      // tanque de distribución del satélite → ENTRA a su inventario
  | 'VEHICULO'   // la camioneta en la que se moviliza → consumo, exige placa
  | 'MAQUINA'    // tanqueo directo de un equipo → consumo, exige horómetro
  | 'PIMPINAS'   // se lleva N pimpinas de X galones → ENTRAN a su inventario

/** DE DÓNDE salió: comprado en bomba, o sacado de la bodega principal. */
export type CombustibleOrigen = 'ESTACION' | 'SEDE'

/** Aval del analista de insumos y materiales. */
export type CombustibleEstado = 'PENDIENTE' | 'APROBADO' | 'RECHAZADO'

export const DESTINO_LABEL: Record<CombustibleDestino, string> = {
  CARRO: 'Tanque de distribución',
  VEHICULO: 'Vehículo',
  MAQUINA: 'Máquina',
  PIMPINAS: 'Pimpinas',
}

/** Placa del catálogo (para no escribirla a mano y que salgan tres variantes). */
export interface Vehiculo {
  id: string
  placa: string
  descripcion?: string
  tipo: string
  frecuente: boolean
  activo: boolean
}

export interface CombustibleExterno {
  id: string
  createdAt: string
  fecha: string
  origen: CombustibleOrigen
  destino: CombustibleDestino
  estado: CombustibleEstado
  /** Bodega que RECIBE (satélite), cuando el destino suma al inventario. */
  bodegaId?: string
  /** Bodega de la que SALIÓ (la principal), cuando el origen es SEDE. */
  bodegaOrigenId?: string
  equipoCodigo?: string
  horometro?: number
  placa?: string
  pimpinasCantidad?: number
  pimpinasCapacidad?: number
  insumoId?: string
  galones: number
  valor?: number
  estacion?: string
  factura?: string
  tirillaUrl?: string
  registradoPor?: string
  registradoNombre?: string
  nota?: string
  revisadoPor?: string
  revisadoNombre?: string
  revisadoEn?: string
  revisionNota?: string
}

export type InsumoCategoria = 'COMBUSTIBLE' | 'MATERIAL'

// Catálogo de insumos con stock actual (combustibles y materiales).
export interface Insumo {
  id: string
  nombre: string
  categoria: InsumoCategoria
  unidad: string
  stock: number
  // Umbral de alerta de stock bajo (0 = sin alerta).
  stockMinimo: number
  // De uso frecuente: aparece de entrada en los selectores; el resto queda
  // detrás de "⋯ Otros" para no saturar la lista.
  frecuente: boolean
  activo: boolean
  // ── Campos de TALLER ──
  // El codigo propio es la LLAVE con la que se habla del item puertas adentro
  // (FIL-0003). El uuid no sirve para dictar por telefono ni para rotular un
  // estante. La `descripcion` es el "texto soporte" del apunte: lo que se le
  // manda al proveedor cuando el nombre corto no alcanza.
  codigo?: string
  familia?: string
  descripcion?: string
  // Vacíos en un insumo de uso diario; llenos en un repuesto. Son los que
  // permiten encontrar la pieza correcta: un filtro sirve para un modelo y no
  // para otro, y sin referencia/número de parte se termina comprando duplicado.
  esRepuesto?: boolean
  referencia?: string
  marca?: string
  numeroParte?: string
  ubicacion?: string
  stockMaximo?: number
  stockSeguridad?: number
  costoPromedio?: number
  fichaUrl?: string
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
  // Bodega en la que ocurrió el movimiento (principal o satélite).
  bodegaId?: string
}

// Solicitud de insumos del operario (fase 2). PENDIENTE→PROGRAMADA/RECHAZADA;
// ENTREGADA la marca el despacho (fase 3).
export type SolicitudEstado = 'PENDIENTE' | 'PROGRAMADA' | 'ENTREGADA' | 'RECHAZADA' | 'CANCELADA'

// Origen de la solicitud/entrega: la pidió el operario, o el supervisor la
// entregó directo (entrega directa — igual requiere aval del operario).
export type SolicitudOrigen = 'OPERARIO' | 'DIRECTA'

export interface SolicitudItem {
  id?: string
  insumoId?: string
  insumoNombre: string
  unidad: string
  cantidad: number
  // Cantidad realmente despachada al entregar (fase 3); puede diferir de la pedida.
  cantidadDespachada?: number
  // Cantidad que el operario CONFIRMÓ haber recibido (fase 4). Si es menor a la
  // despachada, la diferencia vuelve al inventario como devolución (kardex).
  cantidadRecibida?: number
}

export interface SolicitudInsumo {
  id: string
  operarioId: string
  operarioNombre?: string
  estado: SolicitudEstado
  origen: SolicitudOrigen
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
  // Bodega de la que salió el material (satélite del supervisor). Sirve para
  // que una devolución por diferencia regrese a la misma bodega.
  bodegaId?: string
  // Aval del operario (fase 4): confirmación de recepción sobre ENTREGADA.
  // conforme=true → recibió todo; false → reportó diferencia (nota con motivo);
  // confirmadoEn null → entregada sin confirmar aún.
  confirmadoEn?: string
  confirmadoPor?: string
  conforme?: boolean | null
  confirmacionNota?: string
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
  // Permite cambiar de supervisor al REUTILIZAR una línea PENDIENTE (la
  // reasignación queda bajo el supervisor que la toma, para el scope correcto).
  supervisorId?: string
  supervisorName?: string
  liberada?: boolean
  // El supervisor diligencia cliente y zona al APROBAR una labor de campo.
  cliente?: 'ingenios' | 'proveedores'
  zone?: Zone | null
  // Reinicia la fecha de creación al REUTILIZAR una línea PENDIENTE vencida
  // (regla de 72h): vuelve a contar como "programada hoy" y reaparece en
  // Activas, en vez de crear una línea duplicada.
  createdAt?: string
  // Auditoría: quién hace esta edición (se guarda en asignaciones.editado_por).
  editadoPor?: string
  // Facturación: N° de factura (o null/'' para desfacturar).
  facturaNumero?: string | null
}

/* ══════════════════════════════════════════════════════════════════════════
 * Taller de maquinaria
 *
 * El inventario de uso diario responde "¿qué le entregué hoy al operario?".
 * Esto responde otra cosa: "¿qué le he metido a esta máquina en toda su vida
 * y cuánto me cuesta la hora?".
 * ══════════════════════════════════════════════════════════════════════════ */

/** Lectura vigente del horómetro, ya depurada de dedazos. */
export interface EquipoHorometro {
  codigo: string
  horometro: number
  leidoEn: string
  fuente: string
}

/**
 * Lectura que quedo fuera de la magnitud dominante del equipo.
 *
 * No se esconde: se muestra en la hoja de vida para que alguien vaya a
 * corregirla en la labor de origen. `magnitudEsperada` es el orden de magnitud
 * en el que si estan las demas lecturas (1.000, 10.000...), que es la pista de
 * cuantos digitos sobran o faltan.
 */
export interface HorometroDudoso {
  origenId: string
  codigo: string
  horas: number
  cuando: string
  fuente: string
  magnitudEsperada: number
}

export type ProveedorTipo = 'REPUESTOS' | 'AGROINSUMOS' | 'SERVICIOS' | 'OTRO'

export interface Proveedor {
  id: string
  nombre: string
  nit?: string
  tipo: ProveedorTipo
  contacto?: string
  telefono?: string
  email?: string
  zona?: string
  direccion?: string
  nota?: string
  activo: boolean
}

/** Precio y referencia de UN proveedor para UN repuesto. */
export interface InsumoProveedor {
  id: string
  insumoId: string
  proveedorId: string
  proveedorNombre?: string
  referenciaProveedor?: string
  precio?: number
  diasEntrega?: number
  preferido: boolean
  ultimaCompra?: string
}

/** A qué máquinas sirve un repuesto. Sin filas = genérico. */
export interface Aplicabilidad {
  id: string
  insumoId: string
  marca?: string
  modelo?: string
  equipoCodigo?: string
  nota?: string
}

export type CompraEstado = 'BORRADOR' | 'RECIBIDA' | 'ANULADA'

export interface CompraItem {
  id?: string
  insumoId: string
  insumoNombre?: string
  unidad?: string
  cantidad: number
  precioUnitario: number
}

export interface Compra {
  id: string
  consecutivo: number
  proveedorId?: string
  proveedorNombre?: string
  bodegaId?: string
  fecha: string
  factura?: string
  estado: CompraEstado
  subtotal: number
  impuestos: number
  total: number
  nota?: string
  soporteUrl?: string
  creadoNombre?: string
  recibidaEn?: string
  createdAt: string
  items: CompraItem[]
}

/** Tarea preventiva que se dispara por horómetro (y opcionalmente por días). */
export interface MttoPlan {
  id: string
  equipoCodigo?: string
  marca?: string
  modelo?: string
  tarea: string
  cadaHoras?: number
  cadaDias?: number
  avisarAntesHoras: number
  ultimaHoras?: number
  ultimaFecha?: string
  activo: boolean
  nota?: string
}

/** Estado de un plan frente al horómetro de HOY. */
export interface PlanVencimiento {
  plan: MttoPlan
  equipoCodigo: string
  horometro: number
  /** Horómetro al que toca la próxima. */
  proximaEn: number
  /** Horas que faltan (negativo = vencido). */
  faltan: number
  estado: 'VENCIDO' | 'PROXIMO' | 'OK' | 'SIN_LECTURA'
}

export type OtTipo = 'PREVENTIVO' | 'CORRECTIVO' | 'MEJORA'
export type OtEstado = 'ABIERTA' | 'EN_PROCESO' | 'CERRADA' | 'ANULADA'

export const OT_TIPO_LABEL: Record<OtTipo, string> = {
  PREVENTIVO: 'Preventivo',
  CORRECTIVO: 'Correctivo',
  MEJORA: 'Mejora',
}

export interface OtRepuesto {
  id?: string
  insumoId: string
  insumoNombre?: string
  unidad?: string
  bodegaId?: string
  cantidad: number
  costoUnitario: number
  descargado?: boolean
}

export interface OrdenTrabajo {
  id: string
  consecutivo: number
  equipoCodigo: string
  tipo: OtTipo
  estado: OtEstado
  planId?: string
  descripcion: string
  causa?: string
  trabajoRealizado?: string
  horometro?: number
  /** El reloj de la parada: de aquí salen disponibilidad y TMR. */
  paroEn?: string
  arranqueEn?: string
  horasMo: number
  valorHoraMo: number
  costoExterno: number
  proveedorExternoId?: string
  responsable?: string
  evidenciaUrls?: string[]
  creadoNombre?: string
  cerradaEn?: string
  createdAt: string
  repuestos: OtRepuesto[]
}

export type CostoConcepto = 'SEGURO' | 'IMPUESTO' | 'DEPRECIACION' | 'ADMINISTRATIVO' | 'OTRO'

export const COSTO_LABEL: Record<CostoConcepto, string> = {
  SEGURO: 'Seguro',
  IMPUESTO: 'Impuestos',
  DEPRECIACION: 'Depreciación',
  ADMINISTRATIVO: 'Administrativo',
  OTRO: 'Otro',
}

/** Costo que no sale de la operación: alguien lo carga por equipo y periodo. */
export interface EquipoCosto {
  id: string
  equipoCodigo: string
  concepto: CostoConcepto
  periodo: string
  valor: number
  nota?: string
}

/**
 * Un valor de una lista de los formularios de insumos: una estación, una
 * placa, un motivo. Todas viven en la misma tabla, separadas por `tipo`.
 */
export interface ValorCatalogo {
  id: string
  tipo: string
  valor: string
  descripcion?: string
  frecuente: boolean
  activo: boolean
  orden: number
}
