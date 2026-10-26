import { nombreLabor } from '../../lib/fincas'
import type { LineaPlan } from '../../lib/planCorte'

/**
 * Cronograma en días después del corte (DDC): una barra por labor con su ventana ideal (verde, hasta el día)
 * y su ventana normal (arena); pasada la normal, es tardía. Es el dibujo de la maqueta aprobada el 25-oct-2026.
 * `marcas` pone una raya negra en el día real de una labor (la fecha del reporte); en el asistente todavía no hay.
 */
export function CronogramaDDC({ lineas, marcas }: { lineas: LineaPlan[]; marcas?: Record<string, number> }) {
  const filas = lineas.filter((l) => !l.repetible && l.ventanaIdeal != null && l.ventanaNormal != null)
  const repetidas = lineas.filter((l) => l.repetible)
  if (filas.length === 0) return <p className="af-nota">Ninguna labor de este corte trae ventana de tiempo: se programan por calendario.</p>
  const maxNormal = Math.max(...filas.map((l) => l.ventanaNormal as number))
  const eje = Math.max(90, Math.ceil(maxNormal / 30) * 30)
  const marcasEje = Array.from({ length: eje / 15 + 1 }, (_, i) => i * 15).filter((v) => eje <= 90 || v % 30 === 0)
  const pos = (dias: number) => `${Math.min(100, Math.max(0, (dias / eje) * 100))}%`
  const nota = filas.map((l) => `${nombreLabor(l.labor)}${l.variedadFila ? ` ${l.variedadFila}` : ''}: ${l.ventanaIdeal}/${l.ventanaNormal}`).join(' · ')

  return (
    <div className="af-crono" role="img" aria-label={`Cronograma en días después del corte. ${nota}`}>
      <p className="af-crono__tit">Cronograma en días después del corte (DDC) · ventana ideal y normal</p>
      <div className="af-crono__eje">
        <span />
        <div className="af-crono__regla">
          {marcasEje.map((v) => <span key={v} style={{ left: pos(v) }}>{v}</span>)}
          <em>DDC</em>
        </div>
      </div>
      {filas.map((l) => (
        <div key={l.clave} className="af-crono__fila">
          <span className="af-crono__lab">{nombreLabor(l.labor)}{l.variedadFila ? ` ${l.variedadFila}` : ''}</span>
          <div className="af-crono__pista">
            {marcasEje.map((v) => <i key={v} className="af-crono__linea" style={{ left: pos(v) }} />)}
            <b className="af-crono__normal" style={{ left: pos(l.ventanaIdeal as number), width: `calc(${pos(l.ventanaNormal as number)} - ${pos(l.ventanaIdeal as number)})` }} />
            <b className="af-crono__ideal" style={{ left: 0, width: pos(l.ventanaIdeal as number) }} />
            {marcas?.[l.clave] != null && <u className="af-crono__marca" style={{ left: pos(marcas[l.clave]) }} />}
          </div>
        </div>
      ))}
      <ul className="af-crono__leyenda">
        <li><i className="af-crono__sw af-crono__sw--ideal" />Ideal (hasta el día)</li>
        <li><i className="af-crono__sw af-crono__sw--normal" />Normal</li>
        <li>Después = tardía</li>
        {marcas && <li><i className="af-crono__sw af-crono__sw--marca" />Fecha real del reporte</li>}
      </ul>
      <small className="af-nota">
        Ventanas tomadas del catálogo ({nota}).
        {repetidas.length > 0 ? ` ${repetidas.map((l) => nombreLabor(l.labor)).join(' y ')} ${repetidas.length === 1 ? 'es una labor' : 'son labores'} de varias pasadas: se programan por calendario.` : ''}
      </small>
    </div>
  )
}
