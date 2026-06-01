import { useMemo, useState } from 'react'
import { useAppData } from '../context/AppDataContext'
import { executionDateKey, getIngenioName } from '../services/samApi'
import type { Assignment } from '../domain/sam'

/**
 * Pestaña "Validación" (solo jefe/owner y administración).
 *
 * Objetivo: que jefe y administración verifiquen que TODO lo que llevan en el
 * Excel paralelo ya quedó bien diligenciado en el app, detecten registros
 * incompletos, y exporten la data en el formato de columnas de su Excel para
 * cruzar 1:1 mientras corren ambos sistemas en paralelo.
 *
 * Decisiones acordadas con el usuario (2026-05-31):
 * - Regla ×2 (DESPEJE/REENCALLE/REENCALLE V): el app deja DOS líneas que
 *   suman el doble del área; aquí NO se multiplica por un factor — el "área
 *   ejecutada total" simplemente SUMA esas líneas (= el "facturar 2" del Excel).
 * - Validación = consistencia interna (que cada registro tenga sus campos).
 * - Export con las columnas del Excel "Resumen de Labores".
 */

type Nivel = 'completa' | 'curso' | 'incompleta'

interface Validacion {
  nivel: Nivel
  faltan: string[]
}

// Determina si un registro está "diligenciado" y qué le falta.
// - 🟢 completa : COMPLETADA con área ejecutada, horómetro final y operario.
// - 🟡 curso    : EN_PROCESO o PARCIAL (tiene avance pero no está cerrada).
// - 🔴 incompleta: PENDIENTE (sin iniciar) o COMPLETADA con campos faltantes.
function validar(a: Assignment): Validacion {
  if (a.status === 'PENDIENTE') {
    return { nivel: 'incompleta', faltan: ['sin iniciar'] }
  }
  if (a.status === 'EN_PROCESO') {
    return { nivel: 'curso', faltan: ['sin finalizar'] }
  }
  const faltan: string[] = []
  if (!(a.executedArea > 0)) faltan.push('área ejecutada')
  if (a.horometroFinal == null) faltan.push('horómetro final')
  if (!a.operatorName) faltan.push('operario')
  if (!a.equipmentName) faltan.push('equipo')
  if (a.status === 'PARCIAL') {
    return { nivel: 'curso', faltan: faltan.length ? faltan : ['parcial (sigue activa)'] }
  }
  // COMPLETADA
  return { nivel: faltan.length ? 'incompleta' : 'completa', faltan }
}

function clienteCorto(a: Assignment, maestro: Parameters<typeof getIngenioName>[1]): string {
  return (getIngenioName(a, maestro) ?? '').replace(/^Ingenio\s+/i, '').toUpperCase()
}

export function ValidationTab() {
  const { assignments, maestro, users, todayKey, busy, setBusy, setError, setInfo } = useAppData()

  const [mes, setMes] = useState(() => todayKey.slice(0, 7))
  const [quincena, setQuincena] = useState<'MES' | 'Q1' | 'Q2'>('MES')
  const [search, setSearch] = useState('')
  const [nivelFilter, setNivelFilter] = useState<'todas' | Nivel>('todas')

  const supName = useMemo(() => {
    const byId = new Map(users.map((u) => [u.id, u.name]))
    return (id: string) => byId.get(id) ?? id
  }, [users])

  // Meses disponibles (por fecha de EJECUCIÓN) + el mes actual.
  const meses = useMemo(() => {
    const set = new Set<string>()
    assignments.forEach((a) => {
      const k = executionDateKey(a)
      if (k) set.add(k.slice(0, 7))
    })
    set.add(todayKey.slice(0, 7))
    return Array.from(set).sort((a, b) => b.localeCompare(a))
  }, [assignments, todayKey])

  // Registros del período (excluye CANCELADA: no hay nada que validar ahí).
  const periodRows = useMemo(() => {
    return assignments
      .filter((a) => a.status !== 'CANCELADA')
      .filter((a) => {
        const k = executionDateKey(a)
        if (!k || k.slice(0, 7) !== mes) return false
        if (quincena === 'MES') return true
        const day = Number(k.slice(8, 10))
        return quincena === 'Q1' ? day <= 15 : day >= 16
      })
  }, [assignments, mes, quincena])

  // KPIs del período completo (no afectados por la búsqueda/filtro de nivel).
  const kpis = useMemo(() => {
    let ejec = 0
    let completas = 0
    let curso = 0
    let incompletas = 0
    let porAprobar = 0
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

  // Filas para la tabla (con búsqueda + filtro de nivel aplicados).
  const rows = useMemo(() => {
    const term = search.trim().toLowerCase()
    return periodRows
      .map((a) => ({ a, v: validar(a) }))
      .filter(({ a }) => {
        if (!term) return true
        return `${a.haciendaName} ${a.suerte} ${a.labor} ${a.operatorName}`
          .toLowerCase()
          .includes(term)
      })
      .filter(({ v }) => (nivelFilter === 'todas' ? true : v.nivel === nivelFilter))
      .sort((x, y) => (executionDateKey(y.a) > executionDateKey(x.a) ? 1 : -1))
  }, [periodRows, search, nivelFilter])

  async function exportar() {
    if (periodRows.length === 0) return
    setBusy(true)
    setError('')
    try {
      const { utils, writeFile } = await import('xlsx')
      // Encabezado IGUAL al de la hoja "Resumen de Labores" del Excel del usuario
      // (incluye columnas en blanco y MATAS duplicada → usamos array-of-arrays).
      const header = [
        'FECHA', 'EMPRESA', 'CLIENTE', 'SERVICIO', 'SECTOR', 'LABOR', 'HACIENDA',
        'SUERTE', 'HA', ' ', 'MATAS', 'OPERARIO', 'CABO', 'FACTURA ',
        'FECHA DE FACTURA ', ' VALOR FACTURA ', 'OBSERVACION ', 'MATAS ', 'ACTA ',
        'FECHA2', 'DUDA, PREGUNTAR',
      ]
      const aoa: (string | number)[][] = [header]
      // Exportamos por fecha de ejecución, más reciente primero.
      const ordered = [...periodRows].sort((a, b) =>
        executionDateKey(b) > executionDateKey(a) ? 1 : -1,
      )
      for (const a of ordered) {
        aoa.push([
          executionDateKey(a),                                  // FECHA
          'AGROMORALES',                                        // EMPRESA (fijo)
          clienteCorto(a, maestro),                             // CLIENTE (ingenio)
          '',                                                   // SERVICIO
          a.zone ?? '',                                         // SECTOR (zona)
          a.labor,                                              // LABOR
          a.haciendaName,                                       // HACIENDA
          a.suerte,                                             // SUERTE
          a.executedArea > 0 ? a.executedArea : a.area,         // HA (ejecutada)
          '',                                                   // (nota / facturar)
          '',                                                   // MATAS
          a.operatorName,                                       // OPERARIO
          supName(a.supervisorId),                              // CABO (supervisor)
          '', '', '',                                           // FACTURA / FECHA / VALOR
          a.notes,                                              // OBSERVACION
          '', '', '', '',                                       // MATAS / ACTA / FECHA2 / DUDA
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
        <button
          type="button"
          className="primary-button outline validacion-export-btn"
          onClick={() => void exportar()}
          disabled={busy || periodRows.length === 0}
        >
          ⬇ Exportar Excel
        </button>
      </div>

      <p className="subtle-copy" style={{ marginTop: 0 }}>
        Verifica que todo lo del Excel ya esté en el app. Las labores que se
        facturan ×2 (despeje/reencalle) quedan como dos líneas; el área total ya
        las suma. Exporta para cruzar 1:1 con tu Excel.
      </p>

      {/* Filtros */}
      <div className="validacion-filters">
        <label>
          Mes
          <select value={mes} onChange={(e) => setMes(e.target.value)}>
            {meses.map((m) => {
              const [y, mo] = m.split('-')
              const label = new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString('es-CO', {
                month: 'long',
                year: 'numeric',
              })
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
        <label>
          Estado
          <select value={nivelFilter} onChange={(e) => setNivelFilter(e.target.value as 'todas' | Nivel)}>
            <option value="todas">Todas</option>
            <option value="incompleta">🔴 Incompletas</option>
            <option value="curso">🟡 En curso</option>
            <option value="completa">🟢 Completas</option>
          </select>
        </label>
        <label className="validacion-search">
          Buscar
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Hacienda, suerte, labor u operario…"
          />
        </label>
      </div>

      {/* KPIs */}
      <div className="validacion-kpis">
        <div className="validacion-kpi">
          <strong>{kpis.total}</strong>
          <span>registros</span>
        </div>
        <div className="validacion-kpi">
          <strong>{kpis.ejec.toFixed(2)}</strong>
          <span>ha ejecutadas</span>
        </div>
        <div className="validacion-kpi validacion-kpi--green">
          <strong>{kpis.completas}</strong>
          <span>completas</span>
        </div>
        <div className="validacion-kpi validacion-kpi--amber">
          <strong>{kpis.curso}</strong>
          <span>en curso</span>
        </div>
        <div className="validacion-kpi validacion-kpi--red">
          <strong>{kpis.incompletas}</strong>
          <span>incompletas</span>
        </div>
        <div className="validacion-kpi">
          <strong>{kpis.porAprobar}</strong>
          <span>por aprobar</span>
        </div>
      </div>

      {/* Tabla */}
      <div className="table-wrap validacion-table-wrap">
        <table className="validacion-table">
          <thead>
            <tr>
              <th></th>
              <th>Fecha</th>
              <th>Hacienda · Suerte</th>
              <th>Labor</th>
              <th>Operario</th>
              <th className="num">Ha ejec.</th>
              <th>Aprob.</th>
              <th>Falta</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ a, v }) => (
              <tr key={a.id}>
                <td>
                  <span className={`val-dot val-dot--${v.nivel}`} title={v.nivel} />
                </td>
                <td className="nowrap">{executionDateKey(a) || '—'}</td>
                <td>{a.haciendaName} · {a.suerte}</td>
                <td>{a.labor}</td>
                <td>{a.operatorName || '—'}</td>
                <td className="num">{a.executedArea > 0 ? a.executedArea.toFixed(2) : '—'}</td>
                <td>
                  {a.approval === 'APROBADA' && <span className="val-aprob ok">✓</span>}
                  {a.approval === 'PENDIENTE' && <span className="val-aprob pend">Por aprobar</span>}
                  {a.approval === 'RECHAZADA' && <span className="val-aprob rej">Rechazada</span>}
                </td>
                <td className="val-faltan">
                  {v.nivel === 'completa' ? '—' : v.faltan.join(', ')}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="validacion-empty">
                  Sin registros para los filtros seleccionados.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export default ValidationTab
