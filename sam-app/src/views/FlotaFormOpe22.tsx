import { useRef, useState, type ChangeEvent } from 'react'
import { useAppData } from '../context/AppDataContext'
import { createFlotaServicio, uploadImagenFlota } from '../services/samApi'
import { FirmaPad, type FirmaPadHandle } from '../components/FirmaPad'
import { CampoPlaca, recordarPlaca } from '../components/CampoPlaca'
import { aMayus } from '../lib/texto'
import { usePlacaPorDefecto } from '../hooks/usePlacaPorDefecto'

/**
 * Registro de un servicio para la planilla **F-OPE-22 · GESTIÓN OPERATIVA** de
 * AgroMorales.
 *
 * 🔴 **Es un formulario aparte del de IMECOL, no una variante con un `if`.**
 * Los dos formatos no están de acuerdo en qué campos importan: el CDA-F-68 pide
 * centro de costo, peajes y otros gastos; este pide el número de la maquinaria
 * escoltada, el tiempo de espera y las dos lecturas del odómetro. Meterlos en el
 * mismo formulario obligaría a esconder la mitad de los campos según un
 * desplegable — y el día que alguien elija mal, el registro sale con los campos
 * del formato equivocado.
 *
 * Los campos van **en el orden de las columnas del papel**, para poder llenarlo
 * de arriba abajo mirando la planilla impresa.
 */

function hoyISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Los tipos que el pie del F-OPE-22 nombra: TRANSPORTE PERSONAL - ESCOLTAS -
 * TALLER.
 *
 * 🔴 **TALLER es de este formato y no del de IMECOL.** Mientras no existió, los
 * viajes a recoger repuestos —«se recogieron 2 baterías, 1 alternador y unas
 * platinas»— se registraban como «OTRO»: 6 de 34 servicios. Una categoría que
 * falta no desaparece, se disfraza de «otro» y deja de poder contarse.
 */
const TIPOS = ['TRANSPORTE', 'ESCOLTA', 'TALLER', 'OTRO']

/** Lo que se digita va en mayúscula; fechas, horas y números NO se tocan. */
const CRUDOS = new Set(['fecha', 'tipoServicio', 'horaInicio', 'horaFinal',
  'tiempoEspera', 'kmInicial', 'kmFinal', 'numeroServicio'])

/**
 * Los km del servicio a partir de las dos lecturas del odómetro.
 *
 * Devuelve `null` cuando falta alguna — no cero: no haber leído el odómetro no
 * es lo mismo que no haber rodado. En la planilla esa casilla va en blanco.
 */
export function kmDelServicio(inicial: string, final: string): number | null {
  if (inicial.trim() === '' || final.trim() === '') return null
  const a = Number(inicial)
  const b = Number(final)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null
  return Math.round((b - a) * 100) / 100
}

/** Un odómetro va en cientos de miles: sin separador de miles no se lee. */
function n0(v: number) {
  return Number.isFinite(v) ? new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 }).format(v) : '—'
}

export function FlotaFormOpe22({
  onClose,
  onSaved,
  conductorId,
  conductorNombre,
}: {
  onClose: () => void
  onSaved: () => void
  conductorId?: string
  conductorNombre?: string
}) {
  const { busy, setBusy, setError, setInfo } = useAppData()
  const placaPorDefecto = usePlacaPorDefecto()

  const [f, setF] = useState({
    fecha: hoyISO(),
    vehiculo: placaPorDefecto,
    tipoServicio: 'TRANSPORTE',
    numeroMaquinaria: '',
    origen: '',
    destino: '',
    horaInicio: '',
    horaFinal: '',
    tiempoEspera: '',
    kmInicial: '',
    kmFinal: '',
    numeroServicio: '',
    observacion: '',
    firmaNombre: '',
  })
  const set = (k: keyof typeof f, v: string) =>
    setF((prev) => ({ ...prev, [k]: CRUDOS.has(k) ? v : aMayus(v) }))

  /**
   * 🔴 El total NO se guarda en el estado: se deriva al dibujar. Guardarlo
   * obligaría a acordarse de recalcularlo cada vez que se toca una lectura, y el
   * día que se olvide, la planilla sale con un total que no corresponde a sus
   * propios kilómetros. Derivado no se puede desincronizar.
   */
  const kmCalculado = kmDelServicio(f.kmInicial, f.kmFinal)
  const kmAlReves = kmCalculado != null && kmCalculado < 0

  const firmaRef = useRef<FirmaPadHandle>(null)
  const [hayFirma, setHayFirma] = useState(false)
  const fotoRef = useRef<HTMLInputElement>(null)
  const [foto, setFoto] = useState<File | null>(null)
  const [fotoPreview, setFotoPreview] = useState<string>('')

  function onFoto(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) { setError('Selecciona una imagen.'); return }
    setFoto(file)
    setFotoPreview(URL.createObjectURL(file))
  }

  async function guardar() {
    if (!f.origen.trim() || !f.destino.trim()) {
      setError('El lugar de inicio y el de destino son obligatorios.'); return
    }
    setBusy(true); setError('')
    try {
      const tmpId = `${conductorId ?? 'x'}-${Date.now()}`
      let firmaUrl: string | undefined
      let evidenciaUrl: string | undefined

      const firmaFile = await firmaRef.current?.exportar()
      if (firmaFile) firmaUrl = await uploadImagenFlota(tmpId, firmaFile, 'firma')
      if (foto) evidenciaUrl = await uploadImagenFlota(tmpId, foto, 'evidencia')

      await createFlotaServicio({
        formato: 'AGROMORALES',
        fecha: f.fecha,
        vehiculo: f.vehiculo.trim() || undefined,
        tipoServicio: f.tipoServicio,
        numeroMaquinaria: f.numeroMaquinaria.trim() || undefined,
        // El papel los llama «lugar de inicio» y «lugar destino»; en la base son
        // las mismas columnas que usa el otro formato.
        origen: f.origen.trim(),
        destino: f.destino.trim(),
        horaSalidaOrigen: f.horaInicio || undefined,
        horaLlegadaDestino: f.horaFinal || undefined,
        horaEspera: f.tiempoEspera || undefined,
        kmInicial: f.kmInicial ? Number(f.kmInicial) : undefined,
        kmFinal: f.kmFinal ? Number(f.kmFinal) : undefined,
        totalKm: kmCalculado ?? undefined,
        numeroServicio: f.numeroServicio.trim() || undefined,
        observacion: f.observacion.trim() || undefined,
        conductorId,
        conductorNombre,
        firmaUrl,
        firmaNombre: f.firmaNombre.trim() || undefined,
        evidenciaUrl,
      })
      recordarPlaca(f.vehiculo)
      setInfo('Servicio registrado en la planilla de AgroMorales.')
      onSaved()
      onClose()
    } catch (err) {
      const e = err as { message?: string }
      setError(`No se pudo registrar. (${e?.message ?? 'error'})`)
    } finally { setBusy(false) }
  }

  return (
    <div className="modal-overlay open" onClick={() => { if (!busy) onClose() }}>
      <div className="modal-card flota-form" onClick={(e) => e.stopPropagation()}>
        <div className="labor-detail-header">
          <div>
            <p className="eyebrow">AgroMorales · F-OPE-22</p>
            <h3>Registrar servicio</h3>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} disabled={busy} aria-label="Cerrar">&#x2715;</button>
        </div>

        <div className="flota-grid">
          <label>Fecha<input type="date" value={f.fecha} onChange={(e) => set('fecha', e.target.value)} disabled={busy} /></label>
          <label>Placa
            <CampoPlaca value={f.vehiculo} onChange={(v) => set('vehiculo', v)} disabled={busy} />
          </label>
          <label>Tipo de servicio
            <select value={f.tipoServicio} onChange={(e) => set('tipoServicio', e.target.value)} disabled={busy}>
              {TIPOS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          {/* Solo tiene sentido en una escolta: es la máquina a la que se le hizo
              el acompañamiento. En un transporte de personal va vacía, igual que
              en el papel. */}
          <label>Número de maquinaria <span className="field-optional">(si es escolta)</span>
            <input type="text" autoCapitalize="characters" value={f.numeroMaquinaria}
                   onChange={(e) => set('numeroMaquinaria', e.target.value)} disabled={busy} /></label>
          <label>Lugar de inicio <span style={{ color: '#b3261e' }}>*</span>
            <input type="text" autoCapitalize="characters" value={f.origen}
                   onChange={(e) => set('origen', e.target.value)} disabled={busy} /></label>
          <label>Lugar destino <span style={{ color: '#b3261e' }}>*</span>
            <input type="text" autoCapitalize="characters" value={f.destino}
                   onChange={(e) => set('destino', e.target.value)} disabled={busy} /></label>
          <label>Hora de inicio<input type="time" value={f.horaInicio} onChange={(e) => set('horaInicio', e.target.value)} disabled={busy} /></label>
          <label>Hora final<input type="time" value={f.horaFinal} onChange={(e) => set('horaFinal', e.target.value)} disabled={busy} /></label>
          {/* Es una DURACIÓN, no una hora del día: si esperó 45 minutos, `0:45`. */}
          <label>Tiempo de espera <span className="field-optional">(opcional)</span>
            <input type="text" value={f.tiempoEspera} onChange={(e) => set('tiempoEspera', e.target.value)}
                   placeholder="ej. 0:45" disabled={busy} /></label>
          <label>Km inicial<input type="number" min={0} step="any" inputMode="numeric"
            value={f.kmInicial} onChange={(e) => set('kmInicial', e.target.value)} disabled={busy} /></label>
          <label>Km final<input type="number" min={0} step="any" inputMode="numeric"
            value={f.kmFinal} onChange={(e) => set('kmFinal', e.target.value)} disabled={busy} /></label>
          {/* El km total NO se teclea: es la resta, y se muestra la operación
              completa para poder comprobarla contra el tablero del carro. */}
          <div className="flota-km">
            <span className="flota-km__lbl">Km total</span>
            {kmCalculado == null ? (
              <>
                <b className="flota-km__val">—</b>
                <small>sale de las dos lecturas</small>
              </>
            ) : (
              <>
                <b className={kmAlReves ? 'flota-km__mal' : 'flota-km__val'}>{n0(kmCalculado)}</b>
                <small>{n0(Number(f.kmFinal))} − {n0(Number(f.kmInicial))}</small>
              </>
            )}
          </div>
        </div>

        {kmAlReves && (
          <p className="flota-km__aviso">
            ⚠ El kilómetro final es <strong>menor</strong> que el inicial. Revisa las dos
            lecturas: así la planilla saldría con kilómetros en negativo.
          </p>
        )}

        <div className="flota-grid" style={{ marginTop: 8 }}>
          {/* En el papel va casi siempre en blanco, pero es columna del formato. */}
          <label>N° de servicio <span className="field-optional">(opcional)</span>
            <input type="text" value={f.numeroServicio}
                   onChange={(e) => set('numeroServicio', e.target.value)} disabled={busy} /></label>
        </div>

        <label style={{ display: 'block', marginTop: 8 }}>
          Observación
          <textarea rows={2} value={f.observacion} onChange={(e) => set('observacion', e.target.value)} disabled={busy} />
        </label>

        {/* Comprobante: foto de evidencia (liviana) */}
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
                 autoCapitalize="characters" value={f.firmaNombre}
                 onChange={(e) => set('firmaNombre', e.target.value)} disabled={busy} />
          <FirmaPad ref={firmaRef} onCambio={setHayFirma} disabled={busy} />
        </div>

        <div className="modal-footer">
          <button type="button" className="inline-button" onClick={onClose} disabled={busy}>Cancelar</button>
          <button type="button" className="primary-button" onClick={() => void guardar()} disabled={busy}>
            {busy ? 'Guardando…' : 'Registrar servicio'}
          </button>
        </div>
        {!hayFirma && <p className="subtle-copy" style={{ margin: '6px 0 0', textAlign: 'right' }}>Tip: pide la firma del responsable como comprobante.</p>}
      </div>
    </div>
  )
}

export default FlotaFormOpe22
