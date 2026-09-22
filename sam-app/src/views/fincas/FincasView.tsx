import { useCallback, useEffect, useState } from 'react'
import logoAgromorales from '../../assets/logo-agromorales.jpeg'
import { useAppData } from '../../context/AppDataContext'
import { ThemeToggle } from '../../components/ThemeToggle'
import { PantallaSegura } from '../../components/PantallaSegura'
import {
  abrirSesionFincas, cargarFincas, esSinSesion, guardarLlavePersonal, leerLlavePersonal, mensajeDeError,
  type CargaFincas,
} from '../../services/fincasApi'
import { hoyBogota } from '../../lib/periodos'
import { FincasInicio } from './FincasInicio'
import { FincaDetalle } from './FincaDetalle'
import { ReportarLabor } from './ReportarLabor'
import { PorAceptar } from './PorAceptar'
import { FincaForm } from './FincaForm'
import { PaqueteLabores } from './PaqueteLabores'

/**
 * Administración de fincas de caña — el SEGUNDO inicio de la app de ASM
 * (MVP, 22-sep-2026). El primero es el de la maquinaria; los dos se cambian con
 * el selector de arriba (`ModoSwitch`, en App.tsx).
 *
 * Todo el módulo trabaja sobre UNA carga de los datos (`cargarFincas`): el Inicio,
 * la finca y la cuenta salen de la misma foto y no se contradicen. Después de
 * cada acción se recarga completo — son pocas fincas y así nada queda a medias.
 *
 * 🔴 Entra con una LLAVE propia del módulo (30 días), que se saca con el PIN. Se
 * abre sola al iniciar sesión (App.tsx); si no hay o venció, se pide el PIN aquí.
 */

export type TabFincas = 'inicio' | 'fincas' | 'aceptar' | 'reportar' | 'paquete'

export interface CtxFincas {
  datos: CargaFincas
  recargar: () => Promise<void>
  /** La llave con la que la base reconoce a quien está usando la pantalla. */
  token: string
  usuario: string
  esAdmin: boolean
  puedeReportar: boolean
  /** La vista del dueño de la tierra: solo lectura, sin nada de la administración. */
  modoDueno: boolean
  nombre: (id: string) => string
  hoy: string
  abrirFinca: (id: string) => void
  ir: (t: TabFincas) => void
}

export function FincasView({ onLogout }: { onLogout: () => void }) {
  const { session, users, error, info, setError } = useAppData()
  const [token, setToken] = useState<string | null>(() => (session ? leerLlavePersonal(session.id) : null))
  const [datos, setDatos] = useState<CargaFincas | null>(null)
  const [cargando, setCargando] = useState(true)
  const [tab, setTab] = useState<TabFincas>('inicio')
  const [fincaSel, setFincaSel] = useState<string | null>(null)
  const [editando, setEditando] = useState<'nueva' | string | null>(null)

  const recargar = useCallback(async () => {
    if (!token || !session) { setCargando(false); return }
    try {
      setDatos(await cargarFincas(token))
    } catch (e) {
      if (esSinSesion(e)) { guardarLlavePersonal(session.id, null); setToken(null); setDatos(null) }
      else setError(`No se pudieron cargar las fincas. ${mensajeDeError(e)}`)
    } finally { setCargando(false) }
  }, [token, session, setError])
  useEffect(() => { void recargar() }, [recargar])

  if (!session) return null

  const esAdmin = session.role === 'owner' || session.role === 'administracion'
  const nombresUsuarios = new Map(users.map((u) => [u.id, u.name]))
  const ctx: CtxFincas | null = datos && token ? {
    datos, recargar, token, usuario: session.id, esAdmin,
    puedeReportar: esAdmin || session.role === 'supervisor',
    modoDueno: false,
    nombre: (id: string) => nombresUsuarios.get(id) ?? datos.nombres[id] ?? id,
    hoy: hoyBogota(),
    abrirFinca: (id: string) => { setFincaSel(id); setTab('fincas') },
    ir: (t: TabFincas) => { setTab(t); if (t !== 'fincas') setFincaSel(null) },
  } : null

  const porAceptar = datos?.reportes.filter((r) => r.estado === 'PENDIENTE').length ?? 0
  const TABS: { id: TabFincas; label: string; solo?: boolean }[] = [
    { id: 'inicio', label: 'Inicio' },
    { id: 'fincas', label: 'Fincas' },
    { id: 'aceptar', label: porAceptar ? `Por aceptar (${porAceptar})` : 'Por aceptar' },
    { id: 'reportar', label: 'Reportar labor' },
    { id: 'paquete', label: 'Paquete de labores', solo: true },
  ]

  return (
    <main className="app-shell af">
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-info">
            <img src={logoAgromorales} alt="AgroMorales" className="header-logo" />
            <div>
              <strong>AgroMorales</strong>
              <span>Administración de fincas</span>
            </div>
          </div>
        </div>
        <div className="topbar-actions">
          <ThemeToggle />
          {/* Pestaña aparte: se puede ir leyendo el manual y mirando la pantalla real. */}
          <a className="inline-button" href="/manuales/manual-fincas.html" target="_blank" rel="noopener">📖 Manual</a>
          <button type="button" className="inline-button" onClick={onLogout}>Salir</button>
        </div>
      </header>

      {token && (
        <nav className="af-nav" aria-label="Secciones de fincas">
          {TABS.filter((t) => !t.solo || esAdmin).map((t) => (
            <button key={t.id} type="button" aria-pressed={tab === t.id}
                    className={t.id === 'aceptar' && porAceptar ? 'af-nav__pend' : ''}
                    onClick={() => ctx?.ir(t.id)}>
              {t.label}
            </button>
          ))}
        </nav>
      )}

      {error && <div className="sync-error-banner" role="alert"><span>{error}</span></div>}
      {info && <div className="af-info" role="status">{info}</div>}

      <section className="af-cuerpo">
        {!token ? (
          <ConfirmarPin usuario={session.id} nombre={session.name}
                        onListo={(t) => { guardarLlavePersonal(session.id, t); setCargando(true); setToken(t) }} />
        ) : cargando || !ctx ? <p className="subtle-copy">Cargando fincas…</p> : (
          <PantallaSegura nombre="Administración de fincas">
            {editando ? (
              <FincaForm ctx={ctx} fincaId={editando === 'nueva' ? null : editando}
                         onListo={(id) => { setEditando(null); if (id) { setFincaSel(id); setTab('fincas') } }} />
            ) : tab === 'inicio' ? (
              <FincasInicio ctx={ctx} onNueva={() => setEditando('nueva')} />
            ) : tab === 'fincas' && fincaSel ? (
              <FincaDetalle ctx={ctx} fincaId={fincaSel} onVolver={() => setFincaSel(null)} onEditar={() => setEditando(fincaSel)} />
            ) : tab === 'fincas' ? (
              <FincasInicio ctx={ctx} soloLista onNueva={() => setEditando('nueva')} />
            ) : tab === 'aceptar' ? (
              <PorAceptar ctx={ctx} />
            ) : tab === 'reportar' ? (
              <ReportarLabor ctx={ctx} />
            ) : (
              <PaqueteLabores ctx={ctx} />
            )}
          </PantallaSegura>
        )}
      </section>
    </main>
  )
}

/**
 * Sin llave (primera vez con esta versión, o pasaron los 30 días): se confirma el
 * PIN. La base cuenta los intentos: 5 errados en 15 minutos y se bloquea un rato.
 */
function ConfirmarPin({ usuario, nombre, onListo }: { usuario: string; nombre: string; onListo: (token: string) => void }) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [ocupado, setOcupado] = useState(false)

  async function entrar() {
    setOcupado(true); setError('')
    try {
      const t = await abrirSesionFincas(usuario, pin)
      if (t) onListo(t)
      else { setError('El PIN no coincide.'); setPin('') }
    } catch (e) {
      const m = (e as Error).message ?? ''
      setError(m.startsWith('BLOQUEADO') || m.startsWith('SIN_PERMISO') ? mensajeDeError(e)
        : 'No se pudo contactar al servidor. Revise la conexión e intente otra vez.')
    } finally { setOcupado(false) }
  }

  return (
    <form className="af-card af-pin" onSubmit={(e) => { e.preventDefault(); if (pin.length >= 4 && !ocupado) void entrar() }}>
      <h3>Confirme su PIN para entrar a Fincas</h3>
      <p className="af-nota">{nombre}: el módulo de fincas tiene su propia llave, porque ahí está la plata de los dueños. Se pide una vez cada 30 días en este celular.</p>
      <label>PIN
        <input id="af-pin" type="password" inputMode="numeric" autoComplete="current-password" maxLength={8}
               value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} autoFocus />
      </label>
      {error && <p className="feedback error">{error}</p>}
      <div className="af-acciones">
        <button type="submit" className="primary-button" disabled={pin.length < 4 || ocupado}>{ocupado ? 'Verificando…' : 'Entrar'}</button>
      </div>
    </form>
  )
}

export default FincasView
