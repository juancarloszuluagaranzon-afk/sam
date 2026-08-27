import { unidadDeLabor } from '../lib/texto'
import { useEffect, useMemo, useState } from 'react'
import { useAppData } from '../context/AppDataContext'
import { db } from '../lib/db'
import type { Assignment } from '../domain/sam'
import { deleteAssignment, formatTime } from '../services/samApi'
import { avanceCerradoPorSuerte, areaDelDia, cuentaEnPlanilla } from '../lib/planilla'
import {
  executionDateKey,
  loadPlanillaRevisiones,
  setPlanillaRevision,
  clearAllPlanillaRevisiones,
  loadOperarioNovedades,
  setOperarioNovedades,
  clearOperarioNovedades,
  NOVEDAD_TIPOS,
  NOVEDAD_LABEL,
  novLetter,
  type NovedadTipo,
  type HighlightColor,
} from '../services/samApi'

// Colores de resaltado (tonos pastel). El picker los muestra como swatches.
const HIGHLIGHT_COLORS: { value: HighlightColor; label: string }[] = [
  { value: 'azul', label: 'Azul' },
  { value: 'verde', label: 'Verde' },
  { value: 'amarillo', label: 'Amarillo' },
  { value: 'rojo', label: 'Rojo' },
]

// Lista de fechas 'YYYY-MM-DD' entre desde y hasta (inclusive). Guard 400 días.
function datesInRange(desde: string, hasta: string): string[] {
  if (!desde || !hasta || desde > hasta) return []
  const [y1, m1, d1] = desde.split('-').map(Number)
  const [y2, m2, d2] = hasta.split('-').map(Number)
  const out: string[] = []
  let cur = new Date(y1, m1 - 1, d1)
  const end = new Date(y2, m2 - 1, d2)
  let guard = 0
  while (cur <= end && guard < 400) {
    out.push(
      `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`,
    )
    cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 1)
    guard++
  }
  return out
}
import {
  matchesSummaryFilter,
  buildMonthOptions,
  currentQuincena,
  type SummaryQuincena,
} from '../components/EntityHistoryModal'

// Planilla quincenal: filas = operarios (orden alfabetico por nombre),
// columnas = cada dia de la quincena. La celda suma el AREA REAL ejecutada por
// dia: para labores CERRADAS (PARCIAL/COMPLETADA) su executedArea (lo hecho esa
// sesion, atribuido por executionDateKey = finishedAt); para EN_PROCESO el
// RESTANTE estimado (area - lo ya cerrado en la misma suerte+labor del ciclo),
// asi una labor que cruza de dia NO se cuenta dos veces. Antes sumaba el area
// PLANIFICADA al abrir, lo que duplicaba los cruces de dia (13.3+13.3=26.7).

// 🔴 La regla de area vive en `lib/planilla.ts`, no aqui: la comparte con la
// linea que ve cada operario en su pantalla. Tener dos copias de un criterio de
// dinero fue lo que dejo 89,91 ha por fuera de la quincena en agosto.

const WEEKDAY = ['D', 'L', 'M', 'M', 'J', 'V', 'S']

function fmt(value: number) {
  return value > 0 ? value.toFixed(2) : ''
}

export function PlanillaTab({ onEditLabor }: { onEditLabor?: (a: Assignment) => void } = {}) {
  const { assignments, setAssignments, operators, todayKey, session, setError, setInfo , novedadTipos } = useAppData()

  /**
   * Los códigos de novedad, del catálogo que maneja administración.
   *
   * ⚠️ Cae a la lista fija de `samApi` si el catálogo no cargó. La planilla es
   * la base de la nómina: una tabla nueva que no responda no puede dejar a
   * nadie sin poder marcar un día.
   */
  const novCat = useMemo(() => {
    if (novedadTipos.length) return novedadTipos.filter((n) => n.activo)
    return NOVEDAD_TIPOS.map((c) => ({
      codigo: c as string, nombre: NOVEDAD_LABEL[c], color: '#4a5040',
      orden: 0, activo: true, delSistema: true,
    }))
  }, [novedadTipos])

  /** Todos, incluidos los inactivos: el histórico necesita poder nombrarlos. */
  const novPorCodigo = useMemo(() => {
    const m2 = new Map<string, { nombre: string; color: string }>()
    for (const c of NOVEDAD_TIPOS) m2.set(c, { nombre: NOVEDAD_LABEL[c], color: '#4a5040' })
    for (const n of novedadTipos) m2.set(n.codigo, { nombre: n.nombre, color: n.color })
    return m2
  }, [novedadTipos])

  const [planillaMonth, setPlanillaMonth] = useState(() => todayKey.slice(0, 7))
  const [planillaQuincena, setPlanillaQuincena] = useState<SummaryQuincena>(() =>
    currentQuincena(todayKey),
  )
  const [search, setSearch] = useState('')
  const [exporting, setExporting] = useState(false)

  // Resaltado de casillas por color (azul/rojo/amarillo/verde), persistido en BD.
  // Clave: `${operadorKey}|${fecha}` → color. `markMode` activa el clic-para-pintar
  // con el color `markColor` seleccionado.
  const [revisadas, setRevisadas] = useState<Map<string, HighlightColor>>(new Map())
  const [markMode, setMarkMode] = useState(false)
  const [markColor, setMarkColor] = useState<HighlightColor>('azul')
  const [detailOpen, setDetailOpen] = useState(false)
  const [confirmClearAll, setConfirmClearAll] = useState(false)

  // Operarios OCULTOS de la planilla (el usuario decide cuáles ver). Se guarda
  // por dispositivo en localStorage; por defecto no hay ninguno oculto (ver todos).
  const HIDDEN_KEY = 'planilla-operarios-ocultos'
  const [hiddenOps, setHiddenOps] = useState<Set<string>>(() => {
    try {
      const raw = window.localStorage.getItem(HIDDEN_KEY)
      return raw ? new Set<string>(JSON.parse(raw)) : new Set<string>()
    } catch {
      return new Set<string>()
    }
  })
  const [opsPanelOpen, setOpsPanelOpen] = useState(false)
  const [opsSearch, setOpsSearch] = useState('')

  function persistHidden(next: Set<string>) {
    try {
      window.localStorage.setItem(HIDDEN_KEY, JSON.stringify(Array.from(next)))
    } catch {
      // sin localStorage: queda solo en memoria de la sesión
    }
  }
  function toggleHidden(id: string) {
    setHiddenOps((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      persistHidden(next)
      return next
    })
  }
  function setAllVisible(visible: boolean) {
    const next = visible ? new Set<string>() : new Set(operators.map((o) => o.id))
    persistHidden(next)
    setHiddenOps(next)
  }

  // Novedades de operario (V/T/NP/D/P/C). Clave `${operadorId}|${fecha}`.
  const [novedades, setNovedades] = useState<Map<string, NovedadTipo>>(new Map())

  // Reportar/quitar novedad desde la Planilla (al oprimir el nombre del operario).
  const [novTarget, setNovTarget] = useState<{ key: string; name: string } | null>(null)
  const [novTipo, setNovTipo] = useState<NovedadTipo | 'CLEAR'>('V')
  const [novDesde, setNovDesde] = useState('')
  const [novHasta, setNovHasta] = useState('')
  const [savingNov, setSavingNov] = useState(false)

  function openNovedad(key: string, name: string, day?: string) {
    setNovTarget({ key, name })
    // Al abrir desde una casilla vacía la intención típica es marcar la falta.
    setNovTipo(day ? 'F' : 'V')
    setNovDesde(day ?? todayKey)
    setNovHasta(day ?? todayKey)
    setError('')
  }

  async function applyNovedad() {
    if (!novTarget) return
    const fechas = datesInRange(novDesde, novHasta)
    if (fechas.length === 0) {
      setError('Selecciona una fecha de inicio y fin válidas.')
      return
    }
    setSavingNov(true)
    setError('')
    try {
      if (novTipo === 'CLEAR') {
        await clearOperarioNovedades(novTarget.key, fechas)
        setNovedades((prev) => {
          const next = new Map(prev)
          for (const f of fechas) next.delete(`${novTarget.key}|${f}`)
          return next
        })
        setInfo(`Novedad quitada a ${novTarget.name}.`)
      } else {
        await setOperarioNovedades(novTarget.key, fechas, novTipo)
        setNovedades((prev) => {
          const next = new Map(prev)
          for (const f of fechas) next.set(`${novTarget.key}|${f}`, novTipo)
          return next
        })
        setInfo(`${novPorCodigo.get(novTipo)?.nombre ?? novTipo} registrado a ${novTarget.name}.`)
      }
      setNovTarget(null)
    } catch {
      setError('No se pudo guardar la novedad. Revisa la conexión.')
    } finally {
      setSavingNov(false)
    }
  }

  useEffect(() => {
    let alive = true
    void loadOperarioNovedades().then((rows) => {
      if (alive) setNovedades(new Map(rows.map((r) => [`${r.operadorId}|${r.fecha}`, r.tipo])))
    })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    let alive = true
    void loadPlanillaRevisiones().then((rows) => {
      if (alive) setRevisadas(new Map(rows.map((r) => [`${r.operadorId}|${r.fecha}`, r.color])))
    })
    return () => {
      alive = false
    }
  }, [])

  async function toggleRevision(operadorKey: string, fecha: string) {
    const cellKey = `${operadorKey}|${fecha}`
    const actual = revisadas.get(cellKey)
    // Mismo color → lo quita; distinto/ninguno → lo pinta con el color activo.
    const next: HighlightColor | null = actual === markColor ? null : markColor
    const prevColor = actual
    setRevisadas((prev) => {
      const m = new Map(prev)
      if (next) m.set(cellKey, next)
      else m.delete(cellKey)
      return m
    })
    try {
      await setPlanillaRevision(operadorKey, fecha, next, session?.id)
    } catch {
      setRevisadas((prev) => {
        const m = new Map(prev)
        if (prevColor) m.set(cellKey, prevColor)
        else m.delete(cellKey)
        return m
      })
      setError('No se pudo guardar el resaltado. Revisa la conexión.')
    }
  }

  // Nombre del operario y área abierta por celda (operadorKey|fecha), sobre TODAS
  // las asignaciones (las marcas abarcan cualquier periodo, no solo el visible).
  const nameByKey = useMemo(() => {
    const m = new Map<string, string>()
    for (const a of assignments) {
      const opKey = a.operatorId || a.operatorName || 'Sin operador'
      if (!m.has(opKey)) m.set(opKey, a.operatorName || opKey)
    }
    return m
  }, [assignments])

  const areaByCell = useMemo(() => {
    const m = new Map<string, number>()
    for (const a of assignments) {
      if (a.status !== 'EN_PROCESO' && a.status !== 'PARCIAL' && a.status !== 'COMPLETADA') continue
      const opKey = a.operatorId || a.operatorName || 'Sin operador'
      const k = `${opKey}|${executionDateKey(a)}`
      m.set(k, (m.get(k) ?? 0) + a.area)
    }
    return m
  }, [assignments])

  // Detalle ordenado (operario alfabético, luego fecha) de las casillas resaltadas.
  const revisadasList = useMemo(() => {
    return Array.from(revisadas.entries())
      .map(([key, color]) => {
        const [opKey, fecha] = key.split('|')
        return {
          key,
          opKey,
          fecha,
          color,
          name: nameByKey.get(opKey) ?? opKey,
          area: areaByCell.get(key) ?? 0,
        }
      })
      .sort((a, b) => {
        const n = a.name.localeCompare(b.name, 'es', { sensitivity: 'base' })
        return n !== 0 ? n : b.fecha.localeCompare(a.fecha)
      })
  }, [revisadas, nameByKey, areaByCell])

  async function clearOne(opKey: string, fecha: string) {
    const cellKey = `${opKey}|${fecha}`
    const prevColor = revisadas.get(cellKey)
    setRevisadas((prev) => {
      const next = new Map(prev)
      next.delete(cellKey)
      return next
    })
    try {
      await setPlanillaRevision(opKey, fecha, null, session?.id)
    } catch {
      setRevisadas((prev) => {
        const next = new Map(prev)
        if (prevColor) next.set(cellKey, prevColor)
        return next
      })
      setError('No se pudo quitar el resaltado. Revisa la conexión.')
    }
  }

  async function clearAll() {
    const backup = new Map(revisadas)
    setRevisadas(new Map())
    setConfirmClearAll(false)
    try {
      await clearAllPlanillaRevisiones()
      setInfo('Se limpiaron todos los resaltados.')
    } catch {
      setRevisadas(backup)
      setError('No se pudieron limpiar las marcas. Revisa la conexión.')
    }
  }

  function fmtFecha(key: string) {
    const [y, m, d] = key.split('-')
    return d && m && y ? `${d}/${m}/${y}` : key
  }

  const monthOptions = useMemo(() => buildMonthOptions(todayKey.slice(0, 7)), [todayKey])

  // Dias de la quincena seleccionada (1-15 o 16-fin de mes).
  const days = useMemo(() => {
    const [y, m] = planillaMonth.split('-').map(Number)
    const lastDay = new Date(y, m, 0).getDate()
    const start = planillaQuincena === 'SEGUNDA' ? 16 : 1
    const end = planillaQuincena === 'SEGUNDA' ? lastDay : 15
    const out: { key: string; day: number; weekday: string; isToday: boolean }[] = []
    for (let d = start; d <= end; d++) {
      const key = `${planillaMonth}-${String(d).padStart(2, '0')}`
      const wd = new Date(y, m - 1, d).getDay()
      out.push({ key, day: d, weekday: WEEKDAY[wd], isToday: key === todayKey })
    }
    return out
  }, [planillaMonth, planillaQuincena, todayKey])

  // Matriz operario x dia. Se muestran TODOS los operarios del catálogo (aunque
  // no hayan trabajado), más cualquier trabajador con labores/novedad que no esté
  // en el catálogo. Orden: alfabético por nombre.
  const rows = useMemo(() => {
    type Row = {
      id: string
      name: string
      perDay: Record<string, number>
      // true si ese día hay alguna labor EN_PROCESO (aún sin cerrar) → se pinta naranja.
      perDayProceso: Record<string, boolean>
      total: number
    }
    const map = new Map<string, Row>()
    // 1) Sembrar TODOS los operarios del catálogo (rol operador) con fila vacía.
    //    .trim() defensivo: algunos nombres en BD traen espacios/NBSP al inicio
    //    que rompían el orden alfabético (quedaban arriba de todo).
    for (const o of operators) {
      map.set(o.id, { id: o.id, name: o.name.trim(), perDay: {}, perDayProceso: {}, total: 0 })
    }
    // Avance ya CERRADO (executedArea) por suerte+labor, para estimar el restante
    // de las labores EN_PROCESO sin duplicar lo ya hecho en días anteriores.
    const cerradoBySuerte = avanceCerradoPorSuerte(assignments)
    // 2) Sumar el área REAL por día (executedArea de lo cerrado; restante estimado
    //    de lo EN_PROCESO). Así una labor que cruza de día NO se cuenta dos veces.
    for (const a of assignments) {
      if (!cuentaEnPlanilla(a)) continue
      const dk = executionDateKey(a)
      if (!matchesSummaryFilter(dk, planillaMonth, planillaQuincena, todayKey)) continue
      const name = (a.operatorName || 'Sin operador').trim()
      const id = a.operatorId || ''
      // Si el operario está en el catálogo (por id), suma ahí; si no, fila por nombre.
      const key = id && map.has(id) ? id : id || `name:${name.trim().toUpperCase()}`
      let row = map.get(key)
      if (!row) {
        row = { id: id || key, name, perDay: {}, perDayProceso: {}, total: 0 }
        map.set(key, row)
      }
      // Área real del día — misma regla que ve el operario en su pantalla.
      const { area: val, enProceso } = areaDelDia(a, cerradoBySuerte)
      if (enProceso) row.perDayProceso[dk] = true
      row.perDay[dk] = (row.perDay[dk] ?? 0) + val
      row.total += val
    }
    // 3) Los operarios INACTIVOS (los que ya no están en el catálogo activo) NO se
    //    muestran en la planilla, aunque tengan novedades registradas. Solo salen
    //    operarios del catálogo (paso 1) y quienes tengan labores reales en el
    //    periodo (paso 2). Las novedades de operarios ACTIVOS se pintan igual en su
    //    propia fila (ya existe desde el paso 1); no se borra ningún dato, solo se
    //    deja de surfacear al inactivo. Antes el paso 3 colaba al inactivo por traer
    //    una novedad (p. ej. U019 con D/P y área 0.0) — eso es lo que se elimina.
    return Array.from(map.values()).sort((a, b) =>
      a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }),
    )
  }, [assignments, operators, planillaMonth, planillaQuincena, todayKey])

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter(
      (r) => !hiddenOps.has(r.id) && (!q || r.name.toLowerCase().includes(q)),
    )
  }, [rows, search, hiddenOps])

  // Catálogo de operarios (nombre recortado) ordenado, para el panel de selección.
  const operatorsSorted = useMemo(
    () =>
      operators
        .map((o) => ({ id: o.id, name: o.name.trim() }))
        .sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' })),
    [operators],
  )
  const hiddenCount = useMemo(
    () => operatorsSorted.filter((o) => hiddenOps.has(o.id)).length,
    [operatorsSorted, hiddenOps],
  )

  // Detalle de las labores de una celda (operario × día) al oprimir el número.
  const [cellDetail, setCellDetail] = useState<{ rowKey: string; name: string; dateKey: string } | null>(null)
  const [deleteLaborTarget, setDeleteLaborTarget] = useState<Assignment | null>(null)
  const [deletingLabor, setDeletingLabor] = useState(false)

  const cellLabors = useMemo(() => {
    if (!cellDetail) return []
    return assignments.filter((a) => {
      if (a.status !== 'EN_PROCESO' && a.status !== 'PARCIAL' && a.status !== 'COMPLETADA') return false
      if (executionDateKey(a) !== cellDetail.dateKey) return false
      const aKey = a.operatorId || `name:${(a.operatorName || 'Sin operador').trim().toUpperCase()}`
      return aKey === cellDetail.rowKey
    })
  }, [cellDetail, assignments])

  async function handleDeleteLabor() {
    const target = deleteLaborTarget
    if (!target) return
    setDeletingLabor(true)
    setError('')
    try {
      await deleteAssignment(target.id)
      setAssignments((cur) => cur.filter((a) => a.id !== target.id))
      void db.assignments.delete(target.id)
      setInfo(`Labor eliminada: ${target.haciendaName} · ${target.suerte}.`)
      setDeleteLaborTarget(null)
    } catch {
      setError('No se pudo eliminar la labor. Revisa la conexión.')
    } finally {
      setDeletingLabor(false)
    }
  }

  // Totales por columna (dia) y gran total.
  const dayTotals = useMemo(() => {
    const t: Record<string, number> = {}
    let grand = 0
    for (const r of filteredRows) {
      for (const d of days) {
        const v = r.perDay[d.key] ?? 0
        t[d.key] = (t[d.key] ?? 0) + v
      }
      grand += r.total
    }
    return { t, grand }
  }, [filteredRows, days])

  const quincenaLabel = planillaQuincena === 'SEGUNDA' ? '2da quincena (16-fin)' : '1ra quincena (1-15)'
  const monthLabel = monthOptions.find((o) => o.value === planillaMonth)?.label ?? planillaMonth

  async function handleDownload() {
    if (filteredRows.length === 0) {
      setError('No hay datos para exportar en este periodo.')
      return
    }
    setExporting(true)
    try {
      const { utils, writeFile } = await import('xlsx')
      const cell = (v: number) => (v > 0 ? Number(v.toFixed(2)) : '')
      // En la celda, la novedad (V/T) tiene prioridad sobre las hectáreas.
      const cellFor = (rowKey: string, dayKey: string, v: number): string | number => {
        const nov = novedades.get(`${rowKey}|${dayKey}`)
        return nov ?? cell(v)
      }
      const header = ['Operario', ...days.map((d) => `${d.weekday}${d.day}`), 'Total']
      const body = filteredRows.map((r) => [
        r.name,
        ...days.map((d) => cellFor(r.id || r.name, d.key, r.perDay[d.key] ?? 0)),
        Number(r.total.toFixed(2)),
      ])
      const footer = [
        'Total',
        ...days.map((d) => cell(dayTotals.t[d.key] ?? 0)),
        Number(dayTotals.grand.toFixed(2)),
      ]
      const aoa = [
        [`Planilla quincenal · ${monthLabel} · ${quincenaLabel}`],
        ['Hectáreas abiertas por operario y día'],
        [],
        header,
        ...body,
        footer,
      ]
      const ws = utils.aoa_to_sheet(aoa)
      ws['!cols'] = [{ wch: 24 }, ...days.map(() => ({ wch: 6 })), { wch: 9 }]
      const wb = utils.book_new()
      utils.book_append_sheet(wb, ws, 'Planilla')
      writeFile(wb, `planilla-${planillaMonth}-${planillaQuincena.toLowerCase()}.xlsx`)
      setInfo('Planilla exportada a Excel.')
    } catch {
      setError('No se pudo exportar la planilla.')
    } finally {
      setExporting(false)
    }
  }

  return (
    <section className="panel-card">
      <div className="panel-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <h2>Planilla quincenal</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            className={`inline-button planilla-mark-toggle${markMode ? ' is-active' : ''}`}
            onClick={() => setMarkMode((v) => !v)}
            title="Activa el clic para resaltar casillas con color"
          >
            {markMode ? '✓ Resaltando' : '🖍 Resaltar'}
          </button>
          <button
            type="button"
            className="inline-button"
            onClick={() => setDetailOpen(true)}
            disabled={revisadas.size === 0}
            title="Ver el detalle de las casillas resaltadas y limpiarlas"
          >
            📋 Resaltadas ({revisadas.size})
          </button>
          <button
            type="button"
            className={`inline-button${hiddenCount > 0 ? ' is-active' : ''}`}
            onClick={() => { setOpsSearch(''); setOpsPanelOpen(true) }}
            title="Elegir qué operarios mostrar en la planilla"
          >
            👁 Operarios{hiddenCount > 0 ? ` (${hiddenCount} ocultos)` : ''}
          </button>
          <button
            type="button"
            className="inline-button"
            onClick={() => void handleDownload()}
            disabled={exporting}
          >
            {exporting ? 'Exportando…' : '⬇ Excel'}
          </button>
        </div>
      </div>

      <p className="planilla-caption">
        Hectáreas <strong>realmente ejecutadas</strong> por operario y día (lo cerrado cuenta su área hecha;
        lo que está <strong>en proceso</strong>, el restante estimado). Una labor que cruza de día NO se cuenta
        dos veces. {monthLabel} · {quincenaLabel}.
      </p>

      <div className="planilla-legend">
        <span className="planilla-legend__item"><i className="planilla-legend__dot planilla-num--proceso" />En proceso</span>
        <span className="planilla-legend__item"><i className="planilla-legend__dot planilla-num--terminada" />Terminada</span>
        <span className="planilla-legend__sep" />
        {/* Desde el catálogo: administración agrega códigos sin tocar el repo. */}
        {novCat.map((n) => (
          <span key={n.codigo} className="planilla-legend__item">
            <b style={{ color: n.color }}>{n.codigo}</b> {n.nombre}
          </span>
        ))}
        <span className="planilla-legend__sep" />
        <span className="planilla-legend__item"><i className="planilla-legend__dot planilla-vacio-dot" />Sin registro (hasta hoy)</span>
      </div>

      {markMode && (
        <div className="planilla-mark-bar">
          <span className="planilla-mark-hint">🖍 Clic en una casilla para resaltarla (otra vez con el mismo color la quita). Color:</span>
          <div className="planilla-color-picker">
            {HIGHLIGHT_COLORS.map((c) => (
              <button
                key={c.value}
                type="button"
                className={`planilla-swatch planilla-hl--${c.value}${markColor === c.value ? ' is-active' : ''}`}
                onClick={() => setMarkColor(c.value)}
                title={c.label}
                aria-label={c.label}
              />
            ))}
          </div>
        </div>
      )}

      <div className="planilla-filters">
        <label>
          Mes
          <select value={planillaMonth} onChange={(e) => setPlanillaMonth(e.target.value)}>
            {monthOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Quincena
          <select
            value={planillaQuincena === 'SEGUNDA' ? 'SEGUNDA' : 'PRIMERA'}
            onChange={(e) => setPlanillaQuincena(e.target.value as SummaryQuincena)}
          >
            <option value="PRIMERA">1ra quincena (1-15)</option>
            <option value="SEGUNDA">2da quincena (16-fin)</option>
          </select>
        </label>
        <input
          className="planilla-search"
          type="search"
          placeholder="Buscar operario..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {filteredRows.length === 0 ? (
        <div className="empty-card" style={{ marginTop: 12 }}>
          <h2>Sin labores iniciadas</h2>
          <p>Ningún operario ha abierto labores en este periodo.</p>
        </div>
      ) : (
        <div className="planilla-scroll">
          <table className="planilla-table">
            <thead>
              <tr>
                <th className="planilla-sticky planilla-th-op">Operario</th>
                {days.map((d) => (
                  <th key={d.key} className={d.isToday ? 'planilla-today' : ''}>
                    <span className="planilla-wd">{d.weekday}</span>
                    <span className="planilla-day">{d.day}</span>
                  </th>
                ))}
                <th className="planilla-total-col">Total</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((r) => {
                const rowKey = r.id || r.name
                return (
                  <tr key={rowKey}>
                    <td
                      className="planilla-sticky planilla-op planilla-op--clickable"
                      onClick={() => openNovedad(rowKey, r.name)}
                      title="Reportar vacaciones / taller"
                    >
                      {r.name}
                    </td>
                    {days.map((d) => {
                      const v = r.perDay[d.key] ?? 0
                      const hl = revisadas.get(`${rowKey}|${d.key}`)
                      const nov = novedades.get(`${rowKey}|${d.key}`)
                      const proceso = r.perDayProceso[d.key]
                      const numClass = v > 0 && !nov ? (proceso ? ' planilla-num--proceso' : ' planilla-num--terminada') : ''
                      const canDetail = !markMode && v > 0 && !nov
                      // Casilla VACÍA hasta el día de hoy (sin área, sin novedad y sin
                      // resaltado manual) → se pinta amarillo como "falta por registrar".
                      // Clic (fuera de modo resaltar) abre la novedad de ese día (default F).
                      const vacio = v <= 0 && !nov && !hl && d.key <= todayKey
                      return (
                        <td
                          key={d.key}
                          className={`planilla-cell${d.isToday ? ' planilla-today' : ''}${numClass}${hl ? ` planilla-hl planilla-hl--${hl}` : ''}${markMode ? ' planilla-markable' : ''}${canDetail || (vacio && !markMode) ? ' planilla-cell--clickable' : ''}${nov ? ` planilla-nov planilla-nov--${nov.toLowerCase()}` : ''}${vacio ? ' planilla-vacio' : ''}`}
                          onClick={
                            markMode
                              ? () => void toggleRevision(rowKey, d.key)
                              : canDetail
                                ? () => setCellDetail({ rowKey, name: r.name, dateKey: d.key })
                                : vacio
                                  ? () => openNovedad(rowKey, r.name, d.key)
                                  : undefined
                          }
                          title={
                            nov
                              ? (novPorCodigo.get(nov)?.nombre ?? nov)
                              : canDetail
                                ? `Ver labores (${proceso ? 'en proceso' : 'terminada'})`
                                : vacio
                                  ? 'Sin registro — clic para marcar novedad (falta, permiso…)'
                                  : markMode ? 'Resaltar / quitar' : undefined
                          }
                        >
                          {nov
                            ? <b style={{ color: novPorCodigo.get(nov)?.color }}>{novLetter(nov)}</b>
                            : fmt(v)}
                        </td>
                      )
                    })}
                    <td className="planilla-total-col">{r.total.toFixed(2)}</td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr>
                <td className="planilla-sticky planilla-op">Total</td>
                {days.map((d) => (
                  <td key={d.key} className={`planilla-foot${d.isToday ? ' planilla-today' : ''}`}>
                    {fmt(dayTotals.t[d.key] ?? 0)}
                  </td>
                ))}
                <td className="planilla-total-col planilla-foot">{dayTotals.grand.toFixed(2)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Detalle de labores de una celda (operario × día) — editar/eliminar */}
      {cellDetail && (
        <div className="modal-overlay open" onClick={() => setCellDetail(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 'min(560px, calc(100vw - 32px))' }}>
            <div className="labor-detail-header">
              <div>
                <p className="eyebrow">Planilla · {fmtFecha(cellDetail.dateKey)}</p>
                <h3>{cellDetail.name}</h3>
              </div>
              <button type="button" className="modal-close-btn" onClick={() => setCellDetail(null)} aria-label="Cerrar">&#x2715;</button>
            </div>
            {cellLabors.length === 0 ? (
              <p className="subtle-copy" style={{ marginTop: 0 }}>Sin labores ese día.</p>
            ) : (
              <ul className="revisadas-list">
                {cellLabors.map((a) => (
                  <li key={a.id} className="revisadas-item">
                    <div className="revisadas-item__main">
                      <strong>{a.haciendaName} · {a.suerte}</strong>
                      <span>
                        {a.labor} · {a.area.toFixed(2)} {unidadDeLabor(a.labor)} ·{' '}
                        {a.status === 'EN_PROCESO' ? 'En proceso' : a.status === 'PARCIAL' ? 'Parcial' : 'Completada'}
                        {a.finishedAt ? ` · ${formatTime(a.finishedAt)}` : a.startedAt ? ` · ${formatTime(a.startedAt)}` : ''}
                      </span>
                    </div>
                    <div className="report-row-actions">
                      {onEditLabor && (
                        <button
                          type="button"
                          className="inline-button"
                          onClick={() => { onEditLabor(a); setCellDetail(null) }}
                        >
                          Editar
                        </button>
                      )}
                      <button
                        type="button"
                        className="inline-button maestro-delete-btn"
                        onClick={() => setDeleteLaborTarget(a)}
                      >
                        Eliminar
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <div className="modal-footer">
              <button type="button" className="inline-button" onClick={() => setCellDetail(null)}>Cerrar</button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmar eliminación de una labor desde el detalle de la celda */}
      {deleteLaborTarget && (
        <div className="modal-overlay open" onClick={() => { if (!deletingLabor) setDeleteLaborTarget(null) }}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 'min(440px, calc(100vw - 32px))' }}>
            <div className="labor-detail-header">
              <div>
                <p className="eyebrow">Eliminar labor</p>
                <h3>¿Eliminar esta labor?</h3>
              </div>
              <button type="button" className="modal-close-btn" onClick={() => setDeleteLaborTarget(null)} disabled={deletingLabor} aria-label="Cerrar">&#x2715;</button>
            </div>
            <p className="subtle-copy" style={{ marginTop: 0 }}>
              <strong>{deleteLaborTarget.haciendaName} · {deleteLaborTarget.suerte}</strong> — {deleteLaborTarget.labor}
            </p>
            <p className="subtle-copy">Se borra de forma permanente (no se puede deshacer) y deja de contar en la planilla.</p>
            <div className="modal-footer">
              <button type="button" className="inline-button" onClick={() => setDeleteLaborTarget(null)} disabled={deletingLabor}>Cancelar</button>
              <button type="button" className="release-confirm-btn" onClick={() => void handleDeleteLabor()} disabled={deletingLabor}>
                {deletingLabor ? 'Eliminando…' : 'Sí, eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Panel: elegir qué operarios mostrar en la planilla */}
      {opsPanelOpen && (
        <div className="modal-overlay open" onClick={() => setOpsPanelOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 'min(460px, calc(100vw - 32px))' }}>
            <div className="labor-detail-header">
              <div>
                <p className="eyebrow">Planilla</p>
                <h3>Operarios a mostrar</h3>
              </div>
              <button type="button" className="modal-close-btn" onClick={() => setOpsPanelOpen(false)} aria-label="Cerrar">&#x2715;</button>
            </div>
            <p className="subtle-copy" style={{ marginTop: 0 }}>
              Desmarca los operarios que no quieres ver. Se recuerda en este dispositivo.
            </p>
            <div className="ops-panel-actions">
              <input
                className="planilla-search"
                type="search"
                placeholder="Buscar operario…"
                value={opsSearch}
                onChange={(e) => setOpsSearch(e.target.value)}
              />
              <button type="button" className="inline-button" onClick={() => setAllVisible(true)}>Todos</button>
              <button type="button" className="inline-button" onClick={() => setAllVisible(false)}>Ninguno</button>
            </div>
            <ul className="ops-checklist">
              {operatorsSorted
                .filter((o) => !opsSearch.trim() || o.name.toLowerCase().includes(opsSearch.trim().toLowerCase()))
                .map((o) => (
                  <li key={o.id}>
                    <label className="ops-check">
                      <input type="checkbox" checked={!hiddenOps.has(o.id)} onChange={() => toggleHidden(o.id)} />
                      <span>{o.name}</span>
                    </label>
                  </li>
                ))}
              {operatorsSorted.length === 0 && (
                <li><span className="subtle-copy">No hay operarios en el catálogo.</span></li>
              )}
            </ul>
            <div className="modal-footer">
              <button type="button" className="primary-button" onClick={() => setOpsPanelOpen(false)}>
                Listo ({operatorsSorted.length - hiddenCount} visibles)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reportar/quitar novedad (vacaciones/taller) al oprimir el nombre */}
      {novTarget && (
        <div className="modal-overlay open" onClick={() => { if (!savingNov) setNovTarget(null) }}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 'min(440px, calc(100vw - 32px))' }}>
            <div className="labor-detail-header">
              <div>
                <p className="eyebrow">Novedad</p>
                <h3>{novTarget.name}</h3>
              </div>
              <button type="button" className="modal-close-btn" onClick={() => setNovTarget(null)} disabled={savingNov} aria-label="Cerrar">&#x2715;</button>
            </div>
            <div className="realizadas-seg planilla-nov-seg" role="group" aria-label="Tipo de novedad" style={{ marginBottom: 10 }}>
              {novCat.map((n) => (
                <button
                  key={n.codigo}
                  type="button"
                  className={`realizadas-seg__btn ${novTipo === n.codigo ? 'is-active' : ''}`}
                  onClick={() => setNovTipo(n.codigo as NovedadTipo)}
                  disabled={savingNov}
                  style={novTipo === n.codigo ? undefined : { color: n.color }}
                  title={n.nombre}
                >
                  {n.codigo} · {n.nombre}
                </button>
              ))}
              <button
                type="button"
                className={`realizadas-seg__btn ${novTipo === 'CLEAR' ? 'is-active' : ''}`}
                onClick={() => setNovTipo('CLEAR')}
                disabled={savingNov}
              >
                🧹 Quitar
              </button>
            </div>
            <p className="subtle-copy" style={{ marginTop: 0 }}>
              {novTipo === 'CLEAR'
                ? 'Se quitará la novedad de los días del rango.'
                : <>Los días del rango quedarán marcados como <strong>{NOVEDAD_LABEL[novTipo]}</strong> (letra {novLetter(novTipo)}) en la planilla.</>}
            </p>
            <div className="novedad-fields">
              <label>
                <span>Desde</span>
                <input type="date" value={novDesde} max={novHasta || undefined} onChange={(e) => setNovDesde(e.target.value)} disabled={savingNov} />
              </label>
              <label>
                <span>Hasta</span>
                <input type="date" value={novHasta} min={novDesde || undefined} onChange={(e) => setNovHasta(e.target.value)} disabled={savingNov} />
              </label>
            </div>
            <div className="modal-footer">
              <button type="button" className="inline-button" onClick={() => setNovTarget(null)} disabled={savingNov}>Cancelar</button>
              <button
                type="button"
                className={novTipo === 'CLEAR' ? 'release-confirm-btn' : 'primary-button'}
                onClick={() => void applyNovedad()}
                disabled={savingNov || !novDesde || !novHasta}
              >
                {savingNov ? 'Guardando…' : novTipo === 'CLEAR' ? 'Quitar' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Ventana emergente: detalle de casillas revisadas + limpiar */}
      {detailOpen && (
        <div className="modal-overlay open" onClick={() => { setDetailOpen(false); setConfirmClearAll(false) }}>
          <div
            className="modal-card"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 'min(520px, calc(100vw - 32px))' }}
          >
            <div className="labor-detail-header">
              <div>
                <p className="eyebrow">Planilla</p>
                <h3>Casillas resaltadas ({revisadasList.length})</h3>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => { setDetailOpen(false); setConfirmClearAll(false) }}
                aria-label="Cerrar"
              >
                &#x2715;
              </button>
            </div>

            {revisadasList.length === 0 ? (
              <p className="subtle-copy" style={{ marginTop: 0 }}>No hay casillas resaltadas.</p>
            ) : (
              <>
                <ul className="revisadas-list">
                  {revisadasList.map((it) => (
                    <li key={it.key} className="revisadas-item">
                      <div className="revisadas-item__main">
                        <strong>
                          <span className={`planilla-swatch planilla-hl--${it.color}`} style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 6 }} />
                          {it.name}
                        </strong>
                        <span>{fmtFecha(it.fecha)}{it.area > 0 ? ` · ${it.area.toFixed(2)} ha` : ''}</span>
                      </div>
                      <button
                        type="button"
                        className="inline-button revisadas-clear-one"
                        onClick={() => void clearOne(it.opKey, it.fecha)}
                        title="Quitar esta marca"
                      >
                        ✕ Limpiar
                      </button>
                    </li>
                  ))}
                </ul>

                {confirmClearAll ? (
                  <div className="revisadas-confirm">
                    <p className="subtle-copy" style={{ margin: 0 }}>
                      ¿Seguro? Se quitarán <strong>todas</strong> las {revisadasList.length} marcas.
                    </p>
                    <div className="modal-footer" style={{ marginTop: 8 }}>
                      <button type="button" className="inline-button" onClick={() => setConfirmClearAll(false)}>Cancelar</button>
                      <button type="button" className="release-confirm-btn" onClick={() => void clearAll()}>Sí, limpiar todas</button>
                    </div>
                  </div>
                ) : (
                  <div className="modal-footer">
                    <button type="button" className="inline-button" onClick={() => setDetailOpen(false)}>Cerrar</button>
                    <button type="button" className="release-confirm-btn" onClick={() => setConfirmClearAll(true)}>
                      Limpiar todas
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
