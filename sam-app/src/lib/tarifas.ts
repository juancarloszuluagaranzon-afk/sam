import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { executionDateKey, loadCatalogo } from '../services/samApi'
import type { Assignment } from '../domain/sam'
import { esPorHoras } from './texto'
import { laborFacturable, modalidadEfectiva, pasesAdicionales } from './modalidad'

/**
 * VALOR A FACTURAR de cada línea (2-oct-2026, migración 20261002190000):
 *   valor = cantidad × tarifa(razón social, cliente, labor, modalidad, fecha)
 *
 * Qué tarifa le toca a una labor (la regla, de la tabla de Iván):
 *   · Proveedor (asignaciones.cliente = 'proveedores') → CEBALLOS Y LOZANO · PROVEEDOR
 *   · Pichichí → CEBALLOS Y LOZANO · PICHICHI
 *   · San Carlos, Mayagüez, Risaralda → AGROMORALES · ese ingenio
 *   · Riopaila: si la HACIENDA está en la lista HACIENDA_RIOPAILA_AGRICOLA →
 *     AGROMORALES · RIOPAILA AGRÍCOLA; si no → AGROMORALES · RIOPAILA. Si la labor
 *     solo tiene precio en el otro de los dos (p. ej. fertilización), se usa ese y
 *     se avisa. El despeje de Riopaila también existe en CEBALLOS Y LOZANO
 *     ($108.028): se toma AGROMORALES por defecto.
 *   · Modalidad: primero el precio de esa modalidad (VERDE, 4X1, PLANTILLA…), si
 *     no, el que vale para todas.
 *   · Oficios varios: POR HORA usa la tarifa por hora (cantidad = horas); POR
 *     JORNAL la del jornal (cantidad = 1 por servicio).
 *   · Acequias: el hectómetro incluye 2 pases; los pases adicionales NO tienen
 *     precio todavía (se avisa, no se cobran).
 * Sin tarifa → `null` con el motivo: nunca $0 escondido.
 *
 * 🔴 EMPRESA QUE FACTURA (2-oct-2026): la escoge quien factura (Carlos David) en
 * Facturación — AGROMORALES o CEBALLOS Y LOZANO — y con eso se resuelve qué tabla
 * aplica (p. ej. despeje de Riopaila $107.203 vs $108.028). Una línea YA facturada
 * usa la razón social de su factura. Sin empresa escogida: automático (AGROMORALES
 * primero).
 */
export interface Tarifa {
  id: string
  razonSocial: string
  clienteClave: string
  labor: string
  modalidad: string | null
  unidad: 'ha' | 'hm' | 'h' | 'jornal'
  precio: number
  etiqueta: string | null
  desde: string
  hasta: string | null
}

export interface Valoracion {
  valor: number | null
  precio: number | null
  cantidad: number
  unidad: string
  razonSocial: string | null
  cliente: string | null
  etiqueta: string | null
  /** Por qué no hay valor, o qué se supuso. */
  nota: string | null
}

export const NOMBRE_CLIENTE: Record<string, string> = {
  SAN_CARLOS: 'Ingenio San Carlos', RIOPAILA: 'Ingenio Riopaila', RIOPAILA_AGRICOLA: 'Riopaila Agrícola',
  MAYAGUEZ: 'Ingenio Mayagüez', RISARALDA: 'Ingenio Risaralda', PICHICHI: 'Ingenio Pichichí', PROVEEDOR: 'Proveedor',
}

const ESPEJO = 'sam:tarifas'
const ESPEJO_RA = 'sam:haciendas-ra'

function leer<T>(k: string, def: T): T {
  try { return JSON.parse(localStorage.getItem(k) ?? 'null') ?? def } catch { return def }
}

async function cargarTarifas(): Promise<Tarifa[] | null> {
  const { data, error } = await supabase.from('tarifas').select('*').not('cliente_clave', 'is', null)
  if (error || !data) return null
  return (data as Record<string, unknown>[]).map((r) => ({
    id: String(r.id), razonSocial: String(r.razon_social ?? ''), clienteClave: String(r.cliente_clave ?? ''),
    labor: String(r.labor_nombre ?? '').toUpperCase(), modalidad: r.modalidad ? String(r.modalidad).toUpperCase() : null,
    unidad: (r.unidad as Tarifa['unidad']) ?? 'ha', precio: Number(r.precio_ha ?? 0), etiqueta: r.etiqueta ? String(r.etiqueta) : null,
    desde: String(r.vigente_desde ?? ''), hasta: r.vigente_hasta ? String(r.vigente_hasta) : null,
  }))
}

/** Tarifas + haciendas de Riopaila Agrícola, con copia local para sin señal. */
export function useTarifas(): { tarifas: Tarifa[]; haciendasRA: Set<string> } {
  const [tarifas, setTarifas] = useState<Tarifa[]>(() => leer(ESPEJO, []))
  const [ra, setRa] = useState<string[]>(() => leer(ESPEJO_RA, []))
  useEffect(() => {
    let vivo = true
    void cargarTarifas().then((t) => {
      if (!vivo || !t) return
      setTarifas(t)
      try { localStorage.setItem(ESPEJO, JSON.stringify(t)) } catch { /* sin espacio */ }
    })
    void loadCatalogo('HACIENDA_RIOPAILA_AGRICOLA').then((vs) => {
      if (!vivo || vs.length === 0) return
      const l = vs.map((v) => v.valor.trim().toUpperCase())
      setRa(l)
      try { localStorage.setItem(ESPEJO_RA, JSON.stringify(l)) } catch { /* sin espacio */ }
    })
    return () => { vivo = false }
  }, [])
  return { tarifas, haciendasRA: new Set(ra) }
}

const haDe = (a: { executedArea: number; area: number }) => (a.executedArea > 0 ? a.executedArea : a.area)

/** A qué cliente(s) de la tabla se le cobra esta labor, en orden de preferencia. */
function clientesDe(a: Assignment, haciendasRA: Set<string>): string[] {
  if (a.cliente === 'proveedores') return ['PROVEEDOR']
  switch (a.ingenioId) {
    case 'pichichi': return ['PICHICHI']
    case 'san_carlos': return ['SAN_CARLOS']
    case 'mayaguez': return ['MAYAGUEZ']
    case 'risaralda': return ['RISARALDA']
    case 'riopaila':
      return haciendasRA.has(a.haciendaName.trim().toUpperCase()) ? ['RIOPAILA_AGRICOLA', 'RIOPAILA'] : ['RIOPAILA', 'RIOPAILA_AGRICOLA']
    default: return []
  }
}

export function valorarLinea(a: Assignment, tarifas: Tarifa[], haciendasRA: Set<string>, empresa?: string | null): Valoracion {
  const labor = laborFacturable(a.labor)
  const modalidad = modalidadEfectiva(a)?.toUpperCase() ?? null
  const fecha = executionDateKey(a)
  const porHoras = esPorHoras(a.labor)
  const base: Valoracion = { valor: null, precio: null, cantidad: haDe(a), unidad: porHoras ? 'h' : 'ha', razonSocial: null, cliente: null, etiqueta: null, nota: null }
  const clientes = clientesDe(a, haciendasRA)
  if (clientes.length === 0) return { ...base, nota: a.ingenioId ? 'Este cliente no tiene tabla de precios' : 'La labor no tiene ingenio' }

  const vigente = (t: Tarifa) => t.desde <= fecha && (!t.hasta || t.hasta >= fecha)
  // AGROMORALES primero (el despeje de Riopaila existe en las dos razones sociales).
  const orden = (x: Tarifa, y: Tarifa) => (x.razonSocial === 'AGROMORALES' ? 0 : 1) - (y.razonSocial === 'AGROMORALES' ? 0 : 1)

  for (const [i, cli] of clientes.entries()) {
    const delCliente = tarifas
      .filter((t) => t.clienteClave === cli && t.labor === labor && vigente(t) && (!empresa || t.razonSocial === empresa))
      .sort(orden)
    if (delCliente.length === 0) continue
    let t: Tarifa | undefined
    if (porHoras) {
      // Oficios varios: la unidad la decide la modalidad (por hora / por jornal).
      const quiere = modalidad === 'POR JORNAL' ? 'jornal' : 'h'
      t = delCliente.find((x) => x.unidad === quiere)
      if (!t) {
        const hay = delCliente.map((x) => (x.unidad === 'jornal' ? 'por jornal' : 'por hora')).join(', ')
        return { ...base, cliente: NOMBRE_CLIENTE[cli], nota: `${NOMBRE_CLIENTE[cli]} cobra oficios varios ${hay}; la labor está ${modalidad?.toLowerCase() ?? 'sin modalidad'}` }
      }
    } else {
      t = delCliente.find((x) => x.modalidad && x.modalidad === modalidad) ?? delCliente.find((x) => !x.modalidad)
      if (!t) {
        return { ...base, cliente: NOMBRE_CLIENTE[cli], nota: `${NOMBRE_CLIENTE[cli]} no tiene precio de ${labor.toLowerCase()} ${modalidad ?? ''}`.trim() }
      }
    }
    const cantidad = t.unidad === 'jornal' ? 1 : haDe(a)
    const notas: string[] = []
    if (i > 0) notas.push(`Sin precio en ${NOMBRE_CLIENTE[clientes[0]]}: se usó el de ${NOMBRE_CLIENTE[cli]}`)
    // La modalidad tiene precio propio en otra tabla (p. ej. reencalle VERDE) pero este
    // cliente solo trae el general: se cobra el general y se avisa.
    if (!porHoras && modalidad && !t.modalidad && tarifas.some((x) => x.labor === labor && x.modalidad === modalidad)) {
      notas.push(`Sin precio de ${labor.toLowerCase()} ${modalidad.toLowerCase()} para ${NOMBRE_CLIENTE[cli]}: se usó el general`)
    }
    const adic = pasesAdicionales(a)
    if (adic > 0) notas.push(`${adic} pase(s) adicional(es) sin precio todavía`)
    return {
      valor: Math.round(cantidad * t.precio), precio: t.precio, cantidad, unidad: t.unidad,
      razonSocial: t.razonSocial, cliente: NOMBRE_CLIENTE[cli], etiqueta: t.etiqueta, nota: notas.join(' · ') || null,
    }
  }
  return {
    ...base, cliente: NOMBRE_CLIENTE[clientes[0]],
    nota: empresa
      ? `${empresa} no tiene precio de ${labor.toLowerCase()} para ${NOMBRE_CLIENTE[clientes[0]]}`
      : `${NOMBRE_CLIENTE[clientes[0]]} no tiene precio de ${labor.toLowerCase()}`,
  }
}

export const pesosCortos = (n: number) =>
  n >= 1_000_000 ? `$${(n / 1_000_000).toLocaleString('es-CO', { maximumFractionDigits: 1 })} M` : `$${Math.round(n).toLocaleString('es-CO')}`
