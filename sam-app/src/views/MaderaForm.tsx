import { useState, type ChangeEvent, useRef } from 'react'
import { useAppData } from '../context/AppDataContext'
import { CampoPlaca, CampoLista, recordarPlaca, recordarValor } from '../components/CampoPlaca'
import { FotoEvidencia } from '../components/FotoEvidencia'
import { uploadEvidencia } from '../services/samApi'
import { subirOGuardarFoto } from '../lib/outboxInsumos'
import { fmtFechaHora } from '../lib/fechas'
import { crearViaje } from '../services/maderaApi'

/**
 * Parte de viaje: kilometraje CON FOTO DEL TABLERO.
 *
 * **Para qué existe.** El dueño del camión vive lejos y quiere saber qué hizo su
 * vehículo. Eso no se resuelve con más campos, se resuelve con prueba: el
 * kilometraje no se declara, se demuestra con la foto del tablero, y la hora la
 * pone el sistema — no se digita, así que no se puede acomodar después.
 *
 * Cinco campos. Todo lo demás sobra en la carretera.
 */

export function MaderaForm({
  onClose, onGuardado, registradoPor, registradoNombre,
}: {
  onClose: () => void
  onGuardado: () => void
  registradoPor?: string
  registradoNombre?: string
}) {
  const { busy, setBusy, setError, setInfo } = useAppData()

  const [placa, setPlaca] = useState('')
  const [kmInicio, setKmInicio] = useState('')
  const [toneladas, setToneladas] = useState('')
  const [destino, setDestino] = useState('')
  const [fotoTablero, setFotoTablero] = useState('')
  const [nota, setNota] = useState('')
  const [subiendo, setSubiendo] = useState(false)
  const fotoRef = useRef<HTMLInputElement>(null)

  // La hora del registro es la de AHORA y se muestra para que quede claro que
  // no se digita. Se congela al abrir el formulario.
  const [abiertoEn] = useState(() => new Date().toISOString())

  async function onFoto(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setSubiendo(true); setError('')
    try {
      // Perfil `documento`: el tablero hay que poder LEERLO. Con el perfil de
      // evidencia (800 px) los dígitos del odómetro no se distinguen.
      const { url, local } = await subirOGuardarFoto(
        `tablero-${registradoPor ?? 'x'}-${Date.now()}`, file, 0, uploadEvidencia)
      setFotoTablero(url)
      if (local) setInfo('Foto guardada en el equipo. Se sube sola cuando haya señal.')
    } catch { setError('No se pudo subir la foto.') }
    finally { setSubiendo(false) }
  }

  async function guardar() {
    if (!placa.trim()) { setError('¿Cuál camión?'); return }
    const km = Number(kmInicio)
    if (!Number.isFinite(km) || km <= 0) { setError('Escribe los kilómetros que marca el tablero.'); return }
    const ton = Number(toneladas)
    if (!Number.isFinite(ton) || ton <= 0) { setError('Escribe cuántas toneladas se cargaron.'); return }
    // La foto es el punto entero del registro, así que se pide de verdad.
    if (!fotoTablero) { setError('Falta la foto del tablero: es la que respalda el kilometraje.'); return }

    setBusy(true); setError('')
    try {
      await crearViaje({
        placa: placa.trim(),
        kmInicio: km,
        toneladas: ton,
        destino: destino.trim(),
        fotoTableroUrl: fotoTablero,
        nota: nota.trim(),
        registradoPor, registradoNombre,
      })
      recordarPlaca(placa)
      if (destino) recordarValor('DESTINO_MADERA', destino)
      setInfo(`Viaje abierto: ${placa.trim()} · ${km} km · ${ton} t.`)
      onGuardado()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo registrar el viaje.')
    } finally { setBusy(false) }
  }

  return (
    <div className="modal-overlay open" onClick={() => { if (!busy) onClose() }}>
      <div className="modal-card flota-form" onClick={(e) => e.stopPropagation()}>
        <div className="labor-detail-header">
          <div><p className="eyebrow">Madera · Transporte</p><h3>Salida del camión</h3></div>
          <button type="button" className="modal-close-btn" onClick={onClose} disabled={busy} aria-label="Cerrar">&#x2715;</button>
        </div>

        {/* La hora se muestra, no se pide. Que se vea es parte del control. */}
        <p className="madera-hora-auto">
          🕐 <strong>{fmtFechaHora(abiertoEn)}</strong> · la hora la toma el sistema
        </p>

        <div className="flota-grid">
          <label><span>Camión (placa) <span style={{ color: '#b3261e' }}>*</span></span>
            <CampoPlaca value={placa} onChange={setPlaca} disabled={busy} />
          </label>

          <label><span>Kilómetros al salir <span style={{ color: '#b3261e' }}>*</span></span>
            <input type="number" min={0} step="any" inputMode="numeric" value={kmInicio}
                   onChange={(e) => setKmInicio(e.target.value)} disabled={busy} />
          </label>

          <label><span>Toneladas cargadas <span style={{ color: '#b3261e' }}>*</span></span>
            <input type="number" min={0} step="any" inputMode="decimal" value={toneladas}
                   onChange={(e) => setToneladas(e.target.value)} disabled={busy} />
          </label>

          <label>¿Para dónde va?
            <CampoLista tipo="DESTINO_MADERA" value={destino} onChange={setDestino} disabled={busy}
                        placeholder="PLANTA YUMBO" />
          </label>
        </div>

        <div className="flota-comprobante">
          <span className="flota-comprobante__lbl">
            📷 Foto del tablero <span style={{ color: '#b3261e' }}>*</span>
          </span>
          <p className="subtle-copy" style={{ margin: '2px 0 8px' }}>
            Que se alcance a leer el kilometraje. Es lo que respalda el número.
          </p>
          <div className="flota-foto-row">
            {fotoTablero && <FotoEvidencia url={fotoTablero} alt="tablero del camión" tam={72} />}
            <button type="button" className="inline-button" onClick={() => fotoRef.current?.click()}
                    disabled={busy || subiendo}>
              {subiendo ? 'Subiendo…' : fotoTablero ? 'Repetir foto' : '📷 Tomar foto'}
            </button>
            <input ref={fotoRef} type="file" accept="image/*" capture="environment" hidden onChange={onFoto} />
          </div>
        </div>

        <label style={{ display: 'block', marginTop: 10 }}>Nota
          <textarea rows={2} value={nota} onChange={(e) => setNota(e.target.value)} disabled={busy} />
        </label>

        <div className="modal-footer">
          <button type="button" className="inline-button" onClick={onClose} disabled={busy}>Cancelar</button>
          <button type="button" className="primary-button" onClick={() => void guardar()} disabled={busy || subiendo}>
            {busy ? 'Guardando…' : 'Registrar salida'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default MaderaForm
