import { useEffect, useMemo, useState } from 'react'
import type { Assignment } from '../domain/sam'
import { useAppData } from '../context/AppDataContext'
import { executionDateKey, loadOperarioNovedades, novLetter, type NovedadTipo } from '../services/samApi'
import { avanceCerradoPorSuerte, areaDelDia, cuentaEnPlanilla, diasDelMes } from '../lib/planilla'
import { Ayuda } from './Ayuda'

/**
 * La línea de planilla del propio operario, del mes que va corriendo.
 *
 * **Por qué existe.** Es la fila con la que se le paga, y hasta ahora solo la
 * veía la oficina: el operario tenía que preguntar cuánto le habían registrado.
 * Que cada uno vea su propia línea convierte un reclamo de fin de quincena
 * —cuando ya nadie se acuerda del día— en una corrección del mismo día.
 *
 * 🔴 Sale de `lib/planilla.ts`, **el mismo cálculo de la Planilla de la oficina**.
 * Si fuera una cuenta aparte, tarde o temprano daría otro número, y dos cifras
 * distintas para lo que se paga es peor que no mostrar ninguna: el operario
 * creería que le están quitando.
 *
 * Solo mira, no toca: corregir un área sigue siendo del supervisor.
 */
export function MiPlanilla({ assignments, operatorId }: {
  assignments: Assignment[]
  operatorId: string
}) {
  const { todayKey, novedadTipos } = useAppData()
  const [novedades, setNovedades] = useState<Map<string, NovedadTipo>>(new Map())

  const mes = todayKey.slice(0, 7)
  const dias = useMemo(() => diasDelMes(mes, todayKey), [mes, todayKey])

  useEffect(() => {
    if (!operatorId) return
    let vivo = true
    // Solo las suyas: `loadOperarioNovedades` ya recibe el filtro.
    void loadOperarioNovedades(operatorId).catch(() => []).then((ns) => {
      if (!vivo) return
      const m = new Map<string, NovedadTipo>()
      for (const n of ns) m.set(n.fecha, n.tipo)
      setNovedades(m)
    })
    return () => { vivo = false }
  }, [operatorId])

  const colorDe = useMemo(() => {
    const m = new Map<string, string | undefined>()
    for (const n of novedadTipos) m.set(n.codigo, n.color)
    return m
  }, [novedadTipos])

  const { porDia, enProceso, total } = useMemo(() => {
    // ⚠️ El avance cerrado se arma con TODAS las asignaciones que tenga cargadas,
    // no solo con las suyas: una suerte la avanzan varios entre todos y filtrarlo
    // por operario le mostraria mas de lo que la planilla le paga.
    const cerrado = avanceCerradoPorSuerte(assignments)
    const dias = new Set<string>()
    const pd: Record<string, number> = {}
    const ep: Record<string, boolean> = {}
    let t = 0
    for (const a of assignments) {
      if (!cuentaEnPlanilla(a)) continue
      if ((a.operatorId || '') !== operatorId) continue
      const dk = executionDateKey(a)
      if (!dk.startsWith(mes)) continue
      const { area, enProceso } = areaDelDia(a, cerrado)
      pd[dk] = (pd[dk] ?? 0) + area
      if (enProceso) ep[dk] = true
      t += area
      dias.add(dk)
    }
    return { porDia: pd, enProceso: ep, total: t }
  }, [assignments, operatorId, mes])

  const nombreMes = new Date(`${mes}-01T12:00:00`).toLocaleDateString('es-CO', { month: 'long', year: 'numeric' })

  return (
    <section className="panel-card">
      <div className="panel-title split">
        <h2>🗓️ Mi planilla de {nombreMes}</h2>
        <strong className="planilla-total-col">{total > 0 ? total.toFixed(2) : '0.00'}</strong>
      </div>

      <Ayuda>
        <p>
          Esta es <strong>su línea del mes</strong>, la misma con la que se liquida en la
          oficina — no es una cuenta aparte. Cada casilla es el área que quedó registrada
          ese día; las letras son las novedades (descanso, incapacidad, permiso…).
        </p>
        <p>
          Si un día no cuadra, <strong>avísele al supervisor ese mismo día</strong>: es
          mucho más fácil arreglarlo ahí que a fin de quincena, cuando ya nadie se acuerda
          de qué suerte era.
        </p>
      </Ayuda>

      <div className="planilla-scroll" style={{ marginTop: 10 }}>
        <table className="planilla-table">
          <thead>
            <tr>
              {dias.map((d) => (
                <th key={d.key} className={d.isToday ? 'planilla-today' : ''}>
                  <span className="planilla-wd">{d.weekday}</span>
                  <span className="planilla-day">{d.day}</span>
                </th>
              ))}
              <th className="planilla-total-col">Total</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              {dias.map((d) => {
                const v = porDia[d.key] ?? 0
                const nov = novedades.get(d.key)
                const num = v > 0 ? (enProceso[d.key] ? ' planilla-num--proceso' : ' planilla-num--terminada') : ''
                return (
                  <td key={d.key}
                      className={`planilla-cell${d.isToday ? ' planilla-today' : ''}${num}${nov ? ` planilla-nov planilla-nov--${nov.toLowerCase()}` : ''}`}
                      title={nov ? (novedadTipos.find((n) => n.codigo === nov)?.nombre ?? nov) : undefined}>
                    {nov ? <b style={{ color: colorDe.get(nov) }}>{novLetter(nov)}</b> : (v > 0 ? v.toFixed(2) : '')}
                  </td>
                )
              })}
              <td className="planilla-total-col"><strong>{total > 0 ? total.toFixed(2) : ''}</strong></td>
            </tr>
          </tbody>
        </table>
      </div>

      <p className="subtle-copy" style={{ marginTop: 8 }}>
        Los días en <strong>naranja</strong> son labores que siguen abiertas: ese número es
        lo que falta de la suerte y todavía puede cambiar al cerrarla.
      </p>
    </section>
  )
}

export default MiPlanilla
