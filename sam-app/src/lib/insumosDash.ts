import type { Assignment, InsumoKardex } from '../domain/sam'
import { diaKey } from './fechas'
import { executionDateKey } from '../services/samApi'
import { unidadDeLabor } from './texto'
import type { Punto } from '../components/Charts'

/**
 * Cálculos del bloque «Insumos y materiales» del tablero de Operación general.
 *
 * Viven aquí y no dentro del componente para poder probarlos contra datos
 * REALES importando el módulo — el tablero se dibuja dentro de una sesión a la
 * que no siempre se puede entrar.
 *
 * Tres reglas del proyecto que gobiernan todo lo de abajo:
 *
 * 🔴 **Nunca sumar cantidades de insumos distintos.** 40 ganchos + 23,95 galones
 * es un «63,95» que no significa nada. Por eso la torta «por material» cuenta
 * ENTREGAS, y solo combustible (galones) y ganchos (unidades) se suman, cada uno
 * en su propia torta.
 *
 * 🔴 **CONSUMO ≠ todo lo que salió de la bodega.** Solo cuentan los movimientos
 * SALIDA con máquina; surtir un carro es un traslado, no un consumo.
 *
 * 🔴 **ACEQUIAS se mide en hectómetros.** Un gal/ha global que metiera los hm en
 * el denominador sumaría peras con manzanas; se excluyen del global y cada labor
 * lleva su propia unidad.
 */

export type Catalogo = Map<string, { nombre: string; unidad: string }>

/** Los movimientos que cuentan como consumo de una máquina. */
export function consumos(movs: InsumoKardex[]): InsumoKardex[] {
  return movs.filter((m) => m.tipo === 'SALIDA' && m.equipoCodigo)
}

function esCombustible(id: string, cat: Catalogo): boolean {
  return cat.get(id)?.nombre === 'COMBUSTIBLE'
}
function esGancho(id: string, cat: Catalogo): boolean {
  return cat.get(id)?.nombre === 'GANCHOS'
}

/**
 * Entregas por material. Cuenta filas del kardex, no cantidades: cada fila es
 * «ese material, en esa entrega». Es la única forma de poner combustible y
 * ganchos en la misma torta sin mentir.
 */
export function porMaterial(movs: InsumoKardex[], cat: Catalogo): Punto[] {
  const m = new Map<string, number>()
  for (const k of movs) m.set(k.insumoId, (m.get(k.insumoId) ?? 0) + 1)
  return Array.from(m.entries())
    .map(([id, n]) => ({ id, label: cat.get(id)?.nombre ?? id, valor: n, sufijo: 'entregas' }))
    .sort((a, b) => b.valor - a.valor)
}

/** Cantidad de UN material por máquina, en la unidad de ese material. */
export function materialPorMaquina(
  movs: InsumoKardex[], insumoId: string, nombreMaq: (c: string) => string,
): Punto[] {
  const m = new Map<string, number>()
  for (const k of movs) {
    if (k.insumoId !== insumoId || !k.equipoCodigo) continue
    m.set(k.equipoCodigo, (m.get(k.equipoCodigo) ?? 0) + k.cantidad)
  }
  return Array.from(m.entries())
    .map(([c, v]) => ({ id: c, label: nombreMaq(c), valor: Math.round(v * 100) / 100 }))
    .sort((a, b) => b.valor - a.valor)
}

/** Galones de combustible por máquina. */
export function combustiblePorMaquina(movs: InsumoKardex[], cat: Catalogo, nombreMaq: (c: string) => string): Punto[] {
  const fuel = movs.filter((k) => esCombustible(k.insumoId, cat))
  const m = new Map<string, number>()
  for (const k of fuel) m.set(k.equipoCodigo!, (m.get(k.equipoCodigo!) ?? 0) + k.cantidad)
  return Array.from(m.entries())
    .map(([c, v]) => ({ id: c, label: nombreMaq(c), valor: Math.round(v * 10) / 10 }))
    .sort((a, b) => b.valor - a.valor)
}

/** Ganchos por máquina. */
export function ganchosPorMaquina(movs: InsumoKardex[], cat: Catalogo, nombreMaq: (c: string) => string): Punto[] {
  const g = movs.filter((k) => esGancho(k.insumoId, cat))
  const m = new Map<string, number>()
  for (const k of g) m.set(k.equipoCodigo!, (m.get(k.equipoCodigo!) ?? 0) + k.cantidad)
  return Array.from(m.entries())
    .map(([c, v]) => ({ id: c, label: nombreMaq(c), valor: Math.round(v) }))
    .sort((a, b) => b.valor - a.valor)
}

/** Materiales que recibió UNA máquina, contados en entregas. */
export function materialesDeMaquina(movs: InsumoKardex[], maquina: string, cat: Catalogo): Punto[] {
  const m = new Map<string, number>()
  for (const k of movs) {
    if (k.equipoCodigo !== maquina) continue
    m.set(k.insumoId, (m.get(k.insumoId) ?? 0) + 1)
  }
  return Array.from(m.entries())
    .map(([id, n]) => ({ id, label: cat.get(id)?.nombre ?? id, valor: n, sufijo: 'entregas' }))
    .sort((a, b) => b.valor - a.valor)
}

export interface GalPorHa {
  /** gal/ha del periodo, SOLO con labores en hectáreas. `null` si no hay con qué. */
  global: number | null
  galones: number
  hectareas: number
  /** Por labor, cada una con SU unidad (ha o hm). */
  porLabor: { labor: string; gal: number; area: number; unidad: string; ratio: number }[]
  /** Por máquina, con la labor que más área le puso: sin ella la comparación es injusta. */
  porMaquina: { maquina: string; gal: number; ha: number; ratio: number | null; laborDominante: string; labores: string[] }[]
  /** De los días-máquina con hectáreas, cuántos tuvieron tanqueo ESE día. */
  cobertura: { conTanqueo: number; total: number }
  /** Días-máquina con más de una labor: ahí el reparto del combustible es aproximado. */
  ambiguos: { varias: number; total: number }
}

function areaEjec(a: Assignment): number {
  if (a.status !== 'COMPLETADA' && a.status !== 'PARCIAL') return 0
  return a.executedArea > 0 ? a.executedArea : a.area
}

/**
 * Galones por hectárea: el combustible del periodo contra las hectáreas del
 * mismo periodo, y desglosado por labor y por máquina.
 *
 * El combustible se le carga a una MÁQUINA en un DÍA; la labor no viene en el
 * kardex. El puente es (máquina, día): el combustible de ese día se reparte
 * entre las labores que esa máquina cerró ese día, proporcional al área.
 *
 * ⚠️ Es un reparto, no una medida: en el 24% de los días-máquina hubo más de
 * una labor (medido ago–sep 2026). Por eso `ambiguos` viaja con el resultado y
 * la pantalla lo dice. Y un tanqueo del lunes alimenta martes y miércoles: para
 * un solo día el gal/ha es ruidoso (70% de cobertura medida), para una quincena
 * se promedia solo.
 *
 * Medido en agosto de 2026 con ESTE código (6.859 gal / 5.942 ha = 1,15 global):
 * TRIPLE 3,6 gal/ha, SUBSUELO 3,4, FERTILIZACIÓN 2,2, DESPEJE 0,9, REENCALLE 0,8,
 * ACEQUIAS 0,6 gal/hm. Tres a cuatro veces entre la labor pesada y la liviana.
 * Las PUMA (3–5 gal/ha) hacen TRIPLE, SUBSUELO y FERTILIZACIÓN: **es la labor,
 * no la máquina**, y eso es lo que `laborDominante` deja ver.
 *
 * ⚠️ Un SQL rápido hecho antes dio TRIPLE 3,9 y PUMA2302 2,87: contaba solo los
 * días con tanqueo y metía los hectómetros de ACEQUIAS en el denominador. Aquí
 * el denominador es TODO el área en hectáreas del periodo, que es lo coherente
 * con el gal/ha global — y por eso PUMA2302 sale 4,87: hizo 142 hm que no cuentan.
 */
export function galonesPorHectarea(movs: InsumoKardex[], cerradas: Assignment[], cat: Catalogo): GalPorHa {
  // Combustible por (máquina, día).
  const fuelDia = new Map<string, number>()
  const fuelMaq = new Map<string, number>()
  for (const k of movs) {
    if (!esCombustible(k.insumoId, cat) || !k.equipoCodigo) continue
    const llave = `${k.equipoCodigo}|${diaKey(k.createdAt)}`
    fuelDia.set(llave, (fuelDia.get(llave) ?? 0) + k.cantidad)
    fuelMaq.set(k.equipoCodigo, (fuelMaq.get(k.equipoCodigo) ?? 0) + k.cantidad)
  }

  // Labores por (máquina, día): área por labor.
  const labDia = new Map<string, Map<string, number>>()
  for (const a of cerradas) {
    if (!a.equipmentCode) continue
    const area = areaEjec(a)
    if (area <= 0) continue
    // El MISMO día que usa el resto del tablero para ubicar la labor. Si aquí
    // se calculara distinto, el combustible y la labor caerían en días
    // diferentes y el puente (máquina, día) no cerraría.
    const dia = executionDateKey(a)
    if (!dia) continue
    const llave = `${a.equipmentCode}|${dia}`
    const porLab = labDia.get(llave) ?? new Map<string, number>()
    porLab.set(a.labor, (porLab.get(a.labor) ?? 0) + area)
    labDia.set(llave, porLab)
  }

  // Reparto del combustible del día a sus labores, proporcional al área.
  const acumLab = new Map<string, { gal: number; area: number; unidad: string }>()
  const haMaq = new Map<string, number>()
  const labMaq = new Map<string, Map<string, number>>()
  let galGlobal = 0
  let haGlobal = 0
  let conTanqueo = 0
  let varias = 0

  for (const [llave, porLab] of labDia) {
    const [maq] = llave.split('|')
    const gal = fuelDia.get(llave) ?? 0
    if (gal > 0) conTanqueo += 1
    if (porLab.size > 1) varias += 1
    const areaDia = Array.from(porLab.values()).reduce((s, v) => s + v, 0)

    for (const [labor, area] of porLab) {
      const unidad = unidadDeLabor(labor)
      const galLab = areaDia > 0 ? gal * (area / areaDia) : 0
      const e = acumLab.get(labor) ?? { gal: 0, area: 0, unidad }
      e.gal += galLab; e.area += area
      acumLab.set(labor, e)

      const lm = labMaq.get(maq) ?? new Map<string, number>()
      lm.set(labor, (lm.get(labor) ?? 0) + area)
      labMaq.set(maq, lm)

      // El global y el por-máquina SOLO en hectáreas: los hm no se suman con ha.
      if (unidad === 'ha') {
        haMaq.set(maq, (haMaq.get(maq) ?? 0) + area)
        galGlobal += galLab
        haGlobal += area
      }
    }
  }

  const porLabor = Array.from(acumLab.entries())
    .filter(([, e]) => e.area > 0 && e.gal > 0)
    .map(([labor, e]) => ({
      labor, gal: e.gal, area: e.area, unidad: e.unidad,
      ratio: Math.round((e.gal / e.area) * 100) / 100,
    }))
    .sort((a, b) => b.ratio - a.ratio)

  const porMaquina = Array.from(new Set([...fuelMaq.keys(), ...haMaq.keys()]))
    .map((maq) => {
      const gal = fuelMaq.get(maq) ?? 0
      const ha = haMaq.get(maq) ?? 0
      const lm = labMaq.get(maq)
      // Dominante ENTRE las labores en hectáreas: el gal/ha de al lado excluye
      // los hectómetros, y «4,87 gal/ha · ACEQUIAS» mezclaría en la etiqueta lo
      // que el número separa. Si solo hizo hm, se muestra esa igual.
      let laborDominante = ''
      if (lm) {
        let mejor = -1
        for (const [l, a] of lm) if (unidadDeLabor(l) === 'ha' && a > mejor) { mejor = a; laborDominante = l }
        if (!laborDominante) for (const [l, a] of lm) if (a > mejor) { mejor = a; laborDominante = l }
      }
      return {
        maquina: maq, gal: Math.round(gal * 10) / 10, ha: Math.round(ha * 10) / 10,
        ratio: gal > 0 && ha > 0 ? Math.round((gal / ha) * 100) / 100 : null,
        laborDominante,
        labores: lm ? Array.from(lm.keys()) : [],
      }
    })
    .filter((r) => r.gal > 0 || r.ha > 0)
    .sort((a, b) => (b.ratio ?? -1) - (a.ratio ?? -1))

  return {
    global: haGlobal > 0 && galGlobal > 0 ? Math.round((galGlobal / haGlobal) * 100) / 100 : null,
    galones: Math.round(galGlobal * 10) / 10,
    hectareas: Math.round(haGlobal * 10) / 10,
    porLabor,
    porMaquina,
    cobertura: { conTanqueo, total: labDia.size },
    ambiguos: { varias, total: labDia.size },
  }
}
