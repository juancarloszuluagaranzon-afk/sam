import { useEffect, useMemo, useState } from 'react'
import { loadCatalogo } from '../services/samApi'
import {
  RAZONES_SOCIALES, crearDocumento, vincularDocumento,
  type DocumentoFact, type TipoDocumento,
} from '../services/facturacionApi'
import { aligerarDocumento } from '../lib/pdfLigero'

/**
 * Vincular las líneas marcadas a un SOPORTE del cliente o a una FACTURA:
 * uno que ya existe, o uno nuevo con su número, fecha y archivo (PDF o foto).
 * Si alguna línea ya tenía otro documento de ese tipo, la base no la cambia sin
 * que se marque «reemplazar» (así una factura no se pisa sin querer).
 */
export function DocumentoFacturacionModal({
  tipo, ids, resumen, clienteSugerido, razonSugerida, valorSugerido, documentos, usuario, hoy, onCerrar, onListo,
}: {
  tipo: TipoDocumento
  ids: string[]
  /** «12 líneas · 85,40 ha» */
  resumen: string
  clienteSugerido: string
  razonSugerida: string
  /** FACTURA: suma de los valores de las líneas (si todas tienen tarifa). */
  valorSugerido?: number | null
  documentos: DocumentoFact[]
  usuario: string
  hoy: string
  onCerrar: () => void
  onListo: (doc: DocumentoFact, vinculadas: number) => void
}) {
  const propios = useMemo(() => documentos.filter((d) => d.tipo === tipo), [documentos, tipo])
  const [modo, setModo] = useState<'nuevo' | 'existente'>(propios.length ? 'existente' : 'nuevo')
  const [elegido, setElegido] = useState('')
  const [clases, setClases] = useState<string[]>([])
  const [clase, setClase] = useState('')
  const [numero, setNumero] = useState('')
  const [fecha, setFecha] = useState(hoy)
  const [cliente, setCliente] = useState(clienteSugerido)
  const [razon, setRazon] = useState(razonSugerida)
  const [valor, setValor] = useState(valorSugerido != null ? String(valorSugerido) : '')
  const [nota, setNota] = useState('')
  const [archivo, setArchivo] = useState<File | null>(null)
  const [reemplazar, setReemplazar] = useState(false)
  const [pideReemplazo, setPideReemplazo] = useState('')
  const [error, setError] = useState('')
  const [ocupado, setOcupado] = useState(false)
  // «PDF reducido de 4,2 MB a 380 KB»: se reduce en el equipo antes de subir (lib/pdfLigero).
  const [paso, setPaso] = useState('')

  useEffect(() => {
    if (tipo !== 'SOPORTE') return
    void loadCatalogo('TIPO_SOPORTE').then((vs) => {
      const lista = vs.map((v) => v.valor)
      setClases(lista)
      setClase((c) => c || lista[0] || '')
    })
  }, [tipo])

  const nombre = tipo === 'SOPORTE' ? 'soporte del cliente' : 'factura'
  const n = Number(valor.replace(/\./g, '').replace(',', '.'))

  async function guardar() {
    setError('')
    if (modo === 'existente' && !elegido) return setError(`Escoge el ${nombre}.`)
    if (modo === 'nuevo') {
      if (!numero.trim()) return setError('Escribe el número.')
      if (!fecha) return setError('Pon la fecha.')
      if (tipo === 'FACTURA' && !razon) return setError('Escoge la razón social que factura.')
      if (valor.trim() && !(n >= 0)) return setError('El valor va en pesos, sin signo.')
    }
    setOcupado(true)
    try {
      let liviano: File | null = null
      if (modo === 'nuevo' && archivo) {
        setPaso('Reduciendo el archivo…')
        const r = await aligerarDocumento(archivo)
        liviano = r.archivo
        setPaso(r.nota ?? '')
        if (liviano.size > 15 * 1024 * 1024) { setError('El archivo sigue pesando más de 15 MB.'); return }
      }
      const doc = modo === 'existente'
        ? propios.find((d) => d.id === elegido)!
        : await crearDocumento({
          tipo, clase: tipo === 'SOPORTE' ? clase : null, numero, fecha,
          razonSocial: tipo === 'FACTURA' ? razon : null, cliente,
          valor: tipo === 'FACTURA' && valor.trim() ? n : null, nota, creadoPor: usuario,
        }, liviano)
      // A partir de aquí el documento ya existe: si falla el vínculo, se reintenta como «existente».
      if (modo === 'nuevo') { setModo('existente'); setElegido(doc.id) }
      try {
        const vinculadas = await vincularDocumento(doc.id, ids, usuario, reemplazar)
        onListo(doc, vinculadas)
      } catch (e) {
        const m = (e as Error).message
        if (/ya tienen/.test(m)) setPideReemplazo(m)
        else setError(m)
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setOcupado(false)
    }
  }

  return (
    <div className="modal-overlay open" onClick={() => { if (!ocupado) onCerrar() }}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 'min(480px, calc(100vw - 32px))' }}>
        <div className="labor-detail-header">
          <div>
            <p className="eyebrow">{tipo === 'SOPORTE' ? 'Soporte del cliente' : 'Factura'}</p>
            <h3>{resumen}</h3>
          </div>
          <button type="button" className="modal-close-btn" onClick={onCerrar} disabled={ocupado} aria-label="Cerrar">&#x2715;</button>
        </div>

        {propios.length > 0 && (
          <div className="realizadas-seg" style={{ marginBottom: 10 }}>
            <button type="button" className={modo === 'existente' ? 'is-active' : ''} onClick={() => setModo('existente')}>Uno que ya existe</button>
            <button type="button" className={modo === 'nuevo' ? 'is-active' : ''} onClick={() => setModo('nuevo')}>Nuevo</button>
          </div>
        )}

        {modo === 'existente' ? (
          <label className="assignment-detail-field">
            <span>{tipo === 'SOPORTE' ? 'Soporte' : 'Factura'}</span>
            <select id="doc-existente" value={elegido} onChange={(e) => setElegido(e.target.value)} disabled={ocupado}>
              <option value="">Seleccionar…</option>
              {propios.map((d) => (
                <option key={d.id} value={d.id}>
                  {[d.clase ?? d.razonSocial, d.numero, d.cliente, d.fecha].filter(Boolean).join(' · ')}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <>
            {tipo === 'SOPORTE' ? (
              <label className="assignment-detail-field">
                <span>Tipo de soporte</span>
                <select id="doc-clase" value={clase} onChange={(e) => setClase(e.target.value)} disabled={ocupado}>
                  {clases.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
            ) : (
              <label className="assignment-detail-field">
                <span>Razón social que factura</span>
                <select id="doc-razon" value={razon} onChange={(e) => setRazon(e.target.value)} disabled={ocupado}>
                  <option value="">Seleccionar…</option>
                  {RAZONES_SOCIALES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </label>
            )}
            <label className="assignment-detail-field">
              <span>Número</span>
              <input id="doc-numero" value={numero} onChange={(e) => setNumero(e.target.value)} disabled={ocupado}
                placeholder={tipo === 'SOPORTE' ? 'Ej.: OS-2026-0412' : 'Ej.: FE-1234'} />
            </label>
            <label className="assignment-detail-field">
              <span>Fecha</span>
              <input id="doc-fecha" type="date" value={fecha} max={hoy} onChange={(e) => setFecha(e.target.value)} disabled={ocupado} />
            </label>
            <label className="assignment-detail-field">
              <span>Cliente</span>
              <input id="doc-cliente" value={cliente} onChange={(e) => setCliente(e.target.value)} disabled={ocupado} placeholder="Ingenio o proveedor" />
            </label>
            {tipo === 'FACTURA' && (
              <label className="assignment-detail-field">
                <span>Valor total {valorSugerido != null ? '(suma de las líneas por tarifa)' : '(opcional)'}</span>
                <input id="doc-valor" inputMode="numeric" value={valor} onChange={(e) => setValor(e.target.value)} disabled={ocupado} placeholder="0" />
              </label>
            )}
            <label className="assignment-detail-field">
              <span>Archivo (PDF o foto)</span>
              <input id="doc-archivo" type="file" accept="application/pdf,image/jpeg,image/png,image/webp"
                onChange={(e) => setArchivo(e.target.files?.[0] ?? null)} disabled={ocupado} />
            </label>
            <label className="assignment-detail-field">
              <span>Nota (opcional)</span>
              <input id="doc-nota" value={nota} onChange={(e) => setNota(e.target.value)} disabled={ocupado} />
            </label>
          </>
        )}

        {pideReemplazo && (
          <label className="field-warning" style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <input type="checkbox" checked={reemplazar} onChange={(e) => setReemplazar(e.target.checked)} />
            <span>{pideReemplazo}. Marca aquí para pasarlas a {tipo === 'SOPORTE' ? 'este soporte' : 'esta factura'}.</span>
          </label>
        )}
        {paso && <p className="field-hint">{paso}</p>}
        {error && <p className="feedback error">{error}</p>}

        <div className="modal-footer">
          <button type="button" className="inline-button" onClick={onCerrar} disabled={ocupado}>Cancelar</button>
          <button type="button" className="primary-button" onClick={() => void guardar()} disabled={ocupado || (!!pideReemplazo && !reemplazar)}>
            {ocupado ? 'Guardando…' : `Vincular ${nombre}`}
          </button>
        </div>
      </div>
    </div>
  )
}
