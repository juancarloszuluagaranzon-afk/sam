import { supabase } from '../lib/supabase'

/**
 * Datos del tablero de movimientos de insumos.
 *
 * 🔴 Una sola llamada que trae el resumen YA AGREGADO (`resumen_movimientos_insumos`).
 * Traer las entregas con sus ítems para sumarlas en el celular serían cientos de KB
 * cada vez que alguien abre el tablero, y los datos móviles son el gasto que la
 * gente sí nota.
 *
 * 🔴 **Todo cuenta ENTREGAS, no filas de kardex ni de ítems.** Una entrega de
 * ganchos + combustible es UN viaje del supervisor, no dos. Contar filas premia a
 * quien reparte materiales sueltos y castiga a quien lleva un solo insumo por
 * viaje; si de ese número sale un pago, es plata mal repartida. La regla aplica
 * también a los NUMERADORES: el «% con foto» se cuenta sobre entregas, nunca
 * sobre líneas.
 *
 * 🔴 **Ninguna cifra de este archivo se escribe a mano en la pantalla.** Todo lo
 * que el dueño lee sale del periodo que tenga cargado. Un número quemado deja de
 * ser cierto en cuanto alguien cambia las fechas, y nadie vuelve a revisarlo.
 */

export interface Jornada {
  id: string
  /** Promedio de horas por día con ventana medible. */
  horas: number
  /** Suma de las ventanas. Es el DENOMINADOR del ritmo. */
  horasTotal: number
  /**
   * Entregas ocurridas en los días que sí tienen ventana medible.
   *
   * 🔴 Es el numerador que va con `horasTotal`. Un día de una sola entrega no
   * tiene ventana (primera = última) y queda fuera de las horas — así que sus
   * entregas tienen que quedar fuera del conteo también. Dividir TODAS las
   * entregas entre las horas recortadas inflaba el ritmo de quien tiene muchos
   * días de una sola entrega, que es justo el caso del analista.
   */
  entregasEnDias: number
  diasMedibles: number
  primeraHora: number
  ultimaHora: number
}

export interface Despachador {
  id: string
  nombre: string
  /** Su rol real. Separar al analista no puede depender de recordar su cédula. */
  rol: string
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
  /** Horas hasta la aprobación, MEDIANA. El promedio lo arrastran unos pocos rezagados. */
  horasAvalMediana: number | null
  /** Entregas sin aprobar con más de 72 horas encima. */
  avalVencido: number
  /**
   * Visitas: entregas a la misma máquina dentro de 90 minutos cuentan como una.
   *
   * 🔴 Es el detector de la única trampa que de verdad paga: partir un tanqueo
   * en dos registros duplica las "entregas" sin mover un galón. Contando visitas,
   * partir no sirve de nada — y eso vale más que vigilar, porque no queda nada
   * que vigilar.
   */
  eventos: number
  /**
   * Galones que cargó a su carro en el periodo. `0` = no tiene carro (el analista
   * despacha desde la bodega principal), no "no cargó nada".
   */
  cargado: number
  /**
   * Cargues por encima de 500 galones, que un carro no puede recibir. Se excluyen
   * de `cargado` y se cuentan aquí. Existe porque en las tirillas de la estación
   * el punto es DECIMAL y ya hubo quien tecleó los miles: un solo dedazo así
   * destruye el cuadre, y es mejor avisar que mostrar un número roto.
   */
  carguesSospechosos: number
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

export interface EntregaSinFoto {
  id: string
  quien: string
  equipo: string | null
  cuando: string
}

export interface AvalVencido {
  id: string
  quien: string
  operario: string
  equipo: string | null
  cuando: string
  horas: number
}

export interface ResumenMovimientos {
  desde: string
  hasta: string
  /** Cuándo se sacó el corte. Todo entregable de este proyecto lleva fecha y hora. */
  corteEn: string
  despachadores: Despachador[]
  jornadas: Jornada[]
  porDia: { dia: string; quien: string; entregas: number }[]
  porHora: { hora: number; entregas: number }[]
  insumos: InsumoMov[]
  operarios: OperarioMov[]
  maquinas: MaquinaMov[]
  sinFoto: EntregaSinFoto[]
  avalVencido: AvalVencido[]
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
    horasAvalMediana: number | null
  }
  /** true = lo que se ve salió del espejo local porque no hubo red. */
  desdeCache?: boolean
  guardadoEn?: string
}

const VACIO: ResumenMovimientos = {
  desde: '', hasta: '', corteEn: '', despachadores: [], jornadas: [], porDia: [], porHora: [],
  insumos: [], operarios: [], maquinas: [], sinFoto: [], avalVencido: [],
  solicitudes: {}, operariosActivos: 0,
  totales: {
    entregas: 0, galones: 0, conFoto: 0, avaladas: 0, conDiferencia: 0,
    operarios: 0, maquinas: 0, dias: 0, horasAvalMediana: null,
  },
}

/**
 * Espejo local del último resumen que sí cargó.
 *
 * 🔴 Va en `localStorage` y no en Dexie a propósito: agregar una tabla obliga a
 * subir la versión de la base local, y en este proyecto esas migraciones han sido
 * destructivas. Es la misma decisión que se tomó con la referencia del horómetro.
 *
 * Sin esto, abrir el tablero sin señal deja la pantalla en blanco — en una app
 * offline-first que ya tuvo un incidente de pantalla en blanco en producción. Un
 * dato de ayer, rotulado como de ayer, sirve; una pantalla vacía no.
 */
const CACHE_KEY = 'sam:mov-resumen'

function leerCache(clave: string): ResumenMovimientos | null {
  try {
    const crudo = window.localStorage.getItem(`${CACHE_KEY}:${clave}`)
    if (!crudo) return null
    const { json, guardadoEn } = JSON.parse(crudo)
    // 🔴 Se rellena contra VACIO, no se devuelve crudo.
    //
    // Un espejo guardado con una version ANTERIOR del tablero no tiene las
    // secciones que se agregaron despues, y leerlas revienta la pantalla. Paso
    // de verdad: el espejo del 31-ago no tenia `sinFoto` ni `avalVencido`, se
    // agregaron al dia siguiente, y al abrir el tablero salio TODO EN BLANCO.
    //
    // Un cache es de una version vieja por definicion: rellenar es obligatorio,
    // no defensivo.
    return {
      ...VACIO,
      ...json,
      despachadores: json?.despachadores ?? [],
      jornadas: json?.jornadas ?? [],
      porDia: json?.porDia ?? [],
      porHora: json?.porHora ?? [],
      insumos: json?.insumos ?? [],
      operarios: json?.operarios ?? [],
      maquinas: json?.maquinas ?? [],
      sinFoto: json?.sinFoto ?? [],
      avalVencido: json?.avalVencido ?? [],
      solicitudes: json?.solicitudes ?? {},
      totales: { ...VACIO.totales, ...(json?.totales ?? {}) },
      desdeCache: true,
      guardadoEn,
    }
  } catch { return null }
}

function guardarCache(clave: string, json: ResumenMovimientos) {
  try {
    window.localStorage.setItem(
      `${CACHE_KEY}:${clave}`,
      JSON.stringify({ json, guardadoEn: new Date().toISOString() }),
    )
  } catch { /* sin espacio o sin localStorage: el tablero funciona igual */ }
}

export async function loadResumenMovimientos(desde: string, hasta: string): Promise<ResumenMovimientos> {
  const clave = `${desde}:${hasta}`
  try {
    const { data, error } = await supabase.rpc('resumen_movimientos_insumos', {
      p_desde: desde, p_hasta: hasta,
    })
    if (error || !data) throw error ?? new Error('sin datos')
    const d = data as Partial<ResumenMovimientos>
    // Se rellenan los huecos en vez de confiar: si una sección viene vacía o la
    // migración no ha corrido, el tablero muestra "sin datos" y no se cae.
    const lleno: ResumenMovimientos = {
      ...VACIO,
      ...d,
      desde, hasta,
      despachadores: d.despachadores ?? [],
      jornadas: d.jornadas ?? [],
      porDia: d.porDia ?? [],
      porHora: d.porHora ?? [],
      insumos: d.insumos ?? [],
      operarios: d.operarios ?? [],
      maquinas: d.maquinas ?? [],
      sinFoto: d.sinFoto ?? [],
      avalVencido: d.avalVencido ?? [],
      solicitudes: d.solicitudes ?? {},
      totales: { ...VACIO.totales, ...(d.totales ?? {}) },
    }
    guardarCache(clave, lleno)
    return lleno
  } catch (e) {
    const guardado = leerCache(clave)
    if (guardado) return guardado
    throw e
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
 *   · **aprobación del operario** — el segundo par de ojos, que además es quien recibió
 *   · **sin diferencia** — que lo que recibió fue lo que se anotó
 *
 * Se multiplican, no se promedian: es la lógica del *perfect order rate* de
 * logística. Un promedio deja compensar una foto faltante con una aprobación sobrando;
 * multiplicando, fallar en cualquiera de las tres baja el resultado, que es justo
 * lo que se quiere de un control.
 */
export function indiceCalidad(d: Despachador): number {
  if (d.entregas === 0) return 0
  const foto = d.conFoto / d.entregas
  const aprobado = d.avaladas / d.entregas
  const limpias = (d.entregas - d.conDiferencia) / d.entregas
  return Math.round(foto * aprobado * limpias * 100)
}

/** Entregas por día ACTIVO — el divisor honesto: días en que sí trabajó. */
export function entregasPorDia(d: Despachador): number {
  return d.dias > 0 ? d.entregas / d.dias : 0
}

/**
 * Entregas por hora en ruta — el número que puede cambiar la conclusión.
 *
 * Dos personas con volúmenes muy distintos pueden ir al mismo ritmo, y entonces
 * la diferencia era **presencia**, no productividad. Son dos cosas distintas y
 * quien paga tiene que saber cuál está premiando.
 *
 * ⚠️ Numerador y denominador salen del MISMO conjunto de días: solo los que
 * tienen ventana medible. Mezclarlos infla el ritmo.
 *
 * ⚠️ Y las horas son la ventana entre la primera y la última entrega del día, no
 * horas pagadas: aquí nadie marca entrada. Sirve para entender que los totales
 * engañan; **no para calificar a nadie** — dos entregas separadas ocho horas se
 * ven como «lento» y dos seguidas como «rápido», cuando en la mitad pudo haber un
 * viaje largo o una espera en la bomba.
 */
export function ritmoPorHora(d: Despachador, jornadas: Jornada[]): number | null {
  const j = jornadas.find((x) => x.id === d.id)
  if (!j || j.horasTotal <= 0 || j.entregasEnDias <= 0) return null
  return j.entregasEnDias / j.horasTotal
}

/**
 * Cuadre del carro: lo que cargó menos lo que entregó.
 *
 * 🔴 Es la pregunta que un pago por productividad obliga a hacer. Un negativo NO
 * significa que falten galones: puede ser saldo del mes anterior o cargues que no
 * se registraron. Significa que **las cuentas del mes no cierran solas**, y eso
 * hay que resolverlo antes de amarrarle plata.
 *
 * Devuelve `null` para quien no tiene carro: el analista despacha desde la bodega
 * principal y mostrarle un cuadre negativo sería acusarlo de un hueco que no existe.
 */
export function cuadreCarro(d: Despachador): number | null {
  if (d.cargado <= 0) return null
  return d.cargado - d.galones
}

/**
 * ¿Este despachador reparte en ruta, o despacha de mostrador?
 *
 * 🔴 El analista de insumos no hace ruta: despacha desde la bodega principal
 * cuando alguien llega por material. Ponerlo en la misma comparación que los
 * supervisores lo deja siempre de último por algo que no es su trabajo. Se decide
 * por ROL, no por nombre ni por cédula — la gente cambia de cargo.
 */
export function esDeRuta(d: Despachador): boolean {
  return d.rol === 'supervisor_insumos'
}

/** La hora del día como "06:30", desde el decimal que devuelve la base. */
export function hhmm(decimal: number): string {
  const h = Math.floor(decimal)
  const m = Math.round((decimal - h) * 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/* ─────────── Quién solicita y qué solicita (panel aparte) ─────────── */

export interface SolicitanteMov {
  id: string
  nombre: string
  solicitudes: number
  entregadas: number
  pendientes: number
  rechazadas: number
  ultima: string
}

export interface PedidoDetalle {
  id: string
  operario: string
  creada: string
  entregada: string | null
  requeridoPara: string | null
  estado: string
  nota: string | null
  items: string | null
  /** Por que se rechazo. El dato mas informativo del panel. */
  motivo: string | null
}

/**
 * Lo que se pide, con su propio tipo.
 *
 * 🔴 El campo se llama `veces`, no `entregas`. Aquí estaba tipado como
 * `InsumoMov` — que sí tiene `entregas` — y por eso TypeScript no dijo nada: el
 * tipo AFIRMABA un campo que la consulta nunca manda. En pantalla eso fue un
 * `undefined.toFixed()` y la pestaña completa dejó de dibujarse.
 *
 * La leccion: un tipo escrito a mano sobre lo que devuelve una consulta es una
 * PROMESA, no una comprobación. Si la promesa es falsa, el compilador ayuda a
 * romperlo mas rapido.
 */
export interface InsumoPedido {
  nombre: string
  unidad: string
  /** Cuántas solicitudes lo incluyeron. */
  veces: number
  cantidad: number
}

export interface ResumenSolicitudes {
  porOperario: SolicitanteMov[]
  porInsumo: InsumoPedido[]
  detalle: PedidoDetalle[]
}

/**
 * El panel de "quién solicita".
 *
 * 🔴 Va en su propia consulta y no dentro del resumen general: es el panel que
 * menos se abre y no tiene por qué viajar en cada carga del tablero.
 *
 * ⚠️ **Este panel tiene pocos datos y aun así se muestra.** La primera versión lo
 * reemplazó por una explicación de por qué estaría vacío, y esa fue una decisión
 * que no me correspondía: el dueño lo pidió, y un indicador con pocos datos sigue
 * siendo un indicador — la adopción del flujo es justo el número que dice si vale
 * la pena empujarlo. Lo que sí se conserva es el **tamaño de la muestra al lado
 * del dato**: un ranking de tres filas se lee distinto cuando se ve que son
 * siete solicitudes. Esconderlo era paternalista; mostrarlo pelado sería
 * engañoso.
 */
export async function loadSolicitudesOperarios(desde: string, hasta: string): Promise<ResumenSolicitudes> {
  const vacio: ResumenSolicitudes = { porOperario: [], porInsumo: [], detalle: [] }
  try {
    const { data, error } = await supabase.rpc('resumen_solicitudes_operarios', {
      p_desde: desde, p_hasta: hasta,
    })
    if (error || !data) return vacio
    const d = data as Partial<ResumenSolicitudes>
    return {
      porOperario: d.porOperario ?? [],
      porInsumo: d.porInsumo ?? [],
      detalle: d.detalle ?? [],
    }
  } catch { return vacio }
}
