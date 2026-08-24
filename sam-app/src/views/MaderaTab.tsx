import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAppData } from '../context/AppDataContext'
import { Ayuda } from '../components/Ayuda'
import { FotoEvidencia } from '../components/FotoEvidencia'
import { MaderaForm } from './MaderaForm'
import {
  loadViajes, cambiarEstado, registrarRecibido, diasParaVencer,
  PESO_MAXIMO, CONFIG_LABEL, type MaderaViaje, type MaderaEstado,
} from '../services/maderaApi'

/**
 * Viajes de trozas — módulo de transporte de madera (rama `pruebas`).
 *
 * Lo que esta pantalla resuelve y ningún sistema del mercado junta:
 *
 *  1. **El papel que vence.** El salvoconducto dura 8 días y sirve para un solo
 *     viaje; vencido, el decomiso incluye el vehículo. Eso va arriba de todo,
 *     no escondido en el detalle.
 *  2. **Lo despachado contra lo recibido.** La diferencia es donde aparecen las
 *     mermas y los errores de cubicación.
 *  3. **El peso contra el límite legal** de esa configuración de camión.
 */

function hoyISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function primerDiaMes(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}
function fmtFecha(iso: string): string {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-')
  return d && m && y ? `${d}/${m}/${y}` : iso
}
function n1(v: number): string {
  return new Intl.NumberFormat('es-CO', { maximumFractionDigits: 1, useGrouping: false }).format(v)
}

const ESTADO_LABEL: Record<MaderaEstado, string> = {
  CARGADO: 'Cargado', EN_RUTA: 'En ruta', DESCARGADO: 'Descargado', ANULADO: 'Anulado',
}

export function MaderaTab() {
  const { session, busy, setBusy, setError, setInfo } = useAppData()

  const [viajes, setViajes] = useState<MaderaViaje[]>([])
  const [cargando, setCargando] = useState(true)
  const [desde, setDesde] = useState(primerDiaMes())
  const [hasta, setHasta] = useState(hoyISO())
  const [busca, setBusca] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [recibiendo, setRecibiendo] = useState<MaderaViaje | null>(null)
  const [volRecibido, setVolRecibido] = useState('')

  const refrescar = useCallback(async () => {
    setCargando(true)
    try { setViajes(await loadViajes({ desde, hasta })) }
    finally { setCargando(false) }
  }, [desde, hasta])
  useEffect(() => { void refrescar() }, [refrescar])

  const lista = useMemo(() => {
    const q = busca.trim().toLowerCase()
    if (!q) return viajes
    return viajes.filter((v) =>
      `${v.predio} ${v.destino} ${v.placa} ${v.conductorNombre} ${v.especie} ${v.docNumero}`
        .toLowerCase().includes(q))
  }, [viajes, busca])

  const vivos = useMemo(() => lista.filter((v) => v.estado !== 'ANULADO'), [lista])

  /** Documentos vencidos o a punto de vencer, en viajes que todavía no descargan. */
  const enRiesgo = useMemo(() => vivos
    .filter((v) => v.estado !== 'DESCARGADO' && v.docVence)
    .map((v) => ({ v, dias: diasParaVencer(v.docVence) }))
    .filter((x) => x.dias != null && x.dias <= 2)
    .sort((a, b) => (a.dias ?? 0) - (b.dias ?? 0)), [vivos])

  const totales = useMemo(() => {
    const m3 = vivos.reduce((t, v) => t + v.volumenM3, 0)
    const recibidos = vivos.filter((v) => v.volumenRecibidoM3 != null)
    const desp = recibidos.reduce((t, v) => t + v.volumenM3, 0)
    const rec = recibidos.reduce((t, v) => t + (v.volumenRecibidoM3 ?? 0), 0)
    return {
      viajes: vivos.length,
      m3,
      // Solo se compara sobre los que YA se pesaron: meter los pendientes daría
      // una merma inventada que crece sola mientras nadie descarga.
      conciliados: recibidos.length,
      dif: desp > 0 ? ((rec - desp) / desp) * 100 : null,
      difM3: rec - desp,
    }
  }, [vivos])

  async function avanzar(v: MaderaViaje, estado: MaderaEstado) {
    setBusy(true); setError('')
    try {
      await cambiarEstado(v.id, estado)
      setInfo(`Viaje ${estado === 'EN_RUTA' ? 'despachado' : 'anulado'}.`)
      await refrescar()
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo actualizar el viaje.') }
    finally { setBusy(false) }
  }

  async function guardarRecibido() {
    if (!recibiendo) return
    const vol = Number(volRecibido)
    if (!Number.isFinite(vol) || vol < 0) { setError('Escribe cuántos metros cúbicos recibieron.'); return }
    setBusy(true); setError('')
    try {
      await registrarRecibido(recibiendo.id, vol)
      const dif = vol - recibiendo.volumenM3
      setInfo(Math.abs(dif) < 0.05
        ? 'Recibido igual a lo despachado.'
        : `Recibido con ${n1(Math.abs(dif))} m³ ${dif < 0 ? 'de menos' : 'de más'}.`)
      setRecibiendo(null); setVolRecibido('')
      await refrescar()
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo registrar lo recibido.') }
    finally { setBusy(false) }
  }

  return (
    <section className="tab-panel">
      <div className="section-header">
        <h2>Viajes de trozas</h2>
        <button type="button" className="primary-button" onClick={() => setFormOpen(true)} disabled={busy}>
          + Nuevo viaje
        </button>
      </div>

      <Ayuda>
        <p>
          Cada viaje se abre cuando el camión carga en el predio y se cierra cuando la
          planta pesa lo que llegó. La diferencia entre lo que salió y lo que recibieron
          es lo que se mira: ahí aparecen las mermas.
        </p>
        <p>
          El <strong>salvoconducto dura 8 días</strong> y sirve para un solo viaje. Si se
          vence con la madera todavía en la carretera, el decomiso incluye el camión — por
          eso lo que está por vencer sale arriba de todo, en rojo.
        </p>
      </Ayuda>

      {enRiesgo.length > 0 && (
        <div className="madera-alerta" role="alert">
          <strong>
            {enRiesgo.length === 1 ? 'Un viaje con el papel al límite' : `${enRiesgo.length} viajes con el papel al límite`}
          </strong>
          <ul>
            {enRiesgo.map(({ v, dias }) => (
              <li key={v.id}>
                <span className="madera-alerta__placa">{v.placa || 'sin placa'}</span>
                {' · '}{v.docTipo} {v.docNumero || 's/n'}
                {' · '}
                {dias != null && dias < 0
                  ? <strong>venció hace {Math.abs(dias)} {Math.abs(dias) === 1 ? 'día' : 'días'}</strong>
                  : dias === 0
                    ? <strong>vence hoy</strong>
                    : <strong>vence en {dias} {dias === 1 ? 'día' : 'días'}</strong>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="madera-kpis">
        <div className="madera-kpi">
          <span className="madera-kpi__valor">{totales.viajes}</span>
          <span className="madera-kpi__rot">viajes en el periodo</span>
        </div>
        <div className="madera-kpi">
          <span className="madera-kpi__valor">{n1(totales.m3)}</span>
          <span className="madera-kpi__rot">m³ despachados</span>
        </div>
        <div className="madera-kpi">
          <span className={`madera-kpi__valor ${totales.dif != null && totales.dif < -1 ? 'madera-kpi__valor--mal' : ''}`}>
            {totales.dif == null ? '—' : `${totales.dif > 0 ? '+' : ''}${n1(totales.dif)}%`}
          </span>
          <span className="madera-kpi__rot">
            {totales.conciliados === 0
              ? 'sin viajes pesados todavía'
              : `diferencia en ${totales.conciliados} viaje${totales.conciliados === 1 ? '' : 's'} pesado${totales.conciliados === 1 ? '' : 's'}`}
          </span>
        </div>
      </div>

      <div className="filters-row">
        <label>Desde<input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></label>
        <label>Hasta<input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></label>
        <label style={{ flex: 1, minWidth: 160 }}>Buscar
          <input type="search" value={busca} placeholder="Predio, placa, conductor…"
                 onChange={(e) => setBusca(e.target.value)} />
        </label>
      </div>

      {cargando && <p className="subtle-copy">Cargando viajes…</p>}
      {!cargando && lista.length === 0 && (
        <p className="subtle-copy">No hay viajes en este rango. Toca «+ Nuevo viaje» para registrar el primero.</p>
      )}

      <div className="madera-lista">
        {lista.map((v) => {
          const dias = diasParaVencer(v.docVence)
          const vencido = dias != null && dias < 0 && v.estado !== 'DESCARGADO'
          const limite = PESO_MAXIMO[v.config]
          const sobrepeso = v.pesoTon > 0 && v.pesoTon > limite
          const dif = v.volumenRecibidoM3 == null ? null : v.volumenRecibidoM3 - v.volumenM3
          return (
            <article key={v.id} className={`madera-card${vencido ? ' madera-card--riesgo' : ''}`}>
              <header className="madera-card__top">
                <div>
                  <strong>{v.predio || 'Predio sin nombre'}</strong>
                  <span className="madera-card__flecha">→</span>
                  <strong>{v.destino || 'Destino sin nombre'}</strong>
                </div>
                <span className={`madera-chip madera-chip--${v.estado.toLowerCase()}`}>{ESTADO_LABEL[v.estado]}</span>
              </header>

              <div className="madera-card__datos">
                <span title="Fecha">📅 {fmtFecha(v.fecha)}</span>
                {v.placa && <span title="Camión">🚛 {v.placa}</span>}
                <span title="Configuración">{CONFIG_LABEL[v.config]}</span>
                {v.conductorNombre && <span title="Conductor">👤 {v.conductorNombre}</span>}
                {v.especie && <span title="Especie">🌲 {v.especie}</span>}
              </div>

              <div className="madera-card__carga">
                <span><strong>{n1(v.volumenM3)}</strong> m³ despachados</span>
                {v.pesoTon > 0 && (
                  <span className={sobrepeso ? 'madera-peso--mal' : ''}>
                    <strong>{n1(v.pesoTon)}</strong> t {sobrepeso && `· pasa el límite de ${limite} t`}
                  </span>
                )}
                {v.volumenRecibidoM3 != null ? (
                  <span className={dif != null && dif < -0.05 ? 'madera-peso--mal' : ''}>
                    <strong>{n1(v.volumenRecibidoM3)}</strong> m³ recibidos
                    {dif != null && Math.abs(dif) >= 0.05 && ` (${dif > 0 ? '+' : ''}${n1(dif)})`}
                  </span>
                ) : (
                  <span className="subtle-copy">sin pesar en destino</span>
                )}
              </div>

              <div className="madera-card__doc">
                <span>
                  {v.docTipo} {v.docNumero || 's/n'}
                  {v.docVence && ` · vence ${fmtFecha(v.docVence)}`}
                </span>
                {dias != null && v.estado !== 'DESCARGADO' && (
                  <span className={dias <= 2 ? 'madera-dias--mal' : 'madera-dias'}>
                    {dias < 0 ? `venció hace ${Math.abs(dias)} d` : dias === 0 ? 'vence hoy' : `quedan ${dias} d`}
                  </span>
                )}
                {v.fotoUrl && <FotoEvidencia url={v.fotoUrl} alt="soporte del viaje" tam={40} />}
              </div>

              {v.nota && <p className="madera-card__nota">{v.nota}</p>}

              {v.estado !== 'ANULADO' && v.estado !== 'DESCARGADO' && (
                <div className="madera-card__acciones">
                  {v.estado === 'CARGADO' && (
                    <button type="button" className="inline-button" disabled={busy}
                            onClick={() => void avanzar(v, 'EN_RUTA')}>Despachar</button>
                  )}
                  <button type="button" className="primary-button" disabled={busy}
                          onClick={() => { setRecibiendo(v); setVolRecibido(String(v.volumenM3 || '')) }}>
                    Registrar lo recibido
                  </button>
                  <button type="button" className="inline-button" disabled={busy}
                          onClick={() => void avanzar(v, 'ANULADO')}>Anular</button>
                </div>
              )}
            </article>
          )
        })}
      </div>

      {formOpen && (
        <MaderaForm
          onClose={() => setFormOpen(false)}
          onGuardado={() => { setFormOpen(false); void refrescar() }}
          registradoPor={session?.id}
          registradoNombre={session?.name}
        />
      )}

      {recibiendo && (
        <div className="modal-overlay" onClick={() => setRecibiendo(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h3>¿Cuánto recibieron?</h3>
            <p className="subtle-copy">
              Salieron <strong>{n1(recibiendo.volumenM3)} m³</strong> de {recibiendo.predio || 'el predio'}.
              Escribe lo que pesó la planta, aunque no coincida — la diferencia es justo el dato que importa.
            </p>
            <label>Metros cúbicos recibidos
              <input type="number" min={0} step="any" value={volRecibido} autoFocus
                     onChange={(e) => setVolRecibido(e.target.value)} />
            </label>
            <div className="modal-footer">
              <button type="button" className="inline-button" onClick={() => setRecibiendo(null)} disabled={busy}>Cancelar</button>
              <button type="button" className="primary-button" onClick={() => void guardarRecibido()} disabled={busy}>
                {busy ? 'Guardando…' : 'Cerrar el viaje'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

export default MaderaTab
