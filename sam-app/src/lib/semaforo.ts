/**
 * Semáforo de consumo por máquina: galones por hora y ganchos por hora.
 *
 * Los rangos NO viven aquí: vienen de la tabla `semaforo_consumo` (migración
 * `20260921130000`), que el cliente ajusta sin publicar versión. Aquí solo se
 * decide el nivel y cómo se dice.
 *
 * 🔴 El color nunca va solo: cada nivel lleva su símbolo y su palabra (daltonismo,
 * impresión en blanco y negro). Y una máquina sin rango o sin horas NO lleva
 * semáforo — pintar de verde algo que no se pudo medir es inventar un juicio.
 */

export type IndicadorSemaforo = 'gal_hora' | 'ganchos_hora'
export type NivelSemaforo = 'bajo' | 'verde' | 'naranja' | 'rojo'

export interface RangoSemaforo {
  indicador: IndicadorSemaforo
  /** Nombre como lo escribe el cliente (CASE 1001); '*' = todas. */
  maquina: string
  verdeMin: number | null
  verdeMax: number
  naranjaMax: number
  nota: string | null
}

export const NIVEL: Record<NivelSemaforo, { icono: string; texto: string }> = {
  // Debajo del rango no es «bueno» ni «malo»: casi siempre es un registro que falta
  // (un tanqueo o una entrega) o un horómetro que corrió de más. Se dice así.
  bajo: { icono: '▽', texto: 'debajo del rango' },
  verde: { icono: '✓', texto: 'dentro del rango' },
  naranja: { icono: '▲', texto: 'medio' },
  rojo: { icono: '⚠', texto: 'alto' },
}

/** «Case  1304 » → «CASE 1304»: así se cruzan los nombres del equipo con la tabla. */
export function normalizarMaquina(nombre: string): string {
  return nombre.trim().toUpperCase().replace(/\s+/g, ' ')
}

/** El rango de esa máquina; si no tiene propio, el de todas ('*'); si no, null. */
export function rangoDe(
  rangos: RangoSemaforo[],
  indicador: IndicadorSemaforo,
  nombreMaquina: string,
): RangoSemaforo | null {
  const n = normalizarMaquina(nombreMaquina)
  return rangos.find((r) => r.indicador === indicador && normalizarMaquina(r.maquina) === n)
    ?? rangos.find((r) => r.indicador === indicador && r.maquina === '*')
    ?? null
}

export function nivelDe(valor: number | null | undefined, rango: RangoSemaforo | null): NivelSemaforo | null {
  if (valor == null || !Number.isFinite(valor) || !rango) return null
  // Los valores llegan redondeados a 2 decimales, como los escribe la tabla
  // («1,2 a 1,5 · 1,51 a 1,7»): 1,50 es verde y 1,51 ya es naranja.
  const v = Math.round(valor * 100) / 100
  if (rango.verdeMin != null && v < rango.verdeMin) return 'bajo'
  if (v <= rango.verdeMax) return 'verde'
  if (v <= rango.naranjaMax) return 'naranja'
  return 'rojo'
}

const nf = (n: number) => n.toLocaleString('es-CO', { maximumFractionDigits: 2 })

/** «✓ 1,2 a 1,5 · ▲ hasta 1,7 · ⚠ más de 1,7» */
export function describirRango(r: RangoSemaforo): string {
  const verde = r.verdeMin != null ? `${nf(r.verdeMin)} a ${nf(r.verdeMax)}` : `hasta ${nf(r.verdeMax)}`
  return `✓ ${verde} · ▲ hasta ${nf(r.naranjaMax)} · ⚠ más de ${nf(r.naranjaMax)}`
}
