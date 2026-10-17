import { useState } from 'react'
import type { CtxFincas } from './FincasView'
import {
  asignarDuenoFinca, crearAccesoDueno, enlaceDueno, mensajeDeError, quitarDuenoFinca, revocarAccesoDueno, type Finca,
} from '../../services/fincasApi'
import { fmtFechaHora } from '../../lib/fechas'
import { evidenciaDeLabor, VER_PLATA } from '../../lib/fincas'
import { useAppData } from '../../context/AppDataContext'
import { SearchableSelect } from '../../components/SearchableSelect'

/**
 * El acceso del dueño de la tierra (solo administración). Dos caminos que conviven:
 *
 * 1. **Usuario y PIN** (17-oct-2026): se crea el usuario con rol «Dueño de finca»
 *    (Más → Usuarios) y aquí se le liga la finca. Entra como cualquiera y ve solo
 *    sus fincas, con el tablero macro de su negocio. Es el camino nuevo.
 * 2. **Enlace personal** (22-sep-2026): sin usuario ni PIN, una finca. 🔴 El enlace
 *    se muestra UNA vez: la base guarda solo su huella. Si se pierde o se reenvió,
 *    se quita y se crea otro. Cada vez que el dueño lo abre queda registrado.
 */
export function AccesoDueno({ ctx, finca }: { ctx: CtxFincas; finca: Finca }) {
  const { users } = useAppData()
  const accesos = ctx.datos.accesos.filter((a) => a.fincaId === finca.id)
  const activos = accesos.filter((a) => !a.revocadoEn)
  const cancelados = accesos.length - activos.length
  const duenos = ctx.datos.duenos.filter((d) => d.fincaId === finca.id)
  const candidatos = users
    .filter((u) => u.role === 'dueno_finca' && u.active !== false && !duenos.some((d) => d.usuarioId === u.id))
    .sort((a, b) => a.name.localeCompare(b.name))
  const [usuarioSel, setUsuarioSel] = useState('')
  const [nombre, setNombre] = useState(finca.duenoNombre)
  const [nuevo, setNuevo] = useState<string | null>(null)
  const [copiado, setCopiado] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState('')

  async function hacer(fn: () => Promise<void>) {
    setOcupado(true); setError('')
    try { await fn(); await ctx.recargar() } catch (e) { setError(mensajeDeError(e)) } finally { setOcupado(false) }
  }

  async function crear() {
    setOcupado(true); setError(''); setCopiado(false)
    try {
      setNuevo(enlaceDueno(await crearAccesoDueno(finca.id, nombre.trim() || finca.duenoNombre, ctx.token)))
      await ctx.recargar()
    } catch (e) { setError(mensajeDeError(e)) } finally { setOcupado(false) }
  }

  async function copiar(texto: string) {
    try { await navigator.clipboard.writeText(texto); setCopiado(true) } catch { setCopiado(false); window.prompt('Copie el enlace:', texto) }
  }

  const tel = (finca.duenoTelefono ?? '').replace(/\D/g, '')
  const mensaje = nuevo ? `Hola ${nombre.trim() || finca.duenoNombre}. Este es su acceso directo a la finca ${finca.nombre}, administrada por AgroServicios Morales:\n${nuevo}\n\nAhí ve en todo momento el mapa de su finca y las labores${evidenciaDeLabor() ? ` con ${evidenciaDeLabor()}` : ''}${VER_PLATA ? ', el presupuesto y su cuenta' : ''}. Es personal: no lo reenvíe.` : ''
  const whatsapp = nuevo ? `https://wa.me/${tel ? (tel.length === 10 ? `57${tel}` : tel) : ''}?text=${encodeURIComponent(mensaje)}` : null

  return (
    <div className="af-card af-card--ancha af-acceso">
      <h3>Acceso del dueño</h3>

      {/* ── Camino 1: usuario y PIN ── */}
      <p className="af-nota" style={{ marginTop: 0 }}>
        <b>Con usuario y PIN:</b> el dueño entra como cualquiera y ve solo sus fincas, con el resumen de su negocio.
        El usuario se crea en <b>Más → Usuarios</b> con el rol «Dueño de finca»; aquí se le liga esta finca.
      </p>
      {duenos.length > 0 && (
        <ul className="af-lista">
          {duenos.map((d) => (
            <li key={d.usuarioId} className="af-mov">
              <span className="af-foto af-foto--vacia">👤</span>
              <span>
                <b>{d.nombre}</b>
                <small>usuario {d.usuarioId}{d.activo ? '' : ' · INACTIVO'}{d.creadoEn ? ` · ligado ${fmtFechaHora(d.creadoEn)}` : ''}</small>
              </span>
              <button type="button" className="af-link" disabled={ocupado}
                      onClick={() => { if (window.confirm(`¿Quitarle la finca ${finca.nombre} a ${d.nombre}? Deja de verla al instante.`)) void hacer(() => quitarDuenoFinca(finca.id, d.usuarioId, ctx.token)) }}>
                Quitar
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="af-mini-form">
        <label>Ligar un usuario dueño
          {candidatos.length === 0 ? (
            <small className="af-nota">No hay usuarios con rol «Dueño de finca» sin ligar. Créelo en Más → Usuarios.</small>
          ) : (
            <SearchableSelect value={usuarioSel} onChange={setUsuarioSel}
                              options={candidatos.map((u) => ({ value: u.id, label: `${u.name} (${u.id})` }))} />
          )}
        </label>
        {candidatos.length > 0 && (
          <div className="af-acciones">
            <button type="button" className="primary-button" disabled={ocupado || !usuarioSel}
                    onClick={() => void hacer(async () => { await asignarDuenoFinca(finca.id, usuarioSel, ctx.token); setUsuarioSel('') })}>
              Ligar a esta finca
            </button>
          </div>
        )}
      </div>

      {/* ── Camino 2: enlace personal ── */}
      <h3 style={{ marginTop: 16 }}>Enlace personal (sin usuario)</h3>
      <p className="af-nota" style={{ marginTop: 0 }}>
        Con su enlace el dueño ve esta misma página desde su celular, sin usuario ni PIN, y SOLO esta finca.
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
            <button type="button" className="inline-button" disabled={ocupado} onClick={() => void crear()}>
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
              <button type="button" className="af-link" disabled={ocupado}
                      onClick={() => { if (window.confirm(`¿Quitar el acceso de ${a.nombre}? El enlace deja de abrir de inmediato.`)) void hacer(() => revocarAccesoDueno(a.id, ctx.token)) }}>
                Quitar acceso
              </button>
            </li>
          ))}
        </ul>
      )}
      {cancelados > 0 && <p className="af-nota">{cancelados} enlace{cancelados === 1 ? '' : 's'} anterior{cancelados === 1 ? '' : 'es'} cancelado{cancelados === 1 ? '' : 's'}: ya no abre{cancelados === 1 ? '' : 'n'}.</p>}
      <p className="af-nota">Si el enlace se reenvió o el dueño perdió el celular, quite el acceso y cree uno nuevo.</p>
    </div>
  )
}
