import { useState } from 'react'
import { useAppData } from '../context/AppDataContext'
import { editarFlotaServicio } from '../services/samApi'
import { aMayus } from '../lib/texto'
import type { EditarFlotaServicioInput, FlotaServicio } from '../domain/sam'

/**
 * Corregir un servicio de IMECOL ya registrado (2-oct-2026, pedido de Julián):
 * mientras su DÍA no esté firmado. La base vuelve a revisar esa condición al
 * guardar (si mientras tanto alguien firmó el día, no se toca nada).
 * Solo se manda lo que cambió.
 */
type Campo = { k: keyof EditarFlotaServicioInput; label: string; tipo?: 'time' | 'date' | 'num' | 'texto'; ancho?: boolean }
const CAMPOS: Campo[] = [
  { k: 'fecha', label: 'Fecha', tipo: 'date' },
  { k: 'vehiculo', label: 'Placa' },
  { k: 'tipoServicio', label: 'Tipo de servicio' },
  { k: 'centroCosto', label: 'Centro de costo' },
  { k: 'procesoSolicitante', label: 'Proceso solicitante' },
  { k: 'nombrePasajero', label: 'Pasajero', ancho: true },
  { k: 'origen', label: 'Origen' },
  { k: 'destino', label: 'Destino' },
  { k: 'horaSalidaOrigen', label: 'Sale origen', tipo: 'time' },
  { k: 'horaLlegadaDestino', label: 'Llega destino', tipo: 'time' },
  { k: 'horaSalidaDestino', label: 'Sale destino', tipo: 'time' },
  { k: 'horaLlegadaOrigen', label: 'Llega origen', tipo: 'time' },
  { k: 'horaEspera', label: 'Hora de espera' },
  { k: 'numPeajes', label: '# Peajes', tipo: 'num' },
  { k: 'otrosGastos', label: 'Otros gastos', tipo: 'num' },
  { k: 'kmInicial', label: 'Km inicial', tipo: 'num' },
  { k: 'kmFinal', label: 'Km final', tipo: 'num' },
  { k: 'observacion', label: 'Observación', ancho: true },
]

function valorDe(s: FlotaServicio, k: keyof EditarFlotaServicioInput): string {
  const v = (s as unknown as Record<string, unknown>)[k]
  return v == null ? '' : String(v)
}

export function FlotaEditarServicio({ servicio: s, onClose, onSaved }: { servicio: FlotaServicio; onClose: () => void; onSaved: () => void }) {
  const { busy, setBusy, setError, setInfo } = useAppData()
  const [form, setForm] = useState<Record<string, string>>(() => Object.fromEntries(CAMPOS.map((c) => [c.k, valorDe(s, c.k)])))

  async function guardar() {
    const cambios: EditarFlotaServicioInput = {}
    for (const c of CAMPOS) {
      const nuevo = form[c.k] ?? ''
      if (nuevo === valorDe(s, c.k)) continue
      if (c.tipo === 'num') {
        const n = nuevo.trim() === '' ? null : Number(nuevo.replace(',', '.'))
        if (n != null && !Number.isFinite(n)) { setError(`${c.label}: escribe un número.`); return }
        ;(cambios as Record<string, unknown>)[c.k] = n
      } else {
        ;(cambios as Record<string, unknown>)[c.k] = nuevo
      }
    }
    if (Object.keys(cambios).length === 0) { onClose(); return }
    setBusy(true); setError('')
    try {
      const ok = await editarFlotaServicio(s.id, cambios, s.kmInicial, s.kmFinal)
      if (!ok) { setError('No se guardó: el día de este servicio ya está firmado.'); return }
      setInfo('Servicio corregido.')
      onSaved()
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally { setBusy(false) }
  }

  return (
    <div className="modal-overlay open" onClick={() => { if (!busy) onClose() }}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 'min(560px, calc(100vw - 24px))' }}>
        <div className="labor-detail-header">
          <div>
            <p className="eyebrow">Corregir servicio · IMECOL</p>
            <h3>{s.origen} → {s.destino}</h3>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} disabled={busy} aria-label="Cerrar">&#x2715;</button>
        </div>
        <div className="flota-editar-grid">
          {CAMPOS.map((c) => (
            <label key={c.k} className={c.ancho ? 'flota-editar--ancho' : ''}>
              {c.label}
              <input
                id={`flota-ed-${c.k}`}
                type={c.tipo === 'time' ? 'time' : c.tipo === 'date' ? 'date' : 'text'}
                inputMode={c.tipo === 'num' ? 'decimal' : undefined}
                value={form[c.k] ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, [c.k]: c.tipo ? e.target.value : aMayus(e.target.value) }))}
                disabled={busy}
              />
            </label>
          ))}
        </div>
        <p className="field-hint">Se puede corregir mientras el día no esté firmado. El total de km se recalcula solo.</p>
        <div className="modal-footer">
          <button type="button" className="inline-button" onClick={onClose} disabled={busy}>Cancelar</button>
          <button type="button" className="primary-button" onClick={() => void guardar()} disabled={busy}>{busy ? 'Guardando…' : 'Guardar cambios'}</button>
        </div>
      </div>
    </div>
  )
}

export default FlotaEditarServicio
