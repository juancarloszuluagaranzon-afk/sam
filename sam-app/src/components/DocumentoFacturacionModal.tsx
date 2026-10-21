import SearchableSelect from './SearchableSelect'
import { useEffect, useMemo, useState } from 'react'
import { loadCatalogo } from '../services/samApi'
import {
  RAZONES_SOCIALES, crearDocumento, vincularDocumento,
  type DocumentoFact, type TipoDocumento,
} from '../services/facturacionApi'
import { aligerarDocumento } from '../lib/pdfLigero'
import { acuerdosDeHaciendas, ligarFacturaAcuerdo, loadAcuerdos, pesos, type Acuerdo } from '../services/carteraApi'

/**
 * Vincular las líneas marcadas a un SOPORTE del cliente o a una FACTURA:
 * uno que ya existe, o uno nuevo con su número, fecha y archivo (PDF o foto).
 * Si alguna línea ya tenía otro documento de ese tipo, la base no la cambia sin
 * que se marque «reemplazar» (así una factura no se pisa sin querer).
 *
 * FACTURA nueva de labores de un colono con ACUERDO DE PAGO (21-oct-2026): ofrece
 * ligarla al acuerdo; el anticipo que el colono ya pagó se descuenta de ella.
 */
export function DocumentoFacturacionModal({
  tipo, ids, resumen, clienteSugerido, razonSugerida, valorSugerido, documentos, usuario, hoy, onCerrar, onListo, modoInicial, haciendas,
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
  /** `extra`: lo que pasó con el acuerdo de pago («anticipo de $3.600.000 descontado»). */
  onListo: (doc: DocumentoFact, vinculadas: number, extra?: string) => void
  /** Desde «Facturar estas líneas» arranca en «Nuevo»: casi siempre es una factura nueva. */
  modoInicial?: 'nuevo' | 'existente'
  /** Haciendas de las líneas marcadas: para encontrar el acuerdo de pago del colono. */
  haciendas?: string[]
}) {
  const propios = useMemo(() => documentos.filter((d) => d.tipo === tipo), [documentos, tipo])
  const [modo, setModo] = useState<'nuevo' | 'existente'>(modoInicial ?? (propios.length ? 'existente' : 'nuevo'))
  const [elegido, setElegido] = useState('')
  const [clases, setClases] = useState<string[]>([])
  const [clase, setClase] = useState('')
  const [numero, setNumero] = useState('')
  const [fecha, setFecha] = useState(hoy)
  const [cliente, setCliente] = useState(clienteSugerido)
  const [razon, setRazon] = useState(razonSugerida)
  const [valor, setValor] = useState(valorSugerido != null ? Math.round(valorSugerido).toLocaleString('es-CO') : '')
  const [nota, setNota] = useState('')
  const [archivo, setArchivo] = useState<File | null>(null)
  const [reemplazar, setReemplazar] = useState(false)
  // El documento que se acaba de crear aquí (todavía no está en `documentos`): si el
  // vínculo falla, el reintento lo usa a él (antes daba un error técnico).
  const [creado, setCreado] = useState<DocumentoFact | null>(null)
  const [pideReemplazo, setPideReemplazo] = useState('')
  const [error, setError] = useState('')
  const [ocupado, setOcupado] = useState(false)
  // «PDF reducido de 4,2 MB a 380 KB»: se reduce en el equipo antes de subir (lib/pdfLigero).
  const [paso, setPaso] = useState('')
  // Acuerdos de pago de los colonos de estas líneas (solo factura nueva).
  const [acuerdos, setAcuerdos] = useState<Acuerdo[]>([])
  const [acuerdoId, setAcuerdoId] = useState('')
  const [ligarAcuerdo, setLigarAcuerdo] = useState(true)
  const clavesHaciendas = (haciendas ?? []).join('|')
  useEffect(() => {
    if (tipo !== 'FACTURA' || !clavesHaciendas) return
    let vivo = true
    void loadAcuerdos().then((todos) => {
      if (!vivo) return
      // Primero los que aún no tienen factura (ahí está el anticipo por descontar).
      const suyos = acuerdosDeHaciendas(todos, clavesHaciendas.split('|')).sort((x, y) => x.nFacturas - y.nFacturas)
      setAcuerdos(suyos)
      setAcuerdoId(suyos[0]?.id ?? '')
    })
    return () => { vivo = false }
  }, [tipo, clavesHaciendas])
  const acuerdo = acuerdos.find((x) => x.id === acuerdoId) ?? null

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
    if (ids.length === 0) return setError('No hay líneas marcadas: márcalas en la tabla y vuelve a intentar.')
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
        ? (propios.find((d) => d.id === elegido) ?? (creado?.id === elegido ? creado : null))
        : await crearDocumento({
          tipo, clase: tipo === 'SOPORTE' ? clase : null, numero, fecha,
          razonSocial: tipo === 'FACTURA' ? razon : null, cliente,
          valor: tipo === 'FACTURA' && valor.trim() ? n : null, nota, creadoPor: usuario,
        }, liviano)
      if (!doc) { setError(`Escoge el ${nombre} otra vez.`); return }
      // A partir de aquí el documento ya existe: si falla el vínculo, se reintenta como «existente».
      if (modo === 'nuevo') { setCreado(doc); setModo('existente'); setElegido(doc.id) }
      try {
        const vinculadas = await vincularDocumento(doc.id, ids, usuario, reemplazar)
        let extra: string | undefined
        if (tipo === 'FACTURA' && modo === 'nuevo' && acuerdo && ligarAcuerdo) {
          try {
            const d = await ligarFacturaAcuerdo(doc.id, acuerdo.id, usuario)
            extra = `🤝 Quedó en el acuerdo con ${acuerdo.colono}${d > 0 ? `: se le descontó el anticipo (${pesos(d)})` : ''}.`
          } catch (e) {
            extra = `⚠ No se pudo ligar al acuerdo con ${acuerdo.colono} (${(e as Error).message}): lígala en Cartera.`
          }
        }
        onListo(doc, vinculadas, extra)
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
            <button type="button" className={`realizadas-seg__btn${modo === 'existente' ? ' is-active' : ''}`} onClick={() => setModo('existente')}>Uno que ya existe</button>
            <button type="button" className={`realizadas-seg__btn${modo === 'nuevo' ? ' is-active' : ''}`} onClick={() => setModo('nuevo')}>Nuevo</button>
          </div>
        )}

        {tipo === 'FACTURA' && modo === 'nuevo' && acuerdo && (
          <div className="taller-aviso acu-en-factura">
            <label className="acu-check">
              <input type="checkbox" checked={ligarAcuerdo} onChange={(e) => setLigarAcuerdo(e.target.checked)} disabled={ocupado} />
              <span>
                🤝 Estas labores tienen <b>acuerdo de pago con {acuerdo.colono}</b> (negoció {acuerdo.negociadoPor}).
                {' '}Ligar la factura al acuerdo{acuerdo.porDescontar > 0 ? <>: <b>se le descuenta el anticipo de {pesos(acuerdo.porDescontar)}</b></> : ''}.
              </span>
            </label>
            {acuerdos.length > 1 && (
              <select value={acuerdoId} onChange={(e) => setAcuerdoId(e.target.value)} disabled={ocupado || !ligarAcuerdo}
                aria-label="Acuerdo de pago" style={{ marginTop: 6, width: '100%' }}>
                {acuerdos.map((x) => <option key={x.id} value={x.id}>{x.colono} · {x.fecha}{x.porDescontar > 0 ? ` · anticipo ${pesos(x.porDescontar)}` : ''}</option>)}
              </select>
            )}
          </div>
        )}

        {modo === 'existente' ? (
          <label className="assignment-detail-field">
            <span>{tipo === 'SOPORTE' ? 'Soporte' : 'Factura'}</span>
            <SearchableSelect
              value={elegido}
              onChange={setElegido}
              disabled={ocupado}
              placeholder={tipo === 'SOPORTE' ? 'Soporte' : 'Factura'}
              options={[...(creado && !propios.some((d) => d.id === creado.id) ? [creado] : []), ...propios].map((d) => ({ value: d.id, label: [d.clase ?? d.razonSocial, d.numero, d.cliente, d.fecha].filter(Boolean).join(' · ') }))}
            />
          </label>
        ) : (
          <>
            <label className="assignment-detail-field">
              <span>Número {tipo === 'SOPORTE' ? 'del soporte' : 'de la factura'}</span>
              <input id="doc-numero" value={numero} onChange={(e) => setNumero(e.target.value)} disabled={ocupado} autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void guardar() } }}
                placeholder={tipo === 'SOPORTE' ? 'Ej.: OS-2026-0412' : 'Ej.: FE-1234'} />
            </label>
            <label className="assignment-detail-field">
              <span>Fecha</span>
              <input id="doc-fecha" type="date" value={fecha} max={hoy} onChange={(e) => setFecha(e.target.value)} disabled={ocupado} />
            </label>
            {tipo === 'FACTURA' && (
              <label className="assignment-detail-field">
                <span>Valor total {valorSugerido != null ? '(ya sumado de las líneas)' : '(escríbelo: hay líneas sin precio)'}</span>
                <input id="doc-valor" inputMode="numeric" value={valor} onChange={(e) => setValor(e.target.value)} disabled={ocupado} placeholder="0" />
              </label>
            )}
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
              <span>Cliente</span>
              <input id="doc-cliente" value={cliente} onChange={(e) => setCliente(e.target.value)} disabled={ocupado} placeholder="Ingenio o proveedor" />
            </label>
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
            {ocupado ? 'Guardando…'
              : modo === 'nuevo' ? `Crear ${nombre === 'factura' ? 'factura' : 'soporte'} y vincular ${ids.length === 1 ? 'la línea' : `${ids.length} líneas`}`
              : `Vincular ${ids.length === 1 ? 'la línea' : `${ids.length} líneas`} a ${tipo === 'SOPORTE' ? 'ese soporte' : 'esa factura'}`}
          </button>
        </div>
      </div>
    </div>
  )
}
