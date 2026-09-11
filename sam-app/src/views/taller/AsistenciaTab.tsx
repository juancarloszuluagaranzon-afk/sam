import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAppData } from '../../context/AppDataContext'
import { Ayuda } from '../../components/Ayuda'
import { fmtFechaHora } from '../../lib/fechas'
import { PERIODOS, rangoDe, hoyBogota, type Periodo } from '../../lib/periodos'
import {
  loadMarcaciones, loadConfigHoras, guardarConfigHoras, anularMarcacion, loadSitios,
  type MarcacionFila, type Sitio,
} from '../../services/asistenciaApi'
import {
  emparejar, clasificar, totalizar, hhmm, FRANJAS, esFestivo, enBogota,
  CONFIG_POR_DEFECTO, type ConfigHoras,
} from '../../lib/horasExtra'

/**
 * Asistencia del taller — lo que se le entrega a nómina.
 *
 * 🔴 **Lo que no cuadra se muestra ARRIBA, no se esconde.** Una entrada sin
 * salida, una marcación fuera del taller o una hora que hubo que corregir son
 * justo lo que hay que resolver antes de pagar. Un reporte que las omite sale
 * cuadrado y falso, y el error aparece en la quincena siguiente cuando ya se
 * pagó. Ver `managing-movimientos`: el volumen nunca va solo.
 *
 * 🔴 **No se liquida plata.** Se entregan horas por franja. Los pesos los pone
 * nómina con el salario de cada quien, y los porcentajes de ley van al lado
 * como referencia, sin multiplicar nada.
 */
export function AsistenciaTab() {
  const { users, session, setError, setInfo } = useAppData()
  const hoy = hoyBogota()

  const [periodo, setPeriodo] = useState<Periodo>('PRIMERA')
  const [desde, setDesde] = useState(() => rangoDe('PRIMERA', hoy).desde)
  const [hasta, setHasta] = useState(() => rangoDe('PRIMERA', hoy).hasta)
  const [marcas, setMarcas] = useState<MarcacionFila[]>([])
  const [cfg, setCfg] = useState<ConfigHoras>(CONFIG_POR_DEFECTO)
  const [sitios, setSitios] = useState<Sitio[]>([])
  const [cargando, setCargando] = useState(true)
  const [verConfig, setVerConfig] = useState(false)

  const nombreDe = useMemo(() => {
    const m = new Map<string, string>()
    users.forEach((u) => m.set(u.id, u.name))
    return (id: string) => m.get(id) ?? id
  }, [users])

  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      const [ms, c, s] = await Promise.all([
        loadMarcaciones({ desde: `${desde}T00:00:00-05:00`, hasta: `${hasta}T23:59:59-05:00` }),
        loadConfigHoras(),
        loadSitios(),
      ])
      setMarcas(ms); setCfg(c); setSitios(s)
    } finally { setCargando(false) }
  }, [desde, hasta])
  useEffect(() => { void cargar() }, [cargar])

  function elegir(p: Periodo) {
    setPeriodo(p)
    if (p === 'RANGO') return
    const r = rangoDe(p, hoy)
    setDesde(r.desde); setHasta(r.hasta)
  }

  const { sesiones, sueltas } = useMemo(() => emparejar(marcas), [marcas])
  const dias = useMemo(() => clasificar(sesiones, cfg), [sesiones, cfg])
  const totales = useMemo(() => totalizar(dias), [dias])

  /** Quién quedó con la última marcación en ENTRADA: está adentro ahora. */
  const adentro = useMemo(() => {
    const ult = new Map<string, MarcacionFila>()
    for (const m of marcas) {
      const p = ult.get(m.usuarioId)
      if (!p || m.marcadoEn > p.marcadoEn) ult.set(m.usuarioId, m)
    }
    return [...ult.values()].filter((m) => m.tipo === 'ENTRADA')
  }, [marcas])

  const fueraDelSitio = useMemo(() => marcas.filter((m) => m.dentroDelSitio === false), [marcas])
  const horasCorregidas = useMemo(() => marcas.filter((m) => m.horaCorregida), [marcas])
  const sinHuella = useMemo(() => marcas.filter((m) => m.metodo !== 'HUELLA'), [marcas])

  const filas = useMemo(
    () => [...totales.entries()]
      .map(([usuarioId, t]) => ({ usuarioId, nombre: nombreDe(usuarioId), ...t }))
      .sort((a, b) => b.total - a.total),
    [totales, nombreDe],
  )

  async function exportar() {
    try {
      const { utils, writeFile } = await import('xlsx')
      const wb = utils.book_new()
      // Hoja 1 — una fila por persona, en horas y minutos.
      utils.book_append_sheet(wb, utils.json_to_sheet(filas.map((f) => ({
        'Mecánico': f.nombre,
        ...Object.fromEntries(FRANJAS.map((fr) => [`${fr.label} (${fr.recargo})`, hhmm(f[fr.id])])),
        'TOTAL': hhmm(f.total),
      }))), 'Resumen')
      // Hoja 2 — día por día, que es donde se revisa un reclamo.
      utils.book_append_sheet(wb, utils.json_to_sheet(dias.map((d) => ({
        'Mecánico': nombreDe(d.usuarioId),
        'Día': d.dia,
        'Dominical/festivo': d.festivo ? 'Sí' : '',
        ...Object.fromEntries(FRANJAS.map((fr) => [fr.label, hhmm(d.minutos[fr.id])])),
        'Total del día': hhmm(d.totalMinutos),
      }))), 'Día por día')
      // Hoja 3 — las marcaciones crudas, con todo lo que hay que auditar.
      utils.book_append_sheet(wb, utils.json_to_sheet(marcas.map((m) => ({
        'Mecánico': nombreDe(m.usuarioId),
        'Tipo': m.tipo,
        'Ocurrió': fmtFechaHora(m.marcadoEn),
        'Llegó al servidor': fmtFechaHora(m.registradoEn),
        'Método': m.metodo,
        'En el taller': m.dentroDelSitio == null ? 'sin ubicación' : m.dentroDelSitio ? 'Sí' : 'NO',
        'Distancia (m)': m.distanciaM ?? '',
        'Hora corregida': m.horaCorregida ? 'Sí' : '',
        'Aparato': m.dispositivo ?? '',
      }))), 'Marcaciones')
      // Hoja 4 — lo que hay que resolver ANTES de pagar.
      utils.book_append_sheet(wb, utils.json_to_sheet(sueltas.map((s) => ({
        'Mecánico': nombreDe(s.usuarioId),
        'Marcación sin pareja': s.tipo,
        'Cuándo': fmtFechaHora(s.marcadoEn),
      }))), 'Sin cerrar')
      writeFile(wb, `Asistencia-taller-${desde}-a-${hasta}.xlsx`)
    } catch (e) {
      setError(`No se pudo generar el Excel. (${(e as Error)?.message ?? 'error'})`)
    }
  }

  async function anular(m: MarcacionFila) {
    const motivo = window.prompt(
      `Anular la ${m.tipo.toLowerCase()} de ${nombreDe(m.usuarioId)} del ${fmtFechaHora(m.marcadoEn)}.\n\n` +
      'La marcación NO se borra: queda anulada con este motivo y quién lo hizo.\n\n¿Por qué?')
    if (!motivo?.trim()) return
    try {
      await anularMarcacion(m.id, session?.id ?? '', motivo.trim())
      setInfo('Marcación anulada. Queda el rastro.')
      await cargar()
    } catch (e) {
      setError(`No se pudo anular. (${(e as Error)?.message ?? 'error'})`)
    }
  }

  return (
    // `mov` no es decorativo: trae la escala de tipos de los KPI y la paleta.
    // Sin ella `dash-kpi__val` sale como negrita de párrafo.
    <section className="panel-card mov">
      <div className="panel-title split">
        <h2>Asistencia y horas extras</h2>
        <div className="mov-titulo-acciones">
          <Ayuda>
            <p>Las horas que los mecánicos marcaron con su huella, repartidas en las franjas que la ley paga distinto.</p>
            <p>
              🔴 <strong>Aquí no hay pesos.</strong> El módulo entrega horas; la liquidación la hace
              nómina con el salario de cada quien. Los porcentajes se muestran como referencia.
            </p>
            <p>
              Vigente a septiembre de 2026: <strong>nocturno de 7:00 p.m. a 6:00 a.m.</strong>
              (Ley 2466 de 2025, antes eran las 9:00 p.m.), <strong>42 horas semanales</strong>
              (Ley 2101) y dominical o festivo al <strong>90%</strong>. Si la ley vuelve a cambiar,
              se edita en ⚙ Jornada, no en el código.
            </p>
          </Ayuda>
          <button type="button" className="inline-button" onClick={() => setVerConfig((v) => !v)}>⚙ Jornada</button>
          <button type="button" className="inline-button" onClick={() => void exportar()} disabled={marcas.length === 0}>
            ⬇ Excel
          </button>
        </div>
      </div>

      <div className="mov-periodo">
        {PERIODOS.map((p) => (
          <button key={p.value} type="button" aria-pressed={periodo === p.value} onClick={() => elegir(p.value)}>
            {p.label}
          </button>
        ))}
        {periodo === 'RANGO' && (
          <div className="mov-periodo__rango">
            <label>Desde<input type="date" value={desde} max={hasta} onChange={(e) => setDesde(e.target.value)} /></label>
            <label>Hasta<input type="date" value={hasta} min={desde} onChange={(e) => setHasta(e.target.value)} /></label>
          </div>
        )}
      </div>

      {verConfig && (
        <ConfigJornada cfg={cfg} onGuardar={async (c) => {
          try {
            await guardarConfigHoras(c, session?.id ?? '')
            setCfg(c); setInfo('Jornada actualizada. El reporte se recalcula solo.')
          } catch (e) { setError(`No se pudo guardar. (${(e as Error)?.message ?? 'error'})`) }
        }} />
      )}

      {sitios.length === 0 && (
        <p className="mov-alerta">
          ⚠ No hay un sitio de taller configurado, así que no se puede saber si alguien marcó
          desde afuera. La ubicación igual se está guardando en cada marcación.
        </p>
      )}

      {cargando && <p className="muted-text">Cargando marcaciones…</p>}

      {!cargando && marcas.length === 0 && (
        <p className="dash-vacio">Nadie ha marcado en este periodo.</p>
      )}

      {!cargando && marcas.length > 0 && (
        <>
          {/* Lo que hay que resolver antes de pagar, primero. */}
          {(sueltas.length > 0 || fueraDelSitio.length > 0 || horasCorregidas.length > 0) && (
            <div className="mov-freno">
              <strong>⚠ Revisar antes de pagar</strong>
              <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                {sueltas.length > 0 && (
                  <li>
                    <strong>{sueltas.length}</strong> marcación(es) sin pareja — alguien entró y no
                    marcó salida, o al revés. Esas horas <strong>no se cuentan</strong>: el módulo no
                    inventa una hora de salida.
                  </li>
                )}
                {fueraDelSitio.length > 0 && <li><strong>{fueraDelSitio.length}</strong> marcación(es) hechas fuera del taller.</li>}
                {horasCorregidas.length > 0 && <li><strong>{horasCorregidas.length}</strong> con la hora del teléfono corregida por el servidor.</li>}
                {sinHuella.length > 0 && <li><strong>{sinHuella.length}</strong> sin huella (respaldo o anotadas a mano).</li>}
              </ul>
            </div>
          )}

          <div className="dash-kpis">
            <div className="dash-kpi">
              <span className="dash-kpi__val">{filas.length}</span>
              <span className="dash-kpi__lbl">mecánicos</span>
              <span className="dash-kpi__pie">marcaron en el periodo</span>
            </div>
            <div className="dash-kpi">
              <span className="dash-kpi__val">{hhmm([...totales.values()].reduce((t, v) => t + v.total, 0))}</span>
              <span className="dash-kpi__lbl">horas</span>
              <span className="dash-kpi__pie">trabajadas en total</span>
            </div>
            <div className="dash-kpi">
              <span className="dash-kpi__val">
                {hhmm([...totales.values()].reduce((t, v) =>
                  t + v.EXTRA_DIURNA + v.EXTRA_NOCTURNA + v.FEST_EXTRA_DIURNA + v.FEST_EXTRA_NOCTURNA, 0))}
              </span>
              <span className="dash-kpi__lbl">extras</span>
              <span className="dash-kpi__pie">sobre {cfg.jornadaOrdinariaDiaria} h al día</span>
            </div>
            <div className="dash-kpi">
              <span className="dash-kpi__val">{adentro.length}</span>
              <span className="dash-kpi__lbl">adentro</span>
              <span className="dash-kpi__pie">sin marcar salida</span>
            </div>
          </div>

          {adentro.length > 0 && (
            <p className="dash-galha__nota">
              🟢 Adentro ahora: {adentro.map((m) => `${nombreDe(m.usuarioId)} (desde ${fmtFechaHora(m.marcadoEn)})`).join(' · ')}
            </p>
          )}

          <h3 className="dash-titulo">Horas por mecánico</h3>
          <div style={{ overflowX: 'auto' }}>
            <table className="validacion-table">
              <thead>
                <tr>
                  <th>Mecánico</th>
                  {FRANJAS.map((f) => (
                    <th key={f.id} style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {f.label}<br /><small style={{ fontWeight: 400 }}>{f.recargo}</small>
                    </th>
                  ))}
                  <th style={{ textAlign: 'right' }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => (
                  <tr key={f.usuarioId}>
                    <td>{f.nombre}</td>
                    {FRANJAS.map((fr) => (
                      <td key={fr.id} style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {f[fr.id] > 0 ? hhmm(f[fr.id]) : '—'}
                      </td>
                    ))}
                    <td style={{ textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{hhmm(f.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3 className="dash-titulo">Marcaciones</h3>
          <div className="dash-detalle">
            {[...marcas].reverse().slice(0, 200).map((m) => {
              const b = enBogota(m.marcadoEn)
              return (
                <div key={m.id} className="ent-row" style={{ cursor: 'default' }}>
                  <div className="ent-row__cab">
                    <strong>{m.tipo === 'ENTRADA' ? '🟢' : '🔴'} {nombreDe(m.usuarioId)}</strong>
                    <span className="ent-row__hora">{fmtFechaHora(m.marcadoEn)}</span>
                  </div>
                  <span className="ent-row__pie">
                    {m.metodo === 'HUELLA' ? 'con huella' : m.metodo === 'PIN' ? '⚠ sin huella' : 'anotada a mano'}
                    {esFestivo(b.dia) && ' · festivo'}
                    {m.dentroDelSitio === false && ` · ⚠ a ${m.distanciaM ?? '?'} m del taller`}
                    {m.horaCorregida && ' · ⚠ hora corregida'}
                    <button type="button" className="dash-card__link" style={{ marginLeft: 8 }}
                            onClick={() => void anular(m)}>anular</button>
                  </span>
                </div>
              )
            })}
          </div>
        </>
      )}
    </section>
  )
}

/** Los parámetros de la jornada. Se editan aquí, nunca en el código. */
function ConfigJornada({ cfg, onGuardar }: { cfg: ConfigHoras; onGuardar: (c: ConfigHoras) => Promise<void> }) {
  const [v, setV] = useState(cfg)
  useEffect(() => setV(cfg), [cfg])
  return (
    <div className="flota-comprobante" style={{ marginTop: 12 }}>
      <span className="flota-comprobante__lbl">⚙ Jornada — lo que dice la ley hoy</span>
      <div className="flota-grid">
        <label>Horas ordinarias al día
          <input type="number" min={1} max={12} step="0.5" value={v.jornadaOrdinariaDiaria}
                 onChange={(e) => setV({ ...v, jornadaOrdinariaDiaria: Number(e.target.value) })} /></label>
        <label>Tope semanal
          <input type="number" min={1} max={60} step="1" value={v.jornadaSemanalMax}
                 onChange={(e) => setV({ ...v, jornadaSemanalMax: Number(e.target.value) })} /></label>
        <label>La noche empieza
          <input type="time" value={v.inicioNoche} onChange={(e) => setV({ ...v, inicioNoche: e.target.value })} /></label>
        <label>y termina
          <input type="time" value={v.finNoche} onChange={(e) => setV({ ...v, finNoche: e.target.value })} /></label>
      </div>
      <p className="subtle-copy">
        Septiembre de 2026: noche de 7:00 p.m. a 6:00 a.m. y 42 horas semanales. Cambiar esto
        recalcula todo el reporte, también el de quincenas pasadas.
      </p>
      <button type="button" className="primary-button" onClick={() => void onGuardar(v)}>Guardar jornada</button>
    </div>
  )
}

export default AsistenciaTab
