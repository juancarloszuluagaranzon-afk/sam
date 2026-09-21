import { useState } from 'react'
import type { CtxFincas } from './FincasView'
import { mensajeDeError, revisarReporte } from '../../services/fincasApi'
import { contextoReporte, diasEntre, fmtCant, fmtPesos } from '../../lib/fincas'
import { fmtFechaHora } from '../../lib/fechas'

/**
 * Bandeja de reportes por aceptar. Aquí se decide qué cuenta: lo aceptado entra al
 * avance y —si la labor tiene costo— a la cuenta del dueño, con la foto de soporte.
 * 🔴 Nadie acepta lo suyo: el botón no aparece y, si apareciera, la base lo frena.
 */
export function PorAceptar({ ctx }: { ctx: CtxFincas }) {
  const { datos: d, usuario, nombre, puedeReportar, recargar } = ctx
  const [motivos, setMotivos] = useState<Record<string, string>>({})
  const [rechazando, setRechazando] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [error, setError] = useState('')
  const pendientes = d.reportes.filter((r) => r.estado === 'PENDIENTE').sort((a, b) => a.createdAt.localeCompare(b.createdAt))

  async function revisar(id: string, aceptar: boolean) {
    setOcupado(id); setError('')
    try {
      await revisarReporte(id, aceptar, motivos[id] ?? '', usuario)
      setRechazando(null)
      await recargar()
    } catch (e) { setError(mensajeDeError(e)) } finally { setOcupado(null) }
  }

  return (
    <div className="af-stack">
      <div className="af-cab"><div><p className="eyebrow">Verificación</p><h2>Por aceptar</h2></div></div>
      <p className="subtle-copy" style={{ marginTop: 0 }}>Mire la foto y la ubicación antes de aceptar. Lo aceptado cuenta como hecho y, si la labor tiene costo, se carga a la cuenta del dueño.</p>
      {error && <p className="feedback error">{error}</p>}
      {pendientes.length === 0 && <div className="af-card af-vacio"><p>✓ No hay reportes por aceptar.</p></div>}
      {pendientes.map((r) => {
        const { labor, ciclo, suerte, finca } = contextoReporte(r, d)
        const propio = r.reportadoPor === usuario
        const valor = labor && labor.costoUnitarioPlan > 0 ? r.cantidad * labor.costoUnitarioPlan : 0
        return (
          <div key={r.id} className="af-card af-reporte">
            <a href={r.fotoUrl} target="_blank" rel="noreferrer" className="af-reporte__foto">
              <img src={r.fotoUrl} alt="foto de la labor" loading="lazy" />
            </a>
            <div className="af-reporte__txt">
              <h3>{labor?.labor.toLowerCase()} · {fmtCant(r.cantidad)} {labor?.unidad}</h3>
              <p className="af-nota" style={{ margin: 0 }}>{finca?.nombre} · suerte {suerte?.codigo}{ciclo ? ` · ${diasEntre(ciclo.fechaCorte, r.fecha)} días del corte` : ''}</p>
              <ul className="af-datos">
                <li>Hecha el <b>{r.fecha}</b> · reportó <b>{nombre(r.reportadoPor)}</b></li>
                <li>Llegó al servidor: {fmtFechaHora(r.createdAt)}</li>
                <li>{r.lat != null && r.lng != null
                  ? <>Ubicación: <a href={`https://www.google.com/maps?q=${r.lat},${r.lng}`} target="_blank" rel="noreferrer">ver en el mapa</a>{r.precisionM != null ? ` (±${Math.round(r.precisionM)} m)` : ''}</>
                  : <span className="af-rojo">Sin ubicación</span>}</li>
                {valor > 0 && <li>Al aceptar se cargan <b>{fmtPesos(valor)}</b> a la cuenta del dueño</li>}
                {r.nota && <li>Nota: {r.nota}</li>}
              </ul>
              {propio ? (
                <p className="af-nota">Lo reportó usted: lo acepta otra persona.</p>
              ) : !puedeReportar ? null : rechazando === r.id ? (
                <div className="af-mini-form">
                  <label>¿Por qué se rechaza?
                    <input id={`af-motivo-${r.id}`} value={motivos[r.id] ?? ''} onChange={(e) => setMotivos((m) => ({ ...m, [r.id]: e.target.value }))} placeholder="Ej.: la foto es de otra suerte" />
                  </label>
                  <div className="af-acciones">
                    <button type="button" className="inline-button af-boton-mal" disabled={ocupado === r.id || !(motivos[r.id] ?? '').trim()} onClick={() => void revisar(r.id, false)}>Rechazar</button>
                    <button type="button" className="inline-button" onClick={() => setRechazando(null)}>Cancelar</button>
                  </div>
                </div>
              ) : (
                <div className="af-acciones">
                  <button type="button" className="primary-button" disabled={ocupado === r.id} onClick={() => void revisar(r.id, true)}>Aceptar</button>
                  <button type="button" className="inline-button" onClick={() => setRechazando(r.id)}>Rechazar…</button>
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
