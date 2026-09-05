import { useRef, useState, type ChangeEvent } from 'react'
import { useAppData } from '../context/AppDataContext'
import { cerrarFlotaServicio, uploadImagenFlota } from '../services/samApi'
import { FirmaPad, type FirmaPadHandle } from '../components/FirmaPad'
import { aMayus } from '../lib/texto'
import type { FlotaServicio } from '../domain/sam'

/**
 * **CIERRE** de un viaje de la planilla F-OPE-22 — la segunda fase.
 *
 * Aquí van los cuatro datos que solo existen al llegar: la hora final, el
 * tiempo de espera, el kilómetro final y la firma de quien recibió el servicio.
 *
 * 🔴 **El km total no se teclea: es la resta**, y se muestra la operación
 * completa contra el kilómetro con el que se abrió el viaje. Ahí está el valor
 * de partirlo en dos fases — el inicial ya está guardado desde la salida, así
 * que la resta se hace contra un número que nadie tuvo que recordar.
 */

/** La hora de ahora en `HH:mm`: es el momento de llegar. */
function ahoraHHMM(): string {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function n0(v: number) {
  return Number.isFinite(v) ? new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 }).format(v) : '—'
}

export function FlotaCerrarViaje({
  viaje,
  onClose,
  onSaved,
}: {
  viaje: FlotaServicio
  onClose: () => void
  onSaved: () => void
}) {
  const { busy, setBusy, setError, setInfo } = useAppData()

  const [horaFinal, setHoraFinal] = useState(ahoraHHMM())
  const [tiempoEspera, setTiempoEspera] = useState('')
  const [kmFinal, setKmFinal] = useState('')
  const [observacion, setObservacion] = useState('')
  const [firmaNombre, setFirmaNombre] = useState('')

  const firmaRef = useRef<FirmaPadHandle>(null)
  const fotoRef = useRef<HTMLInputElement>(null)
  const [foto, setFoto] = useState<File | null>(null)
  const [fotoPreview, setFotoPreview] = useState('')

  function onFoto(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) { setError('Selecciona una imagen.'); return }
    setFoto(file)
    setFotoPreview(URL.createObjectURL(file))
  }

  const ini = viaje.kmInicial
  const fin = kmFinal.trim() === '' ? null : Number(kmFinal)
  const total = ini != null && fin != null && Number.isFinite(fin)
    ? Math.round((fin - ini) * 100) / 100
    : null
  const alReves = total != null && total < 0

  async function cerrar() {
    // ⚠️ No se BLOQUEA por falta del kilómetro final: el odómetro se daña y a
    // las 7 de la noche exigirlo obliga a inventar un número, que es peor que
    // una casilla vacía. Se pide un segundo toque y ya.
    if (fin == null && !window.confirm(
      'Vas a cerrar el viaje sin el kilómetro final.\n\n' +
      'La planilla saldrá con esa casilla en blanco. ¿Seguro?')) return
    if (alReves && !window.confirm(
      `El kilómetro final (${n0(fin!)}) es menor que el inicial (${n0(ini!)}).\n\n` +
      'La planilla saldría con kilómetros en negativo. ¿Seguro?')) return

    setBusy(true); setError('')
    try {
      let firmaUrl: string | undefined
      let evidenciaUrl: string | undefined
      const firmaFile = await firmaRef.current?.exportar()
      if (firmaFile) firmaUrl = await uploadImagenFlota(viaje.id, firmaFile, 'firma')
      if (foto) evidenciaUrl = await uploadImagenFlota(viaje.id, foto, 'evidencia')

      await cerrarFlotaServicio(viaje.id, {
        horaFinal: horaFinal || undefined,
        tiempoEspera: tiempoEspera.trim() || undefined,
        kmFinal: fin ?? undefined,
        kmInicial: ini ?? undefined,
        observacion: observacion.trim() || undefined,
        firmaUrl,
        firmaNombre: firmaNombre.trim() || undefined,
        evidenciaUrl,
      })
      setInfo('Viaje cerrado. Ya cuenta para la planilla.')
      onSaved()
      onClose()
    } catch (err) {
      const e = err as { message?: string }
      setError(`No se pudo cerrar el viaje. (${e?.message ?? 'error'})`)
    } finally { setBusy(false) }
  }

  return (
    <div className="modal-overlay open" onClick={() => { if (!busy) onClose() }}>
      <div className="modal-card flota-form" onClick={(e) => e.stopPropagation()}>
        <div className="labor-detail-header">
          <div>
            <p className="eyebrow">AgroMorales · F-OPE-22</p>
            <h3>Cerrar viaje</h3>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} disabled={busy} aria-label="Cerrar">&#x2715;</button>
        </div>

        {/* Lo que ya quedó guardado al salir, para no tener que acordarse. */}
        <div className="flota-abierto">
          <strong>{viaje.origen} → {viaje.destino}</strong>
          <span>
            {viaje.vehiculo}
            {viaje.tipoServicio ? ` · ${viaje.tipoServicio}` : ''}
            {viaje.numeroMaquinaria ? ` · máquina ${viaje.numeroMaquinaria}` : ''}
          </span>
          <span>
            Salió {viaje.horaSalidaOrigen || '—'}
            {ini != null ? ` · km ${n0(ini)}` : ' · sin km inicial'}
          </span>
        </div>

        <div className="flota-grid">
          <label>Hora final<input type="time" value={horaFinal} onChange={(e) => setHoraFinal(e.target.value)} disabled={busy} /></label>
          {/* Es una DURACIÓN, no una hora del día: si esperó 45 minutos, `0:45`. */}
          <label>Tiempo de espera <span className="field-optional">(opcional)</span>
            <input type="text" value={tiempoEspera} onChange={(e) => setTiempoEspera(e.target.value)}
                   placeholder="ej. 0:45" disabled={busy} /></label>
          <label>Km final
            <input type="number" min={0} step="any" inputMode="numeric" value={kmFinal}
                   onChange={(e) => setKmFinal(e.target.value)}
                   placeholder={ini != null ? `arrancó en ${n0(ini)}` : 'lectura del tablero'}
                   disabled={busy} /></label>
          <div className="flota-km">
            <span className="flota-km__lbl">Km total</span>
            {total == null ? (
              <>
                <b className="flota-km__val">—</b>
                <small>{ini == null ? 'el viaje no trae km inicial' : 'falta el km final'}</small>
              </>
            ) : (
              <>
                <b className={alReves ? 'flota-km__mal' : 'flota-km__val'}>{n0(total)}</b>
                <small>{n0(fin!)} − {n0(ini!)}</small>
              </>
            )}
          </div>
        </div>

        {alReves && (
          <p className="flota-km__aviso">
            ⚠ El kilómetro final es <strong>menor</strong> que el inicial. Revisa la
            lectura: así la planilla saldría con kilómetros en negativo.
          </p>
        )}

        <label style={{ display: 'block', marginTop: 8 }}>
          Observación
          <textarea rows={2} value={observacion} onChange={(e) => setObservacion(aMayus(e.target.value))} disabled={busy} />
        </label>

        <div className="flota-comprobante">
          <span className="flota-comprobante__lbl">📷 Foto de evidencia <span className="field-optional">(se guarda liviana)</span></span>
          <div className="flota-foto-row">
            {fotoPreview && <img src={fotoPreview} alt="evidencia" className="flota-foto-thumb" />}
            <button type="button" className="inline-button" onClick={() => fotoRef.current?.click()} disabled={busy}>
              {foto ? 'Cambiar foto' : '📷 Tomar foto'}
            </button>
            {foto && <button type="button" className="inline-button" onClick={() => { setFoto(null); setFotoPreview('') }} disabled={busy}>Quitar</button>}
            <input ref={fotoRef} type="file" accept="image/*" capture="environment" hidden onChange={onFoto} />
          </div>
        </div>

        {/* En el papel esta columna se llama FIRMA RESPONSABLE y se escribe el
            nombre CON la cédula («MAURICIO CH 600486»): con el nombre solo, un
            apellido repetido no distingue a nadie. */}
        <div className="flota-comprobante">
          <span className="flota-comprobante__lbl">✍️ Firma responsable</span>
          <input type="text" className="flota-firma-nombre" placeholder="Nombre y cédula de quien recibe"
                 autoCapitalize="characters" value={firmaNombre}
                 onChange={(e) => setFirmaNombre(aMayus(e.target.value))} disabled={busy} />
          <FirmaPad ref={firmaRef} disabled={busy} />
        </div>

        <div className="modal-footer">
          <button type="button" className="inline-button" onClick={onClose} disabled={busy}>Cancelar</button>
          <button type="button" className="primary-button" onClick={() => void cerrar()} disabled={busy}>
            {busy ? 'Cerrando…' : 'Cerrar viaje'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default FlotaCerrarViaje
