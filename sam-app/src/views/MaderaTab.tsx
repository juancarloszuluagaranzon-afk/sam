import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { useAppData } from '../context/AppDataContext'
import { Ayuda } from '../components/Ayuda'
import { FotoEvidencia } from '../components/FotoEvidencia'
import { MaderaForm } from './MaderaForm'
import { fmtFechaHora, fmtLapso } from '../lib/fechas'
import { uploadEvidencia } from '../services/samApi'
import { subirOGuardarFoto } from '../lib/outboxInsumos'
import { loadViajes, cerrarViaje, anularViaje, type MaderaViaje } from '../services/maderaApi'

/**
 * Partes de viaje del camión maderero.
 *
 * Está hecha para alguien que NO está: el dueño del camión vive lejos y quiere
 * saber qué hizo su vehículo. Por eso cada fila muestra el respaldo al lado del
 * número — la foto del tablero junto al kilometraje— y la hora es la que puso el
 * sistema, no la que digitó nadie.
 */

function hoyISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function primerDiaMes(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}
function n1(v: number | null): string {
  if (v == null) return '—'
  return new Intl.NumberFormat('es-CO', { maximumFractionDigits: 1 }).format(v)
}

export function MaderaTab({ conductorScope }: {
  /** Cuando viene, el conductor solo ve y cierra SUS propios viajes. */
  conductorScope?: { id: string; nombre: string }
} = {}) {
  const { session, busy, setBusy, setError, setInfo } = useAppData()
  const esConductor = !!conductorScope

  const [viajes, setViajes] = useState<MaderaViaje[]>([])
  const [cargando, setCargando] = useState(true)
  const [desde, setDesde] = useState(primerDiaMes())
  const [hasta, setHasta] = useState(hoyISO())
  const [busca, setBusca] = useState('')
  const [formOpen, setFormOpen] = useState(false)

  const [cerrando, setCerrando] = useState<MaderaViaje | null>(null)
  const [kmFin, setKmFin] = useState('')
  const [fotoFin, setFotoFin] = useState('')
  const [subiendo, setSubiendo] = useState(false)
  const fotoFinRef = useRef<HTMLInputElement>(null)

  const refrescar = useCallback(async () => {
    setCargando(true)
    try { setViajes(await loadViajes({ desde, hasta })) }
    finally { setCargando(false) }
  }, [desde, hasta])
  useEffect(() => { void refrescar() }, [refrescar])

  const lista = useMemo(() => {
    // El conductor ve SOLO los suyos. Se compara contra el nombre porque es lo
    // que queda en el viaje; el id no viaja al listado.
    const mios = conductorScope
      ? viajes.filter((v) => v.registradoNombre === conductorScope.nombre)
      : viajes
    const q = busca.trim().toLowerCase()
    if (!q) return mios
    return mios.filter((v) => `${v.placa} ${v.origen} ${v.destino} ${v.registradoNombre}`.toLowerCase().includes(q))
  }, [viajes, busca, conductorScope])

  const vivos = useMemo(() => lista.filter((v) => v.estado !== 'ANULADO'), [lista])

  const totales = useMemo(() => ({
    viajes: vivos.length,
    toneladas: vivos.reduce((t, v) => t + (v.toneladas ?? 0), 0),
    km: vivos.reduce((t, v) => t + (v.kmRecorridos ?? 0), 0),
    // Un viaje sin foto es un número sin respaldo. Se cuenta aparte porque es
    // justo lo que el dueño que está lejos necesita saber.
    sinFoto: vivos.filter((v) => !v.fotoTableroUrl).length,
  }), [vivos])

  async function onFotoFin(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setSubiendo(true); setError('')
    try {
      const { url, local } = await subirOGuardarFoto(
        `tablero-fin-${session?.id ?? 'x'}-${Date.now()}`, file, 0, uploadEvidencia)
      setFotoFin(url)
      if (local) setInfo('Foto guardada en el equipo. Se sube sola cuando haya señal.')
    } catch { setError('No se pudo subir la foto.') }
    finally { setSubiendo(false) }
  }

  async function guardarCierre() {
    if (!cerrando) return
    const km = Number(kmFin)
    if (!Number.isFinite(km) || km <= 0) { setError('Escribe los kilómetros de llegada.'); return }
    // El odómetro no baja. Si el número llega menor es un dedazo, y dejarlo
    // pasar daría un recorrido negativo que después nadie entiende.
    if (cerrando.kmInicio != null && km < cerrando.kmInicio) {
      setError(`El tablero marcaba ${n1(cerrando.kmInicio)} km al salir. ¿Seguro son ${n1(km)}?`)
      return
    }
    if (!fotoFin) { setError('Falta la foto del tablero al llegar.'); return }
    setBusy(true); setError('')
    try {
      await cerrarViaje(cerrando.id, km, fotoFin)
      const rec = cerrando.kmInicio != null ? km - cerrando.kmInicio : null
      setInfo(rec != null ? `Viaje cerrado: ${n1(rec)} km recorridos.` : 'Viaje cerrado.')
      setCerrando(null); setKmFin(''); setFotoFin('')
      await refrescar()
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo cerrar el viaje.') }
    finally { setBusy(false) }
  }

  async function anular(v: MaderaViaje) {
    setBusy(true); setError('')
    try { await anularViaje(v.id); setInfo('Viaje anulado.'); await refrescar() }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo anular.') }
    finally { setBusy(false) }
  }

  return (
    <section className="panel-card">
      <div className="panel-title split">
        <h2>{esConductor ? 'Mis viajes' : 'Viajes del camión'}</h2>
        <button type="button" className="primary-button" onClick={() => setFormOpen(true)} disabled={busy}>
          + Registrar salida
        </button>
      </div>

      <Ayuda>
        <p>
          Cada viaje se abre cuando el camión sale —con los kilómetros del tablero, la
          foto y las toneladas— y se cierra al llegar con la foto del tablero otra vez.
          De ahí sale cuánto recorrió, sin que nadie tenga que sumar.
        </p>
        <p>
          <strong>La hora no se digita:</strong> la pone el sistema. Y el kilometraje va
          siempre con su foto, porque un número escrito a mano se puede acomodar y uno
          con foto del tablero, no.
        </p>
        <p>
          Los <strong>predios y los destinos</strong> se escriben libremente: la lista solo
          sugiere lo que ya se ha usado, para no frenar a nadie en la montaña. Si quieres
          ordenarla —agregar, corregir o quitar lugares— se administra en{' '}
          <strong>Insumos → Catálogos</strong>, en “Predios de dónde sale la madera” y
          “Destinos de la madera”.
        </p>
      </Ayuda>

      <div className="madera-kpis">
        <div className="madera-kpi">
          <span className="madera-kpi__valor">{totales.viajes}</span>
          <span className="madera-kpi__rot">viajes</span>
        </div>
        <div className="madera-kpi">
          <span className="madera-kpi__valor">{n1(totales.toneladas)}</span>
          <span className="madera-kpi__rot">toneladas movidas</span>
        </div>
        <div className="madera-kpi">
          <span className="madera-kpi__valor">{n1(totales.km)}</span>
          <span className="madera-kpi__rot">km recorridos</span>
        </div>
        <div className="madera-kpi">
          <span className={`madera-kpi__valor ${totales.sinFoto > 0 ? 'madera-kpi__valor--mal' : ''}`}>
            {totales.sinFoto}
          </span>
          <span className="madera-kpi__rot">
            {totales.sinFoto === 0 ? 'todos con foto del tablero' : 'sin foto que respalde el km'}
          </span>
        </div>
      </div>

      <div className="rep-toolbar">
        <label className="rep-fecha">Desde<input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></label>
        <label className="rep-fecha">Hasta<input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></label>
      </div>
      <input type="search" className="labores-search-input" placeholder="Buscar placa, origen, destino…"
             value={busca} onChange={(e) => setBusca(e.target.value)} style={{ margin: '12px 0' }} />

      {cargando && <p className="muted-text">Cargando viajes…</p>}
      {!cargando && lista.length === 0 && (
        <p className="muted-text">Sin viajes en este rango. Registra el primero con “+ Registrar salida”.</p>
      )}

      <div className="list-rows">
        {lista.map((v) => {
          const abierto = v.kmFin == null && v.estado !== 'ANULADO'
          return (
            <article key={v.id} className={`madera-card${!v.fotoTableroUrl ? ' madera-card--riesgo' : ''}`}>
              <header className="madera-card__top">
                <div>
                  <strong>{v.placa || 'sin placa'}</strong>
                  {v.origen && <><span className="madera-card__flecha">·</span>{v.origen}</>}
                  {v.destino && <><span className="madera-card__flecha">→</span><strong>{v.destino}</strong></>}
                </div>
                <span className={`madera-chip madera-chip--${abierto ? 'en_ruta' : v.estado.toLowerCase()}`}>
                  {v.estado === 'ANULADO' ? 'Anulado' : abierto ? 'En ruta' : 'Cerrado'}
                </span>
              </header>

              <div className="madera-card__datos">
                <span title="Hora del registro, puesta por el sistema">🕐 {fmtFechaHora(v.createdAt)}</span>
                {abierto && <span title="Tiempo desde que salió">{fmtLapso(v.createdAt)} en ruta</span>}
                {v.registradoNombre && <span title="Quién registró">👤 {v.registradoNombre}</span>}
              </div>

              <div className="madera-card__carga">
                <span><strong>{n1(v.toneladas)}</strong> t cargadas</span>
                <span>
                  <strong>{n1(v.kmInicio)}</strong> km al salir
                  {v.kmFin != null && <> → <strong>{n1(v.kmFin)}</strong> al llegar</>}
                </span>
                {v.kmRecorridos != null && <span><strong>{n1(v.kmRecorridos)}</strong> km recorridos</span>}
              </div>

              <div className="madera-card__doc">
                {v.fotoTableroUrl
                  ? <><span>Tablero al salir</span><FotoEvidencia url={v.fotoTableroUrl} alt="tablero al salir" tam={48} /></>
                  : <span className="madera-dias--mal">Sin foto del tablero: el kilometraje no tiene respaldo</span>}
                {v.fotoTableroFinUrl && (
                  <><span>al llegar</span><FotoEvidencia url={v.fotoTableroFinUrl} alt="tablero al llegar" tam={48} /></>
                )}
              </div>

              {v.nota && <p className="madera-card__nota">{v.nota}</p>}

              {v.estado !== 'ANULADO' && (
                <div className="madera-card__acciones">
                  {abierto && (
                    <button type="button" className="primary-button" disabled={busy}
                            onClick={() => { setCerrando(v); setKmFin(''); setFotoFin('') }}>
                      Cerrar viaje
                    </button>
                  )}
                  {/* Anular es de administracion: el conductor corrige llamando,
                      no borrando su propio registro. */}
                  {!esConductor && (
                    <button type="button" className="inline-button maestro-delete-btn" disabled={busy}
                            onClick={() => void anular(v)}>Anular</button>
                  )}
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

      {cerrando && (
        <div className="modal-overlay open" onClick={() => { if (!busy) setCerrando(null) }}>
          <div className="modal-card flota-form" onClick={(e) => e.stopPropagation()}>
            <div className="labor-detail-header">
              <div><p className="eyebrow">Madera · Transporte</p><h3>Llegada del camión</h3></div>
              <button type="button" className="modal-close-btn" onClick={() => setCerrando(null)}
                      disabled={busy} aria-label="Cerrar">&#x2715;</button>
            </div>

            <p className="subtle-copy">
              {cerrando.placa} salió con <strong>{n1(cerrando.kmInicio)} km</strong> y{' '}
              <strong>{n1(cerrando.toneladas)} t</strong>, hace {fmtLapso(cerrando.createdAt)}.
            </p>

            <label style={{ display: 'block', marginTop: 8 }}>Kilómetros al llegar
              <input type="number" min={0} step="any" inputMode="numeric" value={kmFin} autoFocus
                     onChange={(e) => setKmFin(e.target.value)} disabled={busy} />
            </label>

            <div className="flota-comprobante" style={{ marginTop: 10 }}>
              <span className="flota-comprobante__lbl">📷 Foto del tablero al llegar</span>
              <div className="flota-foto-row">
                {fotoFin && <FotoEvidencia url={fotoFin} alt="tablero al llegar" tam={72} />}
                <button type="button" className="inline-button" onClick={() => fotoFinRef.current?.click()}
                        disabled={busy || subiendo}>
                  {subiendo ? 'Subiendo…' : fotoFin ? 'Repetir foto' : '📷 Tomar foto'}
                </button>
                <input ref={fotoFinRef} type="file" accept="image/*" capture="environment" hidden onChange={onFotoFin} />
              </div>
            </div>

            <div className="modal-footer">
              <button type="button" className="inline-button" onClick={() => setCerrando(null)} disabled={busy}>Cancelar</button>
              <button type="button" className="primary-button" onClick={() => void guardarCierre()} disabled={busy || subiendo}>
                {busy ? 'Guardando…' : 'Cerrar viaje'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

export default MaderaTab
