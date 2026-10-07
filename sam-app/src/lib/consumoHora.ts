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

/* ── TANQUE A TANQUE (7-oct-2026) ─────────────────────────────────────────────
 *
 * Regla de Iván: «se tanquea 15 galones con horómetro 1234 y luego se tanquearon
 * el 1 de oct con horómetro 1433,3; así el 9902 del 1 al 3 deberían aparecer
 * gastados alrededor de 9, que fue lo que se cargó, y se asume que se gastaron
 * con horómetro 1439,1. Todo debe quedar con esta misma lógica».
 *
 * Cada tanqueo LLENA lo que se gastó desde el tanqueo anterior: el del 3-oct
 * (9 gal, 1.439,1) es lo que gastó desde el del 1-oct (1.433,3) → 1,55 gal/h.
 *
 * Y el PRIMER tanqueo del periodo se mide contra el último tanqueo del periodo
 * ANTERIOR (mes o quincena), no se deja «sin medir» (pedido del mismo día, con
 * captura: «compara con el horómetro del tanqueo del mes anterior o la quincena
 * anterior»). Entonces:
 *
 *   gastado del periodo = galones de TODOS sus tanqueos
 *   horas del periodo   = horómetro del último tanqueo − el del último tanqueo
 *                         ANTES del periodo (el punto de partida)
 *   gal/hora            = gastado / horas
 *
 * Así cada tanqueo cuenta una sola vez y los meses (o quincenas) suman. Si la
 * máquina no tiene tanqueo anterior (recién llegada), el punto de partida es su
 * primer tanqueo del periodo y ese no entra.
 *
 * Los horómetros sucios se filtran igual que arriba (magnitud, mediana, que no
 * retroceda). Un tanqueo con el horómetro malo o sin horómetro NO corta la
 * cuenta: sus galones entran en el tramo del siguiente tanqueo bueno. Lo que cae
 * después del último horómetro bueno no se puede medir todavía.
 */

export interface Tanqueo {
  /** Id de la fila de origen (entrega o tanqueo): para colgarle comentarios. */
  id?: string
  maquina: string
  /** Instante ISO. */
  cuando: string
  /** `null` = no se anotó. */
  horometro: number | null
  galones: number
  fuente: 'Entrega' | 'Tanqueo'
  detalle: string
}

export interface TramoTanque extends Tanqueo {
  /** Horas desde el tanqueo bueno anterior (`null` si no hay o si el horómetro no sirve). */
  horasDesdeAnterior: number | null
  /** Horómetro del tanqueo bueno anterior (puede ser del periodo anterior). */
  horometroAnterior: number | null
  /** ¿Sus galones entran en el gastado del periodo? */
  cuenta: boolean
  /** Es el punto de partida, del periodo ANTERIOR: no es una columna del periodo. */
  antes: boolean
  /** Por qué no entra, o por qué su horómetro no se usó. */
  nota: string | null
}

export interface ConsumoTanques {
  maquina: string
  /** Gastado tanque a tanque. `null` si no hay contra qué medir. */
  gastado: number | null
  /** Todo lo que se le cargó en el periodo (lo de la torta). */
  cargado: number
  horas: number | null
  galPorHora: number | null
  /** Punto de partida: el último tanqueo bueno ANTES del periodo (o el primero del periodo si no hay). */
  inicial: Tanqueo | null
  final: Tanqueo | null
  problema: string | null
  /** El punto de partida (si es del periodo anterior) + los tanqueos del periodo. */
  tramos: TramoTanque[]
}

/**
 * @param tanqueos  los tanqueos DEL periodo.
 * @param dias      días del periodo.
 * @param previos   tanqueos de ANTES del periodo (los últimos de cada máquina):
 *                  dan el punto de partida del primer tanqueo del periodo.
 */
export function consumoTanqueATanque(tanqueos: Tanqueo[], dias: number, previos: Tanqueo[] = []): Map<string, ConsumoTanques> {
  const agrupar = (lista: Tanqueo[]) => {
    const m = new Map<string, Tanqueo[]>()
    for (const t of lista) {
      if (!t.maquina || !(t.galones > 0)) continue
      const l = m.get(t.maquina) ?? []
      l.push(t)
      m.set(t.maquina, l)
    }
    return m
  }
  const porMaq = agrupar(tanqueos)
  const antesDe = agrupar(previos)
  const enOrden = (l: Tanqueo[]) => [...l].sort((a, b) => a.cuando.localeCompare(b.cuando) || (a.horometro ?? 0) - (b.horometro ?? 0))

  const out = new Map<string, ConsumoTanques>()
  for (const [maquina, lista] of porMaq) {
    const del = enOrden(lista)
    const inicioPeriodo = del[0].cuando
    // Solo los últimos de antes: bastan para el punto de partida y para que la
    // limpieza de horómetros tenga con qué comparar.
    const prev = enOrden((antesDe.get(maquina) ?? []).filter((t) => t.cuando < inicioPeriodo)).slice(-3)
    const orden = [...prev, ...del]
    const nAntes = prev.length

    const comoLectura = (t: Tanqueo): Lectura => ({ maquina, cuando: t.cuando, horometro: t.horometro ?? 0, fuente: t.fuente, detalle: t.detalle })
    const conH = orden.filter((t) => (t.horometro ?? 0) > 0)
    const diasLectura = Math.max(dias, Math.ceil((Date.parse(del[del.length - 1].cuando) - Date.parse(orden[0].cuando)) / 86400000) + 1)
    const { buenas: b1 } = porMagnitud(conH.map(comoLectura))
    const { buenas: b2 } = cercaDeLaMediana(b1, diasLectura)
    const { buenas } = enOrdenDelTiempo(b2)
    const buena = new Set(buenas.map((l) => `${l.cuando}|${l.horometro}`))
    const esBuena = (t: Tanqueo) => (t.horometro ?? 0) > 0 && buena.has(`${t.cuando}|${t.horometro}`)

    // Punto de partida: el último bueno de ANTES; si no hay, el primero bueno del periodo.
    let iPartida = -1
    for (let i = nAntes - 1; i >= 0; i--) if (esBuena(orden[i])) { iPartida = i; break }
    if (iPartida < 0) iPartida = orden.findIndex((t, i) => i >= nAntes && esBuena(t))
    let iUltimo = -1
    for (let i = orden.length - 1; i >= nAntes; i--) if (esBuena(orden[i])) { iUltimo = i; break }

    const tramos: TramoTanque[] = []
    let hAnterior: number | null = null
    orden.forEach((t, i) => {
      const ok = esBuena(t)
      const antes = i < nAntes
      if (antes && i !== iPartida) { if (ok) hAnterior = t.horometro!; return }
      const cuenta = !antes && iPartida >= 0 && i > iPartida && i <= iUltimo
      let nota: string | null = null
      if (!(t.horometro ?? 0)) nota = 'sin horómetro: sus galones entran en el tramo del siguiente'
      else if (!ok) nota = 'horómetro que no cuadra con los demás: sus galones entran en el tramo del siguiente'
      if (antes) nota = 'punto de partida: último tanqueo del periodo anterior'
      else if (i === iPartida) nota = 'sin tanqueo anterior: es el punto de partida'
      else if (iPartida >= 0 && i < iPartida) nota = 'antes del primer horómetro bueno: no se puede medir'
      else if (iUltimo >= 0 && i > iUltimo) nota = `${nota ? `${nota} · ` : ''}después del último horómetro bueno: se mide con el siguiente tanqueo`
      tramos.push({
        ...t, antes, cuenta, nota,
        horasDesdeAnterior: ok && !antes && hAnterior != null ? r1(t.horometro! - hAnterior) : null,
        horometroAnterior: ok && !antes ? hAnterior : null,
      })
      if (ok) hAnterior = t.horometro!
    })

    const cargado = r1(del.reduce((s, t) => s + t.galones, 0))
    const inicial = iPartida >= 0 ? orden[iPartida] : null
    const final = iUltimo >= 0 ? orden[iUltimo] : null
    let gastado: number | null = null
    let horas: number | null = null
    let problema: string | null = null
    if (!inicial || !final) problema = 'ningún tanqueo con horómetro en el periodo'
    else if (iPartida >= iUltimo) problema = 'un solo tanqueo con horómetro y ninguno antes: se mide con el siguiente'
    else {
      const h = final.horometro! - inicial.horometro!
      const diasTramo = Math.max(1, Math.ceil((Date.parse(final.cuando) - Date.parse(inicial.cuando)) / 86400000) + 1)
      if (h <= 0) problema = 'el horómetro no avanzó entre tanqueos'
      else if (h > 24 * diasTramo) problema = `${r1(h)} h en ${diasTramo} día${diasTramo === 1 ? '' : 's'}: revisar horómetro`
      else {
        horas = r1(h)
        gastado = r1(tramos.filter((x) => x.cuenta).reduce((s, x) => s + x.galones, 0))
      }
    }
    out.set(maquina, {
      maquina, gastado, cargado, horas,
      galPorHora: gastado != null && horas ? r2(gastado / horas) : null,
      inicial, final, problema, tramos,
    })
  }
  return out
}

/** Días calendario de un rango `YYYY-MM-DD`, ambos incluidos. */
export function diasDelRango(desde: string, hasta: string): number {
  const a = new Date(`${desde}T12:00:00Z`).getTime()
  const b = new Date(`${hasta}T12:00:00Z`).getTime()
  if (isNaN(a) || isNaN(b) || b < a) return 1
  return Math.round((b - a) / 86400000) + 1
}
