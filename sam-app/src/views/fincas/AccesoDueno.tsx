import { useState } from 'react'
import type { CtxFincas } from './FincasView'
import { crearAccesoDueno, enlaceDueno, mensajeDeError, revocarAccesoDueno, type Finca } from '../../services/fincasApi'
import { fmtFechaHora } from '../../lib/fechas'

/**
 * El acceso directo del dueño de la tierra (solo administración).
 *
 * 🔴 El enlace se muestra UNA vez: la base guarda solo su huella, así que ni
 * soporte ni nadie lo puede volver a leer. Si se pierde o se reenvió, se quita
 * y se crea otro. Cada vez que el dueño lo abre queda registrado.
 */
export function AccesoDueno({ ctx, finca }: { ctx: CtxFincas; finca: Finca }) {
  const accesos = ctx.datos.accesos.filter((a) => a.fincaId === finca.id)
  const activos = accesos.filter((a) => !a.revocadoEn)
  const cancelados = accesos.length - activos.length
  const [nombre, setNombre] = useState(finca.duenoNombre)
  const [nuevo, setNuevo] = useState<string | null>(null)
  const [copiado, setCopiado] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState('')

  async function crear() {
    setOcupado(true); setError(''); setCopiado(false)
    try {
      setNuevo(enlaceDueno(await crearAccesoDueno(finca.id, nombre.trim() || finca.duenoNombre, ctx.token)))
      await ctx.recargar()
    } catch (e) { setError(mensajeDeError(e)) } finally { setOcupado(false) }
  }

  async function quitar(id: string, quien: string) {
    if (!window.confirm(`¿Quitar el acceso de ${quien}? El enlace deja de abrir de inmediato.`)) return
    setOcupado(true); setError('')
    try { await revocarAccesoDueno(id, ctx.token); await ctx.recargar() } catch (e) { setError(mensajeDeError(e)) } finally { setOcupado(false) }
  }

  async function copiar(texto: string) {
    try { await navigator.clipboard.writeText(texto); setCopiado(true) } catch { setCopiado(false); window.prompt('Copie el enlace:', texto) }
  }

  const tel = (finca.duenoTelefono ?? '').replace(/\D/g, '')
  const mensaje = nuevo ? `Hola ${nombre.trim() || finca.duenoNombre}. Este es su acceso directo a la finca ${finca.nombre}, administrada por AgroServicios Morales:\n${nuevo}\n\nAhí ve en todo momento las labores con su foto y ubicación, el presupuesto y su cuenta. Es personal: no lo reenvíe.` : ''
  const whatsapp = nuevo ? `https://wa.me/${tel ? (tel.length === 10 ? `57${tel}` : tel) : ''}?text=${encodeURIComponent(mensaje)}` : null

  return (
    <div className="af-card af-card--ancha af-acceso">
      <h3>Acceso directo del dueño</h3>
      <p className="af-nota" style={{ marginTop: 0 }}>
        Con su enlace personal el dueño ve esta misma página desde su celular, sin usuario ni PIN, y SOLO su finca.
      </p>

      {nuevo ? (
        <div className="af-enlace">
          <p><b>Enlace creado.</b> Envíelo ya: por seguridad no se vuelve a mostrar.</p>
          <input id="af-enlace-nuevo" readOnly value={nuevo} onFocus={(e) => e.currentTarget.select()} />
          <div className="af-acciones">
            {whatsapp && <a className="primary-button" href={whatsapp} target="_blank" rel="noreferrer">Enviar por WhatsApp</a>}
            <button type="button" className="inline-button" onClick={() => void copiar(nuevo)}>{copiado ? '✓ Copiado' : 'Copiar enlace'}</button>
            <button type="button" className="af-link" onClick={() => setNuevo(null)}>Listo</button>
          </div>
        </div>
      ) : (
        <div className="af-mini-form">
          <label>Para quién es el enlace
            <input id="af-acceso-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre del dueño o socio" />
          </label>
          <div className="af-acciones">
            <button type="button" className="primary-button" disabled={ocupado} onClick={() => void crear()}>
              {activos.length ? 'Crear otro enlace' : 'Crear enlace para el dueño'}
            </button>
          </div>
        </div>
      )}
      {error && <p className="feedback error">{error}</p>}

      {activos.length > 0 && (
        <ul className="af-lista">
          {activos.map((a) => (
            <li key={a.id} className="af-mov">
              <span className="af-foto af-foto--vacia">🔑</span>
              <span>
                <b>{a.nombre}</b>
                <small>
                  Creado {fmtFechaHora(a.creadoEn)} por {ctx.nombre(a.creadoPor)} · {a.usos > 0 && a.ultimoUso
                    ? `lo ha abierto ${a.usos} ${a.usos === 1 ? 'vez' : 'veces'}, la última ${fmtFechaHora(a.ultimoUso)}`
                    : 'todavía no lo ha abierto'}
                </small>
              </span>
              <button type="button" className="af-link" disabled={ocupado} onClick={() => void quitar(a.id, a.nombre)}>Quitar acceso</button>
            </li>
          ))}
        </ul>
      )}
      {cancelados > 0 && <p className="af-nota">{cancelados} enlace{cancelados === 1 ? '' : 's'} anterior{cancelados === 1 ? '' : 'es'} cancelado{cancelados === 1 ? '' : 's'}: ya no abre{cancelados === 1 ? '' : 'n'}.</p>}
      <p className="af-nota">Si el enlace se reenvió o el dueño perdió el celular, quite el acceso y cree uno nuevo.</p>
    </div>
  )
}
