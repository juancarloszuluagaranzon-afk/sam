import { useEffect, useMemo, useState } from 'react'
import { useAppData } from '../context/AppDataContext'
import { loadFlotaServicios, anularFlotaServicio } from '../services/samApi'
import { FlotaForm } from './FlotaForm'
import type { FlotaServicio } from '../domain/sam'
import { Ayuda } from '../components/Ayuda'

/**
 * Módulo Flota / Escolta — lista de servicios (CDA-F-68), registro de uno nuevo
 * y exportación a Excel con el formato oficial. Con `conductorScope` se acota a
 * un conductor (su vista); sin él, administración ve todos.
 */
/**
 * Membrete y codigos de normalizacion del formato impreso.
 *
 * Van aparte y con nombre para que se puedan cambiar sin tocar el codigo del
 * export: cuando salga la version 2 del formato, se edita aqui y ya.
 */
const MEMBRETE = {
  empresa: 'IMECOL',
  titulo: 'CONTROL DE TRANSPORTE FLOTA NO PROPIA',
  codigo: 'CDA-F-68',
  version: '1',
  fecha: '1/05/2025',
  pagina: '1 de 1',
}

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

      // La planilla sale CALCADA del formato en papel: membrete, codigos de
      // normalizacion y las 16 columnas en el mismo orden. Se arma con
      // `aoa_to_sheet` y no con `json_to_sheet` porque este ultimo solo sabe
      // hacer una fila de encabezados — no sabe de celdas combinadas ni de un
      // bloque de membrete encima.
      const filas: (string | number)[][] = [
        [MEMBRETE.empresa, 'FORMATO', '', '', '', '', '', '', '', '', '', '', '', '', `Codigo: ${MEMBRETE.codigo}`, ''],
        ['', MEMBRETE.titulo, '', '', '', '', '', '', '', '', '', '', '', '', `Version: ${MEMBRETE.version}`, ''],
        ['', '', '', '', '', '', '', '', '', '', '', '', '', '', `Fecha: ${MEMBRETE.fecha}`, ''],
        ['', '', '', '', '', '', '', '', '', '', '', '', '', '', `Pag: ${MEMBRETE.pagina}`, ''],
        [],
        ['FECHA', 'TIPO SERVICIO', 'CENTRO DE COSTO', 'PROCESO SOLICITANTE', 'NOMBRE DEL PASAJERO',
         'ORIGEN', 'DESTINO', 'HORA SALIDA ORIGEN', 'HORA LLEGADA DESTINO', 'HORA SALIDA DESTINO',
         'HORA LLEGADA ORIGEN', 'HORA DE ESPERA', '# PEAJES', 'OTROS GASTOS', 'TOTAL KM', 'OBSERVACION'],
      ]
      for (const s of lista) {
        filas.push([
          fmtFecha(s.fecha), s.tipoServicio ?? '', s.centroCosto ?? '', s.procesoSolicitante ?? '',
          s.nombrePasajero ?? '', s.origen ?? '', s.destino ?? '',
          s.horaSalidaOrigen ?? '', s.horaLlegadaDestino ?? '', s.horaSalidaDestino ?? '',
          s.horaLlegadaOrigen ?? '', s.horaEspera ?? '',
          s.numPeajes ?? 0, s.otrosGastos ?? 0, s.totalKm ?? 0, s.observacion ?? '',
        ])
      }
      // El total de kilometros, como la suma escrita a mano al pie de la columna.
      const totalKm = lista.reduce((acc, s) => acc + (s.totalKm ?? 0), 0)
      filas.push([])
      filas.push(['', '', '', '', '', '', '', '', '', '', '', '', '', 'TOTAL', totalKm, ''])
      filas.push([])
      filas.push([`OBSERVACION: ${lista.map((s) => s.observacion).filter(Boolean).join(' · ')}`])

      const ws = utils.aoa_to_sheet(filas)
      // Combinadas del membrete: el logo a la izquierda, el titulo al centro y
      // el bloque de codigos a la derecha, igual que el formato impreso.
      ws['!merges'] = [
        { s: { r: 0, c: 0 }, e: { r: 3, c: 0 } },    // empresa
        { s: { r: 0, c: 1 }, e: { r: 0, c: 13 } },   // FORMATO
        { s: { r: 1, c: 1 }, e: { r: 3, c: 13 } },   // titulo del formato
        { s: { r: 0, c: 14 }, e: { r: 0, c: 15 } },  // codigo
        { s: { r: 1, c: 14 }, e: { r: 1, c: 15 } },  // version
        { s: { r: 2, c: 14 }, e: { r: 2, c: 15 } },  // fecha
        { s: { r: 3, c: 14 }, e: { r: 3, c: 15 } },  // pagina
        { s: { r: filas.length - 1, c: 0 }, e: { r: filas.length - 1, c: 15 } },
      ]
      // Anchos: los de hora y numero angostos, los de texto libre amplios.
      ws['!cols'] = [10, 14, 14, 16, 20, 14, 14, 11, 11, 11, 11, 10, 8, 11, 9, 26]
        .map((w) => ({ wch: w }))

      const wb = utils.book_new()
      utils.book_append_sheet(wb, ws, 'CDA-F-68')

      // Segunda hoja con lo que el papel NO tiene pero el sistema si guarda.
      // Va aparte para que la planilla imprimible quede calcada del formato.
      utils.book_append_sheet(wb, utils.json_to_sheet(lista.map((s) => ({
        'FECHA': fmtFecha(s.fecha),
        'ORIGEN': s.origen ?? '',
        'DESTINO': s.destino ?? '',
        'VEHICULO': s.vehiculo ?? '',
        'CONDUCTOR': s.conductorNombre ?? '',
        'FIRMA (quien)': s.firmaNombre ?? '',
        'FIRMA (url)': s.firmaUrl ?? '',
        'EVIDENCIA (url)': s.evidenciaUrl ?? '',
        'ESTADO': s.estado,
      }))), 'Respaldo')

      writeFile(wb, `CDA-F-68-${desde}-a-${hasta}.xlsx`)
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
      <Ayuda>
        <p>Control de transporte de flota no propia (CDA-F-68). Cada servicio lleva su firma y foto de evidencia.</p>
      </Ayuda>

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
