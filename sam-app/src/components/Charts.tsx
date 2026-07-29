/**
 * Gráficos del dashboard — SVG nativo, sin librerías.
 *
 * Por qué a mano: una librería de charts pesa 100-300 KB y este proyecto ya
 * tuvo una caída por meter chunks nuevos. Aquí controlamos el peso (0 KB extra),
 * el tamaño de los toques en celular y el comportamiento táctil.
 *
 * Reglas que sigue (guía de visualización):
 *  · Paleta categórica validada, asignada por ORDEN FIJO (nunca ciclada) y
 *    ligada a la entidad — filtrar no repinta a los que quedan.
 *  · Máximo 6 series visibles; el resto se pliega en "Otros".
 *  · Marcas finas, separación de 2px entre porciones, ejes discretos.
 *  · Todo elemento es tocable y avisa al padre para abrir el detalle.
 */

/**
 * Paleta categórica validada, por VARIABLE CSS: los tonos claros no alcanzan
 * 3:1 sobre el fondo oscuro (el violeta queda en 2.04), así que cada modo tiene
 * sus propios pasos — definidos en App.css, no volteados automáticamente.
 */
export const SERIES = [
  'var(--dash-s1)', 'var(--dash-s2)', 'var(--dash-s3)',
  'var(--dash-s4)', 'var(--dash-s5)', 'var(--dash-s6)',
] as const
export const SERIE_OTROS = 'var(--dash-otros)'

export interface Punto {
  id: string
  label: string
  valor: number
}

/** Color estable por posición (la entidad manda, no el ranking del filtro). */
export function colorDe(idx: number): string {
  return idx < SERIES.length ? SERIES[idx] : SERIE_OTROS
}

/** Agrupa la cola en "Otros" para no pasar de `max` porciones. */
export function plegarOtros(datos: Punto[], max = 6): Punto[] {
  if (datos.length <= max) return datos
  const orden = [...datos].sort((a, b) => b.valor - a.valor)
  const top = orden.slice(0, max - 1)
  const resto = orden.slice(max - 1)
  const suma = resto.reduce((t, d) => t + d.valor, 0)
  return suma > 0 ? [...top, { id: '__otros', label: `Otros (${resto.length})`, valor: suma }] : top
}

/* ─────────────────────────── Donut (parte-a-todo) ─────────────────────────── */

function arco(cx: number, cy: number, r: number, desde: number, hasta: number): string {
  const p = (ang: number) => [cx + r * Math.cos(ang), cy + r * Math.sin(ang)]
  const [x1, y1] = p(desde)
  const [x2, y2] = p(hasta)
  const grande = hasta - desde > Math.PI ? 1 : 0
  return `M ${x1} ${y1} A ${r} ${r} 0 ${grande} 1 ${x2} ${y2}`
}

export function Donut({
  datos,
  total,
  unidad,
  onPick,
}: {
  datos: Punto[]
  total: number
  unidad: string
  onPick?: (p: Punto) => void
}) {
  const suma = datos.reduce((t, d) => t + d.valor, 0)
  if (suma <= 0) return <p className="dash-vacio">Sin datos en este periodo.</p>

  const size = 190
  const cx = size / 2
  const cy = size / 2
  const r = 74
  const grosor = 26
  // Separación de 2px entre porciones (en radianes sobre este radio).
  const gap = 2 / r
  let ang = -Math.PI / 2

  return (
    <div className="dash-donut">
      <svg viewBox={`0 0 ${size} ${size}`} className="dash-donut__svg" role="img" aria-label="Participación">
        {datos.map((d, i) => {
          const frac = d.valor / suma
          const desde = ang + gap / 2
          const hasta = ang + frac * Math.PI * 2 - gap / 2
          ang += frac * Math.PI * 2
          if (hasta <= desde) return null
          return (
            <path
              key={d.id}
              d={arco(cx, cy, r, desde, hasta)}
              stroke={d.id === '__otros' ? SERIE_OTROS : colorDe(i)}
              strokeWidth={grosor}
              fill="none"
              className={onPick ? 'dash-arc is-tap' : 'dash-arc'}
              onClick={() => onPick?.(d)}
              role={onPick ? 'button' : undefined}
              aria-label={`${d.label}: ${d.valor.toFixed(2)} ${unidad}`}
            />
          )
        })}
        <text x={cx} y={cy - 4} textAnchor="middle" className="dash-donut__num">
          {total.toFixed(total >= 100 ? 0 : 1)}
        </text>
        <text x={cx} y={cy + 14} textAnchor="middle" className="dash-donut__uni">{unidad}</text>
      </svg>

      <ul className="dash-leyenda">
        {datos.map((d, i) => {
          const pct = (d.valor / suma) * 100
          return (
            <li key={d.id}>
              <button type="button" onClick={() => onPick?.(d)} disabled={!onPick}>
                <span className="dash-chip" style={{ background: d.id === '__otros' ? SERIE_OTROS : colorDe(i) }} />
                <span className="dash-leyenda__lbl">{d.label}</span>
                <span className="dash-leyenda__val">{d.valor.toFixed(2)} <small>{pct.toFixed(0)}%</small></span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/* ────────────────────── Barras horizontales (magnitud) ────────────────────── */

export function BarrasH({
  datos,
  unidad,
  onPick,
  color = SERIES[0],
}: {
  datos: Punto[]
  unidad: string
  onPick?: (p: Punto) => void
  color?: string
}) {
  if (datos.length === 0) return <p className="dash-vacio">Sin datos en este periodo.</p>
  const max = Math.max(...datos.map((d) => d.valor), 0.0001)
  return (
    <div className="dash-barras">
      {datos.map((d) => (
        <button
          key={d.id}
          type="button"
          className="dash-barra"
          onClick={() => onPick?.(d)}
          disabled={!onPick}
          aria-label={`${d.label}: ${d.valor.toFixed(2)} ${unidad}`}
        >
          <span className="dash-barra__lbl">{d.label}</span>
          <span className="dash-barra__track">
            <span className="dash-barra__fill" style={{ width: `${Math.max((d.valor / max) * 100, 2)}%`, background: color }} />
          </span>
          <span className="dash-barra__val">{d.valor.toFixed(d.valor >= 100 ? 0 : 2)}</span>
        </button>
      ))}
    </div>
  )
}

/* ───────────────────── Columnas por día (evolución) ───────────────────── */

export function Columnas({
  datos,
  onPick,
  color = SERIES[0],
}: {
  datos: Punto[]
  onPick?: (p: Punto) => void
  color?: string
}) {
  if (datos.length === 0) return <p className="dash-vacio">Sin datos en este periodo.</p>
  const max = Math.max(...datos.map((d) => d.valor), 0.0001)
  return (
    <div className="dash-cols" style={{ ['--n' as string]: datos.length }}>
      {datos.map((d) => (
        <button
          key={d.id}
          type="button"
          className="dash-col"
          onClick={() => onPick?.(d)}
          disabled={!onPick}
          aria-label={`${d.label}: ${d.valor.toFixed(2)}`}
          title={`${d.label}: ${d.valor.toFixed(2)}`}
        >
          <span className="dash-col__wrap">
            <span
              className="dash-col__fill"
              style={{ height: `${Math.max((d.valor / max) * 100, 3)}%`, background: color }}
            />
          </span>
          <span className="dash-col__lbl">{d.label}</span>
        </button>
      ))}
    </div>
  )
}
