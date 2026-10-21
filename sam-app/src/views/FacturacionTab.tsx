import { memo, useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react'
import { esPorHoras, unidadDeLabor } from '../lib/texto'
import { useAppData } from '../context/AppDataContext'
import { executionDateKey, setModalidadBulk, setPrecioManualBulk, setTarifaManualBulk } from '../services/samApi'
import { faltaModalidad, laborFacturable, modalidadEfectiva, modalidadesDe, modalidadSugerida, pasesAdicionales, useModalidades, type MapaModalidades } from '../lib/modalidad'
import {
  RAZONES_SOCIALES, abrirArchivo, desvincularDocumento, loadDocumentos,
  type DocumentoFact, type TipoDocumento,
} from '../services/facturacionApi'
import { DocumentoFacturacionModal } from '../components/DocumentoFacturacionModal'
import { EditarLineaFacturacion, type CambioLinea } from '../components/EditarLineaFacturacion'
import { NOMBRE_CLIENTE, clienteDeducido, clienteForzado, pesosCortos, useTarifas, valorarLinea, type Tarifa, type Valoracion } from '../lib/tarifas'
import { ingenioNombre } from '../data/ingenios'
import {
  matchesSummaryFilter,
  buildMonthOptions,
  type SummaryQuincena,
} from '../components/EntityHistoryModal'
import { Ayuda } from '../components/Ayuda'
import type { Assignment } from '../domain/sam'
import { claveHacienda, loadAcuerdos } from '../services/carteraApi'

/**
 * Facturación (administración/owner) — el REALIZADO completo (labores
 * COMPLETADA/PARCIAL) en UNA sola lista que NO se mueve (18-oct-2026, Iván y
 * Carlos: «déjalo ahí mismo, no te lo lleves para ningún lado»). Antes se
 * repartía en etapas (sin soporte → con soporte → facturadas) y una línea se
 * iba de la vista al ponerle soporte, factura o tarifa; ahora la columna
 * «Estado» dice Facturado / Sin facturar y la línea se queda donde estaba.
 * Marcando líneas se les vincula el DOCUMENTO SOPORTE del cliente (orden de
 * servicio, acta, certificación…) y luego la FACTURA emitida, cada uno con su
 * archivo (PDF o foto). Ver `services/facturacionApi` y la migración 20261002150000.
 *
 * MODALIDAD: el precio depende de la labor Y su modalidad (despeje 2x1
 * mecanizada, acequias 2 pases…). Las que la necesitan y no la tienen salen
 * «falta» y se completan EN LOTE aquí. Ver `lib/modalidad`.
 */
const LIMIT = 400
const conFactura = (n?: string | null) => !!(n && n.trim())
// Misma fórmula de "ha ejecutada" que Resumen/Reporte/KPIs.
const haDe = (a: { executedArea: number; area: number }) => (a.executedArea > 0 ? a.executedArea : a.area)

// Solo para el RESUMEN de arriba: ya no filtra la tabla (las líneas no se mueven).
type Grupo = 'SIN_FACTURAR' | 'FACTURADAS' | 'TODAS'
const facturada = (a: Assignment) => !!a.facturaId || conFactura(a.facturaNumero)

export function FacturacionTab({ onEdit }: { onEdit?: (a: Assignment) => void }) {
  const { assignments, setAssignments, session, todayKey, busy, setBusy, setError, setInfo } = useAppData()

  const [search, setSearch] = useState('')
  // De entrada TODO el realizado (pedido de Iván); se puede acotar a un mes o quincena.
  const [mes, setMes] = useState('')
  const [quincena, setQuincena] = useState<SummaryQuincena>('TODO')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const modalidades = useModalidades()
  // «Sin modalidad» y «Sin tarifa» FIJAN las líneas que cumplían al activarlos:
  // al ponerles modalidad o tarifa NO se van de la lista (antes desaparecían y no
  // se veía lo que se acababa de hacer). null = filtro apagado.
  const [fijasSinModalidad, setFijasSinModalidad] = useState<Set<string> | null>(null)
  const [modalidadInput, setModalidadInput] = useState('')
  const [tarifaInput, setTarifaInput] = useState('')
  const [precioManualInput, setPrecioManualInput] = useState('')
  // «Más acciones» de la barra en lote (modalidad, tarifa, precio, quitar) y cómo
  // arranca el formulario del documento (desde «Facturar estas líneas», en «Nuevo»).
  const [masAcciones, setMasAcciones] = useState(false)
  const [modoModal, setModoModal] = useState<'nuevo' | 'existente' | undefined>(undefined)
  const [documentos, setDocumentos] = useState<DocumentoFact[]>([])
  const [modal, setModal] = useState<TipoDocumento | null>(null)
  // Valor a facturar de cada línea: cantidad × tarifa (ver `lib/tarifas`).
  const { tarifas, haciendasRA } = useTarifas()
  const [fijasSinTarifa, setFijasSinTarifa] = useState<Set<string> | null>(null)
  // A quién se factura (20-oct-2026): una factura es de UN cliente. También FIJA
  // las líneas al escogerlo: cambiarle el cliente a una no la saca de la vista.
  const [cliente, setCliente] = useState('')
  const [fijasCliente, setFijasCliente] = useState<Set<string> | null>(null)
  // Con qué EMPRESA se factura (la escoge Carlos David): define qué tabla de precios aplica.
  // '' = automático. Se recuerda en este equipo.
  const [empresa, setEmpresa] = useState<string>(() => {
    try { return localStorage.getItem('sam:fact-empresa') ?? '' } catch { return '' }
  })
  function cambiarEmpresa(v: string) {
    setEmpresa(v)
    setSelected(new Set())
    try { localStorage.setItem('sam:fact-empresa', v) } catch { /* sin almacenamiento */ }
  }

  useEffect(() => { void loadDocumentos().then(setDocumentos) }, [])
  // Colonos con acuerdo de pago (Cartera → 🤝 Acuerdos): sus líneas llevan el nombre.
  const [colonoDe, setColonoDe] = useState<Map<string, string>>(new Map())
  useEffect(() => {
    void loadAcuerdos().then((ac) => {
      const m = new Map<string, string>()
      for (const a of ac) if (!a.anulado) for (const h of a.haciendas) if (!m.has(claveHacienda(h))) m.set(claveHacienda(h), a.colono)
      setColonoDe(m)
    })
  }, [])
  const docPorId = useMemo(() => new Map(documentos.map((d) => [d.id, d])), [documentos])

  const monthOptions = useMemo(() => buildMonthOptions(todayKey.slice(0, 7)), [todayKey])

  // 🔴 Rendimiento (2-oct-2026): el realizado completo son miles de líneas. Se
  // ordena y se valora UNA vez (cuando cambian las labores, los precios o la
  // empresa); buscar, cambiar de mes o de filtro solo recorta esa lista. Antes cada
  // letra del buscador volvía a calcular el precio de todas las líneas.
  const realizado = useMemo(() => assignments
    .filter((a) => (a.status === 'COMPLETADA' || a.status === 'PARCIAL') && a.executedArea > 0)
    .map((a) => ({ a, dia: executionDateKey(a) }))
    .sort((x, y) => y.dia.localeCompare(x.dia)), [assignments])
  const valores = useMemo(() => {
    const m = new Map<string, Valoracion>()
    for (const { a } of realizado) {
      // Ya facturada: manda la razón social de SU factura; si no, la empresa escogida.
      const rs = (a.facturaId ? docPorId.get(a.facturaId)?.razonSocial : null) ?? (empresa || null)
      m.set(a.id, valorarLinea(a, tarifas, haciendasRA, rs))
    }
    return m
  }, [realizado, tarifas, haciendasRA, empresa, docPorId])

  // El realizado del período y la búsqueda. La búsqueda va diferida: el texto se
  // escribe sin esperar a la tabla.
  const busqueda = useDeferredValue(search)
  const delPeriodo = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    return realizado
      .filter(({ dia }) => matchesSummaryFilter(dia, mes, mes ? quincena : 'TODO', todayKey))
      .map(({ a }) => a)
      .filter((a) => {
        if (!q) return true
        const s = a.soporteId ? docPorId.get(a.soporteId)?.numero ?? '' : ''
        return `${a.haciendaName} ${a.suerte} ${a.labor} ${a.operatorName} ${a.facturaNumero ?? ''} ${s}`.toLowerCase().includes(q)
      })
  }, [realizado, busqueda, mes, quincena, todayKey, docPorId])
  const sinTarifa = useMemo(() => delPeriodo.filter((a) => valores.get(a.id)?.valor == null).length, [delPeriodo, valores])
  const sinModalidad = useMemo(() => delPeriodo.filter((a) => faltaModalidad(modalidades, a)).length, [delPeriodo, modalidades])
  const fijarSinTarifa = () => new Set(delPeriodo.filter((a) => valores.get(a.id)?.valor == null).map((a) => a.id))
  const fijarSinModalidad = () => new Set(delPeriodo.filter((a) => faltaModalidad(modalidades, a)).map((a) => a.id))
  const clienteDe = (a: Assignment) => valores.get(a.id)?.cliente ?? 'Sin cliente'
  const fijarCliente = (c: string) => (c ? new Set(delPeriodo.filter((a) => clienteDe(a) === c).map((a) => a.id)) : null)
  // Los clientes del período, con cuántas líneas tiene cada uno (para el selector).
  const clientesDelPeriodo = useMemo(() => {
    const m = new Map<string, number>()
    for (const a of delPeriodo) { const c = valores.get(a.id)?.cliente ?? 'Sin cliente'; m.set(c, (m.get(c) ?? 0) + 1) }
    return [...m.entries()].sort((x, y) => y[1] - x[1])
  }, [delPeriodo, valores])
  // Si cambia lo que se mira (mes, quincena, búsqueda, empresa), los filtros activos
  // se vuelven a fijar sobre lo nuevo; poner una tarifa o modalidad NO los cambia.
  const claveVista = `${mes}|${quincena}|${busqueda}|${empresa}`
  useEffect(() => {
    setFijasSinTarifa((f) => (f ? fijarSinTarifa() : f))
    setFijasSinModalidad((f) => (f ? fijarSinModalidad() : f))
    setFijasCliente(fijarCliente(cliente))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claveVista])

  // La lista: SIEMPRE en el mismo orden (fecha), sin repartir por etapas.
  const realizadas = useMemo(() => delPeriodo
    .filter((a) => !fijasSinModalidad || fijasSinModalidad.has(a.id))
    .filter((a) => !fijasSinTarifa || fijasSinTarifa.has(a.id))
    .filter((a) => !fijasCliente || fijasCliente.has(a.id)), [delPeriodo, fijasSinModalidad, fijasSinTarifa, fijasCliente])
  const shown = realizadas.slice(0, LIMIT)
  const overLimit = realizadas.length > LIMIT

  // 🔴 Las HORAS de servicio se facturan, pero no son hectáreas: van en su propia
  // cuenta. (Los hectómetros siguen sumando con las hectáreas, como en el resto.)
  const suma = (lista: Assignment[], horas: boolean) =>
    lista.filter((a) => esPorHoras(a.labor) === horas).reduce((s, a) => s + haDe(a), 0)
  const porEtapa = useMemo(() => {
    const out: Record<Grupo, { n: number; ha: number; h: number; valor: number }> = {
      SIN_FACTURAR: { n: 0, ha: 0, h: 0, valor: 0 }, FACTURADAS: { n: 0, ha: 0, h: 0, valor: 0 },
      TODAS: { n: 0, ha: 0, h: 0, valor: 0 },
    }
    for (const a of realizadas) {
      for (const k of [facturada(a) ? 'FACTURADAS' : 'SIN_FACTURAR', 'TODAS'] as Grupo[]) {
        out[k].n += 1
        out[k].valor += valores.get(a.id)?.valor ?? 0
        if (esPorHoras(a.labor)) out[k].h += haDe(a)
        else out[k].ha += haDe(a)
      }
    }
    return out
  }, [realizadas, valores])
  // Lo que dicen las FACTURAS que están COMPLETAS en la vista (todas sus líneas a la
  // vista): así se compara con el valor de esas mismas líneas. Una factura que
  // cubre dos meses no cuenta cuando se mira uno solo.
  const valorFacturas = useMemo(() => {
    const vista = new Set(realizadas.map((a) => a.id))
    const lineasDe = new Map<string, string[]>()
    for (const { a } of realizado) {
      if (!a.facturaId) continue
      const l = lineasDe.get(a.facturaId) ?? []
      l.push(a.id); lineasDe.set(a.facturaId, l)
    }
    let total = 0
    for (const [id, ids] of lineasDe) if (ids.every((x) => vista.has(x))) total += docPorId.get(id)?.valor ?? 0
    return total
  }, [realizado, realizadas, docPorId])

  // «¿Qué vas a facturar?» (20-oct-2026, Iván: «algo sencillo e intuitivo»): con el
  // cliente escogido, lo que le falta por facturar en el período, listo para UN toque.
  // Sobre el cliente y el período, SIN los filtros de revisar («sin tarifa», «sin
  // modalidad»): el botón factura todo lo pendiente, no solo lo que se está corrigiendo.
  const vistaCliente = useMemo(() => delPeriodo.filter((a) => !fijasCliente || fijasCliente.has(a.id)), [delPeriodo, fijasCliente])
  const porFacturar = useMemo(() => vistaCliente.filter((a) => !facturada(a)), [vistaCliente])
  const revisando = !!(fijasSinTarifa || fijasSinModalidad)
  const resumenPF = useMemo(() => {
    let ha = 0, h = 0, valor = 0, sinPrecio = 0, sinModalidad = 0, sinSoporte = 0
    for (const a of porFacturar) {
      if (esPorHoras(a.labor)) h += haDe(a); else ha += haDe(a)
      const v = valores.get(a.id)?.valor
      if (v == null) sinPrecio += 1; else valor += v
      if (faltaModalidad(modalidades, a)) sinModalidad += 1
      if (!a.soporteId) sinSoporte += 1
    }
    return { ha, h, valor, sinPrecio, sinModalidad, sinSoporte }
  }, [porFacturar, valores, modalidades])
  // Marcar todas solo alcanza a las que se ven (400): con más, primero se acota.
  const demasiadas = vistaCliente.length > LIMIT
  const periodoTexto = mes
    ? `en ${(monthOptions.find((m) => m.value === mes)?.label ?? mes).toLowerCase()}${quincena === 'PRIMERA' ? ' (1ra quincena)' : quincena === 'SEGUNDA' ? ' (2da quincena)' : ''}`
    : 'en todo el realizado'
  function facturarTodas(tipo: TipoDocumento) {
    // Se quitan los filtros de revisar: así las marcadas son TODAS las pendientes (se ven).
    setFijasSinTarifa(null); setFijasSinModalidad(null)
    const lista = tipo === 'FACTURA' ? porFacturar : porFacturar.filter((a) => !a.soporteId)
    setSelected(new Set(lista.map((a) => a.id)))
    setModoModal('nuevo')
    setModal(tipo)
  }
  function abrirDocumento(tipo: TipoDocumento) {
    setModoModal(undefined)
    setModal(tipo)
  }
  // «falta modalidad» en una línea: se marca sola y se abre donde se pone.
  const corregirModalidad = useCallback((a: Assignment) => {
    setSelected(new Set([a.id]))
    setMasAcciones(true)
  }, [])

  const seleccion = shown.filter((a) => selected.has(a.id))
  const haSel = suma(seleccion, false)
  const hSel = suma(seleccion, true)
  const valorSel = seleccion.reduce((s, a) => s + (valores.get(a.id)?.valor ?? 0), 0)
  const sinTarifaSel = seleccion.filter((a) => valores.get(a.id)?.valor == null).length
  const facturadasSel = seleccion.filter(facturada).length
  // Parciales (la labor sigue abierta): si se facturan y el operario continúa, la
  // base pone lo nuevo en OTRA línea sin facturar (migración 20261020120000).
  const parcialesSel = seleccion.filter((a) => a.status === 'PARCIAL').length
  const avisoFacturadas = () => facturadasSel === 0 ||
    window.confirm(`${facturadasSel} de las ${seleccion.length} líneas marcadas ya están facturadas. ¿Cambiarlas también? La factura no cambia: solo el valor de esas líneas.`)
  // La unidad del precio del lote (ha, hm, h o jornal), según las líneas marcadas.
  const unidadesSel = [...new Set(seleccion.map((a) => valores.get(a.id)?.unidad ?? 'ha'))]
  const unidadLote = unidadesSel.length === 1 ? unidadesSel[0] : 'unidad'

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])
  function toggleAll() {
    setSelected((prev) => (shown.every((a) => prev.has(a.id)) ? new Set() : new Set(shown.map((a) => a.id))))
  }

  // ── Soporte y factura ──────────────────────────────────────────────────
  // Sugerencias para el documento nuevo: el cliente de las líneas marcadas y la
  // razón social propuesta (Pichichí y proveedores → Ceballos y Lozano).
  const ingeniosSel = [...new Set(seleccion.map((a) => (a.ingenioId ? ingenioNombre(a.ingenioId) : '')).filter(Boolean))]
  // La razón social y el cliente salen de la tarifa de las líneas, si todas coinciden.
  const rsSel = [...new Set(seleccion.map((a) => valores.get(a.id)?.razonSocial).filter(Boolean))] as string[]
  const cliSel = [...new Set(seleccion.map((a) => valores.get(a.id)?.cliente).filter(Boolean))] as string[]
  const clienteSugerido = cliSel.length === 1 ? cliSel[0] : ingeniosSel.length === 1 ? ingeniosSel[0] : ''
  const razonSugerida = empresa ? empresa : rsSel.length === 1 ? rsSel[0]
    : seleccion.length > 0 && seleccion.every((a) => a.cliente === 'proveedores' || a.ingenioId === 'pichichi') ? 'CEBALLOS Y LOZANO' : 'AGROMORALES'

  function listo(doc: DocumentoFact, vinculadas: number, extra?: string) {
    const ids = new Set(seleccion.map((a) => a.id))
    setAssignments((prev) => prev.map((a) => {
      if (!ids.has(a.id)) return a
      return doc.tipo === 'SOPORTE' ? { ...a, soporteId: doc.id } : { ...a, facturaId: doc.id, facturaNumero: doc.numero }
    }))
    setDocumentos((prev) => (prev.some((d) => d.id === doc.id) ? prev : [doc, ...prev]))
    setInfo(doc.tipo === 'SOPORTE'
      ? `Soporte ${doc.numero} puesto a ${vinculadas} línea(s).`
      : `✓ Factura ${doc.numero} creada con ${vinculadas} línea(s). Ya está en Cartera (Más → 💰 Cartera) para registrar sus pagos.${extra ? ` ${extra}` : ''}`)
    setModal(null)
    setSelected(new Set())
  }

  async function exportarAExcel() {
    try {
      const { utils, writeFile } = await import('xlsx')
      const wb = utils.book_new()
      const filas = realizadas.map((a) => {
        const v = valores.get(a.id)
        const sop = a.soporteId ? docPorId.get(a.soporteId) : undefined
        const fac = a.facturaId ? docPorId.get(a.facturaId) : undefined
        return {
          'Fecha': executionDateKey(a),
          'Hacienda': a.haciendaName,
          'Suerte': a.suerte,
          'Labor': a.labor,
          'Modalidad': modalidadEfectiva(a) || '',
          'Máquina': a.equipmentName || a.equipmentCode || '',
          'Operario': a.operatorName || '',
          'Cant.': v?.cantidad ?? haDe(a),
          'Unidad': v?.unidad ?? unidadDeLabor(a.labor),
          'Valor Unitario': v?.precio ?? '',
          'Valor Total': v?.valor != null ? Math.round(v.valor) : '',
          'Sin tarifa': v?.valor == null ? (v?.nota || 'sin tarifa') : '',
          'Soporte': sop ? sop.numero : '',
          'Factura': fac ? fac.numero : '',
          'Estado': facturada(a) ? 'Facturado' : 'Sin facturar',
          'Razón Social': v?.razonSocial ?? '',
          'Cliente': v?.cliente ?? '',
        }
      })
      utils.book_append_sheet(wb, utils.json_to_sheet(filas), 'Facturación')
      const sufijo = [mes || 'Todo', mes && quincena !== 'TODO' ? quincena.toLowerCase() : '', cliente.replace(/\s+/g, '-')].filter(Boolean).join('_')
      writeFile(wb, `Facturacion_${sufijo}.xlsx`)
    } catch (err) {
      console.error(err)
      alert('Error al exportar a Excel.')
    }
  }

  async function quitar(tipo: TipoDocumento) {
    if (!session) return
    const ids = seleccion.filter((a) => (tipo === 'SOPORTE' ? !!a.soporteId : facturada(a))).map((a) => a.id)
    if (ids.length === 0) return
    if (!window.confirm(`¿Quitar ${tipo === 'SOPORTE' ? 'el soporte' : 'la factura'} de ${ids.length} línea(s)? ${tipo === 'FACTURA' ? 'Vuelven a quedar «Sin facturar».' : ''}`)) return
    setBusy(true)
    setError('')
    try {
      const n = await desvincularDocumento(tipo, ids, session.id)
      const set = new Set(ids)
      setAssignments((prev) => prev.map((a) => (!set.has(a.id) ? a
        : tipo === 'SOPORTE' ? { ...a, soporteId: null } : { ...a, facturaId: null, facturaNumero: null })))
      setInfo(`${tipo === 'SOPORTE' ? 'Soporte' : 'Factura'} quitado de ${n} labor(es).`)
      setSelected(new Set())
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const verArchivo = useCallback(async (doc: DocumentoFact) => {
    if (!doc.archivoPath) return
    try { await abrirArchivo(doc.archivoPath) } catch (e) { setError((e as Error).message) }
  }, [setError])

  // ── Modalidad en lote ──────────────────────────────────────────────────
  // Solo si todo lo marcado es la MISMA labor y esa labor tiene lista.
  const laboresSel = [...new Set(seleccion.map((a) => laborFacturable(a.labor)))]
  const opcionesModalidad = laboresSel.length === 1 ? modalidadesDe(modalidades, laboresSel[0]) : []
  // De entrada la sugerida (2X1 / 2 PASES), igual que en campo.
  // Lo escogido solo vale si es de la labor marcada AHORA (antes una modalidad o una
  // tarifa escogida para despeje se quedaba y se aplicaba al reencalle marcado después).
  const modalidadLote = (opcionesModalidad.includes(modalidadInput) ? modalidadInput : '')
    || (laboresSel.length === 1 ? modalidadSugerida(modalidades, laboresSel[0]) ?? '' : '')

  async function ponerModalidad() {
    const ids = seleccion.map((a) => a.id)
    if (ids.length === 0 || !modalidadLote) return
    if (!avisoFacturadas()) return
    setBusy(true)
    setError('')
    try {
      await setModalidadBulk(ids, modalidadLote, session?.id)
      const set = new Set(ids)
      setAssignments((prev) => prev.map((a) => (set.has(a.id) ? { ...a, modalidad: modalidadLote } : a)))
      setInfo(`Modalidad ${modalidadLote} puesta a ${ids.length} labor(es).`)
      setSelected(new Set())
      setModalidadInput('')
    } catch (err) {
      const e = err as { message?: string }
      setError(`No se pudo poner la modalidad. (${e?.message ?? 'error'})`)
    } finally {
      setBusy(false)
    }
  }

  // Las tarifas de la labor marcada: primero las vigentes hoy; se rotula modalidad y vigencia.
  const laborUnica = laboresSel.length === 1 ? laboresSel[0] : ''
  const opcionesTarifa = useMemo(() => {
    if (!laborUnica) return []
    const vigente = (t: Tarifa) => t.desde <= todayKey && (!t.hasta || t.hasta >= todayKey)
    return tarifas.filter((t) => t.labor === laborUnica)
      .map((t) => ({ ...t, vigenteHoy: vigente(t) }))
      .sort((x, y) => Number(y.vigenteHoy) - Number(x.vigenteHoy))
  }, [laborUnica, tarifas, todayKey])
  const tarifaValida = opcionesTarifa.some((t) => t.id === tarifaInput)

  async function ponerTarifa() {
    const ids = seleccion.map((a) => a.id)
    if (ids.length === 0 || !tarifaValida) return
    if (!avisoFacturadas()) return
    setBusy(true)
    setError('')
    try {
      await setTarifaManualBulk(ids, tarifaInput, session?.id)
      const set = new Set(ids)
      setAssignments((prev) => prev.map((a) => {
        if (!set.has(a.id)) return a
        const notas = String(a.notes || '').replace(/\[TARIFA:[a-f0-9-]{36}\]/i, '').replace(/\[PRECIO_MANUAL:\d+(?:\.\d+)?\]/i, '').trim()
        const nuevas = notas ? `${notas} [TARIFA:${tarifaInput}]` : `[TARIFA:${tarifaInput}]`
        return { ...a, notes: nuevas, manualPrice: null }
      }))
      setInfo(`Tarifa manual asignada a ${ids.length} labor(es).`)
      setSelected(new Set())
      setTarifaInput('')
    } catch (err) {
      const e = err as { message?: string }
      setError(`No se pudo asignar la tarifa. (${e?.message ?? 'error'})`)
    } finally {
      setBusy(false)
    }
  }

  // Precio de UNA línea desde su casilla (18-oct-2026): número = precio manual;
  // null = quitarlo y volver a la tarifa. Se guarda en la base y luego en pantalla.
  const guardarPrecioLinea = useCallback(async (a: Assignment, precio: number | null) => {
    await setPrecioManualBulk([a.id], precio, session?.id)
    setAssignments((prev) => prev.map((x) => {
      if (x.id !== a.id) return x
      const sinPrecio = String(x.notes || '').replace(/\[PRECIO_MANUAL:\d+(?:\.\d+)?\]/i, '').trim()
      if (precio == null) return { ...x, notes: sinPrecio, manualPrice: null }
      const notas = sinPrecio.replace(/\[TARIFA:[a-f0-9-]{36}\]/i, '').trim()
      return { ...x, notes: notas ? `${notas} [PRECIO_MANUAL:${precio}]` : `[PRECIO_MANUAL:${precio}]`, manualPrice: precio }
    }))
  }, [session?.id, setAssignments])

  // ── Editar UNA línea: a quién se factura, soporte y factura (18-oct-2026) ──
  const [editandoId, setEditandoId] = useState<string | null>(null)
  const editando = editandoId ? assignments.find((a) => a.id === editandoId) ?? null : null
  const abrirEdicion = useCallback((a: Assignment) => setEditandoId(a.id), [])
  function lineaGuardada(id: string, c: CambioLinea, msg: string) {
    setAssignments((prev) => prev.map((a) => {
      if (a.id !== id) return a
      let x = a
      if (c.cliente !== undefined) {
        const notas = String(x.notes || '').replace(/\[CLIENTE:[A-Z_]+\]/, '').replace(/\[TARIFA:[a-f0-9-]{36}\]/i, '').trim()
        x = { ...x, notes: c.cliente == null ? notas : notas ? `${notas} [CLIENTE:${c.cliente}]` : `[CLIENTE:${c.cliente}]` }
      }
      if (c.soporte !== undefined) x = { ...x, soporteId: c.soporte?.id ?? null }
      if (c.factura !== undefined) x = { ...x, facturaId: c.factura?.id ?? null, facturaNumero: c.factura?.numero ?? null }
      return x
    }))
    setInfo(msg)
  }

  async function ponerPrecioManual() {
    const ids = seleccion.map((a) => a.id)
    // Se aceptan «$85.000», «85.000» o «85000» (igual que la casilla de cada línea).
    const val = leerPesos(precioManualInput)
    if (ids.length === 0) return
    if (!Number.isFinite(val) || val <= 0) { setError('Escribe un precio mayor que cero (por ejemplo 85.000).'); return }
    const unidad = unidadLote
    if (!window.confirm(`¿Poner precio manual de ${pesosCortos(val)} por ${unidad} a ${ids.length} labor(es)?${facturadasSel ? ` ${facturadasSel} ya están facturadas (la factura no cambia).` : ''} Reemplaza la tarifa que tengan.`)) return
    setBusy(true)
    setError('')
    try {
      await setPrecioManualBulk(ids, val, session?.id)
      const set = new Set(ids)
      setAssignments((prev) => prev.map((a) => {
        if (!set.has(a.id)) return a
        const notas = String(a.notes || '').replace(/\[PRECIO_MANUAL:\d+(?:\.\d+)?\]/i, '').replace(/\[TARIFA:[a-f0-9-]{36}\]/i, '').trim()
        const nuevas = notas ? `${notas} [PRECIO_MANUAL:${val}]` : `[PRECIO_MANUAL:${val}]`
        return { ...a, notes: nuevas, manualPrice: val }
      }))
      setInfo(`Precio manual ${pesosCortos(val)} por ${unidad} asignado a ${ids.length} labor(es).`)
      setSelected(new Set())
      setPrecioManualInput('')
    } catch (err) {
      const e = err as { message?: string }
      setError(`No se pudo guardar el precio manual. (${e?.message ?? 'error'})`)
    } finally {
      setBusy(false)
    }
  }

  const allChecked = shown.length > 0 && shown.every((a) => selected.has(a.id))
  const fmt = (n: number) => n.toLocaleString('es-CO', { maximumFractionDigits: 2 })

  // Resumen de cada documento: cuántas líneas y cuánta área cubre.
  const usoDocs = useMemo(() => {
    const m = new Map<string, { n: number; ha: number }>()
    for (const a of assignments) {
      for (const id of [a.soporteId, a.facturaId]) {
        if (!id) continue
        const u = m.get(id) ?? { n: 0, ha: 0 }
        u.n += 1; u.ha += haDe(a)
        m.set(id, u)
      }
    }
    return m
  }, [assignments])

  return (
    <section className="panel-card">
      <div className="panel-title split">
        <h2>Facturación</h2>
        <span className="subtle-copy">
          {mes ? `${monthOptions.find((m) => m.value === mes)?.label ?? mes}` : 'Todo el realizado'}: <strong>{fmt(porEtapa.TODAS.ha)} ha</strong>
          {porEtapa.TODAS.h > 0 && <> + <strong>{fmt(porEtapa.TODAS.h)} h</strong></>} en {porEtapa.TODAS.n} labores
          {' '}· valor <strong>{pesosCortos(porEtapa.TODAS.valor)}</strong>
        </span>
      </div>
      <Ayuda>
        <p><a href="/manuales/manual-facturacion.html" target="_blank" rel="noopener">📖 Ver el manual completo de Facturación y Cartera</a></p>
        <p><b>Para facturar:</b> arriba, en <b>¿Qué vas a facturar?</b>, escoge el <b>mes</b> y el <b>cliente</b>. Sale lo que le falta por facturar con su valor. Si dice «sin precio» o «sin modalidad», tócalo para corregir esas líneas. Luego toca <b>🧾 Facturar estas líneas</b>: se abre la factura con el valor ya sumado; escribe el número, la fecha y sube el PDF.</p>
        <p>En cada línea, «<b>sin tarifa ✎</b>» te lleva a su casilla <b>Valor/ha</b> para escribir el precio, y «<b>falta modalidad ✎</b>» la marca y abre dónde ponerla.</p>
        <p>Para corregir <b>una sola línea</b> (a quién se factura, su soporte o su factura), toca su <b>cliente</b> o el ✏️ junto al soporte o la factura.</p>
        <p><b>Facturar por</b>: escoge la empresa (AGROMORALES o CEBALLOS Y LOZANO) y cada línea toma el precio de la tabla de esa empresa; si esa empresa no tiene precio para ese cliente, la línea sale «sin tarifa». Las líneas ya facturadas usan la empresa de su factura.</p>
        <p>Todas las líneas se quedan en su lugar: al ponerles tarifa, soporte o factura <b>no se mueven</b>. La columna <b>Estado</b> dice si ya está <b>facturado</b> o <b>sin facturar</b>.</p>
        <p>Marca las líneas y usa <b>📎 Vincular soporte</b> o <b>🧾 Vincular factura</b>: escoges uno que ya exista o creas uno nuevo con su número, fecha y archivo (PDF o foto). Toca el número de un documento para abrir su archivo.</p>
        <p>La <b>modalidad</b> (2x1, 4x1 quemada, 2 pases…) define la tarifa. Si una labor la necesita y no la tiene, sale «falta»: márcalas (de la misma labor) y ponles la modalidad en lote.</p>
      </Ayuda>

      {/* Resumen en UNA línea (solo informa; no filtra). El total va en el título. */}
      <div className="fact-resumen">
        <span><i className="fact-punto fact-punto--no" />Sin facturar <b>{porEtapa.SIN_FACTURAR.n}</b> · {fmt(porEtapa.SIN_FACTURAR.ha)} ha{porEtapa.SIN_FACTURAR.h > 0 ? ` + ${fmt(porEtapa.SIN_FACTURAR.h)} h` : ''} · <b>{pesosCortos(porEtapa.SIN_FACTURAR.valor)}</b></span>
        <span><i className="fact-punto fact-punto--si" />Facturado <b>{porEtapa.FACTURADAS.n}</b> · {fmt(porEtapa.FACTURADAS.ha)} ha{porEtapa.FACTURADAS.h > 0 ? ` + ${fmt(porEtapa.FACTURADAS.h)} h` : ''} · <b>{pesosCortos(porEtapa.FACTURADAS.valor)}</b>
          {valorFacturas > 0 && (
            <span title="La suma de las facturas que están completas en esta vista. Si no cuadra con el valor de las líneas, alguna quedó sin precio o con otro precio.">
              {' '}(según las facturas <b>{pesosCortos(valorFacturas)}</b>)
            </span>
          )}
        </span>
      </div>

      {/* ── ¿Qué vas a facturar? Lo principal, arriba y grande ── */}
      <div className="fact-armar">
        <p className="fact-armar__titulo">¿Qué vas a facturar?</p>
        <div className="fact-armar__campos">
          <label className="fact-campo">
            <span>Mes</span>
            <select id="fact-mes" value={mes} onChange={(e) => { setMes(e.target.value); setSelected(new Set()) }} className="base-input">
              <option value="">Todo el realizado</option>
              {monthOptions.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </label>
          {mes && (
            <label className="fact-campo">
              <span>Quincena</span>
              <select id="fact-quincena" value={quincena} onChange={(e) => { setQuincena(e.target.value as SummaryQuincena); setSelected(new Set()) }} className="base-input">
                <option value="TODO">Todo el mes</option>
                <option value="PRIMERA">1ra quincena</option>
                <option value="SEGUNDA">2da quincena</option>
              </select>
            </label>
          )}
          <label className="fact-campo fact-campo--ancho">
            <span>Cliente</span>
            <select id="fact-cliente" value={cliente} className="base-input"
              onChange={(e) => { setCliente(e.target.value); setFijasCliente(fijarCliente(e.target.value)); setSelected(new Set()) }}
              title="Una factura es de un cliente: escógelo para ver lo que le falta por facturar">
              <option value="">Todos los clientes</option>
              {clientesDelPeriodo.map(([c, n]) => <option key={c} value={c}>{c} ({n})</option>)}
              {cliente && !clientesDelPeriodo.some(([c]) => c === cliente) && <option value={cliente}>{cliente} (0)</option>}
            </select>
          </label>
        </div>

        {!cliente ? (
          <p className="fact-armar__guia">Escoge el <b>cliente</b> (y el mes) y aquí te sale lo que le falta por facturar, listo para facturar de un solo toque.</p>
        ) : porFacturar.length === 0 ? (
          <p className="fact-armar__listo">✓ Todo lo de {cliente} {periodoTexto} ya está facturado.</p>
        ) : (
          <div className="fact-armar__resultado">
            <div className="fact-armar__cifras">
              <span>
                <b>{porFacturar.length} {porFacturar.length === 1 ? 'línea' : 'líneas'} sin facturar</b> {periodoTexto}
                {' '}· {fmt(resumenPF.ha)} ha{resumenPF.h > 0 ? ` + ${fmt(resumenPF.h)} h` : ''}
                {' '}· <b className="fact-armar__valor">{pesosCortos(resumenPF.valor)}</b>
              </span>
              <span className="fact-armar__avisos">
                {resumenPF.sinPrecio === 0 && resumenPF.sinModalidad === 0 && <span className="fact-ok">✓ Todas tienen precio</span>}
                {resumenPF.sinPrecio > 0 && (
                  <button type="button" className="fact-aviso" onClick={() => { setFijasSinTarifa(fijarSinTarifa()); setSelected(new Set()) }}
                    title="Ver solo esas líneas para escribirles el precio en Valor/ha">
                    ⚠ {resumenPF.sinPrecio} sin precio · ver y corregir
                  </button>
                )}
                {resumenPF.sinModalidad > 0 && (
                  <button type="button" className="fact-aviso" onClick={() => { setFijasSinModalidad(fijarSinModalidad()); setSelected(new Set()) }}
                    title="Ver solo esas líneas para ponerles la modalidad">
                    ⚠ {resumenPF.sinModalidad} sin modalidad · ver
                  </button>
                )}
                {revisando && (
                  <button type="button" className="af-link" onClick={() => { setFijasSinTarifa(null); setFijasSinModalidad(null); setSelected(new Set()) }}>
                    Ver todas otra vez
                  </button>
                )}
              </span>
            </div>
            {demasiadas ? (
              <p className="fact-armar__guia">Son {vistaCliente.length} líneas: escoge el <b>mes</b> (o la quincena) para facturarlas por partes.</p>
            ) : (
              <div className="fact-armar__botones">
                <button type="button" className="primary-button fact-armar__cta" disabled={busy || !session} onClick={() => facturarTodas('FACTURA')}>
                  🧾 Facturar {porFacturar.length === 1 ? 'esta línea' : `estas ${porFacturar.length} líneas`}
                </button>
                {resumenPF.sinSoporte > 0 && (
                  <button type="button" className="inline-button" disabled={busy || !session} onClick={() => facturarTodas('SOPORTE')}
                    title="Ponerles el soporte del cliente (orden de servicio, acta…) a las que no lo tienen">
                    📎 Ponerles soporte
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Herramientas: buscar, empresa, revisar y Excel (más pequeñas) */}
      <div className="fact-herramientas">
        <input
          className="user-search-input fact-buscar"
          type="search"
          placeholder="Buscar hacienda, suerte, labor, operario, soporte o factura…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setSelected(new Set()) }}
        />
        <label className="fact-empresa">
          <span>Facturar por</span>
          <select id="fact-empresa" value={empresa} onChange={(e) => cambiarEmpresa(e.target.value)} className="base-input" style={{ width: 'auto' }}>
            <option value="">Automático (según la tabla)</option>
            {RAZONES_SOCIALES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>
        <button
          type="button"
          className={`inline-button${fijasSinModalidad ? ' is-active' : ''}`}
          onClick={() => { setFijasSinModalidad((f) => (f ? null : fijarSinModalidad())); setSelected(new Set()) }}
          title="Las labores que necesitan modalidad y no la tienen. Al ponérsela se quedan en la lista hasta quitar el filtro."
        >
          {fijasSinModalidad ? '✓ ' : ''}Sin modalidad ({sinModalidad})
        </button>
        <button
          type="button"
          className={`inline-button${fijasSinTarifa ? ' is-active' : ''}`}
          onClick={() => { setFijasSinTarifa((f) => (f ? null : fijarSinTarifa())); setSelected(new Set()) }}
          title="Labores a las que no se les encontró precio. Al ponerles tarifa se quedan en la lista hasta quitar el filtro."
        >
          {fijasSinTarifa ? '✓ ' : ''}Sin tarifa ({sinTarifa})
        </button>
        <button type="button" className="inline-button" onClick={() => void exportarAExcel()} title="Exportar a Excel lo que se ve">
          ⬇️ Excel
        </button>
      </div>

      {/* Barra de acciones en lote: lo principal a la vista; lo demás en «Más acciones» */}
      {seleccion.length > 0 && (
        <div className="factura-bulk-bar">
          {overLimit && seleccion.length >= shown.length && (
            <span className="factura-chip factura-chip--falta" style={{ flexBasis: '100%' }}>
              Solo se marcaron las {shown.length} que se ven de {realizadas.length}: escoge el mes o el cliente para marcarlas todas.
            </span>
          )}
          <span><strong>{seleccion.length}</strong> marcada(s) · {fmt(haSel)} ha{hSel > 0 ? ` + ${fmt(hSel)} h` : ''} · <strong>{pesosCortos(valorSel)}</strong>{sinTarifaSel > 0 ? ` (${sinTarifaSel} sin tarifa)` : ''}</span>
          <button type="button" className="primary-button" onClick={() => abrirDocumento('FACTURA')} disabled={busy}>🧾 Vincular factura</button>
          <button type="button" className="inline-button" onClick={() => abrirDocumento('SOPORTE')} disabled={busy}>📎 Vincular soporte</button>
          <button type="button" className="af-link" onClick={() => setSelected(new Set())}>Quitar las marcas</button>
          <details className="fact-mas" open={masAcciones} onToggle={(e) => setMasAcciones(e.currentTarget.open)}>
            <summary>Más acciones</summary>
            <div className="fact-mas__cuerpo">
              {seleccion.some((a) => a.soporteId) && (
                <button type="button" className="inline-button" onClick={() => void quitar('SOPORTE')} disabled={busy}>Quitar soporte</button>
              )}
              {seleccion.some(facturada) && (
                <button type="button" className="inline-button" onClick={() => void quitar('FACTURA')} disabled={busy}>Quitar factura</button>
              )}
              {opcionesModalidad.length > 0 && (
                <span className="fact-mas__grupo">
                  <select
                    id="fact-modalidad"
                    value={modalidadLote}
                    onChange={(e) => setModalidadInput(e.target.value)}
                    disabled={busy}
                    aria-label={`Modalidad de ${laboresSel[0]}`}
                  >
                    <option value="">Modalidad de {laboresSel[0].toLowerCase()}…</option>
                    {opcionesModalidad.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                  <button type="button" className="inline-button" onClick={() => void ponerModalidad()} disabled={busy || !modalidadLote}>
                    Poner modalidad
                  </button>
                </span>
              )}
              {opcionesTarifa.length > 0 && (
                <span className="fact-mas__grupo">
                  <select
                    id="fact-tarifa"
                    value={tarifaValida ? tarifaInput : ''}
                    onChange={(e) => setTarifaInput(e.target.value)}
                    disabled={busy}
                    aria-label={`Asignar tarifa manual a ${laboresSel[0]}`}
                  >
                    <option value="">Tarifa de la tabla ({opcionesTarifa.length})…</option>
                    {opcionesTarifa.map((t) => (
                      <option key={t.id} value={t.id}>
                        {[t.razonSocial || 'GENERAL', NOMBRE_CLIENTE[t.clienteClave] ?? t.clienteClave ?? 'Todos', t.modalidad ?? 'general',
                          `${pesosCortos(t.precio)}/${t.unidad}`, t.vigenteHoy ? null : `vencida ${t.hasta ?? ''}`.trim()].filter(Boolean).join(' · ')}
                      </option>
                    ))}
                  </select>
                  <button type="button" className="inline-button" onClick={() => void ponerTarifa()} disabled={busy || !tarifaValida}>
                    Forzar tarifa
                  </button>
                </span>
              )}
              {laboresSel.length === 1 && (
                <span className="fact-mas__grupo">
                  <input
                    id="fact-precio-manual"
                    className="base-input"
                    inputMode="numeric"
                    style={{ width: 130, padding: '2px 6px', fontSize: '0.85rem' }}
                    placeholder={`$ por ${unidadLote}`}
                    aria-label={`Precio manual por ${unidadLote} de ${laboresSel[0]}`}
                    value={precioManualInput}
                    onChange={(e) => setPrecioManualInput(e.target.value)}
                    disabled={busy}
                  />
                  <button type="button" className="inline-button" onClick={() => void ponerPrecioManual()} disabled={busy || !precioManualInput}>
                    Precio manual
                  </button>
                </span>
              )}
              {laboresSel.length > 1 && <span className="subtle-copy">Para la modalidad, la tarifa o el precio manual, marca líneas de una sola labor.</span>}
            </div>
          </details>
          {parcialesSel > 0 && (
            <span className="subtle-copy" style={{ flexBasis: '100%' }}>
              {parcialesSel} {parcialesSel === 1 ? 'es parcial' : 'son parciales'} (la labor sigue abierta): se pueden facturar; si el operario continúa, lo nuevo saldrá en otra línea, sin facturar.
            </span>
          )}
        </div>
      )}

      <div className="table-wrap validacion-table-wrap">
        <table className="validacion-table fact-tabla">
          <thead>
            <tr>
              <th style={{ width: 32 }}><input type="checkbox" checked={allChecked} onChange={toggleAll} aria-label="Marcar todas" /></th>
              <th>Fecha</th>
              <th>Hacienda · Suerte</th>
              <th>Labor · modalidad</th>
              <th>Operario · máquina</th>
              <th className="num">Cant.</th>
              <th className="num" title="Precio por hectárea (o por hora / hm según la labor). Toca la casilla para cambiarlo.">Valor/ha</th>
              <th className="num">Subtotal</th>
              <th title="A quién se le factura. Tócalo para cambiarlo.">Cliente</th>
              <th>Soporte</th>
              <th>Factura</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((a) => (
              <FilaFactura
                key={a.id}
                a={a}
                sel={selected.has(a.id)}
                v={valores.get(a.id)}
                sop={a.soporteId ? docPorId.get(a.soporteId) : undefined}
                fac={a.facturaId ? docPorId.get(a.facturaId) : undefined}
                modalidades={modalidades}
                colono={colonoDe.get(claveHacienda(a.haciendaName))}
                onPrecio={guardarPrecioLinea}
                onEditarFact={abrirEdicion}
                onFaltaModalidad={corregirModalidad}
                onErrorPrecio={setError}
                onToggle={toggle}
                onAbrir={verArchivo}
                onEdit={onEdit}
              />
            ))}
            {shown.length === 0 && (
              <tr><td colSpan={12} className="validacion-empty">
                {search.trim() ? 'Sin coincidencias.' : 'No hay labores en este período.'}
              </td></tr>
            )}
          </tbody>
        </table>
        {overLimit && (
          <p className="field-hint" style={{ padding: '8px 12px' }}>
            Mostrando las primeras {LIMIT} de {realizadas.length}. Escoge un mes o busca para acotar.
          </p>
        )}
      </div>

      {documentos.length > 0 && (
        <details className="fact-docs">
          <summary>Soportes y facturas ({documentos.length})</summary>
          <table className="validacion-table">
            <thead><tr><th>Tipo</th><th>Número</th><th>Fecha</th><th>Cliente</th><th className="num">Líneas</th><th className="num">Cant.</th><th>Archivo</th></tr></thead>
            <tbody>
              {documentos.map((d) => (
                <tr key={d.id}>
                  <td>{d.tipo === 'SOPORTE' ? (d.clase ?? 'Soporte') : `Factura · ${d.razonSocial ?? ''}`}</td>
                  <td><b>{d.numero}</b></td>
                  <td className="nowrap">{d.fecha}</td>
                  <td>{d.cliente ?? '—'}</td>
                  <td className="num">{usoDocs.get(d.id)?.n ?? 0}</td>
                  <td className="num">{fmt(usoDocs.get(d.id)?.ha ?? 0)}</td>
                  <td>{d.archivoPath ? <button type="button" className="af-link" onClick={() => void verArchivo(d)}>Abrir</button> : <span className="subtle-copy">sin archivo</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}

      {editando && session && (
        <EditarLineaFacturacion
          key={editando.id}
          a={editando}
          clienteAuto={clienteDeducido(editando, haciendasRA)}
          documentos={documentos}
          usuario={session.id}
          onCerrar={() => setEditandoId(null)}
          onGuardado={(c, msg) => lineaGuardada(editando.id, c, msg)}
          onNuevo={(tipo) => { setSelected(new Set([editando.id])); setEditandoId(null); setModal(tipo) }}
        />
      )}

      {modal && session && (
        <DocumentoFacturacionModal
          tipo={modal}
          modoInicial={modoModal}
          ids={seleccion.map((a) => a.id)}
          resumen={`${seleccion.length} línea(s) · ${fmt(haSel)} ha${hSel > 0 ? ` + ${fmt(hSel)} h` : ''}`}
          clienteSugerido={clienteSugerido}
          razonSugerida={razonSugerida}
          valorSugerido={modal === 'FACTURA' && sinTarifaSel === 0 ? Math.round(valorSel) : null}
          documentos={documentos}
          usuario={session.id}
          hoy={todayKey}
          onCerrar={() => setModal(null)}
          onListo={listo}
          haciendas={[...new Set(seleccion.map((a) => a.haciendaName))]}
        />
      )}
    </section>
  )
}

/**
 * Una línea de la tabla. Memorizada (2-oct-2026): con el realizado completo son
 * 400 filas en pantalla, y marcar UNA las redibujaba todas (más de un segundo
 * por clic). Ahora solo se redibuja la que cambió.
 */
const FilaFactura = memo(function FilaFactura({ a, sel, v, sop, fac, modalidades, colono, onPrecio, onErrorPrecio, onEditarFact, onFaltaModalidad, onToggle, onAbrir, onEdit }: {
  a: Assignment
  sel: boolean
  v?: Valoracion
  sop?: DocumentoFact
  fac?: DocumentoFact
  modalidades: MapaModalidades
  /** Colono con acuerdo de pago en esta hacienda (Cartera → 🤝 Acuerdos). */
  colono?: string
  onPrecio: (a: Assignment, precio: number | null) => Promise<void>
  onErrorPrecio: (m: string) => void
  onEditarFact: (a: Assignment) => void
  onFaltaModalidad: (a: Assignment) => void
  onToggle: (id: string) => void
  onAbrir: (d: DocumentoFact) => void
  onEdit?: (a: Assignment) => void
}) {
  const mod = modalidadEfectiva(a)
  const adic = pasesAdicionales(a)
  return (
    <tr className={sel ? 'factura-row--sel' : ''}>
      <td><input type="checkbox" checked={sel} onChange={() => onToggle(a.id)} aria-label="Marcar" /></td>
      <td className="nowrap">{executionDateKey(a)}</td>
      <td className="fact-doble fact-doble--corta" title={`${a.haciendaName} · suerte ${a.suerte}${colono ? ` · acuerdo de pago con ${colono}` : ''}`}>
        <b>{a.haciendaName}</b>
        <small>
          Suerte {a.suerte}{colono && <span className="fact-colono">🤝 {colono}</span>}
          {onEdit && (
            <button type="button" onClick={() => onEdit(a)} style={{ background: 'none', border: 'none', cursor: 'pointer', opacity: 0.5, marginLeft: 4, padding: 0 }} title="Editar la labor">✏️</button>
          )}
        </small>
      </td>
      <td className="fact-doble fact-doble--corta" title={a.labor}>
        <b>{a.labor}</b>
        <small>
          {mod
            ? <>{mod}{adic > 0 && <span className="factura-chip factura-chip--falta" title="El hectómetro incluye 2 pases: desde el 3.º es adicional"> +{adic} adicional</span>}</>
            : faltaModalidad(modalidades, a)
              ? <button type="button" className="factura-chip factura-chip--falta fact-atajo" onClick={() => onFaltaModalidad(a)} title="Toca para ponerle la modalidad">falta modalidad ✎</button>
              : '—'}
        </small>
      </td>
      <td className="fact-doble fact-doble--corta" title={`${a.operatorName || '—'} · ${a.equipmentName || a.equipmentCode || '—'}`}>
        <span>{a.operatorName || '—'}</span>
        <small>{a.equipmentName || a.equipmentCode || '—'}</small>
      </td>
      <td className="num"><strong>{haDe(a).toFixed(2)}</strong>{unidadDeLabor(a.labor) !== 'ha' && <small> {unidadDeLabor(a.labor)}</small>}</td>
      <td className="num"><CeldaPrecio a={a} v={v} facturada={facturada(a)} onPrecio={onPrecio} onError={onErrorPrecio} /></td>
      <td className="num"><CeldaValor v={v} /></td>
      <td>
        <button type="button" className={`fact-cliente${clienteForzado(a) ? ' is-manual' : ''}`} onClick={() => onEditarFact(a)}
                title={`${v?.cliente ?? 'Sin cliente'}. ${clienteForzado(a) ? 'Puesto a mano.' : 'Sale del ingenio de la suerte.'} Toca para cambiarlo.`}>
          {v?.cliente ? v.cliente.replace(/^Ingenio /, '') : '—'}
        </button>
      </td>
      <td className="nowrap">
        {sop ? <ChipDoc doc={sop} onAbrir={onAbrir} />
          : a.soporteId ? <span className="factura-chip">…</span>
          : <span className="subtle-copy">—</span>}
        <button type="button" className="fact-lapiz" onClick={() => onEditarFact(a)} title="Cambiar el soporte de esta línea" aria-label="Cambiar soporte">✏️</button>
      </td>
      <td className="nowrap">
        {fac ? <ChipDoc doc={fac} onAbrir={onAbrir} />
          : conFactura(a.facturaNumero) ? <span className="factura-chip" title="Número puesto antes de existir los documentos">{a.facturaNumero}</span>
          : <span className="subtle-copy">—</span>}
        <button type="button" className="fact-lapiz" onClick={() => onEditarFact(a)} title="Cambiar la factura de esta línea" aria-label="Cambiar factura">✏️</button>
      </td>
      <td className="nowrap">
        {facturada(a)
          ? <span className="factura-chip fact-estado--si">Facturado</span>
          : <span className="factura-chip fact-estado--no">Sin facturar</span>}
      </td>
    </tr>
  )
})

const conMiles = (n: number) => n.toLocaleString('es-CO', { maximumFractionDigits: 2 })
/** «85.000» o «85000» → 85000; «1.250,5» → 1250.5 (en Colombia el punto es de miles). */
const leerPesos = (t: string) => Number(t.replace(/[$\s]/g, '').replace(/\./g, '').replace(',', '.'))

/**
 * El precio por unidad de UNA línea, editable ahí mismo (18-oct-2026, pedido de
 * Iván: «que se pueda modificar desde cada casilla»). Al salir de la casilla o con
 * Enter se guarda como precio manual; borrarla quita el precio manual y la línea
 * vuelve a su tarifa; Esc deshace. Ya facturada SÍ se puede (20-oct-2026: la
 * FECE 1214 quedó con sus 5 acequias «sin tarifa» y no había cómo ponerles el
 * precio), pero pide confirmación: cambia el valor de la línea, no el de la factura.
 */
function CeldaPrecio({ a, v, facturada, onPrecio, onError }: {
  a: Assignment; v?: Valoracion; facturada: boolean
  onPrecio: (a: Assignment, precio: number | null) => Promise<void>; onError: (m: string) => void
}) {
  const actual = v?.precio ?? null
  const manual = /\[PRECIO_MANUAL:/i.test(a.notes ?? '')
  const unidad = v?.unidad ?? 'ha'
  // null = no se está editando: se muestra el precio vigente (así se pone al día solo).
  const [texto, setTexto] = useState<string | null>(null)
  const [estado, setEstado] = useState<'quieto' | 'guardando' | 'listo'>('quieto')
  const vigente = actual != null ? conMiles(actual) : ''
  useEffect(() => {
    if (estado !== 'listo') return
    const t = window.setTimeout(() => setEstado('quieto'), 1500)
    return () => window.clearTimeout(t)
  }, [estado])

  const deshacer = () => setTexto(null)
  async function confirmar() {
    if (texto == null) return   // no se tocó
    const limpio = texto.trim()
    let nuevo: number | null
    if (!limpio) {
      if (!manual) { deshacer(); return }   // vacía y sin precio manual: nada que quitar
      nuevo = null
    } else {
      const val = leerPesos(limpio)
      if (!Number.isFinite(val) || val <= 0) { deshacer(); onError('Escribe un precio mayor que cero (por ejemplo 85.000).'); return }
      if (actual != null && Math.abs(val - actual) < 0.005) { deshacer(); return }   // no cambió
      nuevo = val
    }
    if (facturada && !window.confirm(`Esta línea ya está facturada (${a.facturaNumero ?? 'factura'}). ¿Cambiar su precio? La factura no cambia: solo el valor de la línea.`)) { deshacer(); return }
    setEstado('guardando')
    try {
      await onPrecio(a, nuevo)
      setTexto(null)
      setEstado('listo')
    } catch (e) {
      setEstado('quieto'); deshacer()
      onError(`No se pudo guardar el precio de ${a.haciendaName} · ${a.suerte}. (${(e as Error).message})`)
    }
  }

  const de = manual ? 'Precio manual' : v?.valor != null ? [v.razonSocial, v.cliente, v.etiqueta].filter(Boolean).join(' · ') : 'Sin tarifa'
  return (
    <span className="fact-precio">
      <input
        className={`fact-precio__in${manual ? ' is-manual' : ''}${actual == null ? ' is-vacio' : ''}`}
        inputMode="decimal"
        value={texto ?? vigente}
        placeholder={`$/${unidad}`}
        aria-label={`Valor por ${unidad} de ${a.labor} en ${a.haciendaName} · ${a.suerte}`}
        title={`${de}. Escribe otro valor y presiona Enter; bórralo para volver a la tarifa.`}
        disabled={estado === 'guardando'}
        onChange={(e) => setTexto(e.target.value)}
        onFocus={(e) => { setTexto(vigente); e.currentTarget.select() }}
        onBlur={() => void confirmar()}
        onKeyDown={(e) => {
          const el = e.currentTarget
          if (e.key === 'Enter') el.blur()
          if (e.key === 'Escape') { deshacer(); setTimeout(() => el.blur(), 0) }
        }}
      />
      {unidad !== 'ha' && <small>/{unidad}</small>}
      {estado === 'listo' && <span className="fact-precio__ok" aria-label="Guardado">✓</span>}
    </span>
  )
}

/** Valor de la línea; sin tarifa sale marcado (nunca $0 escondido). Al pasar el dedo, de dónde salió. */
function CeldaValor({ v }: { v?: Valoracion }) {
  if (!v) return <span className="subtle-copy">—</span>
  if (v.valor == null) {
    return (
      <button type="button" className="factura-chip factura-chip--falta fact-atajo" title={`${v.nota ?? 'Sin tarifa'}. Toca para escribirle el precio.`}
        onClick={(e) => (e.currentTarget.closest('tr')?.querySelector('.fact-precio__in') as HTMLInputElement | null)?.focus()}>
        sin tarifa ✎
      </button>
    )
  }
  const de = [v.razonSocial, v.cliente, v.etiqueta, `${pesosCortos(v.precio ?? 0)}/${v.unidad}`].filter(Boolean).join(' · ')
  return (
    <span className="nowrap" title={v.nota ? `${de} — ${v.nota}` : de}>
      {pesosCortos(v.valor)}{v.nota && <small className="fact-supuesto"> *</small>}
    </span>
  )
}

/** El número del documento; si tiene archivo, tocándolo se abre. */
function ChipDoc({ doc, onAbrir }: { doc: DocumentoFact; onAbrir: (d: DocumentoFact) => void }) {
  const titulo = [doc.clase ?? doc.razonSocial, doc.numero, doc.fecha, doc.archivoPath ? 'tocar para abrir' : 'sin archivo'].filter(Boolean).join(' · ')
  return doc.archivoPath
    ? <button type="button" className="factura-chip factura-chip--doc" title={titulo} onClick={() => onAbrir(doc)}>📄 {doc.numero}</button>
    : <span className="factura-chip" title={titulo}>{doc.numero}</span>
}

export default FacturacionTab
