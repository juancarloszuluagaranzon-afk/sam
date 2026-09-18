import { useState } from 'react'
import { useAppData } from '../context/AppDataContext'
import { createFlotaServicio } from '../services/samApi'
import { CampoPlaca, recordarPlaca } from '../components/CampoPlaca'
import { aMayus } from '../lib/texto'
import { usePlacaPorDefecto } from '../hooks/usePlacaPorDefecto'

/**
 * INICIO de un servicio de escolta (formato CDA-F-68 de IMECOL), pensado para
 * llenarse desde el celular del conductor al SALIR.
 *
 * 🔴 Aquí NO se firma. La firma del pasajero/responsable y la foto de
 * evidencia son comprobantes de un servicio PRESTADO, así que se piden al
 * terminarlo, en `FlotaCerrarViaje` — decisión del cliente, 17-sep-2026. Antes
 * se firmaba al registrar y el pasajero firmaba antes de subirse al carro.
 */

function hoyISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const TIPOS = ['ESCOLTA', 'TRANSPORTE', 'DISPONIBILIDAD', 'OTRO']

/** Campos que NO se tocan: fechas, horas y números. El resto va en mayúscula. */
const CRUDOS = new Set(['fecha', 'tipoServicio', 'horaSalidaOrigen', 'horaLlegadaDestino',
  'horaSalidaDestino', 'horaLlegadaOrigen', 'horaEspera', 'numPeajes', 'otrosGastos', 'totalKm',
  'kmInicial', 'kmFinal'])

/**
 * Los km del servicio a partir de las dos lecturas del odómetro.
 *
 * Devuelve `null` cuando falta alguna — no cero: no haber leído el odómetro no
 * es lo mismo que no haber rodado. Quien lo use decide qué hacer con esa
 * ausencia; aquí no se inventa un número para la planilla que se entrega.
 */
export function kmDelServicio(inicial: string, final: string): number | null {
  const a = Number(inicial)
  const b = Number(final)
  if (inicial.trim() === '' || final.trim() === '') return null
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null
  return Math.round((b - a) * 100) / 100
}

export function FlotaForm({
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

  // La placa sale sola de la maquina asignada. Ver el hook: la regla tiene
  // tres caminos y ahora la comparten los dos formularios.
  const placaPorDefecto = usePlacaPorDefecto()

  /**
   * Los campos que en la planilla en papel van SIEMPRE vacios.
   *
   * En las seis filas del formato lleno, centro de costo, proceso solicitante,
   * las dos horas de regreso, la espera, los peajes y los otros gastos estan en
   * blanco. Pedirlos de entrada es hacerle bajar al conductor por siete campos
   * que nunca llena. Se pliegan, **no se borran**: un peaje pagado hay que poder
   * registrarlo el dia que pase.
   */
  const [verOtros, setVerOtros] = useState(false)

  const [f, setF] = useState({
    fecha: hoyISO(),
    vehiculo: placaPorDefecto,
    tipoServicio: 'ESCOLTA',
    centroCosto: '',
    procesoSolicitante: '',
    nombrePasajero: '',
    origen: '',
    destino: '',
    horaSalidaOrigen: '',
    horaLlegadaDestino: '',
    horaSalidaDestino: '',
    horaLlegadaOrigen: '',
    horaEspera: '',
    numPeajes: '',
    otrosGastos: '',
    kmInicial: '',
    kmFinal: '',
    totalKm: '',
    observacion: '',
    firmaNombre: '',
  })
  const set = (k: keyof typeof f, v: string) =>
    setF((prev) => ({ ...prev, [k]: CRUDOS.has(k) ? v : aMayus(v) }))

  // 🔴 La firma, la foto, la llegada y el km final ya NO se piden aquí: se
  // piden al TERMINAR el servicio (`FlotaCerrarViaje`). Ver el comentario
  // de `guardar()`.

  async function guardar() {
    if (!f.origen.trim() || !f.destino.trim()) { setError('Origen y destino son obligatorios.'); return }
    setBusy(true); setError('')
    try {
      // 🔴 El servicio se ABRE aquí y se CIERRA al terminar, con la firma.
      //
      // El cliente pidió que se firme SOLO al terminar el servicio (17-sep-2026).
      // Pedir la firma al registrar hacía que el pasajero firmara ANTES de
      // viajar: el comprobante decía que el servicio se prestó cuando todavía
      // no había salido el carro. Es la misma mecánica de dos fases que ya usa
      // AgroMorales, sin inventar otra:
      //   · el id lo pone el TELÉFONO, para que el cierre sepa a qué servicio
      //     apunta aunque el servidor no haya respondido;
      //   · nace EN_CURSO y sale arriba, en ámbar, con su botón de terminar;
      //   · el cierre lleva guard `.eq('estado','EN_CURSO')`: reintentar no pisa.
      await createFlotaServicio({
        id: crypto.randomUUID(),
        estado: 'EN_CURSO',
        abiertoEn: new Date().toISOString(),
        formato: 'IMECOL',
        fecha: f.fecha,
        vehiculo: f.vehiculo.trim() || undefined,
        tipoServicio: f.tipoServicio,
        centroCosto: f.centroCosto.trim() || undefined,
        procesoSolicitante: f.procesoSolicitante.trim() || undefined,
        nombrePasajero: f.nombrePasajero.trim() || undefined,
        origen: f.origen.trim(),
        destino: f.destino.trim(),
        horaSalidaOrigen: f.horaSalidaOrigen || undefined,
        horaSalidaDestino: f.horaSalidaDestino || undefined,
        horaLlegadaOrigen: f.horaLlegadaOrigen || undefined,
        horaEspera: f.horaEspera || undefined,
        numPeajes: f.numPeajes ? Number(f.numPeajes) : undefined,
        otrosGastos: f.otrosGastos ? Number(f.otrosGastos) : undefined,
        kmInicial: f.kmInicial ? Number(f.kmInicial) : undefined,
        observacion: f.observacion.trim() || undefined,
        conductorId,
        conductorNombre,
      })
      recordarPlaca(f.vehiculo)
      setInfo('Servicio iniciado. Al terminar, tócalo arriba para firmar.')
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
          <div><p className="eyebrow">Flota · Escolta</p><h3>Iniciar servicio</h3></div>
          <button type="button" className="modal-close-btn" onClick={onClose} disabled={busy} aria-label="Cerrar">&#x2715;</button>
        </div>

        <div className="flota-grid">
          <label>Fecha<input type="date" value={f.fecha} onChange={(e) => set('fecha', e.target.value)} disabled={busy} /></label>
          <label>Vehículo (placa)
            <CampoPlaca value={f.vehiculo} onChange={(v) => set('vehiculo', v)} disabled={busy} />
          </label>
          <label>Tipo de servicio
            <select value={f.tipoServicio} onChange={(e) => set('tipoServicio', e.target.value)} disabled={busy}>
              {TIPOS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label>Nombre del pasajero<input type="text" autoCapitalize="characters" value={f.nombrePasajero} onChange={(e) => set('nombrePasajero', e.target.value)} disabled={busy} /></label>
          <label>Origen <span style={{ color: '#b3261e' }}>*</span><input type="text" autoCapitalize="characters" value={f.origen} onChange={(e) => set('origen', e.target.value)} disabled={busy} /></label>
          <label>Destino <span style={{ color: '#b3261e' }}>*</span><input type="text" autoCapitalize="characters" value={f.destino} onChange={(e) => set('destino', e.target.value)} disabled={busy} /></label>
          <label>Hora salida origen<input type="time" value={f.horaSalidaOrigen} onChange={(e) => set('horaSalidaOrigen', e.target.value)} disabled={busy} /></label>
          <label>Km inicial<input type="number" min={0} step="any" inputMode="numeric"
            value={f.kmInicial} onChange={(e) => set('kmInicial', e.target.value)} disabled={busy} /></label>
        </div>

        {/* Los siete que en el papel van siempre en blanco. Plegados, no
            borrados: el dia que haya un peaje hay que poder anotarlo. */}
        <button type="button" className="usuarios-form-toggle" style={{ marginTop: 10 }}
                onClick={() => setVerOtros((v) => !v)}>
          <span>Otros campos del formato <span className="field-optional">(centro de costo, regreso, peajes)</span></span>
          <span className={`chevron ${verOtros ? 'chevron--up' : ''}`}>▾</span>
        </button>
        {verOtros && (
          <div className="flota-grid">
            <label>Centro de costo<input type="text" autoCapitalize="characters" value={f.centroCosto} onChange={(e) => set('centroCosto', e.target.value)} disabled={busy} /></label>
            <label>Proceso solicitante<input type="text" autoCapitalize="characters" value={f.procesoSolicitante} onChange={(e) => set('procesoSolicitante', e.target.value)} disabled={busy} /></label>
            <label>Hora salida destino<input type="time" value={f.horaSalidaDestino} onChange={(e) => set('horaSalidaDestino', e.target.value)} disabled={busy} /></label>
            <label>Hora llegada origen<input type="time" value={f.horaLlegadaOrigen} onChange={(e) => set('horaLlegadaOrigen', e.target.value)} disabled={busy} /></label>
            <label>Hora de espera<input type="text" value={f.horaEspera} onChange={(e) => set('horaEspera', e.target.value)} placeholder="ej. 0:45" disabled={busy} /></label>
            <label># Peajes<input type="number" min={0} value={f.numPeajes} onChange={(e) => set('numPeajes', e.target.value)} disabled={busy} /></label>
            <label>Otros gastos<input type="number" min={0} step="any" value={f.otrosGastos} onChange={(e) => set('otrosGastos', e.target.value)} disabled={busy} /></label>
          </div>
        )}

        <label style={{ marginTop: 10 }}>Observación
          <textarea rows={2} autoCapitalize="characters" value={f.observacion} onChange={(e) => set('observacion', e.target.value)} disabled={busy} />
        </label>

        {/* La foto y la firma son COMPROBANTES del servicio prestado: se
            piden al terminarlo, no al salir. */}
        <p className="subtle-copy" style={{ marginTop: 10 }}>
          ✍️ La <strong>firma</strong> y la <strong>foto</strong> se piden al <strong>terminar</strong> el servicio.
        </p>

        <div className="modal-footer">
          <button type="button" className="inline-button" onClick={onClose} disabled={busy}>Cancelar</button>
          <button type="button" className="primary-button" onClick={() => void guardar()} disabled={busy}>
            {busy ? 'Guardando…' : 'Iniciar servicio'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default FlotaForm
