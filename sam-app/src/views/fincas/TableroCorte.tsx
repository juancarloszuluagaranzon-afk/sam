import { useEffect, useRef, useState } from 'react'
import type { DatosFincas } from '../../services/fincasApi'
import { fmtCant, fmtPesosCorto, nombreLabor } from '../../lib/fincas'
import { tableroCorte, semaforoIndice, type FilaLaborTablero, type PuntoCurva, type TableroCorte as Tablero } from '../../lib/tableroCorte'
import { Ayuda } from '../../components/Ayuda'

/**
 * «Plan y avance» de una finca (26-oct-2026): lo presupuestado, lo que ya debería llevarse, lo gastado y lo que
 * de verdad se avanzó, con su curva S y las alertas. Todo sale de `lib/tableroCorte` (que se prueba aparte);
 * esta pantalla solo lo dibuja. Con `esAdmin` falso (el dueño) se esconden las alertas de cómo se registra.
 */

const CHIP = { ok: 'af-chip--ok', ojo: 'af-chip--ojo', mal: 'af-chip--mal', neutro: 'af-chip--neutro' } as const
const ESTADO: Record<FilaLaborTablero['estado'], { c: string; t: string }> = {
  terminada: { c: 'af-chip--ok', t: 'Terminada' },
  en_curso: { c: 'af-chip--neutro', t: 'En curso' },
  sin_iniciar: { c: 'af-chip--neutro', t: 'Sin iniciar' },
  atrasada: { c: 'af-chip--mal', t: 'Atrasada' },
}
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const idx = (v: number | null): string => (v == null ? '—' : v.toFixed(2).replace('.', ','))
const pct = (v: number): string => `${Math.round(v * 100)} %`

/** Ancho disponible del contenedor, para dibujar la curva a su tamaño real y que el texto no se encoja en el celular. */
function useAncho(ref: React.RefObject<HTMLDivElement | null>, inicial = 640): number {
  const [w, setW] = useState(inicial)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const medir = () => { const a = Math.round(el.getBoundingClientRect().width); if (a > 0) setW(a) }
    medir()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(medir)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return w
}

const dms = (f: string): number => Date.parse(`${f}T12:00:00Z`)

function Curva({ t, ancho }: { t: Tablero; ancho: number }) {
  const alto = ancho < 480 ? 170 : 200
  const izq = 38, der = 10, arriba = 12, abajo = 24
  const pts: PuntoCurva[] = t.curva
  const x0 = dms(pts[0].fecha), x1 = dms(t.fin)
  const maxV = Math.max(t.presupuesto, t.proyeccion ?? 0, t.ejecutado) * 1.08 || 1
  const X = (f: string) => izq + ((dms(f) - x0) / Math.max(1, x1 - x0)) * (ancho - izq - der)
  const Y = (v: number) => alto - abajo - (v / maxV) * (alto - abajo - arriba)
  const plan = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.fecha).toFixed(1)},${Y(p.plan).toFixed(1)}`).join('')
  const real = pts.filter((p) => p.real !== null).map((p, i) => `${i ? 'L' : 'M'}${X(p.fecha).toFixed(1)},${Y(p.real as number).toFixed(1)}`).join('')
  const xh = X(t.hoy)
  const yAC = Y(t.ejecutado)
  const marcas = [0, 0.5, 1].map((f) => t.presupuesto * f)
  // Una marca de mes cada 3 (cada 4 si el ancho es corto), al día 1.
  const ticks: string[] = []
  const paso = ancho < 480 ? 4 : 3
  let cur = new Date(Date.UTC(new Date(x0).getUTCFullYear(), new Date(x0).getUTCMonth() + 1, 1))
  for (let k = 0; k < 40; k++) {
    const f = cur.toISOString().slice(0, 10)
    if (dms(f) > x1) break
    if (k % paso === 0) ticks.push(f)
    cur = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1))
  }
  const resumen = `Curva S del corte. Presupuesto ${fmtPesosCorto(t.presupuesto)}, plan a hoy ${fmtPesosCorto(t.planAFecha)}, ejecutado ${fmtPesosCorto(t.ejecutado)}${t.proyeccion != null ? `, proyección al cierre ${fmtPesosCorto(t.proyeccion)}` : ''}.`
  return (
    <svg width={ancho} height={alto} viewBox={`0 0 ${ancho} ${alto}`} role="img" aria-label={resumen} className="af-curva">
      <title>{resumen}</title>
      {marcas.map((v, i) => (
        <g key={i}>
          <line x1={izq} x2={ancho - der} y1={Y(v)} y2={Y(v)} className="af-curva__rejilla" />
          <text x={izq - 5} y={Y(v) + 4} textAnchor="end" className="af-curva__txt">{Math.round(v / 1e6)}</text>
        </g>
      ))}
      {ticks.map((f) => (
        <text key={f} x={X(f)} y={alto - 7} textAnchor="middle" className="af-curva__txt">{MESES[Number(f.slice(5, 7)) - 1]} {f.slice(2, 4)}</text>
      ))}
      {t.hoy >= pts[0].fecha && t.hoy <= t.fin && (
        <>
          <line x1={xh} x2={xh} y1={arriba} y2={alto - abajo} className="af-curva__hoy" />
          <text x={xh - 4} y={arriba + 8} textAnchor="end" className="af-curva__txt">hoy</text>
        </>
      )}
      <path d={plan} className="af-curva__plan" />
      {real && <path d={real} className="af-curva__real" />}
      {t.proyeccion != null && t.hoy <= t.fin && <path d={`M${xh},${yAC} L${X(t.fin)},${Y(t.proyeccion)}`} className="af-curva__proy" />}
      <circle cx={xh} cy={yAC} r={4.5} className="af-curva__punto af-curva__punto--real" />
      {t.proyeccion != null && <circle cx={X(t.fin)} cy={Y(t.proyeccion)} r={4.5} className="af-curva__punto af-curva__punto--proy" />}
    </svg>
  )
}

export function TableroCorte({ d, fincaId, hoy, esAdmin }: { d: DatosFincas; fincaId: string; hoy: string; esAdmin: boolean }) {
  const t = tableroCorte(fincaId, d, hoy)
  const caja = useRef<HTMLDivElement>(null)
  const ancho = useAncho(caja)
  if (!t.hay) return <p className="subtle-copy">Esta finca no tiene un corte en curso. Inicie uno en «Labores por suerte» para ver su plan y su avance.</p>

  const alertas = t.alertas.filter((a) => esAdmin || !a.soloAdmin)
  const cpi = semaforoIndice(t.cpi), spi = semaforoIndice(t.spi)
  const bajo = t.proyeccion != null ? t.presupuesto - t.proyeccion : null

  return (
    <div className="af-stack af-tablero">
      <div className="af-cab af-cab--chica">
        <div>
          <p className="eyebrow">Corte en curso · {t.suertes} {t.suertes === 1 ? 'suerte' : 'suertes'} · {fmtCant(Math.round(t.hectareas * 100) / 100)} ha</p>
          <h3>Plan y avance del corte</h3>
        </div>
        <div className="af-acciones">
          <span className={`af-chip ${CHIP[spi]}`} title="Avance frente al plan a la fecha">SPI {idx(t.spi)}</span>
          <span className={`af-chip ${CHIP[cpi]}`} title="Avance frente a lo gastado">CPI {idx(t.cpi)}</span>
        </div>
      </div>
      <Ayuda>
        El presupuesto es lo aprobado para el corte. El plan a la fecha reparte cada labor en línea recta desde el corte hasta su fecha ideal
        (riego y malezas, a lo largo de un año). El valor ganado es lo que valía lo ya avanzado: el presupuesto de cada labor por su avance físico.
        SPI es el valor ganado sobre el plan a la fecha y CPI es el valor ganado sobre lo ejecutado: 0,95 o más va bien, entre 0,90 y 0,95 pide atención,
        y menos de 0,90 es una alerta. Lo ejecutado es todo lo gastado de la finca, esté ligado a una labor o no.
      </Ayuda>

      <div className="af-kpis af-kpis--compacto">
        <div className="af-kpi"><b>{fmtPesosCorto(t.presupuesto)}</b><span>Presupuesto</span><small>{t.presupuestoPorHa != null ? `${fmtPesosCorto(t.presupuestoPorHa)} por ha` : ' '}</small></div>
        <div className="af-kpi"><b>{fmtPesosCorto(t.planAFecha)}</b><span>Plan a la fecha</span><small>{t.presupuesto > 0 ? `${pct(t.planAFecha / t.presupuesto)} del total` : ' '}</small></div>
        <div className="af-kpi"><b>{fmtPesosCorto(t.ejecutado)}</b><span>Ejecutado</span><small>{t.presupuesto > 0 ? `${pct(t.ejecutado / t.presupuesto)} del presupuesto` : ' '}</small></div>
        <div className="af-kpi"><b>{fmtPesosCorto(t.valorGanado)}</b><span>Valor ganado</span><small>por avance físico</small></div>
      </div>

      <div className="af-card">
        <div className="af-cab af-cab--chica">
          <h3>Curva S acumulada</h3>
          <span className={`af-chip ${t.variacionCosto >= 0 ? 'af-chip--ok' : 'af-chip--mal'}`}>
            Variación de costo {t.variacionCosto >= 0 ? '+' : '−'}{fmtPesosCorto(Math.abs(t.variacionCosto))}
          </span>
        </div>
        <div ref={caja} className="af-curva-caja"><Curva t={t} ancho={ancho} /></div>
        <ul className="af-curva__leyenda">
          <li><i className="af-curva__sw af-curva__sw--plan" />Plan</li>
          <li><i className="af-curva__sw af-curva__sw--real" />Ejecutado</li>
          {t.proyeccion != null && (
            <li><i className="af-curva__sw af-curva__sw--proy" />Proyección al cierre {fmtPesosCorto(t.proyeccion)}
              {bajo != null && Math.abs(bajo) >= 1e5 ? ` (${fmtPesosCorto(Math.abs(bajo))} ${bajo >= 0 ? 'bajo' : 'sobre'} el presupuesto)` : ''}</li>
          )}
        </ul>
        {t.proyeccion != null && <small className="af-nota">La proyección supone que se mantiene el costo de lo avanzado hasta ahora; si faltan gastos por registrar, se queda corta.</small>}
      </div>

      {alertas.length > 0 && (
        <div className="af-card">
          <h3>Alertas</h3>
          <ul className="af-alertas">
            {alertas.map((a, i) => (
              <li key={i}><span className={`af-chip ${CHIP[a.nivel]}`}>{a.nivel === 'mal' ? 'Urgente' : a.nivel === 'ojo' ? 'Atención' : 'Bien'}</span><span>{a.texto}</span></li>
            ))}
          </ul>
        </div>
      )}

      <div className="af-card">
        <h3>Avance por labor</h3>
        <div className="af-tabla-wrap">
          <table className="af-tabla af-cat__tabla af-tab-corte">
            <thead><tr><th>Labor</th><th>Presupuesto</th><th>Plan a la fecha</th><th>Avance físico</th><th>Valor ganado</th></tr></thead>
            <tbody>
              {t.labores.map((l) => (
                <tr key={l.clave}>
                  <td data-label="Labor" className="af-cat__tipo"><b>{nombreLabor(l.labor)}</b><span className={`af-chip ${ESTADO[l.estado].c}`}>{ESTADO[l.estado].t}</span></td>
                  <td data-label="Presupuesto">{fmtPesosCorto(l.presupuesto)}</td>
                  <td data-label="Plan a la fecha">{fmtPesosCorto(l.planAFecha)}</td>
                  <td data-label="Avance físico">{pct(l.avance)}<span className="af-barra af-barra--chica" aria-hidden="true"><i style={{ width: `${Math.min(100, Math.round(l.avance * 100))}%` }} /></span></td>
                  <td data-label="Valor ganado">{fmtPesosCorto(l.valorGanado)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
