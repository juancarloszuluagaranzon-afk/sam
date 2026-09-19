/**
 * Combustible por hora de máquina en un día o un rango.
 *
 * Pedido del cliente (18-sep-2026): una barra por máquina con el combustible del
 * periodo y una etiqueta con el consumo por hora, «importante siempre tomar el
 * horómetro inicial del día o del periodo trabajado, así como el final».
 *
 *   horas     = horómetro FINAL del periodo − horómetro INICIAL del periodo
 *   gal/hora  = galones del periodo / horas
 *
 * 🔴 Las lecturas salen de TODAS las fuentes, no solo del cierre de labor. El
 * mismo día que se pidió esto, la PUMA 2302 marcaba 16 días sin moverse: su
 * operario cierra las labores con el horómetro en 0 (32 de 33 en el mes), pero
 * el horómetro SÍ quedó anotado en cada entrega de combustible. Con solo labores,
 * la máquina que más trabajó habría salido «sin horas».
 *
 * 🔴 Los horómetros vienen sucios, y aquí se filtran igual que en el resto del
 * app (`informeSemanal`, `equipo_horometro_v`):
 * - el 0 es la casilla sin llenar, no una lectura;
 * - un cierre de labor con el final MENOR que el inicial, o con más de 24 h, no
 *   se usa (ninguna de sus dos lecturas: no se sabe cuál está mal);
 * - gana la MAGNITUD dominante (cuántos dígitos): `5407` contra `54030`, o el «2»
 *   que anotaron en la CASE 951 contra sus 5.719 horas;
 * - y ninguna máquina trabaja más de 24 h por día del periodo: si la resta da
 *   más, el número no se muestra, se muestra el problema.
 * Lo descartado NO se esconde: viaja con su motivo para que alguien lo corrija.
 *
 * ⚠️ Para UN día el gal/hora es orientativo: el tanqueo del lunes alimenta el
 * martes. En una quincena se promedia solo. La pantalla lo dice.
 *
 * Vive aquí, sin tocar Supabase, para probarlo contra datos reales en Node.
 */

export type FuenteLectura = 'Labor (inicio)' | 'Labor (fin)' | 'Entrega' | 'Tanqueo'

export interface Lectura {
  maquina: string
  /** Instante ISO de la lectura. */
  cuando: string
  horometro: number
  fuente: FuenteLectura
  /** Quién o qué (operario, labor y suerte): para poder ir a corregirla. */
  detalle: string
}

export interface LecturaDescartada extends Lectura {
  motivo: string
}

export interface FilaConsumoHora {
  maquina: string
  nombre: string
  galones: number
  inicial: Lectura | null
  final: Lectura | null
  /** Final − inicial. `null` si no hay dos lecturas buenas distintas. */
  horas: number | null
  galPorHora: number | null
  /** Por qué no hay gal/hora, en palabras de la pantalla. `null` = sí hay. */
  problema: string | null
  usadas: number
  descartadas: LecturaDescartada[]
  /**
   * Cruce contra el horómetro anotado AL TANQUEAR (tanqueos y entregas): las
   * mismas cuentas, pero solo con esas lecturas. Pedido del cliente: «revisa
   * también contra horómetros de tanqueo». Si las dos cifras se separan mucho,
   * una de las dos fuentes está anotando mal.
   */
  cruceTanqueo: {
    lecturas: Lectura[]; horas: number | null; galPorHora: number | null
    /**
     * Horas que dan TODAS las lecturas entre el primer y el último tanqueo: la
     * comparación justa, en las mismas fechas. Comparar el periodo entero contra
     * la ventana de tanqueos marcaba máquinas sanas (la CASE 1101 trabajó antes
     * del primer tanqueo y después del último).
     */
    horasMismasFechas: number | null
    /** Dentro de las mismas fechas se separan más de 4 h y más del 25%. */
    discrepa: boolean
  }
}

const r1 = (n: number) => Math.round(n * 10) / 10
const r2 = (n: number) => Math.round(n * 100) / 100

/**
 * Lecturas de los cierres de labor. Cada labor da dos (inicio y fin); si el par
 * no tiene sentido se descartan las dos, con el motivo.
 */
export function lecturasDeLabores(
  labores: {
    equipmentCode: string; horometroInicial: number | null; horometroFinal: number | null
    startedAt: string | null; finishedAt: string | null; operatorName: string; labor: string; suerteCode: string
  }[],
): { lecturas: Lectura[]; descartadas: LecturaDescartada[] } {
  const lecturas: Lectura[] = []
  const descartadas: LecturaDescartada[] = []
  for (const a of labores) {
    if (!a.equipmentCode) continue
    const detalle = `${a.operatorName} · ${a.labor} ${a.suerteCode}`
    const hi = Number(a.horometroInicial) || 0
    const hf = Number(a.horometroFinal) || 0
    const ini: Lectura = { maquina: a.equipmentCode, cuando: a.startedAt ?? a.finishedAt ?? '', horometro: hi, fuente: 'Labor (inicio)', detalle }
    const fin: Lectura = { maquina: a.equipmentCode, cuando: a.finishedAt ?? a.startedAt ?? '', horometro: hf, fuente: 'Labor (fin)', detalle }
    if (!ini.cuando) continue
    if (hi > 0 && hf > 0) {
      if (hf < hi) { descartadas.push({ ...ini, motivo: 'final menor que el inicial' }, { ...fin, motivo: 'final menor que el inicial' }); continue }
      if (hf - hi > 24) { descartadas.push({ ...ini, motivo: `${r1(hf - hi)} h en una labor` }, { ...fin, motivo: `${r1(hf - hi)} h en una labor` }); continue }
    }
    if (hi > 0) lecturas.push(ini)
    if (hf > 0) lecturas.push(fin)
  }
  return { lecturas, descartadas }
}

/** Separa las lecturas de UNA máquina en usables y descartadas por magnitud. */
function porMagnitud(lecturas: Lectura[]): { buenas: Lectura[]; malas: LecturaDescartada[] } {
  if (lecturas.length === 0) return { buenas: [], malas: [] }
  const mag = (h: number) => Math.floor(Math.log10(h))
  const cuenta = new Map<number, { n: number; ultima: string }>()
  for (const l of lecturas) {
    const m = mag(l.horometro)
    const c = cuenta.get(m) ?? { n: 0, ultima: '' }
    c.n += 1
    if (l.cuando > c.ultima) c.ultima = l.cuando
    cuenta.set(m, c)
  }
  // Gana la más numerosa; empate → la que tiene la lectura más reciente.
  let dominante = 0
  let mejor: { n: number; ultima: string } | null = null
  cuenta.forEach((c, m) => {
    if (!mejor || c.n > mejor.n || (c.n === mejor.n && c.ultima > mejor.ultima)) { mejor = c; dominante = m }
  })
  const buenas: Lectura[] = []
  const malas: LecturaDescartada[] = []
  for (const l of lecturas) {
    if (mag(l.horometro) === dominante) buenas.push(l)
    else malas.push({ ...l, motivo: 'no cuadra con el resto (otra cantidad de dígitos)' })
  }
  return { buenas, malas }
}

/**
 * Quita la lectura que, con los mismos dígitos, está imposiblemente lejos del
 * resto: la CASE 901 iba en 10.6xx y una labor anotó 12.946 de inicio (el
 * horómetro de otra máquina, seguramente). La magnitud no la caza, y la resta
 * daba 2.434 h en 18 días. Ninguna lectura buena del periodo puede estar a más
 * de 24 h por día de la mediana de las demás.
 */
function cercaDeLaMediana(lecturas: Lectura[], dias: number): { buenas: Lectura[]; lejanas: LecturaDescartada[] } {
  if (lecturas.length < 3) return { buenas: lecturas, lejanas: [] }
  const orden = lecturas.map((l) => l.horometro).sort((a, b) => a - b)
  const mitad = Math.floor(orden.length / 2)
  const mediana = orden.length % 2 ? orden[mitad] : (orden[mitad - 1] + orden[mitad]) / 2
  const tope = 24 * Math.max(1, dias)
  const buenas: Lectura[] = []
  const lejanas: LecturaDescartada[] = []
  for (const l of lecturas) {
    if (Math.abs(l.horometro - mediana) > tope) lejanas.push({ ...l, motivo: `a ${r1(Math.abs(l.horometro - mediana))} h de las demás lecturas del periodo` })
    else buenas.push(l)
  }
  return { buenas, lejanas }
}

/**
 * Un horómetro no retrocede. Se ordenan las lecturas por FECHA y se queda la
 * cadena más larga que no baja; lo que rompe la cadena se descarta.
 *
 * Caso real (1–18 sep 2026): la CASE 1303 tomaba de inicial 3.650,4, anotado al
 * cerrar un REENCALLE el 14-sep, cuando las entregas decían 3.780,8 el 1-sep y
 * ~3.955 ese mismo día. Daba 342 h (19 h diarias) contra 206 h al tanquear.
 *
 * ⚠️ Margen de 12 h: la hora de una labor a veces se corrige a mano (queda a las
 * 11:00/12:00 del día elegido) y dos lecturas del mismo día pueden quedar al
 * revés en el reloj. Eso no es un horómetro que retrocede.
 */
function enOrdenDelTiempo(lecturas: Lectura[]): { buenas: Lectura[]; retroceden: LecturaDescartada[] } {
  const TOLERANCIA = 12
  if (lecturas.length < 3) return { buenas: lecturas, retroceden: [] }
  const l = [...lecturas].sort((a, b) => a.cuando.localeCompare(b.cuando) || a.horometro - b.horometro)
  const largo = l.map(() => 1)
  const previo = l.map(() => -1)
  for (let i = 1; i < l.length; i++) {
    for (let j = 0; j < i; j++) {
      if (l[i].horometro >= l[j].horometro - TOLERANCIA && largo[j] + 1 > largo[i]) {
        largo[i] = largo[j] + 1
        previo[i] = j
      }
    }
  }
  let fin = 0
  for (let i = 1; i < l.length; i++) if (largo[i] >= largo[fin]) fin = i
  const cadena = new Set<number>()
  for (let i = fin; i >= 0; i = previo[i]) cadena.add(i)
  const buenas: Lectura[] = []
  const retroceden: LecturaDescartada[] = []
  l.forEach((x, i) => {
    if (cadena.has(i)) buenas.push(x)
    else retroceden.push({ ...x, motivo: 'el horómetro no retrocede: no cuadra con las lecturas de antes y después' })
  })
  return { buenas, retroceden }
}

/**
 * Una fila por máquina que recibió combustible en el periodo.
 *
 * @param galones   galones por máquina (el MISMO cálculo de la torta).
 * @param lecturas  todas las lecturas del periodo, de todas las fuentes.
 * @param dias      días del periodo (para el tope de 24 h por día).
 */
export function consumoPorHora(input: {
  galones: Map<string, number>
  lecturas: Lectura[]
  descartadasPrevias?: LecturaDescartada[]
  dias: number
  nombreMaq: (codigo: string) => string
}): FilaConsumoHora[] {
  const { galones, lecturas, descartadasPrevias = [], dias, nombreMaq } = input
  const filas: FilaConsumoHora[] = []

  for (const [maquina, gal] of galones) {
    if (!(gal > 0)) continue
    const propias = lecturas.filter((l) => l.maquina === maquina && l.horometro > 0)
    const { buenas: mismaEscala, malas } = porMagnitud(propias)
    const { buenas: cercanas, lejanas } = cercaDeLaMediana(mismaEscala, dias)
    const { buenas, retroceden } = enOrdenDelTiempo(cercanas)
    const descartadas = [...descartadasPrevias.filter((d) => d.maquina === maquina), ...malas, ...lejanas, ...retroceden]

    let inicial: Lectura | null = null
    let final: Lectura | null = null
    for (const l of buenas) {
      if (!inicial || l.horometro < inicial.horometro) inicial = l
      if (!final || l.horometro > final.horometro) final = l
    }

    let horas: number | null = null
    let problema: string | null = null
    if (!inicial || !final) {
      problema = 'sin horómetro en el periodo'
    } else if (buenas.length < 2 || final.horometro === inicial.horometro) {
      problema = buenas.length < 2 ? 'una sola lectura: no hay contra qué restar' : 'el horómetro no avanzó'
    } else {
      const h = final.horometro - inicial.horometro
      if (h > 24 * Math.max(1, dias)) problema = `${r1(h)} h en ${dias} día${dias === 1 ? '' : 's'}: revisar horómetro`
      else horas = r1(h)
    }

    const alTanquear = buenas
      .filter((l) => l.fuente === 'Tanqueo' || l.fuente === 'Entrega')
      .sort((a, b) => a.cuando.localeCompare(b.cuando))
    let horasTq: number | null = null
    let horasMismasFechas: number | null = null
    if (alTanquear.length >= 2) {
      const hs = alTanquear.map((l) => l.horometro)
      const h = Math.max(...hs) - Math.min(...hs)
      if (h > 0) horasTq = r1(h)
      const desdeTq = alTanquear[0].cuando
      const hastaTq = alTanquear[alTanquear.length - 1].cuando
      const enVentana = buenas.filter((l) => l.cuando >= desdeTq && l.cuando <= hastaTq).map((l) => l.horometro)
      if (enVentana.length >= 2) horasMismasFechas = r1(Math.max(...enVentana) - Math.min(...enVentana))
    }

    filas.push({
      maquina,
      nombre: nombreMaq(maquina),
      galones: r1(gal),
      inicial,
      final,
      horas,
      galPorHora: horas != null && horas > 0 ? r2(gal / horas) : null,
      problema,
      usadas: buenas.length,
      descartadas,
      cruceTanqueo: {
        lecturas: alTanquear,
        horas: horasTq,
        galPorHora: horasTq != null ? r2(gal / horasTq) : null,
        horasMismasFechas,
        discrepa: horasMismasFechas != null && horasTq != null
          && Math.abs(horasMismasFechas - horasTq) > Math.max(4, horasTq * 0.25),
      },
    })
  }

  return filas.sort((a, b) => b.galones - a.galones)
}

/** Días calendario de un rango `YYYY-MM-DD`, ambos incluidos. */
export function diasDelRango(desde: string, hasta: string): number {
  const a = new Date(`${desde}T12:00:00Z`).getTime()
  const b = new Date(`${hasta}T12:00:00Z`).getTime()
  if (isNaN(a) || isNaN(b) || b < a) return 1
  return Math.round((b - a) / 86400000) + 1
}
