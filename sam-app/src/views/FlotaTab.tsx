import { useEffect, useMemo, useState } from 'react'
import { useAppData } from '../context/AppDataContext'
import { loadFlotaServicios, anularFlotaServicio } from '../services/samApi'
import { FlotaForm } from './FlotaForm'
import type { FlotaServicio } from '../domain/sam'

/**
 * Módulo Flota / Escolta — lista de servicios (CDA-F-68), registro de uno nuevo
 * y exportación a Excel con el formato oficial. Con `conductorScope` se acota a
 * un conductor (su vista); sin él, administración ve todos.
 */
function primerDiaMes(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}
function hoyISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function fmtFecha(iso: string): string {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return d && m && y ? `${d}/${m}/${y}` : iso
}

export function FlotaTab({ conductorScope }: { conductorScope?: { id: string; nombre: string } }) {
  const { busy, setBusy, setError, setInfo } = useAppData()
  const esAdmin = !conductorScope

  const [servicios, setServicios] = useState<FlotaServicio[]>([])
  const [loading, setLoading] = useState(false)
  const [desde, setDesde] = useState(primerDiaMes())
  const [hasta, setHasta] = useState(hoyISO())
  const [busca, setBusca] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [verFotoUrl, setVerFotoUrl] = useState<string>('')

  async function refresh() {
    setLoading(true)
    try {
      setServicios(await loadFlotaServicios({ conductorId: conductorScope?.id, desde, hasta }))
    } finally { setLoading(false) }
  }
  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desde, hasta])

  const lista = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return servicios.filter((s) => !q ||
      `${s.origen} ${s.destino} ${s.nombrePasajero} ${s.vehiculo} ${s.conductorNombre} ${s.centroCosto}`.toLowerCase().includes(q))
  }, [servicios, busca])

  async function exportarExcel() {
    if (lista.length === 0) { setError('No hay servicios en el rango elegido.'); return }
    setBusy(true); setError('')
    try {
      const { utils, writeFile } = await import('xlsx')
      const rows = lista.map((s) => ({
        'FECHA': fmtFecha(s.fecha),
        'TIPO SERVICIO': s.tipoServicio ?? '',
        'CENTRO DE COSTO': s.centroCosto ?? '',
        'PROCESO SOLICITANTE': s.procesoSolicitante ?? '',
        'NOMBRE DEL PASAJERO': s.nombrePasajero ?? '',
        'ORIGEN': s.origen ?? '',
        'DESTINO': s.destino ?? '',
        'HORA SALIDA ORIGEN': s.horaSalidaOrigen ?? '',
        'HORA LLEGADA DESTINO': s.horaLlegadaDestino ?? '',
        'HORA SALIDA DESTINO': s.horaSalidaDestino ?? '',
        'HORA LLEGADA ORIGEN': s.horaLlegadaOrigen ?? '',
        'HORA DE ESPERA': s.horaEspera ?? '',
        '# PEAJES': s.numPeajes ?? 0,
        'OTROS GASTOS': s.otrosGastos ?? 0,
        'TOTAL KM': s.totalKm ?? 0,
        'OBSERVACIÓN': s.observacion ?? '',
        'VEHÍCULO': s.vehiculo ?? '',
        'CONDUCTOR': s.conductorNombre ?? '',
        'FIRMA (quién)': s.firmaNombre ?? '',
        'FIRMA (url)': s.firmaUrl ?? '',
        'EVIDENCIA (url)': s.evidenciaUrl ?? '',
        'ESTADO': s.estado,
      }))
      const wb = utils.book_new()
      utils.book_append_sheet(wb, utils.json_to_sheet(rows), 'CDA-F-68')
      writeFile(wb, `flota-escolta-${desde}-a-${hasta}.xlsx`)
      setInfo(`Exportado: ${lista.length} servicios.`)
    } catch {
      setError('No se pudo generar el Excel.')
    } finally { setBusy(false) }
  }

  async function anular(s: FlotaServicio) {
    if (!window.confirm(`¿Anular el servicio ${s.origen} → ${s.destino} del ${fmtFecha(s.fecha)}?`)) return
    setBusy(true); setError('')
    try {
      await anularFlotaServicio(s.id)
      setInfo('Servicio anulado.')
      void refresh()
    } catch (err) {
      const e = err as { message?: string }
      setError(`No se pudo anular. (${e?.message ?? 'error'})`)
    } finally { setBusy(false) }
  }

  return (
    <section className="panel-card">
      <div className="panel-title split">
        <h2>{esAdmin ? 'Flota / Escolta' : 'Mis servicios'}</h2>
        <button type="button" className="primary-button" onClick={() => setFormOpen(true)} disabled={busy}>+ Nuevo servicio</button>
      </div>
      <p className="subtle-copy" style={{ marginTop: 0 }}>
        Control de transporte de flota no propia (CDA-F-68). Cada servicio lleva su firma y foto de evidencia.
      </p>

      <div className="rep-toolbar">
        <label className="rep-fecha">Desde<input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></label>
        <label className="rep-fecha">Hasta<input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></label>
        {esAdmin && (
          <button type="button" className="primary-button rep-export" onClick={() => void exportarExcel()} disabled={busy || loading || lista.length === 0}>
            ⬇ Excel (CDA-F-68)
          </button>
        )}
      </div>
      <input type="search" className="labores-search-input" placeholder="Buscar origen, destino, pasajero, placa…" value={busca} onChange={(e) => setBusca(e.target.value)} style={{ margin: '12px 0' }} />

      {loading ? (
        <p className="muted-text">Cargando…</p>
      ) : lista.length === 0 ? (
        <p className="muted-text">Sin servicios en este rango. Registra el primero con “+ Nuevo servicio”.</p>
      ) : (
        <div className="list-rows">
          {lista.map((s) => (
            <article key={s.id} className={`flota-card${s.estado === 'ANULADO' ? ' flota-card--anulado' : ''}`}>
              <div className="flota-card__head">
                <strong>{s.origen} → {s.destino}</strong>
                <span className="flota-card__fecha">{fmtFecha(s.fecha)}{s.tipoServicio ? ` · ${s.tipoServicio}` : ''}</span>
              </div>
              <div className="flota-card__meta">
                {s.nombrePasajero && <span>👤 {s.nombrePasajero}</span>}
                {s.vehiculo && <span>🚙 {s.vehiculo}</span>}
                {s.horaSalidaOrigen && <span>🕐 {s.horaSalidaOrigen}{s.horaLlegadaOrigen ? `–${s.horaLlegadaOrigen}` : ''}</span>}
                {s.totalKm ? <span>📍 {s.totalKm} km</span> : null}
                {esAdmin && s.conductorNombre && <span>🧑‍✈️ {s.conductorNombre}</span>}
                {s.estado === 'ANULADO' && <span className="flota-anulado-badge">ANULADO</span>}
              </div>
              {(s.firmaUrl || s.evidenciaUrl || s.firmaNombre) && (
                <div className="flota-card__comp">
                  {s.evidenciaUrl && <button type="button" className="flota-thumb-btn" onClick={() => setVerFotoUrl(s.evidenciaUrl!)}>📷 Evidencia</button>}
                  {s.firmaUrl && <button type="button" className="flota-thumb-btn" onClick={() => setVerFotoUrl(s.firmaUrl!)}>✍️ Firma{s.firmaNombre ? ` · ${s.firmaNombre}` : ''}</button>}
                </div>
              )}
              {esAdmin && s.estado !== 'ANULADO' && (
                <div className="flota-card__actions">
                  <button type="button" className="inline-button maestro-delete-btn" onClick={() => void anular(s)} disabled={busy}>Anular</button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}

      {formOpen && (
        <FlotaForm
          onClose={() => setFormOpen(false)}
          onSaved={() => void refresh()}
          conductorId={conductorScope?.id}
          conductorNombre={conductorScope?.nombre}
        />
      )}

      {verFotoUrl && (
        <div className="modal-overlay open" onClick={() => setVerFotoUrl('')}>
          <img src={verFotoUrl} alt="comprobante" className="flota-foto-full" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </section>
  )
}

export default FlotaTab
