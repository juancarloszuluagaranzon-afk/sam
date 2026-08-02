import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { useAppData } from '../context/AppDataContext'
import { registrarCombustibleExterno, uploadEvidencia } from '../services/samApi'
import { DESTINO_LABEL, type CombustibleDestino, type CombustibleOrigen } from '../domain/sam'
import { SearchableSelect } from './SearchableSelect'
import { CampoPlaca, CampoLista, recordarPlaca, recordarValor } from './CampoPlaca'
import { aMayus } from '../lib/texto'
import { redondear2 } from '../lib/cantidad'
import { enviarOEncolar, subirOGuardarFoto } from '../lib/outboxInsumos'

/**
 * Tanqueo — el único camino por el que entra o sale combustible sin pasar por
 * un despacho. Lo usan el operario y el supervisor de insumos; la diferencia es
 * qué destinos puede elegir cada uno.
 *
 * Dos preguntas, en este orden, porque son independientes:
 *  1. ¿DÓNDE tanqueaste?  ⛽ En estación (se compró en la bomba: no sale de
 *     ninguna bodega) · 🏭 En sede (sale de la bodega principal, se descuenta
 *     de una vez porque ya se lo llevaron).
 *  2. ¿A QUÉ se lo echaste? Tanque de distribución y pimpinas SUMAN al carro
 *     del supervisor; vehículo y máquina son CONSUMO (placa u horómetro).
 *
 * Todo queda PENDIENTE del aval del analista de insumos. Nadie se mete una
 * entrada a mano en el inventario: si no pasó por aquí, no existe.
 */

function hoyISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Última placa que usó esta persona: la siguiente vez sale ya elegida. */
const PLACA_KEY = 'sam:ultima-placa'

export function TanqueoModal({
  open,
  onClose,
  onSaved,
  destinos,
  bodegaId,
  equipoFijo,
}: {
  open: boolean
  onClose: () => void
  onSaved?: () => void
  /** Destinos que este rol puede registrar. El primero sale seleccionado. */
  destinos: CombustibleDestino[]
  /** Satélite que recibe cuando el destino suma al inventario. */
  bodegaId?: string
  /** Máquina del operario: cuando viene, no se pregunta cuál es. */
  equipoFijo?: string
}) {
  const { session, insumos, equipment, busy, setBusy, setError, setInfo } = useAppData()

  const [origen, setOrigen] = useState<CombustibleOrigen>('ESTACION')
  const [destino, setDestino] = useState<CombustibleDestino>(destinos[0] ?? 'MAQUINA')
  const [fecha, setFecha] = useState(hoyISO())
  const [insumoId, setInsumoId] = useState('')
  const [galones, setGalones] = useState('')
  const [horometro, setHorometro] = useState('')
  const [equipoCodigo, setEquipoCodigo] = useState(equipoFijo ?? '')
  const [placa, setPlaca] = useState('')
  const [pimpCant, setPimpCant] = useState('')
  const [pimpCap, setPimpCap] = useState('5')
  const [valor, setValor] = useState('')
  const [estacion, setEstacion] = useState('')
  const [factura, setFactura] = useState('')
  const [tirilla, setTirilla] = useState('')
  const [subiendo, setSubiendo] = useState(false)
  const fotoRef = useRef<HTMLInputElement>(null)

  // El propio analista también tanquea: decirle que "lo avala el analista"
  // sería decirle que se avala a sí mismo, y no puede.
  const soyElAnalista = session?.role === 'analista_insumos'
  const quienAvala = soyElAnalista ? 'del dueño o administración' : 'del analista de insumos y materiales'

  const combustibles = useMemo(
    () => insumos.filter((i) => i.activo && i.categoria === 'COMBUSTIBLE'),
    [insumos],
  )
  const equiposActivos = useMemo(
    () => [...equipment].sort((a, b) => a.code.localeCompare(b.code, 'es', { numeric: true })),
    [equipment],
  )

  useEffect(() => {
    if (!open) return
    setOrigen('ESTACION')
    setDestino(destinos[0] ?? 'MAQUINA')
    setFecha(hoyISO())
    setInsumoId(combustibles.length === 1 ? combustibles[0].id : '')
    setGalones(''); setHorometro(''); setValor('')
    setEstacion(''); setFactura(''); setTirilla('')
    setPimpCant(''); setPimpCap('5')
    setEquipoCodigo(equipoFijo ?? '')
    setPlaca(localStorage.getItem(`${PLACA_KEY}:${session?.id ?? ''}`) ?? '')
    setError('')
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [open])

  // Pimpinas: no se escribe el total, se escribe cuántas y de cuánto. El total
  // sale de la multiplicación para que nadie lo cuadre "a ojo".
  const totalPimpinas = useMemo(
    () => redondear2((Number(pimpCant) || 0) * (Number(pimpCap) || 0)),
    [pimpCant, pimpCap],
  )
  const galonesFinal = destino === 'PIMPINAS' ? totalPimpinas : redondear2(Number(galones) || 0)

  if (!open) return null

  async function onFoto(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setSubiendo(true); setError('')
    try {
      const { url, local } = await subirOGuardarFoto(
        `tanqueo-${session?.id ?? 'x'}-${Date.now()}`, file, 0, uploadEvidencia,
      )
      setTirilla(url)
      if (local) setInfo('Foto guardada en el equipo. Se sube sola cuando haya señal.')
    } catch {
      setError('No se pudo subir la foto.')
    } finally { setSubiendo(false) }
  }

  async function guardar() {
    if (!insumoId) { setError('Elige el combustible.'); return }
    if (galonesFinal <= 0) {
      setError(destino === 'PIMPINAS' ? 'Escribe cuántas pimpinas y de cuántos galones.' : 'Escribe cuántos galones.')
      return
    }
    if (destino === 'MAQUINA') {
      if (!equipoCodigo) { setError('Elige la máquina que se tanqueó.'); return }
      if (!horometro.trim() || Number(horometro) < 0) { setError('El horómetro de la máquina es obligatorio.'); return }
    }
    if (destino === 'VEHICULO' && !placa) { setError('Escribe la placa del vehículo.'); return }
    if ((destino === 'CARRO' || destino === 'PIMPINAS') && !bodegaId) {
      setError('No tienes bodega satélite asignada.'); return
    }
    setBusy(true); setError('')
    try {
      const payload = {
        fecha,
        origen,
        destino,
        bodegaId,
        equipoCodigo: destino === 'MAQUINA' ? equipoCodigo : undefined,
        horometro: destino === 'MAQUINA' ? Number(horometro) : undefined,
        placa: destino === 'VEHICULO' ? placa : undefined,
        pimpinasCantidad: destino === 'PIMPINAS' ? Number(pimpCant) : undefined,
        pimpinasCapacidad: destino === 'PIMPINAS' ? Number(pimpCap) : undefined,
        insumoId,
        galones: galonesFinal,
        valor: Number(valor) || 0,
        estacion: origen === 'ESTACION' ? (estacion.trim() || undefined) : undefined,
        factura: factura.trim() || undefined,
        tirillaUrl: tirilla || undefined,
        registradoPor: session?.id,
        registradoNombre: session?.name,
      }
      const { enviado } = await enviarOEncolar('TANQUEO', payload, () => registrarCombustibleExterno(payload))
      if (destino === 'VEHICULO' && placa) {
        try { localStorage.setItem(`${PLACA_KEY}:${session?.id ?? ''}`, placa) } catch { /* storage lleno */ }
        recordarPlaca(placa)
      }
      // Si la bomba todavía no está en el catálogo, al menos queda sugerida en
      // este equipo para el próximo tanqueo.
      if (estacion) recordarValor('ESTACION', estacion)
      setInfo(enviado
        ? `Registrado: ${galonesFinal} galones · ${DESTINO_LABEL[destino]}. Queda pendiente del aval ${quienAvala}.`
        : `Guardado sin señal: ${galonesFinal} galones · ${DESTINO_LABEL[destino]}. Se envía solo cuando haya cobertura.`)
      onClose()
      onSaved?.()
    } catch (err) {
      const e = err as { message?: string }
      setError(`No se pudo registrar. (${e?.message ?? 'error'})`)
    } finally { setBusy(false) }
  }

  const soloUnDestino = destinos.length === 1

  return (
    <div className="modal-overlay open" onClick={() => { if (!busy && !subiendo) onClose() }}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 'min(460px, calc(100vw - 32px))' }}>
        <div className="labor-detail-header">
          <div><p className="eyebrow">Combustible</p><h3>⛽ Registrar tanqueo</h3></div>
          <button type="button" className="modal-close-btn" onClick={onClose} disabled={busy} aria-label="Cerrar">&#x2715;</button>
        </div>

        {/* 1. Dónde */}
        <p className="tq-lbl">¿Dónde tanqueaste?</p>
        <div className="tq-opts">
          {(['ESTACION', 'SEDE'] as CombustibleOrigen[]).map((o) => (
            <button
              key={o}
              type="button"
              className={`tq-opt${origen === o ? ' is-active' : ''}`}
              onClick={() => setOrigen(o)}
              disabled={busy}
            >
              <strong>{o === 'ESTACION' ? '⛽ En estación' : '🏭 En sede'}</strong>
              <span>{o === 'ESTACION' ? 'Bomba de servicio' : 'Bodega principal'}</span>
            </button>
          ))}
        </div>

        {/* 2. A qué */}
        {!soloUnDestino && (
          <>
            <p className="tq-lbl">¿A qué se lo echaste?</p>
            <div className="tq-opts">
              {destinos.map((d) => (
                <button
                  key={d}
                  type="button"
                  className={`tq-opt${destino === d ? ' is-active' : ''}`}
                  onClick={() => setDestino(d)}
                  disabled={busy}
                >
                  <strong>{DESTINO_LABEL[d]}</strong>
                  <span>
                    {d === 'CARRO' ? 'Suma a mi carro'
                      : d === 'PIMPINAS' ? 'Suma a mi carro'
                      : d === 'VEHICULO' ? 'Consumo · placa'
                      : 'Consumo · horómetro'}
                  </span>
                </button>
              ))}
            </div>
          </>
        )}

        <div className="flota-grid" style={{ marginTop: 10 }}>
          <label>Fecha<input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} disabled={busy} /></label>
          <label>Combustible <span style={{ color: '#b3261e' }}>*</span>
            <SearchableSelect
              value={insumoId}
              onChange={setInsumoId}
              options={combustibles.map((i) => ({ value: i.id, label: i.nombre, frecuente: i.frecuente }))}
              placeholder="Buscar combustible…"
              disabled={busy}
            />
          </label>

          {destino === 'PIMPINAS' ? (
            <>
              <label>¿Cuántas pimpinas? <span style={{ color: '#b3261e' }}>*</span>
                <input type="number" min={0} step={1} value={pimpCant} onChange={(e) => setPimpCant(e.target.value)} disabled={busy} />
              </label>
              <label>Galones por pimpina <span style={{ color: '#b3261e' }}>*</span>
                <input type="number" min={0} step="any" value={pimpCap} onChange={(e) => setPimpCap(e.target.value)} disabled={busy} />
              </label>
            </>
          ) : (
            <label>Galones <span style={{ color: '#b3261e' }}>*</span>
              <input type="number" min={0} step="any" value={galones} onChange={(e) => setGalones(e.target.value)} disabled={busy} />
            </label>
          )}

          {destino === 'VEHICULO' && (
            <label>Placa del vehículo <span style={{ color: '#b3261e' }}>*</span>
              <CampoPlaca value={placa} onChange={setPlaca} disabled={busy} />
            </label>
          )}

          {destino === 'MAQUINA' && !equipoFijo && (
            <label>Máquina <span style={{ color: '#b3261e' }}>*</span>
              <SearchableSelect
                value={equipoCodigo}
                onChange={setEquipoCodigo}
                options={equiposActivos.map((e) => ({ value: e.code, label: e.code, rightLabel: e.name }))}
                placeholder="Buscar máquina…"
                disabled={busy}
              />
            </label>
          )}

          {destino === 'MAQUINA' && (
            <label>Horómetro <span style={{ color: '#b3261e' }}>*</span>
              <input type="number" min={0} step="any" value={horometro} onChange={(e) => setHorometro(e.target.value)} disabled={busy} />
            </label>
          )}

          {origen === 'ESTACION' && (
            <>
              <label>Estación
                <CampoLista tipo="ESTACION" value={estacion} onChange={setEstacion} disabled={busy} placeholder="Buscar o escribir…" />
              </label>
              <label>N° tirilla / factura<input type="text" autoCapitalize="characters" value={factura} onChange={(e) => setFactura(aMayus(e.target.value))} disabled={busy} /></label>
              <label>Valor <span className="field-optional">(opcional)</span>
                <input type="number" min={0} step="any" value={valor} onChange={(e) => setValor(e.target.value)} disabled={busy} />
              </label>
            </>
          )}
        </div>

        {destino === 'PIMPINAS' && totalPimpinas > 0 && (
          <p className="tq-total">Total: <strong>{totalPimpinas} galones</strong> ({pimpCant} × {pimpCap})</p>
        )}

        <div className="flota-comprobante" style={{ marginTop: 10 }}>
          <span className="flota-comprobante__lbl">📷 Foto {origen === 'ESTACION' ? 'de la tirilla' : 'del soporte'}</span>
          <div className="flota-foto-row">
            {tirilla && <img src={tirilla} alt="soporte" className="flota-foto-thumb" />}
            <button type="button" className="inline-button" onClick={() => fotoRef.current?.click()} disabled={busy || subiendo}>
              {subiendo ? 'Subiendo…' : tirilla ? 'Cambiar foto' : '📷 Tomar foto'}
            </button>
            <input ref={fotoRef} type="file" accept="image/*" capture="environment" hidden onChange={onFoto} />
          </div>
        </div>

        <p className="subtle-copy" style={{ marginTop: 10, marginBottom: 0 }}>
          Queda <strong>pendiente del aval</strong> {quienAvala}.
        </p>

        <div className="modal-footer">
          <button type="button" className="inline-button" onClick={onClose} disabled={busy}>Cancelar</button>
          <button type="button" className="primary-button" onClick={() => void guardar()} disabled={busy || subiendo}>
            {busy ? 'Guardando…' : 'Registrar tanqueo'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default TanqueoModal
