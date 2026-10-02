import { memo, useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react'
import { esPorHoras, unidadDeLabor } from '../lib/texto'
import { useAppData } from '../context/AppDataContext'
import { executionDateKey, setModalidadBulk } from '../services/samApi'
import { faltaModalidad, laborFacturable, modalidadEfectiva, modalidadesDe, modalidadSugerida, pasesAdicionales, useModalidades, type MapaModalidades } from '../lib/modalidad'
import {
  RAZONES_SOCIALES, abrirArchivo, desvincularDocumento, loadDocumentos,
  type DocumentoFact, type TipoDocumento,
} from '../services/facturacionApi'
import { DocumentoFacturacionModal } from '../components/DocumentoFacturacionModal'
import { pesosCortos, useTarifas, valorarLinea, type Valoracion } from '../lib/tarifas'
import { ingenioNombre } from '../data/ingenios'
import {
  matchesSummaryFilter,
  buildMonthOptions,
  type SummaryQuincena,
} from '../components/EntityHistoryModal'
import { Ayuda } from '../components/Ayuda'
import type { Assignment } from '../domain/sam'

/**
 * Facturación (administración/owner) — parte del REALIZADO completo (labores
 * COMPLETADA/PARCIAL) y lo lleva por tres etapas (2-oct-2026):
 *   SIN SOPORTE → CON SOPORTE del cliente → FACTURADAS
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

type Etapa = 'SIN_SOPORTE' | 'CON_SOPORTE' | 'FACTURADAS' | 'TODAS'
const facturada = (a: Assignment) => !!a.facturaId || conFactura(a.facturaNumero)
const etapaDe = (a: Assignment): Exclude<Etapa, 'TODAS'> => (facturada(a) ? 'FACTURADAS' : a.soporteId ? 'CON_SOPORTE' : 'SIN_SOPORTE')
const ETAPAS: { id: Etapa; titulo: string }[] = [
  { id: 'SIN_SOPORTE', titulo: 'Sin soporte' },
  { id: 'CON_SOPORTE', titulo: 'Con soporte' },
  { id: 'FACTURADAS', titulo: 'Facturadas' },
  { id: 'TODAS', titulo: 'Todas' },
]

export function FacturacionTab() {
  const { assignments, setAssignments, session, todayKey, busy, setBusy, setError, setInfo } = useAppData()

  const [search, setSearch] = useState('')
  const [etapa, setEtapa] = useState<Etapa>('SIN_SOPORTE')
  // De entrada TODO el realizado (pedido de Iván); se puede acotar a un mes o quincena.
  const [mes, setMes] = useState('')
  const [quincena, setQuincena] = useState<SummaryQuincena>('TODO')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const modalidades = useModalidades()
  const [soloSinModalidad, setSoloSinModalidad] = useState(false)
  const [modalidadInput, setModalidadInput] = useState('')
  const [documentos, setDocumentos] = useState<DocumentoFact[]>([])
  const [modal, setModal] = useState<TipoDocumento | null>(null)
  // Valor a facturar de cada línea: cantidad × tarifa (ver `lib/tarifas`).
  const { tarifas, haciendasRA } = useTarifas()
  const [soloSinTarifa, setSoloSinTarifa] = useState(false)
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

  // El realizado del período y la búsqueda (sin filtrar todavía por etapa). La
  // búsqueda va diferida: el texto se escribe sin esperar a la tabla.
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
      .filter((a) => !soloSinModalidad || faltaModalidad(modalidades, a))
  }, [realizado, busqueda, mes, quincena, todayKey, docPorId, soloSinModalidad, modalidades])
  const sinTarifa = useMemo(() => delPeriodo.filter((a) => valores.get(a.id)?.valor == null).length, [delPeriodo, valores])

  const sinModalidad = useMemo(() => delPeriodo.filter((a) => faltaModalidad(modalidades, a)).length, [delPeriodo, modalidades])
  const realizadas = (etapa === 'TODAS' ? delPeriodo : delPeriodo.filter((a) => etapaDe(a) === etapa))
    .filter((a) => !soloSinTarifa || valores.get(a.id)?.valor == null)
  const shown = realizadas.slice(0, LIMIT)
  const overLimit = realizadas.length > LIMIT

  // 🔴 Las HORAS de servicio se facturan, pero no son hectáreas: van en su propia
  // cuenta. (Los hectómetros siguen sumando con las hectáreas, como en el resto.)
  const suma = (lista: Assignment[], horas: boolean) =>
    lista.filter((a) => esPorHoras(a.labor) === horas).reduce((s, a) => s + haDe(a), 0)
  const porEtapa = useMemo(() => {
    const out: Record<Etapa, { n: number; ha: number; h: number; valor: number }> = {
      SIN_SOPORTE: { n: 0, ha: 0, h: 0, valor: 0 }, CON_SOPORTE: { n: 0, ha: 0, h: 0, valor: 0 },
      FACTURADAS: { n: 0, ha: 0, h: 0, valor: 0 }, TODAS: { n: 0, ha: 0, h: 0, valor: 0 },
    }
    for (const a of delPeriodo) {
      for (const k of [etapaDe(a), 'TODAS'] as Etapa[]) {
        out[k].n += 1
        out[k].valor += valores.get(a.id)?.valor ?? 0
        if (esPorHoras(a.labor)) out[k].h += haDe(a)
        else out[k].ha += haDe(a)
      }
    }
    return out
  }, [delPeriodo, valores])

  const seleccion = shown.filter((a) => selected.has(a.id))
  const haSel = suma(seleccion, false)
  const hSel = suma(seleccion, true)
  const valorSel = seleccion.reduce((s, a) => s + (valores.get(a.id)?.valor ?? 0), 0)
  const sinTarifaSel = seleccion.filter((a) => valores.get(a.id)?.valor == null).length

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

  function listo(doc: DocumentoFact, vinculadas: number) {
    const ids = new Set(seleccion.map((a) => a.id))
    setAssignments((prev) => prev.map((a) => {
      if (!ids.has(a.id)) return a
      return doc.tipo === 'SOPORTE' ? { ...a, soporteId: doc.id } : { ...a, facturaId: doc.id, facturaNumero: doc.numero }
    }))
    setDocumentos((prev) => (prev.some((d) => d.id === doc.id) ? prev : [doc, ...prev]))
    setInfo(`${doc.tipo === 'SOPORTE' ? 'Soporte' : 'Factura'} ${doc.numero} vinculado a ${vinculadas} labor(es).`)
    setModal(null)
    setSelected(new Set())
  }

  async function quitar(tipo: TipoDocumento) {
    if (!session) return
    const ids = seleccion.filter((a) => (tipo === 'SOPORTE' ? !!a.soporteId : facturada(a))).map((a) => a.id)
    if (ids.length === 0) return
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
  const modalidadLote = modalidadInput || (laboresSel.length === 1 ? modalidadSugerida(modalidades, laboresSel[0]) ?? '' : '')

  async function ponerModalidad() {
    const ids = seleccion.map((a) => a.id)
    if (ids.length === 0 || !modalidadLote) return
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
        <p><b>Facturar por</b>: escoge la empresa (AGROMORALES o CEBALLOS Y LOZANO) y cada línea toma el precio de la tabla de esa empresa; si esa empresa no tiene precio para ese cliente, la línea sale «sin tarifa». Las líneas ya facturadas usan la empresa de su factura.</p>
        <p>Todo lo realizado pasa por tres etapas: <b>sin soporte</b> → <b>con soporte</b> del cliente (orden de servicio, acta, certificación…) → <b>facturadas</b>.</p>
        <p>Marca las líneas y usa <b>📎 Vincular soporte</b> o <b>🧾 Vincular factura</b>: escoges uno que ya exista o creas uno nuevo con su número, fecha y archivo (PDF o foto). Toca el número de un documento para abrir su archivo.</p>
        <p>La <b>modalidad</b> (2x1, 4x1 quemada, 2 pases…) define la tarifa. Si una labor la necesita y no la tiene, sale «falta»: márcalas (de la misma labor) y ponles la modalidad en lote.</p>
      </Ayuda>

      {/* Etapas: cuánto hay en cada una */}
      <div className="fact-etapas">
        {ETAPAS.map((e) => (
          <button key={e.id} type="button" className={`fact-etapa${etapa === e.id ? ' is-active' : ''}`}
            onClick={() => { setEtapa(e.id); setSelected(new Set()) }}>
            <span>{e.titulo}</span>
            <b>{porEtapa[e.id].n}</b>
            <small>{fmt(porEtapa[e.id].ha)} ha{porEtapa[e.id].h > 0 ? ` + ${fmt(porEtapa[e.id].h)} h` : ''}</small>
            <small><b>{pesosCortos(porEtapa[e.id].valor)}</b></small>
          </button>
        ))}
      </div>

      {/* Filtros */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', margin: '10px 0' }}>
        <label className="fact-empresa">
          <span>Facturar por</span>
          <select id="fact-empresa" value={empresa} onChange={(e) => cambiarEmpresa(e.target.value)} className="base-input" style={{ width: 'auto' }}>
            <option value="">Automático (según la tabla)</option>
            {RAZONES_SOCIALES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>
        <select id="fact-mes" value={mes} onChange={(e) => setMes(e.target.value)} className="base-input" style={{ width: 'auto' }}>
          <option value="">Todo el realizado</option>
          {monthOptions.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>
        {mes && (
          <select id="fact-quincena" value={quincena} onChange={(e) => setQuincena(e.target.value as SummaryQuincena)} className="base-input" style={{ width: 'auto' }}>
            <option value="TODO">Todo el mes</option>
            <option value="PRIMERA">1ra quincena</option>
            <option value="SEGUNDA">2da quincena</option>
          </select>
        )}
        <button
          type="button"
          className={`inline-button${soloSinModalidad ? ' is-active' : ''}`}
          onClick={() => { setSoloSinModalidad((v) => !v); setSelected(new Set()) }}
          title="Solo las labores que necesitan modalidad y no la tienen"
        >
          {soloSinModalidad ? '✓ ' : ''}Sin modalidad ({sinModalidad})
        </button>
        <button
          type="button"
          className={`inline-button${soloSinTarifa ? ' is-active' : ''}`}
          onClick={() => { setSoloSinTarifa((v) => !v); setSelected(new Set()) }}
          title="Labores a las que no se les encontró precio"
        >
          {soloSinTarifa ? '✓ ' : ''}Sin tarifa ({sinTarifa})
        </button>
      </div>

      <input
        className="user-search-input"
        type="search"
        placeholder="Buscar hacienda, suerte, labor, operario, soporte o factura…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{ marginBottom: 10 }}
      />

      {/* Barra de acciones en lote */}
      {selected.size > 0 && (
        <div className="factura-bulk-bar">
          <span><strong>{selected.size}</strong> seleccionada(s) · {fmt(haSel)} ha{hSel > 0 ? ` + ${fmt(hSel)} h` : ''} · <strong>{pesosCortos(valorSel)}</strong>{sinTarifaSel > 0 ? ` (${sinTarifaSel} sin tarifa)` : ''}</span>
          <button type="button" className="primary-button" onClick={() => setModal('SOPORTE')} disabled={busy}>📎 Vincular soporte</button>
          <button type="button" className="primary-button" onClick={() => setModal('FACTURA')} disabled={busy}>🧾 Vincular factura</button>
          {seleccion.some((a) => a.soporteId) && (
            <button type="button" className="inline-button" onClick={() => void quitar('SOPORTE')} disabled={busy}>Quitar soporte</button>
          )}
          {seleccion.some(facturada) && (
            <button type="button" className="inline-button" onClick={() => void quitar('FACTURA')} disabled={busy}>Quitar factura</button>
          )}
          {opcionesModalidad.length > 0 && (
            <>
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
            </>
          )}
          {laboresSel.length > 1 && <span className="subtle-copy">Para la modalidad, marca una sola labor.</span>}
        </div>
      )}

      <div className="table-wrap validacion-table-wrap">
        <table className="validacion-table">
          <thead>
            <tr>
              <th style={{ width: 32 }}><input type="checkbox" checked={allChecked} onChange={toggleAll} aria-label="Marcar todas" /></th>
              <th>Fecha</th>
              <th>Hacienda · Suerte</th>
              <th>Labor</th>
              <th>Modalidad</th>
              <th>Operario</th>
              <th className="num">Cant.</th>
              <th className="num">Valor</th>
              <th>Soporte</th>
              <th>Factura</th>
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
                onToggle={toggle}
                onAbrir={verArchivo}
              />
            ))}
            {shown.length === 0 && (
              <tr><td colSpan={10} className="validacion-empty">
                {search.trim() ? 'Sin coincidencias.' : 'No hay labores en esta etapa.'}
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

      {modal && session && (
        <DocumentoFacturacionModal
          tipo={modal}
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
const FilaFactura = memo(function FilaFactura({ a, sel, v, sop, fac, modalidades, onToggle, onAbrir }: {
  a: Assignment
  sel: boolean
  v?: Valoracion
  sop?: DocumentoFact
  fac?: DocumentoFact
  modalidades: MapaModalidades
  onToggle: (id: string) => void
  onAbrir: (d: DocumentoFact) => void
}) {
  const mod = modalidadEfectiva(a)
  const adic = pasesAdicionales(a)
  return (
    <tr className={sel ? 'factura-row--sel' : ''}>
      <td><input type="checkbox" checked={sel} onChange={() => onToggle(a.id)} aria-label="Marcar" /></td>
      <td className="nowrap">{executionDateKey(a)}</td>
      <td>{a.haciendaName} · {a.suerte}</td>
      <td>{a.labor}</td>
      <td>
        {mod
          ? <span className="nowrap">{mod}{adic > 0 && <span className="factura-chip factura-chip--falta" title="El hectómetro incluye 2 pases: desde el 3.º es adicional"> +{adic} adicional</span>}</span>
          : faltaModalidad(modalidades, a)
            ? <span className="factura-chip factura-chip--falta">falta</span>
            : <span className="subtle-copy">—</span>}
      </td>
      <td>{a.operatorName || '—'}</td>
      <td className="num"><strong>{haDe(a).toFixed(2)}</strong>{unidadDeLabor(a.labor) !== 'ha' && <small> {unidadDeLabor(a.labor)}</small>}</td>
      <td className="num"><CeldaValor v={v} /></td>
      <td>
        {sop ? <ChipDoc doc={sop} onAbrir={onAbrir} />
          : a.soporteId ? <span className="factura-chip">…</span>
          : <span className="subtle-copy">—</span>}
      </td>
      <td>
        {fac ? <ChipDoc doc={fac} onAbrir={onAbrir} />
          : conFactura(a.facturaNumero) ? <span className="factura-chip" title="Número puesto antes de existir los documentos">{a.facturaNumero}</span>
          : <span className="subtle-copy">—</span>}
      </td>
    </tr>
  )
})

/** Valor de la línea; sin tarifa sale marcado (nunca $0 escondido). Al pasar el dedo, de dónde salió. */
function CeldaValor({ v }: { v?: Valoracion }) {
  if (!v) return <span className="subtle-copy">—</span>
  if (v.valor == null) return <span className="factura-chip factura-chip--falta" title={v.nota ?? ''}>sin tarifa</span>
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
