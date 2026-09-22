import { useState } from 'react'
import type { CtxFincas } from './FincasView'
import { guardarPaquete, mensajeDeError, type LaborPaquete } from '../../services/fincasApi'
import { fmtPesos } from '../../lib/fincas'

/**
 * El paquete de labores: la plantilla con la que nace cada ciclo. Costo por
 * unidad y ventana de oportunidad (días desde el corte). Cambiarlo NO toca los
 * ciclos ya abiertos: cada ciclo guarda su propio presupuesto, que es el que el
 * dueño aprobó.
 */
export function PaqueteLabores({ ctx }: { ctx: CtxFincas }) {
  const { datos: d, token, recargar, esAdmin } = ctx
  const [editando, setEditando] = useState<Partial<LaborPaquete> & { labor: string } | null>(null)
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)
  if (!esAdmin) return <p className="subtle-copy">Solo administración edita el paquete.</p>

  async function guardar() {
    if (!editando) return
    setGuardando(true); setError('')
    try { await guardarPaquete(editando, token); setEditando(null); await recargar() }
    catch (e) { setError(mensajeDeError(e)) } finally { setGuardando(false) }
  }
  const nulo = (v: string) => (v.trim() === '' ? null : Number(v))

  return (
    <div className="af-stack">
      <div className="af-cab">
        <div><p className="eyebrow">Plantilla</p><h2>Paquete de labores</h2></div>
        <button type="button" className="primary-button" onClick={() => setEditando({ labor: '', unidad: 'ha', cantidadPorHa: 1, costoUnitario: 0, aplica: 'AMBOS', orden: 100, activa: true })}>+ Labor</button>
      </div>
      <p className="subtle-copy" style={{ marginTop: 0 }}>Con esto nace cada ciclo: sus labores, cuánto cuestan y hasta qué día después del corte están a tiempo. Cambiarlo no toca los ciclos ya abiertos.</p>
      {error && <p className="feedback error">{error}</p>}

      {editando && (
        <div className="af-card">
          <h3>{editando.id ? `Editar ${editando.labor}` : 'Nueva labor'}</h3>
          <div className="af-form">
            <label>Labor<input id="af-p-labor" value={editando.labor} onChange={(e) => setEditando({ ...editando, labor: e.target.value })} /></label>
            <label>Unidad
              <select id="af-p-unidad" value={editando.unidad ?? 'ha'} onChange={(e) => setEditando({ ...editando, unidad: e.target.value })}>
                <option value="ha">Hectárea</option><option value="jornal">Jornal</option><option value="h">Hora</option><option value="kg">Kilo</option><option value="gal">Galón</option>
              </select>
            </label>
            <label>Cantidad por hectárea<input id="af-p-cxha" inputMode="decimal" value={String(editando.cantidadPorHa ?? 1)} onChange={(e) => setEditando({ ...editando, cantidadPorHa: Number(e.target.value.replace(',', '.')) || 1 })} /></label>
            <label>Costo por unidad (pesos)<input id="af-p-costo" inputMode="numeric" value={String(editando.costoUnitario ?? 0)} onChange={(e) => setEditando({ ...editando, costoUnitario: Number(e.target.value.replace(/\./g, '')) || 0 })} /></label>
            <label>A tiempo hasta (días del corte)<input id="af-p-vi" inputMode="numeric" value={editando.ventanaIdeal ?? ''} onChange={(e) => setEditando({ ...editando, ventanaIdeal: nulo(e.target.value) })} placeholder="sin ventana" /></label>
            <label>Tardía después de (días)<input id="af-p-vn" inputMode="numeric" value={editando.ventanaNormal ?? ''} onChange={(e) => setEditando({ ...editando, ventanaNormal: nulo(e.target.value) })} placeholder="sin ventana" /></label>
            <label>Aplica a
              <select id="af-p-aplica" value={editando.aplica ?? 'AMBOS'} onChange={(e) => setEditando({ ...editando, aplica: e.target.value as LaborPaquete['aplica'] })}>
                <option value="AMBOS">Soca y plantilla</option><option value="SOCA">Solo soca</option><option value="PLANTILLA">Solo plantilla</option>
              </select>
            </label>
            <label>Orden<input id="af-p-orden" inputMode="numeric" value={String(editando.orden ?? 100)} onChange={(e) => setEditando({ ...editando, orden: Number(e.target.value) || 100 })} /></label>
          </div>
          <div className="af-acciones">
            <button type="button" className="primary-button" disabled={guardando || !editando.labor.trim()} onClick={() => void guardar()}>{guardando ? 'Guardando…' : 'Guardar'}</button>
            <button type="button" className="inline-button" onClick={() => setEditando(null)}>Cancelar</button>
          </div>
        </div>
      )}

      <div className="af-card">
        <div className="af-tabla-wrap">
          <table className="af-tabla">
            <thead><tr><th>Labor</th><th>Aplica</th><th>Costo</th><th>A tiempo</th><th /></tr></thead>
            <tbody>
              {d.paquete.map((p) => (
                <tr key={p.id} className={p.activa ? '' : 'af-anulada'}>
                  <td><b>{p.labor.toLowerCase()}</b><small>{p.cantidadPorHa !== 1 ? `${p.cantidadPorHa} ${p.unidad} por ha` : `por ${p.unidad}`}</small></td>
                  <td><small>{p.aplica === 'AMBOS' ? 'soca y plantilla' : p.aplica.toLowerCase()}</small></td>
                  <td>{p.costoUnitario > 0 ? `${fmtPesos(p.costoUnitario)} / ${p.unidad}` : <span className="af-rojo">sin costo</span>}</td>
                  <td><small>{p.ventanaIdeal != null && p.ventanaNormal != null ? `ideal ≤${p.ventanaIdeal} · normal ≤${p.ventanaNormal} días` : 'sin ventana'}</small></td>
                  <td className="af-td-acc">
                    <button type="button" className="af-link" onClick={() => setEditando({ ...p })}>Editar</button>
                    <button type="button" className="af-link" onClick={async () => {
                      try { await guardarPaquete({ ...p, activa: !p.activa }, token); await recargar() } catch (e) { setError(mensajeDeError(e)) }
                    }}>{p.activa ? 'Desactivar' : 'Activar'}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
