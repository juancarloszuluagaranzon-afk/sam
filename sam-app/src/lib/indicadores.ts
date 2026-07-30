import type { MttoPlan, OrdenTrabajo, PlanVencimiento, EquipoCosto } from '../domain/sam'

/**
 * Indicadores de mantenimiento y costo por hora del activo.
 *
 * Las definiciones se escriben aquí, explícitas, porque cada empresa las cuenta
 * distinto y una diferencia de criterio cambia el número sin que nadie lo note:
 *
 *  · **Disponibilidad** = (horas del periodo − horas paradas) / horas del periodo.
 *    Se mide contra las horas CALENDARIO del periodo, no contra las programadas.
 *    Es la definición conservadora: una máquina parada un domingo también estuvo
 *    parada. Si el cliente prefiere medir contra horas programadas, el cambio va
 *    en `HORAS_DIA` y queda documentado.
 *
 *  · **TMEF / MTBF** = horas operando / número de FALLAS. Solo cuentan los
 *    correctivos: un preventivo no es una falla, y meterlo en la cuenta hace ver
 *    la máquina peor mientras mejor la cuiden — el incentivo exactamente al revés.
 *
 *  · **TMR / MTTR** = horas paradas / número de reparaciones. Mide qué tan rápido
 *    se responde, no qué tan seguido se daña.
 *
 *  · **# Paradas** = correctivos cerrados en el periodo.
 */

/** Horas que se le cuentan a la máquina por día calendario. */
const HORAS_DIA = 24

export interface Indicadores {
  /** 0–100. */
  disponibilidad: number
  /** Horas entre fallas. 0 si no hubo fallas (no se puede dividir). */
  tmef: number
  /** Horas por reparación. */
  tmr: number
  paradas: number
  horasParado: number
  horasPeriodo: number
  /** Órdenes sin cerrar: su paro no se puede medir todavía. */
  abiertas: number
}

function horasEntre(a?: string, b?: string): number | null {
  if (!a || !b) return null
  const x = new Date(a).getTime()
  const y = new Date(b).getTime()
  if (isNaN(x) || isNaN(y) || y < x) return null
  return (y - x) / 3600000
}

/**
 * Indicadores de un conjunto de órdenes en un rango.
 *
 * `desde`/`hasta` son las fechas del periodo (YYYY-MM-DD) y definen el
 * denominador de la disponibilidad.
 */
export function calcularIndicadores(
  ordenes: OrdenTrabajo[],
  desde: string,
  hasta: string,
): Indicadores {
  const ini = new Date(`${desde}T00:00:00`).getTime()
  const fin = new Date(`${hasta}T23:59:59`).getTime()
  const dias = Math.max(1, Math.round((fin - ini) / 86400000))
  const horasPeriodo = dias * HORAS_DIA

  const vivas = ordenes.filter((o) => o.estado !== 'ANULADA')
  const cerradas = vivas.filter((o) => o.estado === 'CERRADA')

  // Paro medido: solo el de las órdenes que ya arrancaron de nuevo.
  let horasParado = 0
  let reparaciones = 0
  for (const o of cerradas) {
    const h = horasEntre(o.paroEn, o.arranqueEn)
    if (h != null) { horasParado += h; reparaciones += 1 }
  }
  // El paro no puede exceder el periodo (una parada puede venir de antes).
  horasParado = Math.min(horasParado, horasPeriodo)

  const fallas = cerradas.filter((o) => o.tipo === 'CORRECTIVO').length
  const horasOperando = Math.max(0, horasPeriodo - horasParado)

  return {
    disponibilidad: horasPeriodo > 0 ? (horasOperando / horasPeriodo) * 100 : 0,
    tmef: fallas > 0 ? horasOperando / fallas : 0,
    tmr: reparaciones > 0 ? horasParado / reparaciones : 0,
    paradas: fallas,
    horasParado,
    horasPeriodo,
    abiertas: vivas.filter((o) => o.estado !== 'CERRADA').length,
  }
}

/* ── Costo del activo ────────────────────────────────────────────────────── */

export interface CostoActivo {
  administrativos: number
  operativos: number
  mantenimiento: number
  total: number
  /** Horas trabajadas en el periodo (para el $/hora). */
  horas: number
  /** El número que importa. 0 si no hay horas. */
  porHora: number
  detalle: {
    seguros: number
    impuestos: number
    depreciacion: number
    combustible: number
    repuestos: number
    manoObra: number
    externos: number
  }
}

/**
 * Costo del activo en un periodo, dividido en las tres bolsas del modelo.
 *
 * La depreciación se calcula por USO, no por calendario: es maquinaria, y una
 * máquina quieta no se gasta. Sale de (valor − residual) / vida útil en horas,
 * multiplicado por las horas del periodo. Si el equipo no tiene esos datos
 * cargados, la depreciación es 0 y hay que decirlo en pantalla — un costo por
 * hora sin depreciación se ve engañosamente barato.
 */
export function calcularCostoActivo(input: {
  ordenes: OrdenTrabajo[]
  costos: EquipoCosto[]
  /** Galones consumidos por la máquina en el periodo. */
  galones: number
  precioGalon: number
  /** Horas trabajadas (diferencia de horómetro en el periodo). */
  horas: number
  valorCompra?: number
  valorResidual?: number
  vidaUtilHoras?: number
}): CostoActivo {
  const cerradas = input.ordenes.filter((o) => o.estado === 'CERRADA')

  const repuestos = cerradas.reduce(
    (t, o) => t + o.repuestos.reduce((x, r) => x + r.cantidad * r.costoUnitario, 0), 0)
  const manoObra = cerradas.reduce((t, o) => t + o.horasMo * o.valorHoraMo, 0)
  const externos = cerradas.reduce((t, o) => t + o.costoExterno, 0)

  const suma = (c: string) => input.costos.filter((x) => x.concepto === c).reduce((t, x) => t + x.valor, 0)
  const seguros = suma('SEGURO')
  const impuestos = suma('IMPUESTO')
  const otrosAdmin = suma('ADMINISTRATIVO') + suma('OTRO')

  // Depreciación: la cargada a mano manda; si no hay, se calcula por uso.
  const depCargada = suma('DEPRECIACION')
  const base = (input.valorCompra ?? 0) - (input.valorResidual ?? 0)
  const depCalculada = input.vidaUtilHoras && input.vidaUtilHoras > 0 && base > 0
    ? (base / input.vidaUtilHoras) * input.horas
    : 0
  const depreciacion = depCargada > 0 ? depCargada : depCalculada

  const combustible = input.galones * input.precioGalon

  const administrativos = seguros + impuestos + depreciacion + otrosAdmin
  const operativos = combustible
  const mantenimiento = repuestos + manoObra + externos
  const total = administrativos + operativos + mantenimiento

  return {
    administrativos,
    operativos,
    mantenimiento,
    total,
    horas: input.horas,
    porHora: input.horas > 0 ? total / input.horas : 0,
    detalle: { seguros, impuestos, depreciacion, combustible, repuestos, manoObra, externos },
  }
}

/* ── Plan preventivo ─────────────────────────────────────────────────────── */

/**
 * Cuánto le falta a cada plan para vencer, según el horómetro de hoy.
 *
 * Un plan puede definirse para una máquina (`equipoCodigo`) o para un MODELO,
 * en cuyo caso aplica a todas las máquinas iguales. Sin lectura de horómetro no
 * se inventa nada: queda como SIN_LECTURA, que es información, no un cero.
 */
export function vencimientosDe(
  planes: MttoPlan[],
  horometros: Map<string, number>,
  equipos: { codigo: string; marca?: string; modelo?: string }[],
): PlanVencimiento[] {
  const out: PlanVencimiento[] = []

  for (const plan of planes) {
    if (!plan.activo || !plan.cadaHoras || plan.cadaHoras <= 0) continue

    // A qué máquinas aplica este plan.
    const objetivo = plan.equipoCodigo
      ? equipos.filter((e) => e.codigo === plan.equipoCodigo)
      : equipos.filter((e) =>
          (!plan.marca || (e.marca ?? '').toUpperCase() === plan.marca.toUpperCase()) &&
          (!plan.modelo || (e.modelo ?? '').toUpperCase() === plan.modelo.toUpperCase()) &&
          (plan.marca != null || plan.modelo != null))

    for (const eq of objetivo) {
      const h = horometros.get(eq.codigo)
      if (h == null || h <= 0) {
        out.push({
          plan, equipoCodigo: eq.codigo, horometro: 0,
          proximaEn: 0, faltan: 0, estado: 'SIN_LECTURA',
        })
        continue
      }
      // Sin registro de la última vez, se asume que toca desde el ciclo en curso.
      const desde = plan.ultimaHoras ?? Math.floor(h / plan.cadaHoras) * plan.cadaHoras
      const proximaEn = desde + plan.cadaHoras
      const faltan = proximaEn - h
      out.push({
        plan, equipoCodigo: eq.codigo, horometro: h, proximaEn, faltan,
        estado: faltan <= 0 ? 'VENCIDO' : faltan <= plan.avisarAntesHoras ? 'PROXIMO' : 'OK',
      })
    }
  }

  // Lo urgente arriba: vencidos primero, y dentro de cada grupo el más vencido.
  const orden = { VENCIDO: 0, PROXIMO: 1, OK: 2, SIN_LECTURA: 3 }
  return out.sort((a, b) => orden[a.estado] - orden[b.estado] || a.faltan - b.faltan)
}

/** Horas trabajadas en un periodo = diferencia de horómetro entre extremos. */
export function horasTrabajadas(lecturas: { horas: number }[]): number {
  if (lecturas.length < 2) return 0
  const vals = lecturas.map((l) => l.horas).sort((a, b) => a - b)
  return Math.max(0, vals[vals.length - 1] - vals[0])
}

/* ── Consumo de combustible de una máquina ───────────────────────────────── */

/**
 * Galones consumidos por una máquina en un periodo. **Una sola definición**,
 * compartida, porque había dos implementaciones que daban cifras distintas del
 * mismo mes.
 *
 * 🔴 El combustible llega por dos caminos que NO se pueden sumar a ciegas:
 *
 *  · **Kardex** — ya cubre el despacho de una solicitud, la entrega directa y
 *    el tanqueo `origen=SEDE`, porque los tres generan una SALIDA con la
 *    máquina encima.
 *  · **`combustible_externo`** — el evento. Para `origen=SEDE` es la MISMA
 *    salida que ya está en el kardex: sumar las dos fuentes contaba el galón
 *    dos veces e inflaba el costo por hora. Solo hay que sumar aparte los de
 *    `origen=ESTACION`, que se compraron en la bomba y nunca pasaron por una
 *    bodega.
 *
 * Los rechazados por el analista no cuentan: ese combustible se reversó.
 */
export function galonesDeMaquina(input: {
  /** Movimientos de kardex del periodo, ya filtrados por esta máquina. */
  kardex: { tipo: string; insumoId: string; cantidad: number }[]
  /** Eventos de combustible del periodo, ya filtrados por esta máquina. */
  tanqueos: { origen: string; estado: string; galones: number }[]
  esCombustible: (insumoId: string) => boolean
}): number {
  // Salidas menos devoluciones: si el operario recibió menos, no se le carga.
  const porBodega = input.kardex
    .filter((m) => input.esCombustible(m.insumoId))
    .reduce((t, m) => t + (m.tipo === 'SALIDA' ? m.cantidad : m.tipo === 'ENTRADA' ? -m.cantidad : 0), 0)

  const enEstacion = input.tanqueos
    .filter((t) => t.origen === 'ESTACION' && t.estado !== 'RECHAZADO')
    .reduce((t, c) => t + c.galones, 0)

  return Math.max(0, porBodega + enEstacion)
}
