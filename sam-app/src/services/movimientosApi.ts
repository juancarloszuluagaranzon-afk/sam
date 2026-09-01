import { supabase } from '../lib/supabase'

/**
 * Datos del tablero de movimientos de insumos.
 *
 * 🔴 Una sola llamada que trae el resumen YA AGREGADO (`resumen_movimientos_insumos`).
 * Un mes cabe en ~12 KB. Traer las 400 entregas con sus ítems para sumarlas en el
 * celular serían cientos de KB cada vez que alguien abre el tablero, y los datos
 * móviles son el gasto que la gente sí nota.
 *
 * 🔴 **Todo cuenta ENTREGAS, no filas de kardex.** Una entrega de ganchos +
 * combustible es UN viaje del supervisor, no dos. La diferencia no es cosmética:
 * medido sobre agosto, contar filas infla a Genaro un 51% y a Diego un 23% — o
 * sea que premia a quien reparte materiales sueltos y castiga a quien lleva un
 * solo insumo por viaje. Si de este número sale un pago, eso es plata mal repartida.
 */

export interface Jornada {
  id: string
  horas: number
  horasTotal: number
  primeraHora: number
  ultimaHora: number
}

export interface Despachador {
  id: string
  nombre: string
  entregas: number
  /** Días en que de verdad entregó algo. El divisor honesto, no los días del mes. */
  dias: number
  galones: number
  maquinas: number
  operarios: number
  conFoto: number
  avaladas: number
  conDiferencia: number
  conHorometro: number
  /**
   * Visitas: entregas a la misma máquina dentro de 90 minutos cuentan como una.
   *
   * 🔴 Es el detector de la única trampa que de verdad paga: partir un tanqueo
   * de 40 galones en dos registros duplica las "entregas" sin mover un galón.
   * Contando visitas, partir no sirve de nada. Medido el 31-ago-2026, los tres
   * van en 1,01 entregas por visita — nadie está partiendo. Eso es la línea
   * base: si sube después de anunciar el pago, ahí está la respuesta.
   */
  eventos: number
  primera: string
  ultima: string
}

export interface OperarioMov {
  id: string
  nombre: string
  entregas: number
  galones: number
  maquinas: number
  avaladas: number
  ultima: string
}

export interface InsumoMov {
  nombre: string
  unidad: string
  entregas: number
  cantidad: number
}

export interface MaquinaMov {
  codigo: string
  entregas: number
  galones: number
}

export interface ResumenMovimientos {
  desde: string
  hasta: string
  despachadores: Despachador[]
  jornadas: Jornada[]
  porDia: { dia: string; quien: string; entregas: number }[]
  porHora: { hora: number; entregas: number }[]
  insumos: InsumoMov[]
  operarios: OperarioMov[]
  maquinas: MaquinaMov[]
  solicitudes: {
    total?: number
    pendientes?: number
    entregadas?: number
    rechazadas?: number
    operariosQuePidieron?: number
    minutosRespuesta?: number | null
  }
  operariosActivos: number
  totales: {
    entregas: number
    galones: number
    conFoto: number
    avaladas: number
    conDiferencia: number
    operarios: number
    maquinas: number
    dias: number
  }
}

const VACIO: ResumenMovimientos = {
  desde: '', hasta: '', despachadores: [], jornadas: [], porDia: [], porHora: [],
  insumos: [], operarios: [], maquinas: [], solicitudes: {}, operariosActivos: 0,
  totales: { entregas: 0, galones: 0, conFoto: 0, avaladas: 0, conDiferencia: 0, operarios: 0, maquinas: 0, dias: 0 },
}

export async function loadResumenMovimientos(desde: string, hasta: string): Promise<ResumenMovimientos> {
  const { data, error } = await supabase.rpc('resumen_movimientos_insumos', {
    p_desde: desde, p_hasta: hasta,
  })
  if (error || !data) return { ...VACIO, desde, hasta }
  const d = data as Partial<ResumenMovimientos>
  // Se rellenan los huecos en vez de confiar: si la migración no ha corrido o
  // una sección viene vacía, el tablero muestra "sin datos" y no se cae.
  return {
    ...VACIO,
    ...d,
    despachadores: d.despachadores ?? [],
    jornadas: d.jornadas ?? [],
    porDia: d.porDia ?? [],
    porHora: d.porHora ?? [],
    insumos: d.insumos ?? [],
    operarios: d.operarios ?? [],
    maquinas: d.maquinas ?? [],
    solicitudes: d.solicitudes ?? {},
    totales: { ...VACIO.totales, ...(d.totales ?? {}) },
  }
}

/**
 * Índice de calidad del registro de un despachador: 0 a 100.
 *
 * 🔴 Existe para que el volumen NO se pueda cobrar solo. Pagar por número de
 * entregas premia correr; este índice mide si lo que corrió quedó bien
 * registrado, y son las tres cosas que hacen creíble una entrega:
 *
 *   · **foto** — la evidencia de que ocurrió
 *   · **aval del operario** — el segundo par de ojos, que además es quien recibió
 *   · **sin diferencia** — que lo que el operario recibió fue lo que se anotó
 *
 * Se multiplican, no se promedian: es la lógica del *perfect order rate* de
 * logística. Un promedio deja compensar una foto faltante con un aval sobrando;
 * multiplicando, fallar en cualquiera de las tres baja el resultado, que es
 * justo lo que se quiere de un control.
 */
export function indiceCalidad(d: Despachador): number {
  if (d.entregas === 0) return 0
  const foto = d.conFoto / d.entregas
  const aval = d.avaladas / d.entregas
  const limpias = (d.entregas - d.conDiferencia) / d.entregas
  return Math.round(foto * aval * limpias * 100)
}

/** Entregas por día ACTIVO — el divisor honesto: días en que sí trabajó. */
export function entregasPorDia(d: Despachador): number {
  return d.dias > 0 ? d.entregas / d.dias : 0
}

/**
 * Entregas por hora en campo — el número que cambia la conclusión.
 *
 * 🔴 Medido en agosto: Genaro entregó 263 veces y Castañeda 104, dos veces y
 * media más. Pero por hora van **1,24 contra 1,26**: el mismo ritmo. La
 * diferencia entera es presencia — Genaro trabajó 29 días con jornadas de 7,3 h,
 * Castañeda 20 días con jornadas de 4,3 h.
 *
 * Sin este número el dueño paga PRESENCIA creyendo que paga PRODUCTIVIDAD. Son
 * dos decisiones distintas y solo una fue la que pidió. Puede que después de
 * verlo decida premiar la presencia igual —es su empresa y es una decisión
 * legítima— pero tiene que saber cuál está tomando.
 *
 * ⚠️ Las horas son la VENTANA entre la primera y la última entrega del día, no
 * horas pagadas: nadie marca entrada. Llamarlas "hora-hombre" sería falso.
 */
export function ritmoPorHora(d: Despachador, jornadas: Jornada[]): number | null {
  const j = jornadas.find((x) => x.id === d.id)
  if (!j || j.horasTotal <= 0) return null
  return d.entregas / j.horasTotal
}

/** La hora del día como "06:30", desde el decimal que devuelve la base. */
export function hhmm(decimal: number): string {
  const h = Math.floor(decimal)
  const m = Math.round((decimal - h) * 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}
