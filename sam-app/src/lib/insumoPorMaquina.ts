import type { InsumoKardex } from '../domain/sam'
import { compararEquipos } from './ordenEquipos.ts'   // con extensión: así también lo cargan las pruebas de Node

/**
 * «Otros insumos» de Eficiencia de maquinaria (Ola 1 de la reunión con ASM, 26-oct-2026): cuánto se le ha entregado de UN
 * insumo (un rodamiento, un filtro…) a cada máquina en un periodo. Sin semáforo ni galones por hora: eso solo tiene
 * sentido para combustible y ganchos.
 *
 * Consumo de la máquina = SALIDAS cargadas a ella menos las ENTRADAS de devolución (la regla de toda la app: surtir un
 * carro NO es consumo, y solo cuentan los movimientos con máquina). Un despacho es UN hecho aunque el kardex guarde una
 * fila por insumo: las entregas se cuentan por `referencia`.
 */
export interface FilaInsumoMaquina {
  maquina: string
  /** SALIDAS − devoluciones, en la unidad del insumo. Nunca negativa. */
  cantidad: number
  /** Cuántos despachos distintos (por referencia). */
  entregas: number
  /** Fecha efectiva de la última salida (`createdAt` del movimiento). */
  ultima: string | null
}

const r2 = (n: number) => Math.round(n * 100) / 100

export function consumoInsumoPorMaquina(kardex: InsumoKardex[], insumoId: string): FilaInsumoMaquina[] {
  const m = new Map<string, { sal: number; dev: number; refs: Set<string>; ultima: string | null }>()
  for (const k of kardex) {
    if (k.insumoId !== insumoId || !k.equipoCodigo) continue
    if (k.tipo !== 'SALIDA' && k.tipo !== 'ENTRADA') continue
    const f = m.get(k.equipoCodigo) ?? { sal: 0, dev: 0, refs: new Set<string>(), ultima: null }
    if (k.tipo === 'SALIDA') {
      f.sal += Number(k.cantidad) || 0
      f.refs.add(k.referencia || k.id)
      if (!f.ultima || k.createdAt > f.ultima) f.ultima = k.createdAt
    } else {
      f.dev += Number(k.cantidad) || 0
    }
    m.set(k.equipoCodigo, f)
  }
  return [...m.entries()]
    .map(([maquina, f]) => ({ maquina, cantidad: Math.max(0, r2(f.sal - f.dev)), entregas: f.refs.size, ultima: f.ultima }))
    .filter((f) => f.cantidad > 0 || f.entregas > 0)
    .sort((a, b) => compararEquipos(a.maquina, b.maquina))
}
