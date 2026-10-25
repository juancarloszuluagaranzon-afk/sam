import type { MarcacionFila, RespuestaMarcar, RostroRegistrado } from './asistenciaApi'
import type { ResultadoCamara } from '../components/CamaraRostro'

/**
 * Personal del taller y quiosco de la entrada (25-oct-2026, pedido de Carlos David).
 *
 * Antes cada mecánico se tenía que registrar solo, en su celular: nadie lo hizo
 * (cero caras en la base). Ahora el JEFE da de alta a cada persona y le registra
 * la cara en persona, y la tableta fija de la entrada marca por todos.
 *
 * 🔴 Toda escritura pasa por funciones de la base (`app_create_user`,
 * `taller_guardar_personal`, `taller_enrolar_rostro`, `taller_marcar`…). El
 * cliente solo lee.
 */

/** Una persona del taller (usuario con rol `taller`) con lo que necesitan las dos pantallas. */
export interface Mecanico {
  id: string
  /** `nombre_completo`, en MAYÚSCULA. */
  nombre: string
  cedula?: string
  /** De `taller_personal`. */
  cargo?: string
  telefono?: string
  /** La cara vigente (activa), o null si no tiene. */
  rostro: RostroRegistrado | null
  /** La última marcación NO anulada de los últimos 14 días, o null. */
  ultima: MarcacionFila | null
}

/** El roster del quiosco, con de dónde salió (sin señal sale del espejo del aparato). */
export interface RosterQuiosco {
  mecanicos: Mecanico[]
  desdeCache: boolean
  /** ISO de la última vez que se trajo de la base. */
  actualizadoEn: string | null
}

/** Personal activo del taller, ordenado por nombre. Lee app_usuarios (columnas explícitas: nunca pin_hash). */
export async function loadPersonalTaller(): Promise<Mecanico[]> {
  throw new Error('PENDIENTE: lo implementa Codex')
}

/**
 * Da de alta a un mecánico: crea su usuario (rol `taller`) con un PIN de 4
 * dígitos al azar, guarda su ficha (cargo, teléfono) y lo devuelve con el PIN,
 * que la pantalla muestra UNA sola vez.
 * Errores con mensaje claro: nombre vacío, cédula vacía o con algo distinto de
 * dígitos, cédula repetida en otro usuario activo («Ya existe … con esa cédula»).
 */
export async function crearMecanico(
  datos: { nombre: string; cedula: string; cargo?: string; telefono?: string },
  quien: string,
): Promise<{ mecanico: Mecanico; pin: string }> {
  void datos; void quien
  throw new Error('PENDIENTE: lo implementa Codex')
}

/** Corrige cargo y teléfono (la base pasa el cargo a MAYÚSCULA). */
export async function guardarFicha(usuarioId: string, ficha: { cargo?: string; telefono?: string }, quien: string): Promise<void> {
  void usuarioId; void ficha; void quien
  throw new Error('PENDIENTE: lo implementa Codex')
}

/**
 * Retira a la persona del taller: PRIMERO suprime su plantilla de la cara
 * (Ley 1581: terminada la finalidad, se borra) y DESPUÉS desactiva su usuario.
 * Sus marcaciones y horas pasadas se conservan.
 */
export async function retirarMecanico(usuarioId: string, quien: string): Promise<void> {
  void usuarioId; void quien
  throw new Error('PENDIENTE: lo implementa Codex')
}

/**
 * El jefe registra la cara EN PERSONA (después de que la persona leyó y aceptó
 * la autorización en la pantalla del jefe). Queda APROBADA de una.
 */
export async function enrolarPorJefe(
  input: { usuarioId: string; toma: ResultadoCamara; version: string },
  quien: string,
): Promise<'PENDIENTE' | 'APROBADO'> {
  void input; void quien
  throw new Error('PENDIENTE: lo implementa Codex')
}

/** El usuario del quiosco, si ya existe (rol `quiosco_taller`, activo). */
export async function loadUsuarioQuiosco(): Promise<{ id: string; nombre: string } | null> {
  throw new Error('PENDIENTE: lo implementa Codex')
}

/** Crea el usuario del quiosco («QUIOSCO DEL TALLER») con PIN de 4 dígitos al azar. */
export async function crearUsuarioQuiosco(quien: string): Promise<{ id: string; pin: string }> {
  void quien
  throw new Error('PENDIENTE: lo implementa Codex')
}

/**
 * El roster del quiosco. Con señal: `loadPersonalTaller()` y lo espeja en el
 * aparato. Sin señal (o si falla): el espejo, con `desdeCache: true`.
 * 🔴 El espejo es de una versión VIEJA por definición: al leerlo se rellena
 * contra el objeto vacío (regla 2b del CLAUDE.md), nunca se devuelve crudo.
 */
export async function loadRosterQuiosco(): Promise<RosterQuiosco> {
  throw new Error('PENDIENTE: lo implementa Codex')
}

/**
 * Marca desde el quiosco. Usa `marcarOEncolar` (sin señal queda en cola y sube
 * sola), con `quioscoId`, `dispositivo: 'Quiosco del taller · <aparato>'` y la
 * ubicación si la hay (no bloquea: si no llega en 5 s, va sin ella).
 * Si se envió, actualiza la última marcación de esa persona en el espejo, para
 * que la cuadrícula diga ADENTRO/AFUERA bien aunque luego se caiga la señal.
 */
export async function marcarEnQuiosco(input: {
  usuarioId: string
  quioscoId: string
  tipo: 'ENTRADA' | 'SALIDA'
  metodo: 'ROSTRO' | 'PIN'
  toma?: ResultadoCamara | null
  /** Foto del momento cuando la cara no se reconoce y se deja para el jefe. */
  foto?: string | null
  pin?: string | null
  forzarRevision?: boolean
}): Promise<{ enviada: boolean; respuesta?: RespuestaMarcar }> {
  void input
  throw new Error('PENDIENTE: lo implementa Codex')
}
