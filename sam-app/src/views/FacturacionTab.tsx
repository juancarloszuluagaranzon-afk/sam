import { useMemo, useState } from 'react'
import { useAppData } from '../context/AppDataContext'
import { executionDateKey, setFacturaBulk } from '../services/samApi'
import {
  matchesSummaryFilter,
  buildMonthOptions,
  currentQuincena,
  type SummaryQuincena,
} from '../components/EntityHistoryModal'
import { Ayuda } from '../components/Ayuda'

/**
 * Facturación (administración/owner): lista las labores REALIZADAS
 * (COMPLETADA/PARCIAL) y permite asignarles un N° de factura, individual o
 * EN LOTE (marcar varias → un solo número). Alimenta el KPI "Área facturada".
 */
const LIMIT = 400
const conFactura = (n?: string | null) => !!(n && n.trim())
// Misma fórmula de "ha ejecutada" que Resumen/Reporte/KPIs.
const haDe = (a: { executedArea: number; area: number }) => (a.executedArea > 0 ? a.executedArea : a.area)

export function FacturacionTab() {
  const { assignments, setAssignments, session, todayKey, busy, setBusy, setError, setInfo } = useAppData()

  const [search, setSearch] = useState('')
  const [seg, setSeg] = useState<'SIN' | 'CON' | 'TODAS'>('SIN')
  const [mes, setMes] = useState(() => todayKey.slice(0, 7))
  const [quincena, setQuincena] = useState<SummaryQuincena>(() => currentQuincena(todayKey))
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [facturaInput, setFacturaInput] = useState('')

  const monthOptions = useMemo(() => buildMonthOptions(todayKey.slice(0, 7)), [todayKey])

  const realizadas = useMemo(() => {
    const q = search.trim().toLowerCase()
    return assignments
      .filter((a) => (a.status === 'COMPLETADA' || a.status === 'PARCIAL') && a.executedArea > 0)
      .filter((a) => matchesSummaryFilter(executionDateKey(a), mes, quincena, todayKey))
      .filter((a) => (seg === 'TODAS' ? true : seg === 'CON' ? conFactura(a.facturaNumero) : !conFactura(a.facturaNumero)))
      .filter((a) => !q || `${a.haciendaName} ${a.suerte} ${a.labor} ${a.operatorName} ${a.facturaNumero ?? ''}`.toLowerCase().includes(q))
      .sort((a, b) => executionDateKey(b).localeCompare(executionDateKey(a)))
  }, [assignments, search, seg, mes, quincena, todayKey])

  const shown = realizadas.slice(0, LIMIT)
  const overLimit = realizadas.length > LIMIT

  const haFacturada = realizadas.filter((a) => conFactura(a.facturaNumero)).reduce((s, a) => s + haDe(a), 0)
  const haSinFacturar = realizadas.filter((a) => !conFactura(a.facturaNumero)).reduce((s, a) => s + haDe(a), 0)
  const haSel = shown.filter((a) => selected.has(a.id)).reduce((s, a) => s + haDe(a), 0)

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  function toggleAll() {
    setSelected((prev) => (shown.every((a) => prev.has(a.id)) ? new Set() : new Set(shown.map((a) => a.id))))
  }

  async function asignar(desfacturar: boolean) {
    const ids = [...selected].filter((id) => shown.some((a) => a.id === id))
    if (ids.length === 0) {
      setError('Selecciona al menos una labor.')
      return
    }
    const num = desfacturar ? null : facturaInput.trim()
    if (!desfacturar && !num) {
      setError('Escribe el N° de factura (o usa "Desfacturar").')
      return
    }
    setBusy(true)
    setError('')
    try {
      await setFacturaBulk(ids, num, session?.id)
      const set = new Set(ids)
      setAssignments((prev) => prev.map((a) => (set.has(a.id) ? { ...a, facturaNumero: num } : a)))
      setInfo(
        num
          ? `Factura ${num} asignada a ${ids.length} labor(es).`
          : `${ids.length} labor(es) desfacturada(s).`,
      )
      setSelected(new Set())
      setFacturaInput('')
    } catch (err) {
      const e = err as { message?: string }
      setError(`No se pudo asignar la factura. (${e?.message ?? 'error'})`)
    } finally {
      setBusy(false)
    }
  }

  const allChecked = shown.length > 0 && shown.every((a) => selected.has(a.id))

  return (
    <section className="panel-card">
      <div className="panel-title split">
        <h2>Facturación</h2>
        <span className="subtle-copy">
          Sin facturar: <strong>{haSinFacturar.toFixed(2)} ha</strong> · Facturada: <strong>{haFacturada.toFixed(2)} ha</strong>
        </span>
      </div>
      <Ayuda>
        <p>Labores realizadas del período. Marca varias y asígnales un N° de factura de una sola vez.</p>
      </Ayuda>

      {/* Filtros */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
        <select value={mes} onChange={(e) => setMes(e.target.value)} className="base-input" style={{ width: 'auto' }}>
          {monthOptions.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>
        <select value={quincena} onChange={(e) => setQuincena(e.target.value as SummaryQuincena)} className="base-input" style={{ width: 'auto' }}>
          <option value="TODO">Todo el mes</option>
          <option value="PRIMERA">1ra quincena</option>
          <option value="SEGUNDA">2da quincena</option>
        </select>
      </div>

      <div className="realizadas-seg" style={{ marginBottom: 10 }}>
        {(['SIN', 'CON', 'TODAS'] as const).map((s) => (
          <button key={s} type="button" className={seg === s ? 'is-active' : ''} onClick={() => { setSeg(s); setSelected(new Set()) }}>
            {s === 'SIN' ? 'Sin facturar' : s === 'CON' ? 'Facturadas' : 'Todas'}
          </button>
        ))}
      </div>

      <input
        className="user-search-input"
        type="search"
        placeholder="Buscar hacienda, suerte, labor, operario o factura…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{ marginBottom: 10 }}
      />

      {/* Barra de asignación en lote */}
      {selected.size > 0 && (
        <div className="factura-bulk-bar">
          <span><strong>{selected.size}</strong> seleccionada(s) · {haSel.toFixed(2)} ha</span>
          <input
            type="text"
            value={facturaInput}
            onChange={(e) => setFacturaInput(e.target.value)}
            placeholder="N° de factura"
            disabled={busy}
          />
          <button type="button" className="primary-button" onClick={() => void asignar(false)} disabled={busy}>
            {busy ? '...' : 'Asignar factura'}
          </button>
          <button type="button" className="inline-button" onClick={() => void asignar(true)} disabled={busy}>
            Desfacturar
          </button>
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
              <th>Operario</th>
              <th className="num">Ha ejec.</th>
              <th>Factura</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((a) => (
              <tr key={a.id} className={selected.has(a.id) ? 'factura-row--sel' : ''}>
                <td><input type="checkbox" checked={selected.has(a.id)} onChange={() => toggle(a.id)} aria-label="Marcar" /></td>
                <td className="nowrap">{executionDateKey(a)}</td>
                <td>{a.haciendaName} · {a.suerte}</td>
                <td>{a.labor}</td>
                <td>{a.operatorName || '—'}</td>
                <td className="num"><strong>{haDe(a).toFixed(2)}</strong></td>
                <td>
                  {conFactura(a.facturaNumero)
                    ? <span className="factura-chip">{a.facturaNumero}</span>
                    : <span className="subtle-copy">—</span>}
                </td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr><td colSpan={7} className="validacion-empty">
                {search.trim() ? 'Sin coincidencias.' : seg === 'SIN' ? 'No hay labores sin facturar en el período.' : 'Sin labores en el período.'}
              </td></tr>
            )}
          </tbody>
        </table>
        {overLimit && (
          <p className="field-hint" style={{ padding: '8px 12px' }}>
            Mostrando las primeras {LIMIT} de {realizadas.length}. Refina el período o la búsqueda.
          </p>
        )}
      </div>
    </section>
  )
}

export default FacturacionTab
