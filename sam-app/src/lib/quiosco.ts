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
  if (!ultima || ultima.tipo === 'SALIDA') return { tipo: 'ENTRADA', olvidoSalida: false }
  const horas = (ahora.getTime() - new Date(ultima.marcadoEn).getTime()) / 3_600_000
  if (horas > LIMITE_TURNO_HORAS) return { tipo: 'ENTRADA', olvidoSalida: true }
  return { tipo: 'SALIDA', olvidoSalida: false }
}

/** «ANDRÉS RUIZ» → «AR»; un solo nombre → sus dos primeras letras; vacío → «?». */
export function iniciales(nombre: string): string {
  const palabras = nombre.trim().split(/\s+/).filter(Boolean)
  if (!palabras.length) return '?'
  return (palabras.length > 1
    ? palabras.slice(0, 2).map((p) => p[0]).join('')
    : palabras[0].slice(0, 2)).toLocaleUpperCase('es-CO')
}

/** El primer nombre para la cuadrícula: «ANDRÉS FELIPE RUIZ» → «Andrés». */
export function primerNombre(nombre: string): string {
  const primero = nombre.trim().split(/\s+/).filter(Boolean)[0]
  if (!primero) return ''
  const minuscula = primero.toLocaleLowerCase('es-CO')
  return minuscula.charAt(0).toLocaleUpperCase('es-CO') + minuscula.slice(1)
}

/** «ANDRÉS FELIPE RUIZ» → «Andrés Felipe»: tipo oración, solo las primeras `n` palabras. */
function palabrasBonitas(nombre: string, n: number): string {
  return nombre.trim().split(/\s+/).filter(Boolean).slice(0, n)
    .map((p) => p.toLocaleLowerCase('es-CO'))
    .map((p) => p.charAt(0).toLocaleUpperCase('es-CO') + p.slice(1)).join(' ')
}

/**
 * La etiqueta de cada tarjeta de la cuadrícula. En un taller de diez personas
 * puede haber dos «Luis»: con solo el primer nombre, uno marcaría por el otro.
 * Primer nombre; si se repite, los DOS primeros; si todavía se repite, el nombre
 * completo (y para eso queda el buscador por cédula). Devuelve una etiqueta por
 * cada nombre recibido, en el mismo orden.
 */
export function etiquetasCortas(nombres: string[]): string[] {
  const nivel = (n: number) => nombres.map((x) => palabrasBonitas(x, n))
  const cuenta = (l: string[]) => l.reduce((m, e) => m.set(e, (m.get(e) ?? 0) + 1), new Map<string, number>())
  const uno = nivel(1)
  const c1 = cuenta(uno)
  const dos = nivel(2)
  const c2 = cuenta(dos)
  const todo = nombres.map((x) => palabrasBonitas(x, 99))
  return nombres.map((_, i) => (c1.get(uno[i]) ?? 0) <= 1 ? uno[i] : (c2.get(dos[i]) ?? 0) <= 1 ? dos[i] : todo[i])
}

/**
 * Filtra por nombre o cédula, sin importar tildes ni mayúsculas
 * («andres» encuentra «ANDRÉS»; «1094» encuentra la cédula que lo contiene).
 * Texto vacío → todos. Resultado ordenado por nombre.
 */
export function buscarPersona<T extends { nombre: string; cedula?: string }>(lista: T[], texto: string): T[] {
  const normalizar = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es-CO')
  const busqueda = normalizar(texto.trim())
  if (!busqueda) return [...lista].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
  const digitos = texto.replace(/\D/g, '')
  return lista.filter((p) => normalizar(p.nombre).includes(busqueda)
    || (!!digitos && (p.cedula ?? '').replace(/\D/g, '').includes(digitos)))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
}

/** PIN de 4 dígitos al azar (crypto), para el usuario nuevo. Nunca «0000» ni cuatro iguales. */
export function pinNuevo(): string {
  const bytes = new Uint8Array(4)
  let pin = ''
  do {
    crypto.getRandomValues(bytes)
    pin = String(((bytes[0] << 8) | bytes[1]) % 10000).padStart(4, '0')
  } while (pin === '0000' || /^([0-9])\1{3}$/.test(pin))
  return pin
}
