import { useRef, useState } from 'react'
import { useAppData } from '../context/AppDataContext'
import { firmarDiaFlota } from '../services/samApi'
import { FirmaPad, type FirmaPadHandle } from '../components/FirmaPad'
import { aMayus } from '../lib/texto'
import type { FlotaServicio } from '../domain/sam'

/**
 * Firma la PLANILLA DEL DÍA de IMECOL (2-oct-2026): «una firma por día, no una por
 * registro, porque es una planilla para todos los recorridos del día». Quien recibe
 * ve la lista de los servicios del día y firma una sola vez. Con la firma, el día
 * queda cerrado: esos servicios ya no se corrigen (administración puede quitar la
 * firma para corregir).
 */
export function FlotaFirmarDia({ fecha, conductorId, conductorNombre, servicios, onClose, onSaved }: {
  fecha: string
  conductorId: string
  conductorNombre?: string
  servicios: FlotaServicio[]
  onClose: () => void
  onSaved: () => void
}) {
  const { busy, setBusy, setError, setInfo, session } = useAppData()
  const [nombre, setNombre] = useState('')
  const firmaRef = useRef<FirmaPadHandle>(null)
  const totalKm = servicios.reduce((a, s) => a + (s.totalKm ?? 0), 0)
  const [y, m, d] = fecha.split('-')

  async function firmar() {
    if (!nombre.trim()) { setError('Escribe el nombre y la cédula de quien recibe.'); return }
    setBusy(true); setError('')
    try {
      const firma = await firmaRef.current?.exportar()
      if (!firma) { setError('Falta la firma.'); return }
      const n = await firmarDiaFlota({
        conductorId, conductorNombre, fecha, formato: 'IMECOL', firma, firmaNombre: nombre,
        servicioIds: servicios.map((s) => s.id), creadoPor: session?.id,
      })
      setInfo(`Planilla del ${d}/${m}/${y} firmada: ${n} servicio${n === 1 ? '' : 's'}.`)
      onSaved()
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally { setBusy(false) }
  }

  return (
    <div className="modal-overlay open" onClick={() => { if (!busy) onClose() }}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 'min(520px, calc(100vw - 24px))' }}>
        <div className="labor-detail-header">
          <div>
            <p className="eyebrow">Planilla del día · IMECOL</p>
            <h3>{d}/{m}/{y}{conductorNombre ? ` · ${conductorNombre}` : ''}</h3>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} disabled={busy} aria-label="Cerrar">&#x2715;</button>
        </div>

        <p className="subtle-copy" style={{ marginTop: 0 }}>
          {servicios.length} servicio{servicios.length === 1 ? '' : 's'}{totalKm ? ` · ${totalKm.toLocaleString('es-CO')} km` : ''}. Una sola firma para todos:
        </p>
        <ul className="flota-dia-lista">
          {servicios.map((s) => (
            <li key={s.id}>
              <b>{s.origen} → {s.destino}</b>
              <span>{[s.horaSalidaOrigen && `${s.horaSalidaOrigen}${s.horaLlegadaDestino ? `–${s.horaLlegadaDestino}` : ''}`, s.nombrePasajero, s.totalKm ? `${s.totalKm} km` : null].filter(Boolean).join(' · ')}</span>
            </li>
          ))}
        </ul>

        <div className="flota-comprobante">
          <span className="flota-comprobante__lbl">✍️ Firma de quien recibe la planilla del día</span>
          <input type="text" className="flota-firma-nombre" placeholder="Nombre y cédula de quien recibe"
            autoCapitalize="characters" value={nombre} onChange={(e) => setNombre(aMayus(e.target.value))} disabled={busy} />
          <FirmaPad ref={firmaRef} disabled={busy} />
        </div>
        <p className="field-hint">Al firmar, los servicios de este día quedan cerrados y ya no se pueden corregir.</p>

        <div className="modal-footer">
          <button type="button" className="inline-button" onClick={onClose} disabled={busy}>Cancelar</button>
          <button type="button" className="primary-button" onClick={() => void firmar()} disabled={busy}>
            {busy ? 'Firmando…' : 'Firmar planilla del día'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default FlotaFirmarDia
