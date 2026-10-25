import type { MarcacionFila } from '../services/asistenciaApi'

/**
 * Reglas puras del quiosco del taller (la tableta fija de la entrada).
 * Sin base de datos: se prueban con `node scripts/prueba-taller-quiosco.mts`.
 */

/**
 * Una ENTRADA sin salida más vieja que esto ya no es «sigue adentro»: se le
 * olvidó marcar la salida. Lo siguiente que toca es una ENTRADA nueva, y la
 * entrada vieja queda suelta para que el jefe la resuelva (nunca se cierra sola).
 */
export const LIMITE_TURNO_HORAS = 18

export interface ProximaMarcacion {
  tipo: 'ENTRADA' | 'SALIDA'
  /** true cuando la última fue una ENTRADA de hace más de LIMITE_TURNO_HORAS. */
  olvidoSalida: boolean
}

/** Qué le toca marcar a la persona, según su última marcación NO anulada. */
export function proximoTipo(ultima: Pick<MarcacionFila, 'tipo' | 'marcadoEn'> | null, ahora: Date = new Date()): ProximaMarcacion {
  void ultima; void ahora
  throw new Error('PENDIENTE: lo implementa Codex')
}

/** «ANDRÉS RUIZ» → «AR»; un solo nombre → sus dos primeras letras; vacío → «?». */
export function iniciales(nombre: string): string {
  void nombre
  throw new Error('PENDIENTE: lo implementa Codex')
}

/** El primer nombre para la cuadrícula: «ANDRÉS FELIPE RUIZ» → «Andrés». */
export function primerNombre(nombre: string): string {
  void nombre
  throw new Error('PENDIENTE: lo implementa Codex')
}

/**
 * Filtra por nombre o cédula, sin importar tildes ni mayúsculas
 * («andres» encuentra «ANDRÉS»; «1094» encuentra la cédula que lo contiene).
 * Texto vacío → todos. Resultado ordenado por nombre.
 */
export function buscarPersona<T extends { nombre: string; cedula?: string }>(lista: T[], texto: string): T[] {
  void lista; void texto
  throw new Error('PENDIENTE: lo implementa Codex')
}

/** PIN de 4 dígitos al azar (crypto), para el usuario nuevo. Nunca «0000» ni cuatro iguales. */
export function pinNuevo(): string {
  throw new Error('PENDIENTE: lo implementa Codex')
}
