import type { CtxFincas } from './FincasView'
import { cuentaFinca, fmtCant, fmtPesosCorto, laboresDeFinca, presupuestoFinca, VER_PLATA } from '../../lib/fincas'
import { ingenioNombre } from '../../data/ingenios'

/**
 * Inicio de administración de fincas: todas las fincas de un vistazo.
 * Arriba lo que pide acción (reportes por aceptar, labores atrasadas, costos que
 * faltan en el paquete); abajo una tarjeta por finca con su plata y su avance.
 */
export function FincasInicio({ ctx, soloLista, onNueva }: { ctx: CtxFincas; soloLista?: boolean; onNueva: () => void }) {
  const { datos: d, hoy, esAdmin } = ctx
  const fincas = d.fincas.filter((f) => f.activa)
  const porAceptar = d.reportes.filter((r) => r.estado === 'PENDIENTE').length
  const filasTodas = fincas.flatMap((f) => laboresDeFinca(f.id, d, hoy).map((x) => ({ ...x, finca: f })))
  const atrasadas = filasTodas.filter((x) => x.oport?.nivel === 'tardia' && !x.oport.hecha && x.labor.estado !== 'TERMINADA')
  const ha = d.suertes.filter((s) => s.activa && fincas.some((f) => f.id === s.fincaId)).reduce((s, x) => s + x.areaHa, 0)
  const paqueteSinCosto = d.paquete.filter((p) => p.activa && p.costoUnitario <= 0).length

  return (
    <div className="af-stack">
      <div className="af-cab">
        <div>
          <p className="eyebrow">{soloLista ? 'Fincas' : 'Administración de fincas'}</p>
          <h2>{soloLista ? `${fincas.length} finca${fincas.length === 1 ? '' : 's'}` : 'Así van las fincas'}</h2>
        </div>
        {esAdmin && <button type="button" className="primary-button" onClick={onNueva}>+ Nueva finca</button>}
      </div>

      {!soloLista && (
        <>
          <div className="af-kpis">
            <div className="af-kpi"><b>{fincas.length}</b><span>fincas</span><small>{fmtCant(ha)} ha administradas</small></div>
            <button type="button" className={`af-kpi af-kpi--btn${porAceptar ? ' af-kpi--ojo' : ''}`} onClick={() => ctx.ir('aceptar')}>
              <b>{porAceptar}</b><span>por aceptar</span><small>{porAceptar ? 'reportes de campo esperando' : 'todo revisado'}</small>
            </button>
            <div className={`af-kpi${atrasadas.length ? ' af-kpi--mal' : ''}`}>
              <b>{atrasadas.length}</b><span>atrasadas</span><small>labores fuera de su ventana, sin hacer</small>
            </div>
            {VER_PLATA && <div className="af-kpi">
              <b>{fmtPesosCorto(fincas.reduce((s, f) => s + presupuestoFinca(f.id, d).ejecutado, 0))}</b>
              <span>ejecutado</span>
              <small>de {fmtPesosCorto(fincas.reduce((s, f) => s + presupuestoFinca(f.id, d).presupuesto, 0))} presupuestado</small>
            </div>}
          </div>

          {VER_PLATA && esAdmin && paqueteSinCosto > 0 && (
            <p className="af-alerta">
              ▲ {paqueteSinCosto} labor{paqueteSinCosto === 1 ? '' : 'es'} del paquete no tiene{paqueteSinCosto === 1 ? '' : 'n'} costo: sin eso el presupuesto sale en cero.{' '}
              <button type="button" className="af-link" onClick={() => ctx.ir('paquete')}>Ponerles costo</button>
            </p>
          )}
          {atrasadas.length > 0 && (
            <div className="af-card">
              <h3>⚠ Atrasadas</h3>
              <ul className="af-lista">
                {atrasadas.slice(0, 8).map((x) => (
                  <li key={x.labor.id}>
                    <button type="button" className="af-fila" onClick={() => ctx.abrirFinca(x.finca.id)}>
                      <span><b>{x.labor.labor.toLowerCase()}</b> · suerte {x.suerte.codigo} · {x.finca.nombre}</span>
                      <span className="af-chip af-chip--mal">{x.oport?.ddc} días del corte</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {fincas.length === 0 ? (
        <div className="af-card af-vacio">
          <h3>Todavía no hay fincas</h3>
          <p>{esAdmin
            ? 'Cree la primera: el dueño, sus suertes con el área, y el corte de cada una. Al abrir el ciclo se cargan las labores del paquete con su presupuesto.'
            : 'Administración todavía no ha creado fincas.'}</p>
          {esAdmin && <button type="button" className="primary-button" onClick={onNueva}>+ Crear la primera finca</button>}
        </div>
      ) : (
        <div className="af-fincas">
          {fincas.map((f) => {
            const p = presupuestoFinca(f.id, d)
            const c = cuentaFinca(f.id, d.movimientos)
            const filas = laboresDeFinca(f.id, d, hoy)
            const tard = filas.filter((x) => x.oport?.nivel === 'tardia' && !x.oport.hecha && x.labor.estado !== 'TERMINADA').length
            const pend = d.reportes.filter((r) => r.estado === 'PENDIENTE' && filas.some((x) => x.labor.id === r.laborId)).length
            return (
              <button key={f.id} type="button" className="af-finca" onClick={() => ctx.abrirFinca(f.id)}>
                <span className="af-finca__nom">{f.nombre}</span>
                <span className="af-finca__dueno">{f.duenoNombre}{f.ingenioId ? ` · ${ingenioNombre(f.ingenioId)}` : ''}</span>
                <span className="af-finca__ha">{fmtCant(p.hectareas)} ha · {p.ciclos} ciclo{p.ciclos === 1 ? '' : 's'} abierto{p.ciclos === 1 ? '' : 's'}</span>
                {VER_PLATA && <span className="af-barra" aria-hidden="true"><i style={{ width: `${Math.min(100, p.pct ?? 0)}%` }} /></span>}
                {VER_PLATA && <span className="af-finca__plata">
                  {p.presupuesto > 0 ? `${fmtPesosCorto(p.ejecutado)} de ${fmtPesosCorto(p.presupuesto)} (${p.pct} %)` : `${fmtPesosCorto(p.ejecutado)} gastado · sin presupuesto`}
                </span>}
                <span className="af-finca__chips">
                  {VER_PLATA && <span className={`af-chip ${c.saldo < 0 ? 'af-chip--mal' : 'af-chip--neutro'}`}>saldo {fmtPesosCorto(c.saldo)}</span>}
                  {pend > 0 && <span className="af-chip af-chip--ojo">{pend} por aceptar</span>}
                  {tard > 0 && <span className="af-chip af-chip--mal">⚠ {tard} atrasada{tard === 1 ? '' : 's'}</span>}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
