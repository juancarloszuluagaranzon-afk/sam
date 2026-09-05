import { useEffect, useState } from 'react'
import { useAppData } from '../context/AppDataContext'
import { createFlotaServicio, ultimoKmDePlaca } from '../services/samApi'
import { CampoPlaca, recordarPlaca } from '../components/CampoPlaca'
import { aMayus } from '../lib/texto'
import { usePlacaPorDefecto } from '../hooks/usePlacaPorDefecto'

/**
 * **INICIO** de un viaje de la planilla F-OPE-22 de AgroMorales.
 *
 * 🔴 **El viaje se registra en DOS FASES y esta es la primera.** Aquí solo se
 * pide lo que se sabe AL SALIR. La hora de llegada, el kilómetro final, el
 * tiempo de espera y la firma se piden al cerrar, porque hasta entonces no
 * existen.
 *
 * El motivo no es comodidad. Pedirlo todo junto obliga a llenar la planilla de
 * memoria al final del día, y de ahí salen los odómetros inventados: ocho
 * registros seguidos con 147.952, 147.977, 148.001… escritos donde iba la
 * distancia recorrida.
 *
 * 🔴 **Es un formulario aparte del de IMECOL, no una variante con un `if`.** Los
 * dos formatos no están de acuerdo en qué campos importan: el CDA-F-68 pide
 * centro de costo, peajes y otros gastos; este pide la maquinaria escoltada y
 * las dos lecturas del odómetro.
 *
 * Los campos van **en el orden de las columnas del papel**, para poder llenarlo
 * de arriba abajo mirando la planilla impresa.
 */

function hoyISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** La hora de ahora en `HH:mm`, que es lo que pide un `<input type="time">`. */
function ahoraHHMM(): string {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
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
const CRUDOS = new Set(['fecha', 'tipoServicio', 'horaInicio', 'kmInicial', 'numeroServicio'])

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
    horaInicio: ahoraHHMM(),
    kmInicial: '',
    numeroServicio: '',
  })
  const set = (k: keyof typeof f, v: string) =>
    setF((prev) => ({ ...prev, [k]: CRUDOS.has(k) ? v : aMayus(v) }))

  const esEscolta = f.tipoServicio === 'ESCOLTA'

  /**
   * Cambiar el tipo BORRA la maquinaria.
   *
   * 🔴 Esconder el campo no basta: si alguien escribe 34261, se da cuenta de
   * que era un transporte y cambia el tipo, el valor seguiría en el estado y
   * viajaría igual al guardado. La planilla saldría con una máquina que nadie
   * escoltó, y el error no se ve en pantalla porque el campo ya no está.
   */
  function cambiarTipo(v: string) {
    setF((prev) => ({
      ...prev,
      tipoServicio: v,
      numeroMaquinaria: v === 'ESCOLTA' ? prev.numeroMaquinaria : '',
    }))
  }

  /**
   * El último kilometraje cerrado de esa placa.
   *
   * 🔴 **Se muestra al lado, NO se rellena solo en el campo.** Rellenarlo haría
   * que un conductor que no leyó el tablero guarde el número anterior sin darse
   * cuenta, y ese viaje quedaría con cero kilómetros. Mostrado al lado hace lo
   * que hace falta: si escribe 1.482 donde iba 148.238, la diferencia salta.
   */
  const [ultimoKm, setUltimoKm] = useState<number | null>(null)
  useEffect(() => {
    let vivo = true
    void ultimoKmDePlaca(f.vehiculo).then((v) => { if (vivo) setUltimoKm(v) })
    // Sin señal no dice nada: una referencia que no se pudo leer no es una
    // referencia de cero.
    return () => { vivo = false }
  }, [f.vehiculo])

  const kmEscrito = f.kmInicial.trim() === '' ? null : Number(f.kmInicial)
  const kmRaro = kmEscrito != null && ultimoKm != null && Number.isFinite(kmEscrito)
    && (kmEscrito < ultimoKm || kmEscrito > ultimoKm + 2000)

  async function guardar() {
    if (!f.origen.trim() || !f.destino.trim()) {
      setError('El lugar de inicio y el de destino son obligatorios.'); return
    }
    setBusy(true); setError('')
    try {
      await createFlotaServicio({
        // 🔴 El id lo pone el TELÉFONO. El cierre necesita saber a qué viaje
        // apunta, y con dos fases eso no puede depender de que el servidor haya
        // respondido: se abre a las 5 a.m. y se cierra a las 7.
        id: crypto.randomUUID(),
        estado: 'EN_CURSO',
        abiertoEn: new Date().toISOString(),
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
        kmInicial: f.kmInicial ? Number(f.kmInicial) : undefined,
        numeroServicio: f.numeroServicio.trim() || undefined,
        conductorId,
        conductorNombre,
      })
      recordarPlaca(f.vehiculo)
      setInfo('Viaje iniciado. Ciérralo al llegar para completar la planilla.')
      onSaved()
      onClose()
    } catch (err) {
      const e = err as { message?: string }
      setError(`No se pudo iniciar el viaje. (${e?.message ?? 'error'})`)
    } finally { setBusy(false) }
  }

  return (
    <div className="modal-overlay open" onClick={() => { if (!busy) onClose() }}>
      <div className="modal-card flota-form" onClick={(e) => e.stopPropagation()}>
        <div className="labor-detail-header">
          <div>
            <p className="eyebrow">AgroMorales · F-OPE-22</p>
            <h3>Iniciar viaje</h3>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} disabled={busy} aria-label="Cerrar">&#x2715;</button>
        </div>

        <p className="subtle-copy" style={{ marginTop: 0 }}>
          Ahora solo lo de la salida. Al llegar lo cierras con la hora, el kilometraje
          final y la firma.
        </p>

        <div className="flota-grid">
          <label>Fecha<input type="date" value={f.fecha} onChange={(e) => set('fecha', e.target.value)} disabled={busy} /></label>
          <label>Placa
            <CampoPlaca value={f.vehiculo} onChange={(v) => set('vehiculo', v)} disabled={busy} />
          </label>
          {/* Sin el campo de maquinaria al lado, el tipo ocupa la fila entera. Si
              no, todo lo de abajo se corre media casilla y «Lugar de inicio»
              queda emparejado con el tipo, separando origen de destino — que en
              el papel van juntos. */}
          <label style={esEscolta ? undefined : { gridColumn: '1 / -1' }}>Tipo de servicio
            <select value={f.tipoServicio} onChange={(e) => cambiarTipo(e.target.value)} disabled={busy}>
              {TIPOS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          {esEscolta && (
            <label>Número de maquinaria
              <input type="text" autoCapitalize="characters" value={f.numeroMaquinaria}
                     onChange={(e) => set('numeroMaquinaria', e.target.value)}
                     placeholder="ej. 34261" disabled={busy} /></label>
          )}
          <label>Lugar de inicio <span style={{ color: '#b3261e' }}>*</span>
            <input type="text" autoCapitalize="characters" value={f.origen}
                   onChange={(e) => set('origen', e.target.value)} disabled={busy} /></label>
          <label>Lugar destino <span style={{ color: '#b3261e' }}>*</span>
            <input type="text" autoCapitalize="characters" value={f.destino}
                   onChange={(e) => set('destino', e.target.value)} disabled={busy} /></label>
          {/* Viene con la hora de ahora: es el momento de salir. */}
          <label>Hora de inicio<input type="time" value={f.horaInicio} onChange={(e) => set('horaInicio', e.target.value)} disabled={busy} /></label>
          <label>Km inicial
            <input type="number" min={0} step="any" inputMode="numeric"
                   value={f.kmInicial} onChange={(e) => set('kmInicial', e.target.value)}
                   placeholder={ultimoKm != null ? `último: ${n0(ultimoKm)}` : 'lectura del tablero'}
                   disabled={busy} /></label>
        </div>

        {ultimoKm != null && (
          <p className={kmRaro ? 'flota-km__aviso' : 'subtle-copy'} style={{ marginTop: 8 }}>
            {kmRaro ? (
              <>⚠ El último viaje de <strong>{f.vehiculo}</strong> cerró en{' '}
                <strong>{n0(ultimoKm)}</strong> km. Lo que escribiste queda{' '}
                {kmEscrito! < ultimoKm ? 'por debajo' : 'muy por encima'} — revisa el tablero.</>
            ) : (
              <>El último viaje de <strong>{f.vehiculo}</strong> cerró en{' '}
                <strong>{n0(ultimoKm)}</strong> km.</>
            )}
          </p>
        )}

        <div className="flota-grid" style={{ marginTop: 8 }}>
          {/* En el papel va casi siempre en blanco, pero es columna del formato. */}
          <label>N° de servicio <span className="field-optional">(opcional)</span>
            <input type="text" value={f.numeroServicio}
                   onChange={(e) => set('numeroServicio', e.target.value)} disabled={busy} /></label>
        </div>

        <div className="modal-footer">
          <button type="button" className="inline-button" onClick={onClose} disabled={busy}>Cancelar</button>
          <button type="button" className="primary-button" onClick={() => void guardar()} disabled={busy}>
            {busy ? 'Guardando…' : 'Iniciar viaje'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default FlotaFormOpe22
