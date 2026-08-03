import type { SolicitudInsumo, CombustibleExterno } from '../domain/sam'

/**
 * Informe semanal por máquina: horas trabajadas y rendimiento del combustible.
 *
 * Reemplaza la hoja de Excel que se llenaba a mano —una fila por entrega, con
 * el horómetro anotado— y le agrega lo que ahí no se podía calcular: las horas
 * entre un evento y el siguiente, las de toda la semana, y los galones por
 * hora.
 *
 * ⚠️ EL PROBLEMA DE FONDO: los horómetros vienen sucios.
 *
 * Medido en producción (3-ago-2026), la VALTRA 9901 tiene en la misma semana
 * `10288.2`, `294.9` y `10298.6`. Ese 294.9 es un dedazo o el horómetro de otra
 * máquina. Restar sin filtrar daría −9.993 horas y después +10.003, y con eso
 * el rendimiento sale en cualquier cosa.
 *
 * Por eso aquí NO se resta a ciegas: se descartan las lecturas cuyo orden de
 * magnitud no coincide con el dominante de esa máquina, igual que hace la vista
 * `equipo_horometro_v` del taller. La lectura descartada NO se borra — se
 * devuelve marcada, para que alguien la corrija en vez de que desaparezca.
 */

export interface EventoMaquina {
  id: string
  /** De dónde salió: una entrega de material o un tanqueo. */
  tipo: 'ENTREGA' | 'TANQUEO'
  cuando: string
  horometro: number
  /** Galones entregados en este evento (0 si fue solo material). */
  galones: number
  /** Cantidad por insumo, para armar las columnas del Excel. */
  insumos: { nombre: string; unidad: string; cantidad: number }[]
  operario: string
  responsable: string
  /** ¿Se engrasó en esta entrega? `undefined` = no se preguntó. */
  engraso?: boolean
  /** Horas desde el evento anterior. `null` en el primero de la semana. */
  horasDesdeAnterior: number | null
  /** La lectura no cuadra con las demás de esta máquina: no se usó. */
  horometroSospechoso: boolean
}

export interface FilaSemanal {
  equipo: string
  semana: number
  operario: string
  responsable: string
  horometroInicial: number | null
  horometroFinal: number | null
  /** Último válido − primero válido. `null` si no hay dos lecturas buenas. */
  horas: number | null
  galones: number
  /** Galones por hora. El número que de verdad se compara entre semanas. */
  galonesPorHora: number | null
  insumos: Map<string, { unidad: string; cantidad: number }>
  eventos: EventoMaquina[]
  /**
   * Cuántas veces se engrasó en la semana, sobre cuántas entregas lo
   * preguntaron. "2 de 3" dice más que un sí/no: en una semana hay varias
   * entregas y el engrase no se hace en todas.
   */
  engrases: { si: number; preguntadas: number }
  /** Lecturas que se descartaron por no cuadrar. */
  sospechosos: number
}

/** Semana ISO del año: es la que usa la hoja que ya llevan. */
export function semanaDe(iso: string): number {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return 0
  const jueves = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  // El jueves de esa semana define a qué año pertenece (regla ISO-8601).
  jueves.setUTCDate(jueves.getUTCDate() + 4 - (jueves.getUTCDay() || 7))
  const enero1 = new Date(Date.UTC(jueves.getUTCFullYear(), 0, 1))
  return Math.ceil(((jueves.getTime() - enero1.getTime()) / 86400000 + 1) / 7)
}

/**
 * Marca las lecturas que no cuadran con el resto.
 *
 * El criterio es el orden de magnitud, no la distancia: los errores reales son
 * un dígito de más o de menos (`5407` escrito `54030`, `10288` escrito `294`),
 * no un 5% de diferencia. Gana el grupo con más lecturas.
 */
function marcarSospechosos(horometros: number[]): boolean[] {
  const validos = horometros.filter((h) => h > 0)
  if (validos.length < 2) return horometros.map((h) => h <= 0)

  const magnitud = (h: number) => Math.floor(Math.log10(h))
  const cuenta = new Map<number, number>()
  validos.forEach((h) => cuenta.set(magnitud(h), (cuenta.get(magnitud(h)) ?? 0) + 1))

  let dominante = 0
  let mejor = -1
  cuenta.forEach((n, mag) => { if (n > mejor) { mejor = n; dominante = mag } })

  return horometros.map((h) => h <= 0 || magnitud(h) !== dominante)
}

/**
 * Arma el informe: una fila por máquina y semana, con sus eventos adentro.
 *
 * Los eventos se ordenan por HORÓMETRO, no por fecha: dos entregas del mismo
 * día pueden quedar registradas al revés, y lo que manda para calcular horas es
 * cuánto había andado la máquina.
 */
export function armarInformeSemanal(input: {
  entregas: SolicitudInsumo[]
  tanqueos: CombustibleExterno[]
  nombreUsuario: (id?: string) => string
}): FilaSemanal[] {
  const { entregas, tanqueos, nombreUsuario } = input
  const porClave = new Map<string, EventoMaquina[]>()

  const agregar = (equipo: string, cuando: string, ev: Omit<EventoMaquina, 'horasDesdeAnterior' | 'horometroSospechoso'>) => {
    const clave = `${equipo}|${semanaDe(cuando)}`
    const lista = porClave.get(clave) ?? []
    lista.push({ ...ev, horasDesdeAnterior: null, horometroSospechoso: false })
    porClave.set(clave, lista)
  }

  for (const e of entregas) {
    if (!e.equipoCodigo || e.horometro == null) continue
    const cuando = e.entregadoEn ?? e.createdAt
    agregar(e.equipoCodigo, cuando, {
      id: e.id,
      tipo: 'ENTREGA',
      cuando,
      horometro: Number(e.horometro),
      galones: e.items
        .filter((it) => /combustible/i.test(it.insumoNombre ?? ''))
        .reduce((t, it) => t + (it.cantidadDespachada ?? it.cantidad), 0),
      insumos: e.items.map((it) => ({
        nombre: it.insumoNombre,
        unidad: it.unidad,
        cantidad: it.cantidadDespachada ?? it.cantidad,
      })),
      operario: e.operarioNombre ?? nombreUsuario(e.operarioId),
      responsable: nombreUsuario(e.despachadoPor),
      engraso: e.engraso,
    })
  }

  for (const t of tanqueos) {
    // Solo los que van a una máquina traen horómetro; el resto no sirve aquí.
    if (!t.equipoCodigo || t.horometro == null || t.estado === 'RECHAZADO') continue
    const cuando = t.createdAt || `${t.fecha}T12:00:00`
    agregar(t.equipoCodigo, cuando, {
      id: t.id,
      tipo: 'TANQUEO',
      cuando,
      horometro: Number(t.horometro),
      galones: t.galones,
      insumos: [{ nombre: 'COMBUSTIBLE', unidad: 'galón', cantidad: t.galones }],
      operario: t.operarioNombre ?? '',
      responsable: t.registradoNombre ?? nombreUsuario(t.registradoPor),
    })
  }

  const filas: FilaSemanal[] = []

  for (const [clave, eventos] of porClave) {
    const [equipo, semanaTxt] = clave.split('|')
    eventos.sort((a, b) => a.horometro - b.horometro)

    const sospechosos = marcarSospechosos(eventos.map((e) => e.horometro))
    eventos.forEach((e, i) => { e.horometroSospechoso = sospechosos[i] })

    const buenos = eventos.filter((e) => !e.horometroSospechoso)
    // Las horas entre eventos solo se calculan entre lecturas confiables: si en
    // medio hubo un dedazo, se salta y el tramo abarca el hueco.
    let anterior: number | null = null
    for (const e of eventos) {
      if (e.horometroSospechoso) { e.horasDesdeAnterior = null; continue }
      e.horasDesdeAnterior = anterior == null ? null : Math.round((e.horometro - anterior) * 10) / 10
      anterior = e.horometro
    }

    const inicial = buenos.length ? buenos[0].horometro : null
    const final = buenos.length ? buenos[buenos.length - 1].horometro : null
    const horas = inicial != null && final != null && buenos.length >= 2
      ? Math.round((final - inicial) * 10) / 10
      : null
    const galones = Math.round(eventos.reduce((t, e) => t + e.galones, 0) * 100) / 100

    const insumos = new Map<string, { unidad: string; cantidad: number }>()
    for (const e of eventos) {
      for (const it of e.insumos) {
        const prev = insumos.get(it.nombre)
        insumos.set(it.nombre, {
          unidad: it.unidad,
          cantidad: Math.round(((prev?.cantidad ?? 0) + it.cantidad) * 100) / 100,
        })
      }
    }

    const preguntadas = eventos.filter((e) => e.engraso != null).length

    filas.push({
      equipo,
      semana: Number(semanaTxt),
      engrases: { si: eventos.filter((e) => e.engraso === true).length, preguntadas },
      // El de la mayoría de los eventos: si cambió de operario a mitad de
      // semana, en el detalle se ve evento por evento.
      operario: eventos.find((e) => e.operario)?.operario ?? '',
      responsable: eventos.find((e) => e.responsable)?.responsable ?? '',
      horometroInicial: inicial,
      horometroFinal: final,
      horas,
      galones,
      galonesPorHora: horas != null && horas > 0 && galones > 0
        ? Math.round((galones / horas) * 100) / 100
        : null,
      insumos,
      eventos,
      sospechosos: sospechosos.filter(Boolean).length,
    })
  }

  return filas.sort((a, b) => b.semana - a.semana || a.equipo.localeCompare(b.equipo, 'es', { numeric: true }))
}

/**
 * Rendimiento fuera de lo normal para esa máquina.
 *
 * Un tractor que siempre gasta 3 gal/h y esta semana gasta 5 está diciendo
 * algo: una fuga, un filtro tapado, o combustible que no llegó donde dice. Se
 * compara contra su PROPIO promedio, no contra el de la flota — un tractor
 * grande y uno chico no son comparables.
 */
export function desviacionRendimiento(fila: FilaSemanal, historico: FilaSemanal[]): number | null {
  if (fila.galonesPorHora == null) return null
  const otras = historico
    .filter((f) => f.equipo === fila.equipo && f.semana !== fila.semana && f.galonesPorHora != null)
    .map((f) => f.galonesPorHora!)
  if (otras.length < 2) return null
  const promedio = otras.reduce((a, b) => a + b, 0) / otras.length
  if (promedio <= 0) return null
  return Math.round(((fila.galonesPorHora - promedio) / promedio) * 100)
}
