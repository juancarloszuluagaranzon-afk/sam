import { useMemo, useState, type ChangeEvent, useRef } from 'react'
import { useAppData } from '../context/AppDataContext'
import { SearchableSelect } from '../components/SearchableSelect'
import { CampoPlaca, CampoLista, recordarPlaca, recordarValor } from '../components/CampoPlaca'
import { FotoEvidencia } from '../components/FotoEvidencia'
import { uploadEvidencia } from '../services/samApi'
import { subirOGuardarFoto } from '../lib/outboxInsumos'
import { crearViaje, PESO_MAXIMO, CONFIG_LABEL, type MaderaConfig } from '../services/maderaApi'

/**
 * Registro de un viaje de trozas.
 *
 * Los predios, destinos y especies van con `<CampoLista>`: **sugieren sin
 * obligar**. Dar de alta un predio antes de poder registrar el viaje sería un
 * muro en la montaña a las 5 de la mañana, que es donde se carga.
 */

function hoyISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
/** El SUNL dura 8 días calendario. Se propone vencido a 8 días, no se impone. */
function masDias(dias: number): string {
  const d = new Date(); d.setDate(d.getDate() + dias)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function MaderaForm({
  onClose, onGuardado, registradoPor, registradoNombre,
}: {
  onClose: () => void
  onGuardado: () => void
  registradoPor?: string
  registradoNombre?: string
}) {
  const { users, busy, setBusy, setError, setInfo } = useAppData()

  const [fecha, setFecha] = useState(hoyISO())
  const [predio, setPredio] = useState('')
  const [destino, setDestino] = useState('')
  const [placa, setPlaca] = useState('')
  const [config, setConfig] = useState<MaderaConfig>('C3')
  const [conductor, setConductor] = useState('')
  const [especie, setEspecie] = useState('')
  const [volumen, setVolumen] = useState('')
  const [peso, setPeso] = useState('')
  const [docTipo, setDocTipo] = useState('SUNL')
  const [docNumero, setDocNumero] = useState('')
  const [docVence, setDocVence] = useState(masDias(8))
  const [foto, setFoto] = useState('')
  const [nota, setNota] = useState('')
  const [subiendo, setSubiendo] = useState(false)
  const fotoRef = useRef<HTMLInputElement>(null)

  const opcionesConductor = useMemo(
    () => users.map((u) => ({ value: u.name, label: u.name })), [users])

  const pesoNum = Number(peso) || 0
  const limite = PESO_MAXIMO[config]
  const sobrepeso = pesoNum > limite

  async function onFoto(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setSubiendo(true); setError('')
    try {
      const { url, local } = await subirOGuardarFoto(
        `madera-${registradoPor ?? 'x'}-${Date.now()}`, file, 0, uploadEvidencia)
      setFoto(url)
      if (local) setInfo('Foto guardada en el equipo. Se sube sola cuando haya señal.')
    } catch { setError('No se pudo subir la foto.') }
    finally { setSubiendo(false) }
  }

  async function guardar() {
    if (!predio.trim()) { setError('¿De qué predio salió la madera?'); return }
    if (!destino.trim()) { setError('¿A dónde va?'); return }
    if (!placa.trim()) { setError('Escribe la placa del camión.'); return }
    const vol = Number(volumen) || 0
    if (vol <= 0) { setError('Escribe cuántos metros cúbicos se cargaron.'); return }

    setBusy(true); setError('')
    try {
      await crearViaje({
        fecha, predio: predio.trim(), destino: destino.trim(), placa: placa.trim(),
        config, conductorNombre: conductor, especie,
        volumenM3: vol, pesoTon: pesoNum,
        docTipo, docNumero: docNumero.trim(), docVence,
        fotoUrl: foto, nota: nota.trim(),
        registradoPor, registradoNombre,
      })
      // Lo escrito alimenta las sugerencias del próximo viaje, aquí en el equipo.
      recordarPlaca(placa)
      recordarValor('PREDIO', predio)
      recordarValor('DESTINO_MADERA', destino)
      if (especie) recordarValor('ESPECIE', especie)
      setInfo(`Viaje registrado: ${vol} m³ de ${predio.trim()} a ${destino.trim()}.`)
      onGuardado()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo registrar el viaje.')
    } finally { setBusy(false) }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card modal-card--wide" onClick={(e) => e.stopPropagation()}>
        <h3>Nuevo viaje de trozas</h3>

        <div className="form-grid">
          <label>Fecha de cargue
            <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} disabled={busy} />
          </label>

          <label>Predio de origen <span className="req">*</span>
            <CampoLista tipo="PREDIO" value={predio} onChange={setPredio} disabled={busy}
                        placeholder="LA ESPERANZA" />
          </label>

          <label>Destino <span className="req">*</span>
            <CampoLista tipo="DESTINO_MADERA" value={destino} onChange={setDestino} disabled={busy}
                        placeholder="PLANTA YUMBO" />
          </label>

          <label>Placa del camión <span className="req">*</span>
            <CampoPlaca value={placa} onChange={setPlaca} disabled={busy} />
          </label>

          <label>Configuración
            <select value={config} onChange={(e) => setConfig(e.target.value as MaderaConfig)} disabled={busy}>
              {(Object.keys(CONFIG_LABEL) as MaderaConfig[]).map((c) => (
                <option key={c} value={c}>{CONFIG_LABEL[c]}</option>
              ))}
            </select>
          </label>

          <label>Conductor
            <SearchableSelect value={conductor} onChange={setConductor}
                              options={opcionesConductor} placeholder="Buscar…" disabled={busy} />
          </label>

          <label>Especie
            <CampoLista tipo="ESPECIE" value={especie} onChange={setEspecie} disabled={busy}
                        placeholder="EUCALIPTO" />
          </label>

          <label>Volumen cargado (m³) <span className="req">*</span>
            <input type="number" min={0} step="any" value={volumen}
                   onChange={(e) => setVolumen(e.target.value)} disabled={busy} />
          </label>

          <label>Peso en báscula (toneladas)
            <input type="number" min={0} step="any" value={peso}
                   onChange={(e) => setPeso(e.target.value)} disabled={busy} />
          </label>
        </div>

        {/* El aviso de peso sale ANTES de salir, no en el puesto de control:
            pasarse cuesta la multa, la inmovilización y el transbordo. */}
        {sobrepeso && (
          <p className="madera-aviso-peso" role="alert">
            {peso} t pasa el límite de <strong>{limite} t</strong> de un {config}. Con madera
            verde el camión se llena por peso antes que por volumen — revisa antes de salir.
          </p>
        )}

        <div className="form-grid">
          <label>Documento
            <select value={docTipo} onChange={(e) => setDocTipo(e.target.value)} disabled={busy}>
              <option value="SUNL">SUNL · salvoconducto (bosque natural)</option>
              <option value="ICA">Remisión ICA (plantación registrada)</option>
            </select>
          </label>

          <label>Número
            <input type="text" value={docNumero} onChange={(e) => setDocNumero(e.target.value.toLocaleUpperCase('es-CO'))}
                   disabled={busy} autoCapitalize="characters" />
          </label>

          <label>Vence
            <input type="date" value={docVence} onChange={(e) => setDocVence(e.target.value)} disabled={busy} />
          </label>
        </div>

        <p className="subtle-copy" style={{ marginTop: 4 }}>
          El SUNL dura <strong>8 días calendario</strong> y sirve para un solo viaje. La fecha
          viene propuesta a 8 días; cámbiala si el salvoconducto dice otra cosa.
        </p>

        <div className="flota-comprobante" style={{ marginTop: 10 }}>
          <span className="flota-comprobante__lbl">📷 Foto del documento o de la carga</span>
          <div className="flota-foto-row">
            {foto && <FotoEvidencia url={foto} alt="soporte del viaje" />}
            <button type="button" className="inline-button" onClick={() => fotoRef.current?.click()}
                    disabled={busy || subiendo}>
              {subiendo ? 'Subiendo…' : foto ? 'Cambiar foto' : '📷 Tomar foto'}
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
            {busy ? 'Guardando…' : 'Registrar viaje'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default MaderaForm
