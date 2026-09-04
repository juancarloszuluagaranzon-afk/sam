import { useRef, useState, type ChangeEvent } from 'react'
import { useAppData } from '../context/AppDataContext'
import { createFlotaServicio, uploadImagenFlota } from '../services/samApi'
import { FirmaPad, type FirmaPadHandle } from '../components/FirmaPad'
import { CampoPlaca, recordarPlaca } from '../components/CampoPlaca'
import { aMayus } from '../lib/texto'

/**
 * Formulario de registro de un SERVICIO de escolta (formato CDA-F-68), pensado
 * para llenarse desde el celular del conductor. Incluye comprobante: FIRMA del
 * pasajero/responsable + FOTO de evidencia (ambas se suben ya comprimidas y
 * livianas). Reutilizable por la vista del conductor y por administración.
 */

function hoyISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Los tipos que el papel nombra en su pie: TRANSPORTE PERSONAL - ESCOLTAS -
 * TALLER. **TALLER faltaba**, y sin él 6 de los 34 servicios (18%) cayeron en
 * «OTRO» siendo viajes de repuestos — «se recogieron 2 baterías, 1 alternador y
 * unas platinas». Una categoría que falta no desaparece: se disfraza de «otro»
 * y deja de poder contarse.
 *
 * Los valores se quedan CORTOS y como estaban (`TRANSPORTE`, no `TRANSPORTE
 * PERSONAL`): renombrarlos dejaría a los 34 registros ya hechos hablando otro
 * idioma que los nuevos, y la columna del papel se llena a mano igual de corta.
 * `OTRO` sobrevive para lo que de verdad no encaje.
 */
const TIPOS = ['ESCOLTA', 'TRANSPORTE', 'TALLER', 'DISPONIBILIDAD', 'OTRO']

/** Un odómetro va en cientos de miles: sin separador de miles no se lee. */
function n0(v: number) {
  return Number.isFinite(v) ? new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 }).format(v) : '—'
}

/** Campos que NO se tocan: fechas, horas y números. El resto va en mayúscula. */
const CRUDOS = new Set(['fecha', 'tipoServicio', 'horaSalidaOrigen', 'horaLlegadaDestino',
  'horaSalidaDestino', 'horaLlegadaOrigen', 'horaEspera', 'numPeajes', 'otrosGastos', 'totalKm',
  'kmInicial', 'kmFinal', 'numeroServicio'])

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
  const { session, equipment, users, busy, setBusy, setError, setInfo } = useAppData()

  /**
   * La placa sale sola de la máquina asignada al conductor.
   *
   * La camioneta está en el maestro de equipos como cualquier tractor, así que
   * `equipo_codigo` del usuario ya dice cuál le toca. Se propone, **no se
   * impone**: el campo sigue siendo editable porque un día le puede tocar otro
   * carro y no vamos a bloquearle el registro por eso.
   */
  const placaPorDefecto = (() => {
    // 1. La maquina asignada al usuario, si la sesion la trae.
    const codigo = session?.equipmentCode
    if (codigo) {
      const eq = equipment.find((e) => e.code === codigo)
      if (eq) return eq.plate || eq.code
    }
    // 2. Si no, la maquina que la BASE dice que tiene asignada.
    //
    //    Hace falta porque `equipmentCode` se guarda en la sesion AL ENTRAR: si
    //    a alguien le asignan la camioneta hoy, su sesion abierta sigue sin ella
    //    hasta que vuelva a entrar — y en campo nadie cierra sesion. `users` si
    //    se recarga en cada arranque, asi que ahi el dato esta fresco.
    const yo = users.find((u) => u.id === session?.id)
    if (yo?.equipmentCode) {
      const eq = equipment.find((e) => e.code === yo.equipmentCode)
      if (eq) return eq.plate || eq.code
      return yo.equipmentCode
    }
    // 3. Y si tampoco, el unico vehiculo de la flota. Con dos o mas se deja en
    //    blanco y que elija: proponerle el carro equivocado es peor que nada.
    const vehiculos = equipment.filter((e) => e.type === 'vehiculo')
    if (vehiculos.length === 1) return vehiculos[0].plate || vehiculos[0].code
    return ''
  })()

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
    numeroMaquinaria: '',
    numeroServicio: '',
    kmInicial: '',
    kmFinal: '',
    totalKm: '',
    observacion: '',
    firmaNombre: '',
  })
  const set = (k: keyof typeof f, v: string) =>
    setF((prev) => ({ ...prev, [k]: CRUDOS.has(k) ? v : aMayus(v) }))

  /**
   * 🔴 El total NO se recalcula dentro del `set`: se deriva al dibujar.
   *
   * Guardarlo en el estado obligaría a acordarse de recalcularlo en cada sitio
   * que toque una lectura, y el día que se olvide uno la planilla sale con un
   * total que no corresponde a sus propios kilómetros. Derivado no se puede
   * desincronizar.
   */
  const kmCalculado = kmDelServicio(f.kmInicial, f.kmFinal)
  const kmParaGuardar = kmCalculado ?? (f.totalKm ? Number(f.totalKm) : undefined)
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
    if (!f.origen.trim() || !f.destino.trim()) { setError('Origen y destino son obligatorios.'); return }
    setBusy(true); setError('')
    try {
      const tmpId = `${conductorId ?? 'x'}-${Date.now()}`
      let firmaUrl: string | undefined
      let evidenciaUrl: string | undefined

      const firmaFile = await firmaRef.current?.exportar()
      if (firmaFile) firmaUrl = await uploadImagenFlota(tmpId, firmaFile, 'firma')
      if (foto) evidenciaUrl = await uploadImagenFlota(tmpId, foto, 'evidencia')

      await createFlotaServicio({
        fecha: f.fecha,
        vehiculo: f.vehiculo.trim() || undefined,
        tipoServicio: f.tipoServicio,
        centroCosto: f.centroCosto.trim() || undefined,
        procesoSolicitante: f.procesoSolicitante.trim() || undefined,
        nombrePasajero: f.nombrePasajero.trim() || undefined,
        origen: f.origen.trim(),
        destino: f.destino.trim(),
        horaSalidaOrigen: f.horaSalidaOrigen || undefined,
        horaLlegadaDestino: f.horaLlegadaDestino || undefined,
        horaSalidaDestino: f.horaSalidaDestino || undefined,
        horaLlegadaOrigen: f.horaLlegadaOrigen || undefined,
        horaEspera: f.horaEspera || undefined,
        numPeajes: f.numPeajes ? Number(f.numPeajes) : undefined,
        otrosGastos: f.otrosGastos ? Number(f.otrosGastos) : undefined,
        numeroMaquinaria: f.numeroMaquinaria.trim() || undefined,
        numeroServicio: f.numeroServicio.trim() || undefined,
        kmInicial: f.kmInicial ? Number(f.kmInicial) : undefined,
        kmFinal: f.kmFinal ? Number(f.kmFinal) : undefined,
        totalKm: kmParaGuardar,
        observacion: f.observacion.trim() || undefined,
        conductorId,
        conductorNombre,
        firmaUrl,
        firmaNombre: f.firmaNombre.trim() || undefined,
        evidenciaUrl,
      })
      recordarPlaca(f.vehiculo)
      setInfo('Servicio registrado.')
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
          <div><p className="eyebrow">Flota · Escolta</p><h3>Registrar servicio</h3></div>
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
          <label>Número de maquinaria <span className="field-optional">(si es escolta)</span>
            <input type="text" autoCapitalize="characters" value={f.numeroMaquinaria}
                   onChange={(e) => set('numeroMaquinaria', e.target.value)} disabled={busy} /></label>
          <label>Nombre del pasajero<input type="text" autoCapitalize="characters" value={f.nombrePasajero} onChange={(e) => set('nombrePasajero', e.target.value)} disabled={busy} /></label>
          <label>Origen <span style={{ color: '#b3261e' }}>*</span><input type="text" autoCapitalize="characters" value={f.origen} onChange={(e) => set('origen', e.target.value)} disabled={busy} /></label>
          <label>Destino <span style={{ color: '#b3261e' }}>*</span><input type="text" autoCapitalize="characters" value={f.destino} onChange={(e) => set('destino', e.target.value)} disabled={busy} /></label>
          <label>Hora salida origen<input type="time" value={f.horaSalidaOrigen} onChange={(e) => set('horaSalidaOrigen', e.target.value)} disabled={busy} /></label>
          <label>Hora llegada destino<input type="time" value={f.horaLlegadaDestino} onChange={(e) => set('horaLlegadaDestino', e.target.value)} disabled={busy} /></label>
          {/* Va arriba y no plegado: en el CDA-F-68 de IMECOL esta casilla va
              siempre en blanco, pero en el F-OPE-22 de AgroMorales es una
              COLUMNA PRINCIPAL — y hoy solo 2 de 34 servicios la traen. */}
          <label>Tiempo de espera <span className="field-optional">(opcional)</span>
            <input type="text" value={f.horaEspera} onChange={(e) => set('horaEspera', e.target.value)}
                   placeholder="ej. 0:45" disabled={busy} /></label>
          <label>Km inicial<input type="number" min={0} step="any" inputMode="numeric"
            value={f.kmInicial} onChange={(e) => set('kmInicial', e.target.value)} disabled={busy} /></label>
          <label>Km final<input type="number" min={0} step="any" inputMode="numeric"
            value={f.kmFinal} onChange={(e) => set('kmFinal', e.target.value)} disabled={busy} /></label>
          {/* Con las dos lecturas el total NO se teclea: es la resta, y se
              muestra la operación completa para que se pueda comprobar contra el
              tablero del carro sin abrir una calculadora. */}
          {kmCalculado == null ? (
            <label>Km del servicio <span className="field-optional">(si no pudo leer el odómetro)</span>
              <input type="number" min={0} step="any" value={f.totalKm}
                     onChange={(e) => set('totalKm', e.target.value)} disabled={busy} /></label>
          ) : (
            <div className="flota-km">
              <span className="flota-km__lbl">Km del servicio</span>
              <b className={kmAlReves ? 'flota-km__mal' : 'flota-km__val'}>{n0(kmCalculado)}</b>
              <small>{n0(Number(f.kmFinal))} − {n0(Number(f.kmInicial))}</small>
            </div>
          )}
        </div>

        {kmAlReves && (
          <p className="flota-km__aviso">
            ⚠ El kilómetro final es <strong>menor</strong> que el inicial. Revisa las dos
            lecturas: así la planilla saldría con kilómetros en negativo.
          </p>
        )}

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
            <label># Peajes<input type="number" min={0} value={f.numPeajes} onChange={(e) => set('numPeajes', e.target.value)} disabled={busy} /></label>
            <label>Otros gastos<input type="number" min={0} step="any" value={f.otrosGastos} onChange={(e) => set('otrosGastos', e.target.value)} disabled={busy} /></label>
            {/* En el papel esta casilla va casi siempre en blanco, igual que los
                peajes: por eso vive aqui abajo y no en la primera pantalla. */}
            <label>N° de servicio<input type="text" value={f.numeroServicio}
              onChange={(e) => set('numeroServicio', e.target.value)} disabled={busy} /></label>
          </div>
        )}

        <label style={{ marginTop: 10 }}>Observación
          <textarea rows={2} autoCapitalize="characters" value={f.observacion} onChange={(e) => set('observacion', e.target.value)} disabled={busy} />
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

        {/* Comprobante: firma del pasajero/responsable */}
        <div className="flota-comprobante">
          <span className="flota-comprobante__lbl">✍️ Firma del pasajero / responsable</span>
          <input type="text" className="flota-firma-nombre" placeholder="Nombre de quien firma" autoCapitalize="characters" value={f.firmaNombre} onChange={(e) => set('firmaNombre', e.target.value)} disabled={busy} />
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

export default FlotaForm
