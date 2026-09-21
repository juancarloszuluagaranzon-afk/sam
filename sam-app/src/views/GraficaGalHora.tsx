import { NIVEL, describirRango, type NivelSemaforo, type RangoSemaforo } from '../lib/semaforo'

/**
 * Galones del mes por máquina, con su galones/hora encima y, debajo de cada
 * barra, la máquina, el horómetro inicial, el final y las horas.
 *
 * Es el dibujo que mandó el cliente en una hoja cuadriculada (21-sep-2026): una
 * barra por máquina («8 gal», «20 gal»), arriba «1 gal/h», «2 gal/h», y abajo una
 * tabla alineada con las barras. Por eso es una REJILLA y no un gráfico con su
 * tabla aparte: cada columna es una máquina de arriba abajo, y el ojo baja de la
 * barra a sus horómetros sin buscar.
 *
 * - La barra es galones (lo que se gastó). El número de encima es gal/h, que es
 *   lo que se juzga — lleva el color y el símbolo del semáforo del cliente.
 * - Horas = horómetro final − inicial del mes. Si las lecturas venían tan sucias
 *   que hubo que sumar las labores, la casilla lo dice (Σ) en vez de fingir que
 *   la resta cuadra.
 * - 22 máquinas no caben en un celular: la rejilla se desliza de lado y la
 *   columna de rótulos se queda quieta a la izquierda.
 */

export interface ColumnaGalHora {
  codigo: string
  nombre: string
  galones: number
  horas: number
  galHora: number | null
  inicial: number | null
  final: number | null
  /** Las horas salieron de sumar las labores: el horómetro no se pudo leer de punta a punta. */
  porSuma: boolean
  nivel: NivelSemaforo | null
  rango: RangoSemaforo | null
}

const ALTO_BARRAS = 170 // px del área de barras
// 🔴 En las máquinas con la serie sucia NO se muestran sus lecturas: la limpieza se
// quedó con restos como «inicial 1 · final 55» o «147.284 → 147.284», y ponerlas en
// la tabla haría creer que la resta da esas horas. Medido en sep-2026: 6 de 22.
const SUCIO = 'Las lecturas de este horómetro vienen sucias: no hay un inicial y un final confiables. Revisar en Más → Horómetros.'
const n1 = (n: number) => n.toLocaleString('es-CO', { maximumFractionDigits: 1 })
const n2 = (n: number) => n.toLocaleString('es-CO', { maximumFractionDigits: 2 })

export function GraficaGalHora({ columnas }: { columnas: ColumnaGalHora[] }) {
  const cols = columnas.filter((c) => c.galones > 0)
  if (cols.length === 0) return null
  const max = Math.max(...cols.map((c) => c.galones), 0.0001)

  return (
    <div className="ggh">
      <p className="ins-res__lbl" style={{ margin: '18px 0 6px' }}>Galones y galones por hora, máquina por máquina</p>
      <div className="ggh__scroll" role="region" aria-label="Galones por máquina" tabIndex={0}>
        {/* Ancho = el del panel; solo se desliza si las columnas no caben a 3,3em
            (≈53 px: lo que ocupa «11.490,2», la cifra más ancha). Con `max-content`
            cada columna tomaba el ancho de su nombre en una línea y 22 máquinas
            pedían 2.094 px aun en un monitor de 1.440. */}
        <div className="ggh__grid" style={{
          gridTemplateColumns: `6.6em repeat(${cols.length}, minmax(3.3em, 1fr))`,
          minWidth: `calc(6.6em + ${cols.length} * (3.3em + 4px))`,
        }}>
          {/* ── Barras ─────────────────────────────────────────────── */}
          <div className="ggh__eje" style={{ height: ALTO_BARRAS + 44 }}><span>Galones</span></div>
          {cols.map((c) => {
            const alto = Math.max((c.galones / max) * ALTO_BARRAS, 3)
            const adentro = alto >= 30 // si no cabe el número dentro, va encima
            return (
              <div key={c.codigo} className="ggh__col" style={{ height: ALTO_BARRAS + 44 }}
                   title={`${c.nombre}: ${n1(c.galones)} gal en ${c.horas ? n1(c.horas) : '—'} h${c.rango ? ` · rango ${describirRango(c.rango)} gal/h` : ''}`}>
                {c.galHora != null ? (
                  <span className={`dash-galh ggh__galh${c.nivel ? ` dash-galh--${c.nivel}` : ''}`}>
                    {c.nivel && `${NIVEL[c.nivel].icono} `}{n2(c.galHora)}<small>gal/h</small>
                  </span>
                ) : (
                  <span className="dash-galh dash-galh--sin ggh__galh">sin horas</span>
                )}
                {!adentro && <span className="ggh__gal ggh__gal--fuera">{n1(c.galones)} gal</span>}
                <span className="ggh__barra" style={{ height: alto }}>
                  {adentro && <span className="ggh__gal">{n1(c.galones)}<small> gal</small></span>}
                </span>
              </div>
            )
          })}

          {/* ── La tabla, alineada con las barras ──────────────────── */}
          <div className="ggh__rot">Máquina</div>
          {cols.map((c) => <div key={c.codigo} className="ggh__cel ggh__cel--maq">{c.nombre}</div>)}

          <div className="ggh__rot">Horómetro inicial</div>
          {cols.map((c) => <div key={c.codigo} className="ggh__cel" title={c.porSuma ? SUCIO : undefined}>{!c.porSuma && c.inicial != null ? n1(c.inicial) : '—'}</div>)}

          <div className="ggh__rot">Horómetro final</div>
          {cols.map((c) => <div key={c.codigo} className="ggh__cel" title={c.porSuma ? SUCIO : undefined}>{!c.porSuma && c.final != null ? n1(c.final) : '—'}</div>)}

          <div className="ggh__rot">Horas</div>
          {cols.map((c) => (
            <div key={c.codigo} className="ggh__cel ggh__cel--horas"
                 title={c.porSuma ? 'Suma de las labores: las lecturas del horómetro vienen sucias y no se pudo restar final − inicial' : undefined}>
              {c.horas ? <>{c.porSuma && 'Σ '}{n1(c.horas)}</> : '—'}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
