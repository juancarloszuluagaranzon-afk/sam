import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAppData } from '../context/AppDataContext'
import { loadSesionesRango } from '../services/consumoApi'
import { armarEficiencia, MIN_HORAS_DIA, type Cumplimiento, type Eficiencia, type SesionMaquina } from '../lib/eficiencia'
import { hoyBogota } from '../lib/periodos'
import { Ayuda } from '../components/Ayuda'

/**
 * Eficiencia de maquinaria y operarios — pedido de Cristian (reunión 15-oct-2026):
 * por máquina y por operario, cuántos DÍAS trabajó en el periodo y cuántas HORAS
 * POR DÍA, contra el mínimo de 7 h (se paga un básico de 8). Las horas del día
 * salen del HORÓMETRO (final − inicial del día), no de sumar labores.
 * El cálculo vive en `lib/eficiencia.ts` (puro, probado con Node contra datos reales).
 */

const primerDiaDelMes = (hoy: string) => `${hoy.slice(0, 7)}-01`
function mesAnterior(hoy: string): { desde: string; hasta: string } {
  const [y, m] = hoy.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 2, 1)), f = new Date(Date.UTC(y, m - 1, 0))
  return { desde: d.toISOString().slice(0, 10), hasta: f.toISOString().slice(0, 10) }
}
function haceDias(hoy: string, n: number): string {
  const d = new Date(`${hoy}T12:00:00`); d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}
const tono = (c: Cumplimiento) => (c === 'bien' ? 'done' : c === 'apura' ? 'progress' : 'cancel')
const texto = (c: Cumplimiento) => (c === 'bien' ? 'cumple' : c === 'apura' ? 'le falta poco' : 'bajo el mínimo')
const fmtDia = (f: string) => new Date(`${f}T12:00:00`).toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'short' })

export function EficienciaTab() {
  const { sortedEquipment, busy, setBusy, setError, setInfo } = useAppData()
  const hoy = hoyBogota()
  const [desde, setDesde] = useState(primerDiaDelMes(hoy))
  const [hasta, setHasta] = useState(hoy)
  const [minimo, setMinimo] = useState(MIN_HORAS_DIA)
  const [sesiones, setSesiones] = useState<SesionMaquina[]>([])
  const [cargando, setCargando] = useState(true)
  const [vista, setVista] = useState<'maquinas' | 'operarios'>('maquinas')
  const [abierta, setAbierta] = useState('')

  const nombreEquipo = useMemo(() => {
    const m = new Map<string, string>()
    sortedEquipment.forEach((e) => m.set(e.code, e.name))
    return m
  }, [sortedEquipment])

  const cargar = useCallback(async () => {
    setCargando(true)
    try { setSesiones(await loadSesionesRango(desde, hasta)) }
    catch (e) { setError(`No se pudieron cargar las horas. ${(e as Error).message}`) }
    finally { setCargando(false) }
  }, [desde, hasta, setError])
  useEffect(() => { void cargar() }, [cargar])

  const ef: Eficiencia = useMemo(() => {
    const conNombre = sesiones.map((s) => ({ ...s, equipoNombre: nombreEquipo.get(s.equipo) ?? s.equipoNombre ?? s.equipo }))
    return armarEficiencia(conNombre, { desde, hasta, hoy, minimo })
  }, [sesiones, nombreEquipo, desde, hasta, hoy, minimo])

  async function exportar() {
    setBusy(true); setError('')
    try {
      const { utils, writeFile } = await import('xlsx')
      const wb = utils.book_new()
      utils.book_append_sheet(wb, utils.json_to_sheet(ef.maquinas.map((m) => ({
        'Máquina': m.nombre, 'Días trabajados': m.diasTrabajados, 'Días del periodo': ef.diasPeriodo,
        'Horas': m.horas, 'Horas por día trabajado': m.horasPorDia, 'Horas por día calendario': m.horasPorDiaCalendario,
        [`Mínimo (${minimo} h/día)`]: texto(m.cumple), 'Días bajo el mínimo': m.diasBajoMinimo,
        'Días sin lectura útil': m.diasSinLectura, 'Lecturas descartadas': m.descartadas, 'Operarios': m.operadores.join(', '),
      }))), 'Por máquina')
      utils.book_append_sheet(wb, utils.json_to_sheet(ef.operadores.map((o) => ({
        'Operario': o.nombre, 'Días trabajados': o.diasTrabajados, 'Horas': o.horas, 'Horas por día': o.horasPorDia,
        [`Mínimo (${minimo} h/día)`]: texto(o.cumple), 'Días bajo el mínimo': o.diasBajoMinimo, 'Máquinas': o.maquinas.join(', '),
      }))), 'Por operario')
      const dias: Record<string, unknown>[] = []
      for (const m of ef.maquinas) for (const d of m.dias) dias.push({
        'Máquina': m.nombre, 'Fecha': d.fecha, 'Horómetro inicial': d.horometroInicial ?? '', 'Horómetro final': d.horometroFinal ?? '',
        'Horas del día': d.horas, 'Cómo se calculó': d.fuente, 'Tramos (labores)': d.tramos,
        'Operarios': d.operadores.map((o) => `${o.nombre} (${o.horas} h)`).join(' · '), '⚠ Lecturas descartadas': d.descartadas || '',
      })
      utils.book_append_sheet(wb, utils.json_to_sheet(dias), 'Día por día')
      writeFile(wb, `eficiencia-${desde}-a-${hasta}.xlsx`)
      setInfo(`Informe descargado: ${ef.maquinas.length} máquinas, ${ef.operadores.length} operarios.`)
    } catch { setError('No se pudo generar el Excel.') } finally { setBusy(false) }
  }

  const mesPasado = mesAnterior(hoy)
  const esRango = (a: string, b: string) => desde === a && hasta === b

  return (
    <section className="panel">
      <div className="panel-title split">
        <h2>⏱ Eficiencia de maquinaria y operarios</h2>
        <button type="button" className="inline-button" onClick={() => void cargar()} disabled={cargando}>↻ Actualizar</button>
      </div>
      <Ayuda>
        <p>
          Por cada máquina y cada operario: <strong>cuántos días trabajó</strong> en el periodo y{' '}
          <strong>cuántas horas por día</strong>, comparado con el mínimo acordado ({minimo} h por día:
          se paga un básico de 8). Lo que esté por debajo sale en rojo.
        </p>
        <p>
          Las horas del día salen del <strong>horómetro</strong>: la última lectura del día menos la
          primera, con todas las labores que cerró la máquina ese día (en turno doble, los dos operarios
          suman). A cada operario se le cuentan solo <strong>sus</strong> tramos.
        </p>
        <p>
          Los horómetros vienen con errores de digitación. Una lectura que no cuadra con las demás de
          esa máquina se descarta y se cuenta aparte; si el rango de un día no es creíble, se usa lo que
          suman las labores. Medido contra el cierre manual de julio: 7 de 20 máquinas quedan dentro del
          10 %, y en total la app ve un <strong>17 % menos</strong> que el cierre, porque aquí solo cuentan los
          días con labores cerradas: lo que la máquina anda sin una labor registrada (traslados, encendida
          sin cerrar labor) no se le acredita a nadie.
        </p>
      </Ayuda>

      <div className="rep-toolbar">
        <label className="rep-fecha">Desde<input type="date" value={desde} max={hasta} onChange={(e) => setDesde(e.target.value)} /></label>
        <label className="rep-fecha">Hasta<input type="date" value={hasta} min={desde} max={hoy} onChange={(e) => setHasta(e.target.value)} /></label>
        <label className="rep-fecha">Mínimo h/día
          <input type="number" min={1} max={24} step={0.5} value={minimo} onChange={(e) => setMinimo(Number(e.target.value) || MIN_HORAS_DIA)} style={{ width: 70 }} />
        </label>
        <button type="button" className="primary-button rep-export" onClick={() => void exportar()} disabled={busy || cargando || ef.maquinas.length === 0}>⬇ Descargar Excel</button>
      </div>
      <div className="tablero-caras" style={{ margin: '8px 0 12px' }}>
        <button type="button" className={esRango(primerDiaDelMes(hoy), hoy) ? 'is-sel' : ''} onClick={() => { setDesde(primerDiaDelMes(hoy)); setHasta(hoy) }}>Este mes</button>
        <button type="button" className={esRango(mesPasado.desde, mesPasado.hasta) ? 'is-sel' : ''} onClick={() => { setDesde(mesPasado.desde); setHasta(mesPasado.hasta) }}>Mes pasado</button>
        <button type="button" className={esRango(haceDias(hoy, 29), hoy) ? 'is-sel' : ''} onClick={() => { setDesde(haceDias(hoy, 29)); setHasta(hoy) }}>Últimos 30 días</button>
      </div>

      {!cargando && ef.maquinas.length > 0 && (
        <div className="sem-fila__kpis" style={{ marginBottom: 12 }}>
          <span><small>Horas de la flota</small><strong>{ef.flota.horas.toLocaleString('es-CO')}</strong></span>
          <span><small>Promedio h/día trabajado</small><strong>{ef.flota.horasPorDia}</strong></span>
          <span className={ef.flota.maquinasBajoMinimo ? 'sem-alerta' : ''}><small>Máquinas bajo el mínimo</small><strong>{ef.flota.maquinasBajoMinimo} de {ef.maquinas.length}</strong></span>
          <span><small>Días del periodo</small><strong>{ef.diasPeriodo}</strong></span>
        </div>
      )}
      {ef.descartadas > 0 && (
        <div className="taller-aviso taller-aviso--warn" style={{ marginBottom: 10 }}>
          ⚠ {ef.descartadas} lectura(s) de horómetro no cuadran con su máquina y quedaron por fuera. Están
          marcadas día por día (y en el Excel): vale la pena corregirlas con el operario.
        </div>
      )}

      <div className="tablero-caras" style={{ marginBottom: 12 }}>
        <button type="button" className={vista === 'maquinas' ? 'is-sel' : ''} onClick={() => setVista('maquinas')}>🚜 Por máquina ({ef.maquinas.length})</button>
        <button type="button" className={vista === 'operarios' ? 'is-sel' : ''} onClick={() => setVista('operarios')}>🙋 Por operario ({ef.operadores.length})</button>
      </div>

      {cargando ? <p className="muted-text">Cargando…</p>
        : ef.maquinas.length === 0 ? <p className="muted-text">Sin labores cerradas con horómetro en este rango.</p>
        : vista === 'maquinas' ? (
        <div className="inv-list">
          {ef.maquinas.map((m) => (
            <div key={m.equipo} className="sem-fila">
              <button type="button" className="sem-fila__cab" onClick={() => setAbierta(abierta === m.equipo ? '' : m.equipo)}>
                <div className="sem-fila__id">
                  <strong>🚜 {m.nombre}</strong>
                  <small>{m.operadores.join(', ') || 'sin operario'}</small>
                </div>
                <div className="sem-fila__kpis">
                  <span><small>Días</small><strong>{m.diasTrabajados}<small> de {ef.diasPeriodo}</small></strong></span>
                  <span><small>Horas</small><strong>{m.horas}</strong></span>
                  <span className={m.cumple !== 'bien' ? 'sem-alerta' : ''}><small>h/día</small><strong>{m.horasPorDia}</strong></span>
                  <span><span className={`status-chip ${tono(m.cumple)}`}>{texto(m.cumple)}</span></span>
                </div>
                <span className="consumo-maq__ver">{abierta === m.equipo ? 'ocultar ▴' : 'ver días ▾'}</span>
              </button>
              {abierta === m.equipo && (
                <div className="sem-fila__detalle">
                  <p className="subtle-copy" style={{ margin: '0 0 8px' }}>
                    {m.diasBajoMinimo} día(s) por debajo de {minimo} h · {m.horasPorDiaCalendario} h por día calendario
                    {m.diasSinLectura ? ` · ${m.diasSinLectura} día(s) sin lectura útil` : ''}
                    {m.descartadas ? ` · ${m.descartadas} lectura(s) descartada(s)` : ''}
                  </p>
                  {m.dias.map((d) => (
                    <div key={d.fecha} className={`sem-evento${d.fuente !== 'horómetro' ? ' sem-evento--dudoso' : ''}`}>
                      <div className="sem-evento__top">
                        <strong>{fmtDia(d.fecha)}</strong>
                        <span className={`status-chip ${d.horas >= minimo ? 'done' : d.horas >= minimo - 1 ? 'progress' : 'cancel'}`}>{d.horas} h</span>
                      </div>
                      <div className="sem-evento__datos">
                        {d.horometroInicial != null && d.horometroFinal != null && <span>Horómetro <strong>{d.horometroInicial} → {d.horometroFinal}</strong></span>}
                        <span>{d.tramos} labor{d.tramos === 1 ? '' : 'es'}</span>
                        {d.fuente !== 'horómetro' && <span>⚠ {d.fuente === 'tramos' ? 'rango no creíble: se sumaron las labores' : 'sin horómetro útil'}</span>}
                      </div>
                      <span className="subtle-copy">{d.operadores.map((o) => `🙋 ${o.nombre} · ${o.horas} h`).join('   ')}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="inv-list">
          {ef.operadores.map((o) => (
            <div key={o.operador} className="sem-fila">
              <button type="button" className="sem-fila__cab" onClick={() => setAbierta(abierta === o.operador ? '' : o.operador)}>
                <div className="sem-fila__id">
                  <strong>🙋 {o.nombre}</strong>
                  <small>{o.maquinas.join(', ')}</small>
                </div>
                <div className="sem-fila__kpis">
                  <span><small>Días</small><strong>{o.diasTrabajados}<small> de {ef.diasPeriodo}</small></strong></span>
                  <span><small>Horas</small><strong>{o.horas}</strong></span>
                  <span className={o.cumple !== 'bien' ? 'sem-alerta' : ''}><small>h/día</small><strong>{o.horasPorDia}</strong></span>
                  <span><span className={`status-chip ${tono(o.cumple)}`}>{texto(o.cumple)}</span></span>
                </div>
                <span className="consumo-maq__ver">{abierta === o.operador ? 'ocultar ▴' : 'ver días ▾'}</span>
              </button>
              {abierta === o.operador && (
                <div className="sem-fila__detalle">
                  <p className="subtle-copy" style={{ margin: '0 0 8px' }}>{o.diasBajoMinimo} día(s) por debajo de {minimo} h.</p>
                  {o.dias.map((d) => (
                    <div key={d.fecha} className="sem-evento">
                      <div className="sem-evento__top">
                        <strong>{fmtDia(d.fecha)}</strong>
                        <span className={`status-chip ${d.horas >= minimo ? 'done' : d.horas >= minimo - 1 ? 'progress' : 'cancel'}`}>{d.horas} h</span>
                      </div>
                      <span className="subtle-copy">🚜 {d.maquinas.join(', ')}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

export default EficienciaTab
