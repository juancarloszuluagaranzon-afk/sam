import { useEffect, useState } from 'react'
import type { Assignment } from '../domain/sam'
import { abrirArchivo, loadDocumentos, type DocumentoFact } from '../services/facturacionApi'
import { infoEstado, loadFacturaCartera, pesos, type FacturaCartera } from '../services/carteraApi'

/**
 * Trazabilidad de UNA labor (2-oct-2026): con qué SOPORTE del cliente quedó, con
 * qué FACTURA, y cuántos días de cartera lleva o si ya se pagó. Va en el detalle
 * de la labor. Solo se consulta si la labor tiene algo vinculado.
 */
export function TrazaFacturacion({ a }: { a: Assignment }) {
  const [docs, setDocs] = useState<DocumentoFact[]>([])
  const [cartera, setCartera] = useState<FacturaCartera | null>(null)
  const [error, setError] = useState('')
  const realizada = a.status === 'COMPLETADA' || a.status === 'PARCIAL'

  useEffect(() => {
    let vivo = true
    if (a.soporteId || a.facturaId) void loadDocumentos().then((d) => { if (vivo) setDocs(d) })
    if (a.facturaId) void loadFacturaCartera(a.facturaId).then((c) => { if (vivo) setCartera(c) })
    return () => { vivo = false }
  }, [a.soporteId, a.facturaId])

  if (!realizada) return null
  const sop = docs.find((d) => d.id === a.soporteId)
  const fac = docs.find((d) => d.id === a.facturaId)
  const e = cartera ? infoEstado(cartera.estado) : null
  const ver = async (path: string | null) => {
    if (!path) return
    try { await abrirArchivo(path) } catch (err) { setError((err as Error).message) }
  }

  return (
    <section className="assignment-detail-section">
      <p className="eyebrow">Facturación y cartera</p>
      <dl className="assignment-detail-grid">
        <div className="assignment-detail-row">
          <dt>Soporte del cliente</dt>
          <dd>{sop
            ? <>{sop.clase ?? 'Soporte'} {sop.numero} · {sop.fecha} {sop.archivoPath && <button type="button" className="af-link" onClick={() => void ver(sop.archivoPath)}>📄 abrir</button>}</>
            : a.soporteId ? '…' : <span className="subtle-copy">sin soporte</span>}</dd>
        </div>
        <div className="assignment-detail-row">
          <dt>Factura</dt>
          <dd>{fac
            ? <>{fac.numero} · {fac.fecha} · {fac.razonSocial ?? ''} {fac.archivoPath && <button type="button" className="af-link" onClick={() => void ver(fac.archivoPath)}>📄 abrir</button>}</>
            : a.facturaNumero ? a.facturaNumero : <span className="subtle-copy">sin facturar</span>}</dd>
        </div>
        {cartera && e && (
          <>
            <div className="assignment-detail-row">
              <dt>Cartera</dt>
              <dd><span className={`cart-chip ${e.clase}`}>{e.titulo}</span> {cartera.estado === 'PAGADA'
                ? <>pagada en {cartera.diasCartera} días{cartera.ultimoPago ? ` (${cartera.ultimoPago})` : ''}</>
                : <>{cartera.diasCartera} días · vence {cartera.vence}{cartera.diasMora > 0 ? ` · ${cartera.diasMora} días de mora` : ''}</>}</dd>
            </div>
            {cartera.estado !== 'PAGADA' && cartera.saldo != null && (
              <div className="assignment-detail-row"><dt>Saldo de la factura</dt><dd>{pesos(cartera.saldo)}</dd></div>
            )}
          </>
        )}
      </dl>
      {error && <p className="feedback error">{error}</p>}
    </section>
  )
}
