import { useMemo, useState } from 'react'
import SearchableSelect from './SearchableSelect'
import type { Assignment } from '../domain/sam'
import { desvincularDocumento, vincularDocumento, type DocumentoFact, type TipoDocumento } from '../services/facturacionApi'
import { setClienteFacturaBulk } from '../services/samApi'
import { NOMBRE_CLIENTE, clienteForzado } from '../lib/tarifas'

/** Lo que cambió, para que la tabla se ponga al día sin volver a cargar todo. */
export interface CambioLinea {
  /** `undefined` = no cambió; `null` = volvió a automático. */
  cliente?: string | null
  soporte?: DocumentoFact | null
  factura?: DocumentoFact | null
}

const etiquetaDoc = (d: DocumentoFact) =>
  [d.tipo === 'SOPORTE' ? (d.clase ?? 'Soporte') : d.razonSocial, d.numero, d.cliente, d.fecha].filter(Boolean).join(' · ')

/**
 * Editar UNA línea de Facturación (18-oct-2026, pedido de Carlos David): a quién
 * se le factura, su soporte del cliente y su factura. Cambiar de documento usa
 * `fact_vincular` con «reemplazar» (la base guarda quién lo hizo); «Sin …» usa
 * `fact_desvincular`. Para un documento que todavía no existe, «Crear uno nuevo»
 * abre el formulario de siempre con esta sola línea.
 */
export function EditarLineaFacturacion({ a, clienteAuto, documentos, usuario, onCerrar, onGuardado, onNuevo }: {
  a: Assignment
  /** El cliente que sale solo, por el ingenio (para la opción «Automático»). */
  clienteAuto: string | null
  documentos: DocumentoFact[]
  usuario: string
  onCerrar: () => void
  onGuardado: (cambio: CambioLinea, mensaje: string) => void
  onNuevo: (tipo: TipoDocumento) => void
}) {
  const clienteAntes = clienteForzado(a) ?? ''
  const soporteAntes = a.soporteId ?? ''
  const facturaAntes = a.facturaId ?? ''
  const [cliente, setCliente] = useState(clienteAntes)
  const [soporte, setSoporte] = useState(soporteAntes)
  const [factura, setFactura] = useState(facturaAntes)
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState('')

  const porId = useMemo(() => new Map(documentos.map((d) => [d.id, d])), [documentos])
  // La primera fila del selector (su «placeholder») es la opción vacía: Automático / Sin soporte / Sin factura.
  const opcionesCliente = useMemo(
    () => Object.entries(NOMBRE_CLIENTE).map(([clave, nombre]) => ({ value: clave, label: nombre })), [])
  const opcionesDoc = (tipo: TipoDocumento) =>
    documentos.filter((d) => d.tipo === tipo).map((d) => ({ value: d.id, label: etiquetaDoc(d) }))

  const facturaVieja = facturaAntes ? porId.get(facturaAntes) : undefined
  const facturaNueva = factura ? porId.get(factura) : undefined
  // Factura «a la antigua» (solo número, sin documento): se ve, pero el selector no la tiene.
  const numeroSuelto = !a.facturaId && a.facturaNumero?.trim() ? a.facturaNumero.trim() : ''
  const nombreCliente = cliente ? NOMBRE_CLIENTE[cliente] : clienteAuto
  // Aviso (no bloquea): el cliente de la línea no es el de su factura.
  const choca = facturaNueva?.cliente && nombreCliente &&
    !facturaNueva.cliente.toLowerCase().includes(nombreCliente.replace(/^Ingenio /, '').toLowerCase())

  const cambios = cliente !== clienteAntes || soporte !== soporteAntes || factura !== facturaAntes

  async function guardar() {
    if (!cambios) { onCerrar(); return }
    if (factura !== facturaAntes && facturaVieja &&
        !window.confirm(`La línea sale de la factura ${facturaVieja.numero}${facturaNueva ? ` y pasa a la ${facturaNueva.numero}` : ' y queda sin factura'}. ¿Seguir?`)) return
    setOcupado(true); setError('')
    const hecho: CambioLinea = {}
    const partes: string[] = []
    try {
      if (cliente !== clienteAntes) {
        await setClienteFacturaBulk([a.id], cliente || null, usuario)
        hecho.cliente = cliente || null
        partes.push(`se factura a ${nombreCliente ?? '—'}`)
      }
      for (const [tipo, nuevo, antes] of [['SOPORTE', soporte, soporteAntes], ['FACTURA', factura, facturaAntes]] as const) {
        if (nuevo === antes) continue
        if (nuevo) {
          await vincularDocumento(nuevo, [a.id], usuario, true)
          const doc = porId.get(nuevo) ?? null
          if (tipo === 'SOPORTE') hecho.soporte = doc; else hecho.factura = doc
          partes.push(`${tipo === 'SOPORTE' ? 'soporte' : 'factura'} ${doc?.numero ?? ''}`.trim())
        } else {
          await desvincularDocumento(tipo, [a.id], usuario)
          if (tipo === 'SOPORTE') hecho.soporte = null; else hecho.factura = null
          partes.push(tipo === 'SOPORTE' ? 'sin soporte' : 'sin factura')
        }
      }
      onGuardado(hecho, `${a.haciendaName} · ${a.suerte}: ${partes.join(', ')}.`)
      onCerrar()
    } catch (e) {
      // Lo que alcanzó a guardarse se refleja igual en la tabla; lo demás se avisa.
      if (Object.keys(hecho).length) onGuardado(hecho, `Guardado en parte: ${partes.join(', ')}.`)
      setError((e as Error).message)
    } finally {
      setOcupado(false)
    }
  }

  return (
    <div className="modal-overlay open" onClick={() => { if (!ocupado) onCerrar() }}>
      <div className="modal-card" onClick={(ev) => ev.stopPropagation()} style={{ maxWidth: 'min(520px, calc(100vw - 32px))' }}>
        <div className="panel-title split">
          <div>
            <p className="eyebrow">Facturación de la línea</p>
            <h3 style={{ margin: 0 }}>{a.haciendaName} · {a.suerte}</h3>
            <p className="subtle-copy" style={{ margin: '2px 0 0' }}>{a.labor} · {a.operatorName || '—'}</p>
          </div>
          <button type="button" className="inline-button" onClick={onCerrar} disabled={ocupado}>Cerrar</button>
        </div>

        <label className="assignment-detail-field">
          <span>A quién se factura</span>
          <SearchableSelect value={cliente} onChange={setCliente} options={opcionesCliente} disabled={ocupado} placeholder={`Automático (${clienteAuto ?? 'la labor no tiene ingenio'})`} />
        </label>
        <p className="field-hint" style={{ marginTop: 2 }}>
          De ahí sale la tarifa. «Automático» es el cliente del ingenio de la suerte.
        </p>

        {(['SOPORTE', 'FACTURA'] as const).map((tipo) => (
          <div key={tipo} style={{ marginTop: 10 }}>
            <label className="assignment-detail-field">
              <span>{tipo === 'SOPORTE' ? 'Soporte del cliente' : 'Factura'}</span>
              <SearchableSelect
                value={tipo === 'SOPORTE' ? soporte : factura}
                onChange={tipo === 'SOPORTE' ? setSoporte : setFactura}
                options={opcionesDoc(tipo)}
                disabled={ocupado}
                placeholder={tipo === 'SOPORTE' ? 'Sin soporte' : 'Sin factura'}
              />
            </label>
            {tipo === 'FACTURA' && numeroSuelto && !factura && (
              <p className="field-hint">Tiene el número {numeroSuelto} puesto antes de existir las facturas; escoger una lo reemplaza.</p>
            )}
            <button type="button" className="af-link" disabled={ocupado} onClick={() => onNuevo(tipo)}>
              + Crear {tipo === 'SOPORTE' ? 'un soporte nuevo' : 'una factura nueva'} para esta línea
            </button>
          </div>
        ))}

        {choca && (
          <p className="feedback" style={{ marginTop: 10 }}>
            ⚠️ La factura {facturaNueva?.numero} es de {facturaNueva?.cliente} y la línea se le factura a {nombreCliente}. Revisa que sea correcto.
          </p>
        )}
        {error && <p className="feedback error">{error}</p>}

        <div className="af-acciones" style={{ marginTop: 12 }}>
          <button type="button" className="primary-button" onClick={() => void guardar()} disabled={ocupado || !cambios}>
            {ocupado ? 'Guardando…' : 'Guardar cambios'}
          </button>
          <button type="button" className="inline-button" onClick={onCerrar} disabled={ocupado}>Cancelar</button>
        </div>
      </div>
    </div>
  )
}
