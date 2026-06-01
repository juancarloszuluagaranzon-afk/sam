import { useMemo, useRef, useState } from 'react'
import { useAppData } from '../context/AppDataContext'
import { executionDateKey, getIngenioName } from '../services/samApi'
import type { Assignment } from '../domain/sam'

/**
 * Pestaña "Validación" (solo jefe/owner y administración).
 *
 * Sirve para CRUZAR lo diligenciado en el app contra el Excel paralelo que
 * todavía llevan a mano mientras prueban el sistema. El usuario sube su Excel
 * ("Resumen de Labores") y la app compara por hacienda+suerte+labor dentro del
 * mes seleccionado, mostrando:
 *   - 🔴 En el Excel pero FALTA en el app  (lo más importante: falta registrar)
 *   - 🟡 En el app pero NO está en el Excel
 *   - 🟢 En ambos (con el área de cada lado para comparar)
 *
 * Si no se sube Excel, muestra una validación de consistencia interna del app
 * (semáforo de campos faltantes) y permite exportar a Excel con sus columnas.
 *
 * Regla ×2 (DESPEJE/REENCALLE/REENCALLE V): el app deja dos líneas que suman el
 * doble; al agrupar por hacienda+suerte+labor el área del app queda sumada
 * (= el "facturar 2" del Excel, que en su hoja es una sola línea).
 */

// ---------- normalización para el cruce ----------
function stripAccents(s: string) {
  // Quita marcas diacríticas combinantes (U+0300–U+036F) tras NFD.
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
}
function normTxt(s: unknown) {
  return stripAccents(String(s ?? '')).toUpperCase().replace(/\s+/g, ' ').trim()
}
// Suerte: si es solo dígitos, quita ceros a la izquierda ("034" == "34").
function normSuerte(s: unknown) {
  const t = normTxt(s)
  return /^\d+$/.test(t) ? String(Number(t)) : t
}
// Labor: unifica los alias que difieren entre Excel y app.
function canonLabor(s: unknown) {
  const t = normTxt(s)
  if (t === 'REENCALLE' || t === 'RENCALLE') return 'RENCALLE'
  if (['REENCALLE V', 'REENCALLE EN V', 'RENCALLE EN V', 'RENCALLE V'].includes(t)) return 'RENCALLE V'
  if (t === 'DESPAJE' || t === 'DESPEJE') return 'DESPEJE'
  return t
}
// Para el CRUCE, DESPEJE / REENCALLE / REENCALLE V se tratan como UNA sola
// unidad por suerte. En el Excel suelen colapsarse en una línea "DESPEJE X2"
// (área ×2), mientras que en el app van como DOS labores separadas (DESPEJE +
// REENCALLE). Agrupándolas juntas, ambas representaciones suman lo mismo y
// cuadran (Excel 3.03×2 = 6.06 == app 3.03 + 3.03 = 6.06).
function bucketLabor(labor: unknown): string {
  const c = canonLabor(labor)
  if (c === 'DESPEJE' || c === 'RENCALLE' || c === 'RENCALLE V') return 'DESPEJE/REENCALLE'
  return c
}
function groupKey(hacienda: unknown, suerte: unknown, labor: unknown) {
  return `${normTxt(hacienda)}|${normSuerte(suerte)}|${bucketLabor(labor)}`
}
// Detecta la marca "FACTURA X2" / "SE FACTURA X2" / "FACTURA X 2" en cualquier
// celda de una fila del Excel (la posición de la columna de nota varía).
function tieneMarcaX2(celdas: unknown[]): boolean {
  return celdas.some((c) => /facturad?[ao]?\s*x\s*2|factura\s*x\s*2/i.test(String(c ?? '')))
}

function pad2(n: number) {
  return String(n).padStart(2, '0')
}
// Parsea la FECHA del Excel (Date real, "M/D/YY", "M/D/YYYY" o ISO) a YYYY-MM-DD.
function parseFecha(v: unknown): string {
  if (v instanceof Date && !isNaN(v.getTime())) {
    return `${v.getFullYear()}-${pad2(v.getMonth() + 1)}-${pad2(v.getDate())}`
  }
  const s = String(v ?? '').trim()
  if (!s) return ''
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if (us) {
    let yy = Number(us[3])
    if (yy < 100) yy += 2000
    return `${yy}-${pad2(Number(us[1]))}-${pad2(Number(us[2]))}`
  }
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (iso) return `${iso[1]}-${pad2(Number(iso[2]))}-${pad2(Number(iso[3]))}`
  return ''
}

// ---------- validación de consistencia interna (sin Excel) ----------
type Nivel = 'completa' | 'curso' | 'incompleta'
function validar(a: Assignment): { nivel: Nivel; faltan: string[] } {
  if (a.status === 'PENDIENTE') return { nivel: 'incompleta', faltan: ['sin iniciar'] }
  if (a.status === 'EN_PROCESO') return { nivel: 'curso', faltan: ['sin finalizar'] }
  const faltan: string[] = []
  if (!(a.executedArea > 0)) faltan.push('área ejecutada')
  if (a.horometroFinal == null) faltan.push('horómetro final')
  if (!a.operatorName) faltan.push('operario')
  if (!a.equipmentName) faltan.push('equipo')
  if (a.status === 'PARCIAL') return { nivel: 'curso', faltan: faltan.length ? faltan : ['parcial (sigue activa)'] }
  return { nivel: faltan.length ? 'incompleta' : 'completa', faltan }
}

function clienteCorto(a: Assignment, maestro: Parameters<typeof getIngenioName>[1]): string {
  return (getIngenioName(a, maestro) ?? '').replace(/^Ingenio\s+/i, '').toUpperCase()
}

interface ExcelRow {
  fechaKey: string
  hacienda: string
  suerte: string
  labor: string
  ha: number
  operario: string
  facturaX2: boolean
}
interface Grupo {
  hacienda: string
  suerte: string
  labor: string
  ha: number
  operario: string
  n: number
  x2?: boolean
}

export function ValidationTab() {
  const { assignments, maestro, users, todayKey, busy, setBusy, setError, setInfo } = useAppData()

  const [mes, setMes] = useState(() => todayKey.slice(0, 7))
  const [quincena, setQuincena] = useState<'MES' | 'Q1' | 'Q2'>('MES')
  const [search, setSearch] = useState('')
  const [nivelFilter, setNivelFilter] = useState<'todas' | Nivel>('todas')

  const [excelRows, setExcelRows] = useState<ExcelRow[] | null>(null)
  const [excelName, setExcelName] = useState('')
  const [excelError, setExcelError] = useState('')
  const [loadingExcel, setLoadingExcel] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const supName = useMemo(() => {
    const byId = new Map(users.map((u) => [u.id, u.name]))
    return (id: string) => byId.get(id) ?? id
  }, [users])

  const meses = useMemo(() => {
    const set = new Set<string>()
    assignments.forEach((a) => {
      const k = executionDateKey(a)
      if (k) set.add(k.slice(0, 7))
    })
    if (excelRows) excelRows.forEach((r) => r.fechaKey && set.add(r.fechaKey.slice(0, 7)))
    set.add(todayKey.slice(0, 7))
    return Array.from(set).sort((a, b) => b.localeCompare(a))
  }, [assignments, todayKey, excelRows])

  function inPeriod(fechaKey: string) {
    if (!fechaKey || fechaKey.slice(0, 7) !== mes) return false
    if (quincena === 'MES') return true
    const day = Number(fechaKey.slice(8, 10))
    return quincena === 'Q1' ? day <= 15 : day >= 16
  }

  // Registros del app en el período (excluye CANCELADA).
  const periodRows = useMemo(
    () => assignments.filter((a) => a.status !== 'CANCELADA').filter((a) => inPeriod(executionDateKey(a))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [assignments, mes, quincena],
  )

  // Agrupa el app por suerte+labor en el período: suma del executedArea, área
  // de la suerte (del maestro), y operario. El ×2 del app es "data-driven": el
  // app dejó dos líneas que suman ~el doble del área de la suerte. NO se marca
  // por nombre de labor (no todas las despeje/reencalle van ×2).
  const appGroups = useMemo(() => {
    const m = new Map<
      string,
      { hacienda: string; suerte: string; labor: string; sum: number; area: number; operario: string; n: number }
    >()
    for (const a of periodRows) {
      const k = groupKey(a.haciendaName, a.suerte, a.labor)
      const mr = maestro.find((r) => r.haciendaCode === a.haciendaCode && r.suerte === a.suerte)
      const area = mr?.area ?? a.area
      const cur = m.get(k) ?? { hacienda: a.haciendaName, suerte: a.suerte, labor: bucketLabor(a.labor), sum: 0, area: 0, operario: a.operatorName, n: 0 }
      cur.sum += a.executedArea > 0 ? a.executedArea : 0
      cur.area = Math.max(cur.area, area)
      cur.n++
      m.set(k, cur)
    }
    return m
  }, [periodRows, maestro])

  // ¿El grupo (suerte+labor) del app está facturado ×2? = lo ejecutado suma
  // ≈ el doble del área de la suerte (umbral 1.8× para tolerar redondeos).
  const isAppX2 = (k: string) => {
    const g = appGroups.get(k)
    return !!g && g.area > 0 && g.sum >= g.area * 1.8
  }
  const appRowX2 = (a: Assignment) => isAppX2(groupKey(a.haciendaName, a.suerte, a.labor))

  // ---------- cruce app ↔ Excel ----------
  const reconc = useMemo(() => {
    if (!excelRows) return null
    // Excel: una línea marcada "FACTURA X2" cuenta su área DOS VECES, para que
    // su facturable iguale a las dos líneas separadas del app.
    const excelMap = new Map<string, Grupo>()
    for (const r of excelRows) {
      if (!inPeriod(r.fechaKey)) continue
      const k = groupKey(r.hacienda, r.suerte, r.labor)
      const g = excelMap.get(k) ?? { hacienda: r.hacienda, suerte: r.suerte, labor: bucketLabor(r.labor), ha: 0, operario: r.operario, n: 0, x2: false }
      g.ha += r.ha * (r.facturaX2 ? 2 : 1)
      g.x2 = g.x2 || r.facturaX2
      g.n++
      excelMap.set(k, g)
    }
    const faltanApp: Grupo[] = []
    const ambos: (Grupo & { haApp: number })[] = []
    for (const [k, g] of excelMap) {
      const ap = appGroups.get(k)
      if (ap) ambos.push({ ...g, haApp: ap.sum })
      else faltanApp.push(g)
    }
    const soloApp: Grupo[] = []
    for (const [k, ap] of appGroups) {
      if (!excelMap.has(k)) {
        soloApp.push({ hacienda: ap.hacienda, suerte: ap.suerte, labor: ap.labor, ha: ap.sum, operario: ap.operario, n: ap.n, x2: isAppX2(k) })
      }
    }
    const byName = (a: Grupo, b: Grupo) => `${a.hacienda} ${a.suerte}`.localeCompare(`${b.hacienda} ${b.suerte}`)
    faltanApp.sort(byName)
    soloApp.sort(byName)
    ambos.sort(byName)
    return { faltanApp, soloApp, ambos, excelTotal: excelMap.size }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [excelRows, appGroups, mes, quincena])

  const term = search.trim().toLowerCase()
  const matchSearch = (g: { hacienda: string; suerte: string; labor: string; operario?: string }) =>
    !term || `${g.hacienda} ${g.suerte} ${g.labor} ${g.operario ?? ''}`.toLowerCase().includes(term)

  // ---------- consistencia interna (sin Excel) ----------
  const kpis = useMemo(() => {
    let ejec = 0, completas = 0, curso = 0, incompletas = 0, porAprobar = 0
    for (const a of periodRows) {
      if (a.executedArea > 0) ejec += a.executedArea
      const v = validar(a)
      if (v.nivel === 'completa') completas++
      else if (v.nivel === 'curso') curso++
      else incompletas++
      if (a.approval === 'PENDIENTE') porAprobar++
    }
    return { total: periodRows.length, ejec, completas, curso, incompletas, porAprobar }
  }, [periodRows])

  const internalRows = useMemo(() => {
    return periodRows
      .map((a) => ({ a, v: validar(a) }))
      .filter(({ a }) => !term || `${a.haciendaName} ${a.suerte} ${a.labor} ${a.operatorName}`.toLowerCase().includes(term))
      .filter(({ v }) => (nivelFilter === 'todas' ? true : v.nivel === nivelFilter))
      .sort((x, y) => (executionDateKey(y.a) > executionDateKey(x.a) ? 1 : -1))
  }, [periodRows, term, nivelFilter])

  // ---------- carga del Excel ----------
  async function onExcelFile(file: File) {
    setLoadingExcel(true)
    setExcelError('')
    try {
      const XLSX = await import('xlsx')
      const data = new Uint8Array(await file.arrayBuffer())
      const wb = XLSX.read(data, { type: 'array', cellDates: true })
      let parsed: ExcelRow[] | null = null
      for (const name of wb.SheetNames) {
        const aoa = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' }) as unknown[][]
        if (!aoa.length) continue
        const header = (aoa[0] as unknown[]).map((h) => normTxt(h))
        const iFecha = header.indexOf('FECHA')
        const iLabor = header.indexOf('LABOR')
        const iHac = header.indexOf('HACIENDA')
        const iSuerte = header.indexOf('SUERTE')
        const iHa = header.indexOf('HA')
        const iOp = header.indexOf('OPERARIO')
        if (iLabor < 0 || iHac < 0 || iSuerte < 0 || iHa < 0) continue
        const out: ExcelRow[] = []
        for (let i = 1; i < aoa.length; i++) {
          const r = aoa[i]
          const labor = String(r[iLabor] ?? '').trim()
          const hac = String(r[iHac] ?? '').trim()
          const suerte = String(r[iSuerte] ?? '').trim()
          if (!labor || !hac || !suerte) continue
          const haRaw = r[iHa]
          const ha = typeof haRaw === 'number' ? haRaw : parseFloat(String(haRaw ?? '').replace(/,/g, '.')) || 0
          out.push({
            fechaKey: iFecha >= 0 ? parseFecha(r[iFecha]) : '',
            hacienda: hac,
            suerte,
            labor,
            ha,
            operario: iOp >= 0 ? String(r[iOp] ?? '').trim() : '',
            facturaX2: tieneMarcaX2(r),
          })
        }
        parsed = out
        break
      }
      if (!parsed) {
        setExcelError('No encontré una hoja con columnas LABOR / HACIENDA / SUERTE / HA. Revisa el archivo.')
        return
      }
      setExcelRows(parsed)
      setExcelName(file.name)
      // Si el Excel no tiene datos del mes actual, salta al mes más reciente del Excel.
      const mesesExcel = new Set(parsed.map((r) => r.fechaKey.slice(0, 7)).filter(Boolean))
      if (!mesesExcel.has(mes) && mesesExcel.size) {
        setMes([...mesesExcel].sort((a, b) => b.localeCompare(a))[0])
      }
      setInfo(`Excel cargado: ${parsed.length} filas leídas.`)
    } catch {
      setExcelError('No se pudo leer el Excel. Verifica que sea .xlsx válido.')
    } finally {
      setLoadingExcel(false)
    }
  }

  function quitarExcel() {
    setExcelRows(null)
    setExcelName('')
    setExcelError('')
    if (fileRef.current) fileRef.current.value = ''
  }

  async function exportar() {
    if (periodRows.length === 0) return
    setBusy(true)
    setError('')
    try {
      const { utils, writeFile } = await import('xlsx')
      const header = [
        'FECHA', 'EMPRESA', 'CLIENTE', 'SERVICIO', 'SECTOR', 'LABOR', 'HACIENDA',
        'SUERTE', 'HA', 'FACTURA X2', 'MATAS', 'OPERARIO', 'CABO', 'FACTURA ',
        'FECHA DE FACTURA ', ' VALOR FACTURA ', 'OBSERVACION ', 'MATAS ', 'ACTA ',
        'FECHA2', 'DUDA, PREGUNTAR',
      ]
      const aoa: (string | number)[][] = [header]
      const ordered = [...periodRows].sort((a, b) => (executionDateKey(b) > executionDateKey(a) ? 1 : -1))
      for (const a of ordered) {
        aoa.push([
          executionDateKey(a), 'AGROMORALES', clienteCorto(a, maestro), '', a.zone ?? '',
          a.labor, a.haciendaName, a.suerte, a.executedArea > 0 ? a.executedArea : a.area,
          appRowX2(a) ? 'SE FACTURA X2' : '',
          '', a.operatorName, supName(a.supervisorId), '', '', '', a.notes, '', '', '', '',
        ])
      }
      const ws = utils.aoa_to_sheet(aoa)
      const wb = utils.book_new()
      utils.book_append_sheet(wb, ws, 'Validacion')
      writeFile(wb, `validacion-${mes}-${quincena.toLowerCase()}.xlsx`)
      setInfo(`Exportado: ${periodRows.length} registros.`)
    } catch {
      setError('No se pudo exportar el archivo.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel-card validacion-card">
      <div className="panel-title split">
        <h2>Validación</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void onExcelFile(f)
            }}
          />
          <button
            type="button"
            className="primary-button outline validacion-export-btn"
            onClick={() => fileRef.current?.click()}
            disabled={loadingExcel}
          >
            {loadingExcel ? 'Leyendo…' : '⬆ Cargar Excel'}
          </button>
          <button
            type="button"
            className="primary-button outline validacion-export-btn"
            onClick={() => void exportar()}
            disabled={busy || periodRows.length === 0}
          >
            ⬇ Exportar Excel
          </button>
        </div>
      </div>

      <p className="subtle-copy" style={{ marginTop: 0 }}>
        {reconc
          ? 'Cruce app ↔ Excel por hacienda + suerte + labor (en el mes elegido). Las líneas con “FACTURA X2” en el Excel cuentan el área ×2 (equivale a las dos líneas separadas del app). Lo importante es la lista 🔴 "Falta en app".'
          : 'Sube tu Excel para cruzar lo registrado en el app contra lo que llevas en el archivo, o revisa abajo qué registros del app están incompletos.'}
      </p>

      {excelError && <div className="feedback error">{excelError}</div>}

      {/* Filtros */}
      <div className="validacion-filters">
        <label>
          Mes
          <select value={mes} onChange={(e) => setMes(e.target.value)}>
            {meses.map((m) => {
              const [y, mo] = m.split('-')
              const label = new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString('es-CO', { month: 'long', year: 'numeric' })
              return <option key={m} value={m}>{label}</option>
            })}
          </select>
        </label>
        <label>
          Quincena
          <select value={quincena} onChange={(e) => setQuincena(e.target.value as 'MES' | 'Q1' | 'Q2')}>
            <option value="MES">Mes completo</option>
            <option value="Q1">Quincena 1 (1–15)</option>
            <option value="Q2">Quincena 2 (16–fin)</option>
          </select>
        </label>
        {!reconc && (
          <label>
            Estado
            <select value={nivelFilter} onChange={(e) => setNivelFilter(e.target.value as 'todas' | Nivel)}>
              <option value="todas">Todas</option>
              <option value="incompleta">🔴 Incompletas</option>
              <option value="curso">🟡 En curso</option>
              <option value="completa">🟢 Completas</option>
            </select>
          </label>
        )}
        <label className="validacion-search">
          Buscar
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Hacienda, suerte, labor u operario…" />
        </label>
      </div>

      {reconc ? (
        <>
          <div className="validacion-excel-banner">
            <span>📄 Comparando contra <strong>{excelName}</strong></span>
            <button type="button" className="inline-button" onClick={quitarExcel}>Quitar Excel</button>
          </div>

          <div className="validacion-kpis">
            <div className="validacion-kpi validacion-kpi--red">
              <strong>{reconc.faltanApp.length}</strong>
              <span>falta en app</span>
            </div>
            <div className="validacion-kpi validacion-kpi--amber">
              <strong>{reconc.soloApp.length}</strong>
              <span>solo en app</span>
            </div>
            <div className="validacion-kpi validacion-kpi--green">
              <strong>{reconc.ambos.length}</strong>
              <span>en ambos</span>
            </div>
            <div className="validacion-kpi">
              <strong>{reconc.excelTotal}</strong>
              <span>grupos en excel</span>
            </div>
          </div>

          {/* 🔴 En Excel, falta en app */}
          <h3 className="validacion-section-title val-title--red">🔴 En el Excel pero falta en el app ({reconc.faltanApp.filter(matchSearch).length})</h3>
          <div className="table-wrap validacion-table-wrap--sm">
            <table className="validacion-table">
              <thead><tr><th>Hacienda · Suerte</th><th>Labor</th><th className="num">Ha (Excel)</th><th>Operario (Excel)</th></tr></thead>
              <tbody>
                {reconc.faltanApp.filter(matchSearch).map((g, i) => (
                  <tr key={i}>
                    <td>{g.hacienda} · {g.suerte}</td>
                    <td>{g.labor}{g.x2 && <span className="x2-badge">×2</span>}</td>
                    <td className="num">{g.ha.toFixed(2)}</td>
                    <td>{g.operario || '—'}</td>
                  </tr>
                ))}
                {reconc.faltanApp.filter(matchSearch).length === 0 && (
                  <tr><td colSpan={4} className="validacion-empty">Nada pendiente: todo lo del Excel está en el app. ✅</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* 🟡 Solo en app */}
          <h3 className="validacion-section-title val-title--amber">🟡 En el app pero no está en el Excel ({reconc.soloApp.filter(matchSearch).length})</h3>
          <div className="table-wrap validacion-table-wrap--sm">
            <table className="validacion-table">
              <thead><tr><th>Hacienda · Suerte</th><th>Labor</th><th className="num">Ha (app)</th><th>Operario (app)</th></tr></thead>
              <tbody>
                {reconc.soloApp.filter(matchSearch).map((g, i) => (
                  <tr key={i}>
                    <td>{g.hacienda} · {g.suerte}</td>
                    <td>{g.labor}{g.x2 && <span className="x2-badge">×2</span>}</td>
                    <td className="num">{g.ha.toFixed(2)}</td>
                    <td>{g.operario || '—'}</td>
                  </tr>
                ))}
                {reconc.soloApp.filter(matchSearch).length === 0 && (
                  <tr><td colSpan={4} className="validacion-empty">—</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* 🟢 En ambos */}
          <h3 className="validacion-section-title val-title--green">🟢 En ambos ({reconc.ambos.filter(matchSearch).length})</h3>
          <div className="table-wrap validacion-table-wrap--sm">
            <table className="validacion-table">
              <thead><tr><th>Hacienda · Suerte</th><th>Labor</th><th className="num">Ha Excel</th><th className="num">Ha app</th><th>Dif.</th></tr></thead>
              <tbody>
                {reconc.ambos.filter(matchSearch).map((g, i) => {
                  const dif = Math.abs(g.ha - g.haApp)
                  return (
                    <tr key={i}>
                      <td>{g.hacienda} · {g.suerte}</td>
                      <td>{g.labor}{g.x2 && <span className="x2-badge">×2</span>}</td>
                      <td className="num">{g.ha.toFixed(2)}</td>
                      <td className="num">{g.haApp.toFixed(2)}</td>
                      <td>{dif > 0.1 ? <span className="val-faltan">⚠ {dif.toFixed(2)}</span> : '✓'}</td>
                    </tr>
                  )
                })}
                {reconc.ambos.filter(matchSearch).length === 0 && (
                  <tr><td colSpan={5} className="validacion-empty">—</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <>
          <div className="validacion-kpis">
            <div className="validacion-kpi"><strong>{kpis.total}</strong><span>registros</span></div>
            <div className="validacion-kpi"><strong>{kpis.ejec.toFixed(2)}</strong><span>ha ejecutadas</span></div>
            <div className="validacion-kpi validacion-kpi--green"><strong>{kpis.completas}</strong><span>completas</span></div>
            <div className="validacion-kpi validacion-kpi--amber"><strong>{kpis.curso}</strong><span>en curso</span></div>
            <div className="validacion-kpi validacion-kpi--red"><strong>{kpis.incompletas}</strong><span>incompletas</span></div>
            <div className="validacion-kpi"><strong>{kpis.porAprobar}</strong><span>por aprobar</span></div>
          </div>

          <div className="table-wrap validacion-table-wrap">
            <table className="validacion-table">
              <thead>
                <tr>
                  <th></th><th>Fecha</th><th>Hacienda · Suerte</th><th>Labor</th>
                  <th>Operario</th><th className="num">Ha ejec.</th><th>Aprob.</th><th>Falta</th>
                </tr>
              </thead>
              <tbody>
                {internalRows.map(({ a, v }) => (
                  <tr key={a.id}>
                    <td><span className={`val-dot val-dot--${v.nivel}`} title={v.nivel} /></td>
                    <td className="nowrap">{executionDateKey(a) || '—'}</td>
                    <td>{a.haciendaName} · {a.suerte}</td>
                    <td>{a.labor}{appRowX2(a) && <span className="x2-badge">×2</span>}</td>
                    <td>{a.operatorName || '—'}</td>
                    <td className="num">{a.executedArea > 0 ? a.executedArea.toFixed(2) : '—'}</td>
                    <td>
                      {a.approval === 'APROBADA' && <span className="val-aprob ok">✓</span>}
                      {a.approval === 'PENDIENTE' && <span className="val-aprob pend">Por aprobar</span>}
                      {a.approval === 'RECHAZADA' && <span className="val-aprob rej">Rechazada</span>}
                    </td>
                    <td className="val-faltan">{v.nivel === 'completa' ? '—' : v.faltan.join(', ')}</td>
                  </tr>
                ))}
                {internalRows.length === 0 && (
                  <tr><td colSpan={8} className="validacion-empty">Sin registros para los filtros seleccionados.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}

export default ValidationTab
