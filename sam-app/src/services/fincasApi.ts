/**
 * Administración de fincas de caña — acceso a datos (MVP, 22-sep-2026).
 *
 * 🔴 Desde la migración 20260922150000 las tablas `af_*` NO se leen ni se escriben
 * directo: todo pasa por funciones de la base que reciben una LLAVE y deciden con
 * ella quién es y qué puede ver. El personal saca su llave con el PIN
 * (`abrirSesionFincas`); el dueño de la tierra la trae en su enlace personal.
 * Las reglas siguen en la base — sin foto no hay reporte, nadie acepta lo suyo,
 * no se pasa del área, nada se borra —; la pantalla solo avisa antes.
 */
import { supabase } from '../lib/supabase'
import { comprimirImagen, PERFIL_IMAGEN } from '../lib/imagenLigera'

export type EstadoLabor = 'PROGRAMADA' | 'EN_CURSO' | 'TERMINADA' | 'ANULADA'
export type EstadoReporte = 'PENDIENTE' | 'ACEPTADO' | 'RECHAZADO'
export type TipoMovimiento = 'ANTICIPO' | 'GASTO' | 'HONORARIO'
export type TipoCiclo = 'SOCA' | 'PLANTILLA'
/** Objeto de costo, como agrupa Procaña. NULL en un movimiento = se deduce de la labor. */
export type RubroCosto = 'insumos' | 'agua' | 'mano_obra' | 'maquinaria' | 'administracion' | 'predial_fondos' | 'semilla' | 'otros'

export interface Finca {
  id: string
  nombre: string
  duenoNombre: string
  duenoTelefono: string | null
  duenoCorreo: string | null
  ingenioId: string | null
  municipio: string | null
  honorarioModo: 'POR_DEFINIR' | 'PORCENTAJE' | 'FIJO_HA_MES'
  honorarioValor: number | null
  nota: string | null
  activa: boolean
  createdAt: string
  /** Código de la hacienda en el ingenio (p. ej. «627»): enlaza la maquinaria de ASM. */
  haciendaCodigo: string | null
  /** Kilos de azúcar que se liquidan por tonelada de caña (58 en la compraventa tradicional). */
  kgAzucarTc?: number | null
  /** Precio del kg de azúcar de la liquidación (lo fija administración con el ingenio). */
  precioKgAzucar?: number | null
}
/** Lo que reporta el ingenio de la suerte (último corte, número de corte, TCH…). */
export interface DatosIngenio {
  fUltCorte?: string; edadMeses?: number; numeroCorte?: number
  toneladas?: number; tch?: number; rendimiento?: number; sacarosa?: number; fuente?: string
}
export interface SuerteFinca {
  id: string; fincaId: string; codigo: string; areaHa: number; variedad: string | null; activa: boolean
  datosIngenio: DatosIngenio | null
}
/** Un pedazo de terreno en el mapa, asignado o no a una suerte. Anillo [lng, lat]. */
export interface Poligono {
  id: string; fincaId: string; suerteId: string | null; etiqueta: string | null
  anillo: [number, number][]; areaHa: number | null; fuente: string
}
/** Una labor de MAQUINARIA que ASM ya registra en su operación (tabla asignaciones). */
export interface LaborMaquina {
  id: string; fincaId: string; suerteCodigo: string; labor: string
  estado: string; area: number; fecha: string
  /** Cuándo quedó registrada (para «novedades desde su última visita»). */
  registradoEn: string
  equipo: string | null; operador: string | null
}
export interface Ciclo {
  id: string; suerteId: string; fechaCorte: string; tipo: TipoCiclo
  estado: 'ABIERTO' | 'CERRADO'; fechaCierre: string | null
  datosCosecha: DatosIngenio | null
}
export interface LaborPaquete {
  id: string; labor: string; unidad: string; cantidadPorHa: number; costoUnitario: number
  pasadasPlan: number; costoAparteUnitario: number
  ventanaIdeal: number | null; ventanaNormal: number | null
  aplica: 'SOCA' | 'PLANTILLA' | 'AMBOS'; orden: number; activa: boolean
  /** Varias pasadas por ciclo (riego, malezas): el total no se topa al área y no se cierra sola. */
  repetible: boolean
  /** NULL = todas las variedades. Con valor, esta fila manda sobre la genérica para esa variedad (17-oct-2026). */
  variedad: string | null
}
export interface LaborCiclo {
  id: string; cicloId: string; labor: string; unidad: string
  cantidadPlan: number; costoUnitarioPlan: number; pasadasPlan: number; costoAparteUnitarioPlan: number
  ventanaIdeal: number | null; ventanaNormal: number | null
  estado: EstadoLabor; anuladaMotivo: string | null; orden: number
  /** Heredado del paquete: `cantidadPlan` es UNA pasada (el área de la suerte). */
  repetible: boolean
}
export interface ReporteCampo {
  id: string; laborId: string; cantidad: number; fecha: string; fotoUrl: string
  lat: number | null; lng: number | null; precisionM: number | null; nota: string | null
  reportadoPor: string; estado: EstadoReporte
  revisadoPor: string | null; revisadoEn: string | null; motivoRechazo: string | null
  costoUnitario: number | null; createdAt: string
}
export interface Movimiento {
  id: string; fincaId: string; tipo: TipoMovimiento; fecha: string; concepto: string
  suerteId: string | null; laborId: string | null; reporteId: string | null
  cantidad: number | null; unidad: string | null; valorUnitario: number | null; valor: number
  soporteUrl: string | null; registradoPor: string
  anulado: boolean; anuladoPor: string | null; anuladoMotivo: string | null; createdAt: string
  /** Objeto de costo (Procaña). NULL = se deduce de la labor o cae en «otros». */
  rubro?: RubroCosto | null
}
/** Un enlace del dueño de la tierra. La llave NUNCA vuelve de la base: solo su huella. */
export interface AccesoDueno {
  id: string; fincaId: string; nombre: string; creadoPor: string; creadoEn: string
  revocadoEn: string | null; ultimoUso: string | null; usos: number
}

export interface DatosFincas {
  fincas: Finca[]
  suertes: SuerteFinca[]
  ciclos: Ciclo[]
  labores: LaborCiclo[]
  reportes: ReporteCampo[]
  movimientos: Movimiento[]
  paquete: LaborPaquete[]
}
export interface CargaFincas extends DatosFincas {
  /** 'owner' | 'administracion' | 'supervisor' | 'dueno' — lo dice la base, no el celular. */
  rol: string
  accesos: AccesoDueno[]
  /** Nombres de quien aparece en los datos (el dueño no tiene la lista de usuarios). */
  nombres: Record<string, string>
  poligonos: Poligono[]
  maquinaria: LaborMaquina[]
  /** Dueños con USUARIO (rol dueno_finca) de cada finca; solo administración lo recibe (17-oct-2026). */
  duenos: DuenoFinca[]
}
export interface DuenoFinca { fincaId: string; usuarioId: string; nombre: string; activo: boolean; creadoEn: string }

/**
 * Los parámetros del sector (Cenicaña / Procaña): son un DATO de la base, no una
 * cifra escrita en la app. La pantalla los usa solo para comparar; ninguna finca
 * depende de ellos.
 */
export interface ReferenciasSector {
  productividad: { fuente: string; anio: number; tch: number; tah: number; tchm: number; tahm: number
    rendimiento: number; sacarosa: number; edadMeses: number; numeroCorte: number } | null
  costos: { fuente: string; anio: number; costoHa: number; costoTc: number; kaTc: number
    tch: number; kgAzucarTc: number; precioTc: number } | null
  rubroPorLabor: Record<string, RubroCosto>
  inflacion: Inflacion | null
}
export interface Inflacion { fuente: string; ipcAnual: Record<number, number> }

const num = (v: unknown): number => Number(v ?? 0)
const numN = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))
const txt = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v))
/** El día en Colombia de una marca de tiempo. */
const diaBogota = (v: string): string => (v ? new Date(v).toLocaleDateString('en-CA', { timeZone: 'America/Bogota' }) : '')
function datosIngenio(v: unknown): DatosIngenio | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const n = (k: string) => (o[k] == null ? undefined : Number(o[k]))
  return {
    fUltCorte: o.f_ult_corte ? String(o.f_ult_corte) : undefined, edadMeses: n('edad_meses'),
    numeroCorte: n('numero_corte'), toneladas: n('toneladas'), tch: n('tch'), rendimiento: n('rendimiento'),
    sacarosa: n('sacarosa'), fuente: o.fuente ? String(o.fuente) : undefined,
  }
}

async function lanzar<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p
  if (error) throw new Error(error.message)
  return data
}

/**
 * Frases de la base que todavía dicen «ciclo» donde es un CORTE (vocabulario del cliente,
 * 24-oct-2026: el ciclo va de renovación a renovación; lo que se abre por suerte es un corte).
 * Se traducen aquí para no reescribir las funciones de la base solo por una palabra.
 */
const FRASES_DE_CORTE: Record<string, string> = {
  'el ciclo de esa suerte ya se cerró': 'el corte de esa suerte ya se cerró',
  'solo administración abre ciclos': 'solo administración inicia cortes',
  'una labor no se cambia de ciclo': 'una labor no se cambia de corte',
}

/** Los errores de la base traen un código al frente («SIN_FOTO: …»): se muestra la frase. */
export function mensajeDeError(e: unknown): string {
  const m = (e as { message?: string })?.message ?? String(e)
  const i = m.indexOf(': ')
  const frase = i > 0 && /^[A-Z_]+$/.test(m.slice(0, i)) ? m.slice(i + 2) : m
  return FRASES_DE_CORTE[frase] ?? frase
}

/** ¿La llave dejó de servir (vencida, cancelada, inventada)? Hay que pedir otra. */
export function esSinSesion(e: unknown): boolean {
  return String((e as { message?: string })?.message ?? '').startsWith('SIN_SESION')
}

// ── Llaves ────────────────────────────────────────────────────────────────
const LLAVE_PERSONAL = 'sam:af-sesion'
const LLAVE_DUENO = 'sam:af-dueno'
const LLAVE_REFERENCIAS = 'sam:af-referencias'

/** La llave del personal, solo si es del MISMO usuario que tiene la sesión abierta. */
export function leerLlavePersonal(usuario: string): string | null {
  try {
    const x = JSON.parse(window.localStorage.getItem(LLAVE_PERSONAL) ?? 'null') as { usuario?: string; token?: string } | null
    return x && x.usuario === usuario && x.token ? x.token : null
  } catch { return null }
}
export function guardarLlavePersonal(usuario: string, token: string | null) {
  try {
    if (token) window.localStorage.setItem(LLAVE_PERSONAL, JSON.stringify({ usuario, token }))
    else window.localStorage.removeItem(LLAVE_PERSONAL)
  } catch { /* sin almacenamiento: se pedirá el PIN otra vez */ }
}
export function leerLlaveDueno(): string | null {
  try { return window.localStorage.getItem(LLAVE_DUENO) } catch { return null }
}
export function guardarLlaveDueno(token: string | null) {
  try {
    if (token) window.localStorage.setItem(LLAVE_DUENO, token)
    else window.localStorage.removeItem(LLAVE_DUENO)
  } catch { /* nada */ }
}

/** La llave del módulo a partir del PIN (dura 30 días). `null` = PIN errado. */
export async function abrirSesionFincas(usuario: string, pin: string): Promise<string | null> {
  const d = await lanzar(supabase.rpc('af_abrir_sesion', { p_usuario: usuario, p_pin: pin }))
  return d ? String(d) : null
}
/**
 * La llave SIN PIN, mientras la base lo permita (`af_config.pin_requerido`,
 * apagado «de momento» el 23-sep-2026). Si el PIN vuelve a exigirse lanza
 * `PIN_REQUERIDO` y la pantalla lo pide como antes.
 */
export async function abrirSesionSinPin(usuario: string): Promise<string> {
  return String(await lanzar(supabase.rpc('af_abrir_sesion_sin_pin', { p_usuario: usuario })))
}
export function esPinRequerido(e: unknown): boolean {
  return String((e as { message?: string })?.message ?? '').startsWith('PIN_REQUERIDO')
}
export async function cerrarSesionFincas(token: string) {
  await supabase.rpc('af_cerrar_sesion', { p_token: token })
}

/**
 * Todo el módulo de una vez, por UNA función de la base: el personal recibe todas
 * las fincas; el dueño, SOLO la suya (lo decide la base con la llave, no la pantalla).
 * Inicio, la finca y la cuenta salen de la misma foto y ninguna cifra contradice a otra.
 */
export async function cargarFincas(token: string): Promise<CargaFincas> {
  type Fila = Record<string, unknown>
  const raw = (await lanzar(supabase.rpc('af_datos', { p_token: token })) ?? {}) as Record<string, unknown>
  const arr = (k: string) => ((raw[k] as Fila[] | null) ?? [])
  return {
    rol: String(raw.rol ?? ''),
    nombres: (raw.nombres as Record<string, string> | null) ?? {},
    accesos: arr('accesos').map((x) => ({
      id: String(x.id), fincaId: String(x.finca_id), nombre: String(x.nombre), creadoPor: String(x.creado_por),
      creadoEn: String(x.creado_en), revocadoEn: txt(x.revocado_en), ultimoUso: txt(x.ultimo_uso), usos: num(x.usos),
    })),
    duenos: arr('duenos').map((x) => ({
      fincaId: String(x.finca_id), usuarioId: String(x.usuario_id), nombre: String(x.nombre ?? x.usuario_id),
      activo: x.activo !== false, creadoEn: String(x.creado_en ?? ''),
    })),
    fincas: arr('fincas').map((x) => ({
      id: String(x.id), nombre: String(x.nombre), duenoNombre: String(x.dueno_nombre),
      duenoTelefono: txt(x.dueno_telefono), duenoCorreo: txt(x.dueno_correo), ingenioId: txt(x.ingenio_id),
      municipio: txt(x.municipio), honorarioModo: (x.honorario_modo as Finca['honorarioModo']) ?? 'POR_DEFINIR',
      honorarioValor: numN(x.honorario_valor), nota: txt(x.nota), activa: x.activa !== false, createdAt: String(x.created_at),
      haciendaCodigo: txt(x.hacienda_codigo),
      kgAzucarTc: numN(x.kg_azucar_tc), precioKgAzucar: numN(x.precio_kg_azucar),
    })),
    suertes: arr('suertes').map((x) => ({
      id: String(x.id), fincaId: String(x.finca_id), codigo: String(x.codigo), areaHa: num(x.area_ha),
      variedad: txt(x.variedad), activa: x.activa !== false,
      datosIngenio: datosIngenio(x.datos_ingenio),
    })),
    poligonos: arr('poligonos').map((x) => ({
      id: String(x.id), fincaId: String(x.finca_id), suerteId: txt(x.suerte_id), etiqueta: txt(x.etiqueta),
      anillo: ((x.anillo as unknown[]) ?? []).map((pt) => [Number((pt as number[])[0]), Number((pt as number[])[1])] as [number, number]),
      areaHa: numN(x.area_ha), fuente: String(x.fuente ?? ''),
    })),
    maquinaria: arr('maquinaria').map((x) => {
      const hecha = num(x.area_realizada)
      return {
        id: String(x.id), fincaId: String(x.finca_id), suerteCodigo: String(x.numero_suerte ?? ''),
        labor: String(x.labor_nombre ?? ''), estado: String(x.estado ?? ''),
        // Mismo criterio del Reporte: si no quedó el área ejecutada, cuenta la planificada.
        area: hecha > 0 ? hecha : num(x.area_asignada),
        fecha: diaBogota(txt(x.fecha_fin) ?? txt(x.fecha_inicio) ?? String(x.created_at ?? '')),
        registradoEn: txt(x.fecha_fin) ?? txt(x.fecha_inicio) ?? String(x.created_at ?? ''),
        equipo: txt(x.equipo_nombre) ?? txt(x.equipo_codigo), operador: txt(x.operador_nombre),
      }
    }),
    ciclos: arr('ciclos').map((x) => ({
      id: String(x.id), suerteId: String(x.suerte_id), fechaCorte: String(x.fecha_corte),
      tipo: (x.tipo as TipoCiclo) ?? 'SOCA', estado: (x.estado as Ciclo['estado']) ?? 'ABIERTO', fechaCierre: txt(x.fecha_cierre),
      datosCosecha: datosIngenio(x.datos_cosecha),
    })),
    labores: arr('labores').map((x) => ({
      id: String(x.id), cicloId: String(x.ciclo_id), labor: String(x.labor), unidad: String(x.unidad ?? 'ha'),
      cantidadPlan: num(x.cantidad_plan), costoUnitarioPlan: num(x.costo_unitario_plan),
      pasadasPlan: Math.max(1, num(x.pasadas_plan) || 1), costoAparteUnitarioPlan: num(x.costo_aparte_unitario_plan) || 0,
      ventanaIdeal: numN(x.ventana_ideal), ventanaNormal: numN(x.ventana_normal),
      estado: (x.estado as EstadoLabor) ?? 'PROGRAMADA', anuladaMotivo: txt(x.anulada_motivo), orden: num(x.orden),
      repetible: x.repetible === true,
    })),
    reportes: arr('reportes').map((x) => ({
      id: String(x.id), laborId: String(x.labor_id), cantidad: num(x.cantidad), fecha: String(x.fecha),
      // Sin foto (opcional de momento, 17-oct-2026) llega null: queda '' y las pantallas no la dibujan.
      fotoUrl: x.foto_url ? String(x.foto_url) : '', lat: numN(x.lat), lng: numN(x.lng), precisionM: numN(x.precision_m),
      nota: txt(x.nota), reportadoPor: String(x.reportado_por), estado: (x.estado as EstadoReporte) ?? 'PENDIENTE',
      revisadoPor: txt(x.revisado_por), revisadoEn: txt(x.revisado_en), motivoRechazo: txt(x.motivo_rechazo),
      costoUnitario: numN(x.costo_unitario), createdAt: String(x.created_at),
    })),
    movimientos: arr('movimientos').map((x) => ({
      id: String(x.id), fincaId: String(x.finca_id), tipo: x.tipo as TipoMovimiento, fecha: String(x.fecha),
      concepto: String(x.concepto), suerteId: txt(x.suerte_id), laborId: txt(x.labor_id), reporteId: txt(x.reporte_id),
      cantidad: numN(x.cantidad), unidad: txt(x.unidad), valorUnitario: numN(x.valor_unitario), valor: num(x.valor),
      soporteUrl: txt(x.soporte_url), registradoPor: String(x.registrado_por), anulado: x.anulado === true,
      anuladoPor: txt(x.anulado_por), anuladoMotivo: txt(x.anulado_motivo), createdAt: String(x.created_at),
      rubro: txt(x.rubro) as RubroCosto | null,
    })),
    paquete: arr('paquete').map((x) => ({
      id: String(x.id), labor: String(x.labor), unidad: String(x.unidad ?? 'ha'), cantidadPorHa: num(x.cantidad_por_ha),
      costoUnitario: num(x.costo_unitario), ventanaIdeal: numN(x.ventana_ideal), ventanaNormal: numN(x.ventana_normal),
      pasadasPlan: Math.max(1, num(x.pasadas_plan) || 1), costoAparteUnitario: num(x.costo_aparte_unitario) || 0,
      aplica: (x.aplica as LaborPaquete['aplica']) ?? 'AMBOS', orden: num(x.orden), activa: x.activa !== false,
      repetible: x.repetible === true, variedad: txt(x.variedad),
    })),
  }
}

// ── Referencias del sector (24-oct-2026) ──────────────────────────────────
const RUBROS_VALIDOS: RubroCosto[] = ['insumos', 'agua', 'mano_obra', 'maquinaria', 'administracion', 'predial_fondos', 'semilla', 'otros']

/**
 * Convierte el jsonb de `af_referencias()` a camelCase. RELLENA lo que falte: un
 * caché puede ser de una versión vieja (sección ausente → null, mapa → {}).
 * Nunca lanza: cualquier dato raro cae en 0 o en null.
 */
function convertirReferencias(v: unknown): ReferenciasSector {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  const n = (x: unknown): number => {
    const num = Number(x)
    return Number.isFinite(num) ? num : 0
  }
  const p = o.productividad && typeof o.productividad === 'object' ? o.productividad as Record<string, unknown> : null
  const c = o.costos && typeof o.costos === 'object' ? o.costos as Record<string, unknown> : null
  const i = o.inflacion && typeof o.inflacion === 'object' ? o.inflacion as Record<string, unknown> : null
  const ipcRaw = i?.ipc_anual && typeof i.ipc_anual === 'object' ? i.ipc_anual as Record<string, unknown> : {}
  const ipcAnual: Record<number, number> = {}
  for (const [anio, valor] of Object.entries(ipcRaw)) {
    const k = Number(anio), v = Number(valor)
    if (Number.isFinite(k) && Number.isFinite(v)) ipcAnual[k] = v
  }
  const mapa: Record<string, RubroCosto> = {}
  if (o.rubro_por_labor && typeof o.rubro_por_labor === 'object') {
    for (const [k, val] of Object.entries(o.rubro_por_labor as Record<string, unknown>)) {
      const id = String(val) as RubroCosto
      if (RUBROS_VALIDOS.includes(id)) mapa[k] = id
    }
  }
  return {
    productividad: p ? {
      fuente: String(p.fuente ?? ''), anio: n(p.anio), tch: n(p.tch), tah: n(p.tah), tchm: n(p.tchm), tahm: n(p.tahm),
      rendimiento: n(p.rendimiento), sacarosa: n(p.sacarosa), edadMeses: n(p.edad_meses), numeroCorte: n(p.numero_corte),
    } : null,
    costos: c ? {
      fuente: String(c.fuente ?? ''), anio: n(c.anio), costoHa: n(c.costo_ha), costoTc: n(c.costo_tc), kaTc: n(c.ka_tc),
      tch: n(c.tch), kgAzucarTc: n(c.kg_azucar_tc), precioTc: n(c.precio_tc),
    } : null,
    rubroPorLabor: mapa,
    inflacion: i && typeof i.fuente === 'string' ? { fuente: i.fuente, ipcAnual } : null,
  }
}

/**
 * Las referencias del sector para comparar. Si no hay señal (o la función todavía
 * no existe en la base), usa la última copia guardada en este celular. NUNCA lanza:
 * sin referencias, la pantalla se dibuja igual, sin comparaciones.
 */
export async function cargarReferencias(): Promise<ReferenciasSector | null> {
  try {
    const raw = await lanzar<unknown>(supabase.rpc('af_referencias'))
    if (raw && typeof raw === 'object') {
      try { window.localStorage.setItem(LLAVE_REFERENCIAS, JSON.stringify(raw)) } catch { /* sin almacenamiento */ }
      return convertirReferencias(raw)
    }
  } catch { /* sin señal o sin la función: se intenta la caché */ }
  try {
    const guardado = window.localStorage.getItem(LLAVE_REFERENCIAS)
    return guardado ? convertirReferencias(JSON.parse(guardado) as unknown) : null
  } catch { return null }
}

// ── Escrituras: todas por funciones con llave (la base decide quién puede) ──
// Quién lo hizo sale de la llave, no de un parámetro: el celular no lo puede cambiar.
export async function guardarFinca(f: {
  id?: string; nombre: string; duenoNombre: string; duenoTelefono?: string; duenoCorreo?: string
  ingenioId?: string; municipio?: string; honorarioModo: Finca['honorarioModo']; honorarioValor?: number | null; nota?: string
  haciendaCodigo?: string | null
}, token: string): Promise<string> {
  const d = await lanzar(supabase.rpc('af_guardar_finca', {
    p_token: token, p_id: f.id ?? null,
    p_datos: {
      nombre: f.nombre.trim(), dueno_nombre: f.duenoNombre.trim(), dueno_telefono: f.duenoTelefono?.trim() ?? '',
      dueno_correo: f.duenoCorreo?.trim() ?? '', ingenio_id: f.ingenioId ?? '', municipio: f.municipio?.trim() ?? '',
      honorario_modo: f.honorarioModo, honorario_valor: f.honorarioValor ?? null, nota: f.nota?.trim() ?? '',
      ...(f.haciendaCodigo !== undefined ? { hacienda_codigo: f.haciendaCodigo ?? '' } : {}),
    },
  }))
  return String(d)
}

export async function agregarSuertes(fincaId: string, suertes: { codigo: string; areaHa: number; variedad?: string }[], token: string) {
  if (!suertes.length) return
  await lanzar(supabase.rpc('af_agregar_suertes', {
    p_token: token, p_finca: fincaId,
    p_suertes: suertes.map((s) => ({ codigo: s.codigo.trim(), area_ha: s.areaHa, variedad: s.variedad?.trim() ?? '' })),
  }))
}

export async function guardarPaquete(p: Partial<LaborPaquete> & { labor: string }, token: string) {
  await lanzar(supabase.rpc('af_guardar_paquete', {
    p_token: token, p_id: p.id ?? null,
    p_datos: {
      labor: p.labor.trim().toUpperCase(), unidad: p.unidad ?? 'ha', cantidad_por_ha: p.cantidadPorHa ?? 1,
      costo_unitario: p.costoUnitario ?? 0, ventana_ideal: p.ventanaIdeal ?? null, ventana_normal: p.ventanaNormal ?? null,
      ...(p.pasadasPlan !== undefined ? { pasadas_plan: p.pasadasPlan } : {}),
      ...(p.costoAparteUnitario !== undefined ? { costo_aparte_unitario: p.costoAparteUnitario } : {}),
      aplica: p.aplica ?? 'AMBOS', orden: p.orden ?? 100, activa: p.activa ?? true, repetible: p.repetible ?? false,
      // Se manda siempre (vacío = todas): así la base sabe que se quiso borrar.
      variedad: p.variedad?.trim().toUpperCase() ?? '',
    },
  }))
}

export async function actualizarLaborPlan(id: string, cambios: { cantidadPlan?: number; costoUnitarioPlan?: number; pasadasPlan?: number; costoAparteUnitarioPlan?: number }, token: string) {
  // null = no se toca ese campo.
  await lanzar(supabase.rpc('af_actualizar_labor', {
    p_token: token, p_id: id, p_cantidad: cambios.cantidadPlan ?? null, p_costo: cambios.costoUnitarioPlan ?? null,
    p_pasadas: cambios.pasadasPlan ?? null, p_costo_aparte: cambios.costoAparteUnitarioPlan ?? null,
  }))
}

export async function anularLabor(id: string, motivo: string, token: string) {
  await lanzar(supabase.rpc('af_anular_labor', { p_token: token, p_id: id, p_motivo: motivo.trim() }))
}

export async function abrirCiclo(suerteId: string, fechaCorte: string, tipo: TipoCiclo, token: string): Promise<string> {
  const d = await lanzar(supabase.rpc('af_abrir_ciclo', { p_token: token, p_suerte: suerteId, p_fecha_corte: fechaCorte, p_tipo: tipo }))
  return String(d)
}

/**
 * Abre el corte Y aplica los ajustes de presupuesto en una sola operación (todo o nada): el
 * asistente «Iniciar corte» no deja un corte a medias si algo falla. Los costos van en los
 * nombres de la base (`costo` = servicio, `costo_aparte` = «Ppto por ha» en pantalla).
 */
export async function abrirCicloConPlan(
  suerteId: string, fechaCorte: string, tipo: TipoCiclo,
  ajustes: Array<{ labor: string; unidad: string; costo: number; costo_aparte: number; pasadas: number }>, token: string,
): Promise<string> {
  const d = await lanzar(supabase.rpc('af_abrir_ciclo_plan', {
    p_token: token, p_suerte: suerteId, p_fecha_corte: fechaCorte, p_tipo: tipo, p_ajustes: ajustes,
  }))
  return String(d)
}

export async function reportarLabor(r: {
  id: string; laborId: string; cantidad: number; fecha: string; fotoUrl: string
  lat: number | null; lng: number | null; precisionM: number | null; nota: string
}, token: string) {
  await lanzar(supabase.rpc('af_reportar', {
    p_token: token, p_id: r.id, p_labor: r.laborId, p_cantidad: r.cantidad, p_fecha: r.fecha, p_foto: r.fotoUrl,
    p_lat: r.lat, p_lng: r.lng, p_precision: r.precisionM, p_nota: r.nota,
  }))
}

export async function revisarReporte(id: string, aceptar: boolean, motivo: string, token: string): Promise<string> {
  const d = await lanzar(supabase.rpc('af_revisar', { p_token: token, p_reporte: id, p_aceptar: aceptar, p_motivo: motivo }))
  return String(d)
}

export async function registrarMovimiento(m: {
  fincaId: string; tipo: TipoMovimiento; fecha: string; concepto: string; valor: number
  suerteId?: string | null; soporteUrl?: string | null
}, token: string) {
  await lanzar(supabase.rpc('af_registrar_movimiento', {
    p_token: token,
    p_datos: {
      finca_id: m.fincaId, tipo: m.tipo, fecha: m.fecha, concepto: m.concepto.trim(), valor: m.valor,
      suerte_id: m.suerteId ?? '', soporte_url: m.soporteUrl ?? '',
    },
  }))
}

export async function anularMovimiento(id: string, motivo: string, token: string) {
  await lanzar(supabase.rpc('af_anular_movimiento', { p_token: token, p_id: id, p_motivo: motivo }))
}

// ── El mapa de la finca (solo administración) ─────────────────────────────
/** Agrega pedazos de terreno (importar un KML, dibujar). */
export async function guardarPoligonos(fincaId: string, poligonos: {
  anillo: [number, number][]; etiqueta?: string; areaHa?: number; suerteCodigo?: string; fuente: string
}[], token: string): Promise<number> {
  return Number(await lanzar(supabase.rpc('af_guardar_poligonos', {
    p_token: token, p_finca: fincaId,
    p_poligonos: poligonos.map((p) => ({
      anillo: p.anillo, etiqueta: p.etiqueta ?? '', area_ha: p.areaHa ?? null, suerte_codigo: p.suerteCodigo ?? '', fuente: p.fuente,
    })),
  })))
}
/** Dice a qué suerte pertenece un pedazo (null = sin suerte). */
export async function asignarPoligono(poligonoId: string, suerteId: string | null, token: string) {
  await lanzar(supabase.rpc('af_asignar_poligono', { p_token: token, p_poligono: poligonoId, p_suerte: suerteId }))
}
export async function quitarPoligono(poligonoId: string, token: string) {
  await lanzar(supabase.rpc('af_quitar_poligono', { p_token: token, p_poligono: poligonoId }))
}

// ── Avisos al celular del dueño (25-sep-2026) ─────────────────────────────
export async function claveAvisos(): Promise<string | null> {
  const d = await lanzar(supabase.rpc('af_clave_avisos'))
  return d ? String(d) : null
}
export async function suscribirAvisos(token: string, sub: PushSubscriptionJSON, agente: string) {
  await lanzar(supabase.rpc('af_suscribir', { p_token: token, p_sub: sub, p_agente: agente }))
}
export async function desuscribirAvisos(token: string, endpoint: string) {
  await lanzar(supabase.rpc('af_desuscribir', { p_token: token, p_endpoint: endpoint }))
}
export async function probarAviso(token: string, endpoint: string): Promise<boolean> {
  return Boolean(await lanzar(supabase.rpc('af_probar_aviso', { p_token: token, p_endpoint: endpoint })))
}

// ── Enlaces del dueño de la tierra (solo administración) ──────────────────
/** Crea el enlace personal del dueño. Devuelve la llave: es la ÚNICA vez que existe en claro. */
export async function crearAccesoDueno(fincaId: string, nombre: string, token: string): Promise<string> {
  return String(await lanzar(supabase.rpc('af_crear_acceso', { p_token: token, p_finca: fincaId, p_nombre: nombre })))
}
export async function revocarAccesoDueno(accesoId: string, token: string) {
  await lanzar(supabase.rpc('af_revocar_acceso', { p_token: token, p_acceso: accesoId }))
}
/** El enlace que abre la vista del dueño. La llave va después del «#»: no viaja al servidor web ni queda en sus registros. */
export function enlaceDueno(llave: string): string {
  return `${window.location.origin}/#finca=${llave}`
}

/** Foto de campo o soporte de un gasto. Mismo almacenamiento de las demás evidencias. */
export async function subirFotoFinca(file: File, carpeta: 'reportes' | 'soportes'): Promise<string> {
  const liviana = await comprimirImagen(file, carpeta === 'soportes' ? PERFIL_IMAGEN.documento : PERFIL_IMAGEN.evidencia)
  const ext = (liviana.name.split('.').pop() || 'jpg').toLowerCase()
  const path = `fincas/${carpeta}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
  const { error } = await supabase.storage.from('avatars').upload(path, liviana, { upsert: false, contentType: liviana.type || 'image/jpeg' })
  if (error) throw new Error(error.message)
  return supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl
}

// ── Dueños con usuario (17-oct-2026) ─────────────────────────────────────────
/** Administración liga un usuario con rol «Dueño de finca» a una finca: desde ahí la ve al entrar. */
export async function asignarDuenoFinca(fincaId: string, usuarioId: string, token: string) {
  await lanzar(supabase.rpc('af_asignar_dueno', { p_token: token, p_finca: fincaId, p_usuario: usuarioId }))
}
export async function quitarDuenoFinca(fincaId: string, usuarioId: string, token: string) {
  await lanzar(supabase.rpc('af_quitar_dueno', { p_token: token, p_finca: fincaId, p_usuario: usuarioId }))
}
