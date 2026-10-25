import { useCallback, useEffect, useRef, useState } from 'react'
import logoAgromorales from '../../assets/logo-agromorales.jpeg'
import { useAppData } from '../../context/AppDataContext'
import { ThemeToggle } from '../../components/ThemeToggle'
import { PantallaSegura } from '../../components/PantallaSegura'
import {
  abrirSesionFincas, abrirSesionSinPin, cargarFincas, esPinRequerido, esSinSesion, guardarLlavePersonal,
  leerLlavePersonal, mensajeDeError, type CargaFincas,
} from '../../services/fincasApi'
import { hoyBogota } from '../../lib/periodos'
import { esRechazo, reportesPendientes, sincronizarReportes, EVENTO_PENDIENTES } from '../../lib/outboxFincas'
import { esFalloDeRed } from '../../lib/outboxInsumos'
import { guardarCargaFincas, leerCargaFincas, leerRechazosAtendidos } from '../../lib/cacheFincas'
import { rechazosPorAtender } from '../../lib/fincas'
import { fmtFechaHora } from '../../lib/fechas'
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
  /** Suertes con novedades desde la última visita del dueño: se resaltan en el mapa. */
  resaltar?: Set<string>
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
  // El supervisor (Julio) viene a REPORTAR: entra directo ahí (16-oct-2026). El
  // Inicio, con plata e indicadores, es para administración.
  const [tab, setTab] = useState<TabFincas>(() => (session?.role === 'supervisor' ? 'reportar' : 'inicio'))
  const [fincaSel, setFincaSel] = useState<string | null>(null)
  const [editando, setEditando] = useState<'nueva' | string | null>(null)
  // Reportes hechos sin señal que todavía no salen: se avisa en la pestaña,
  // porque quien los registró tiene que saber que aún no han llegado.
  const [porEnviar, setPorEnviar] = useState(0)
  // Los que el servidor rechazó estando en la cola: no salen solos.
  const [noSalieron, setNoSalieron] = useState(0)
  const [atendidos, setAtendidos] = useState<Set<string>>(() => (session ? leerRechazosAtendidos(session.id) : new Set()))
  // ¿Hay que pedir el PIN? Solo si la base lo exige (hoy está apagado «de momento»).
  const [pedirPin, setPedirPin] = useState(false)
  // 🔴 SIN SEÑAL (16-oct-2026): se trabaja con la última carga guardada en el
  // celular (`lib/cacheFincas`) y la pantalla lo dice. Antes, abrir Fincas sin
  // cobertura dejaba «Cargando fincas…» para siempre y no se podía reportar.
  const [sinSenal, setSinSenal] = useState(false)
  const [guardadaEn, setGuardadaEn] = useState<string | null>(null)
  // Sin llave y sin señal (la de 30 días venció): se espera la señal, no el PIN.
  const [esperandoSenal, setEsperandoSenal] = useState(false)
  const frescos = useRef(false)

  // Mientras llega la carga en vivo, la guardada (si la hay) ya sirve.
  useEffect(() => {
    if (!session) return
    let vivo = true
    void leerCargaFincas(session.id).then((g) => {
      if (!vivo || !g || frescos.current) return
      setDatos((prev) => prev ?? g.datos)
      setGuardadaEn(g.guardadaEn)
      setCargando(false)
    })
    return () => { vivo = false }
  }, [session])

  const recargar = useCallback(async () => {
    if (!token || !session) { setCargando(false); return }
    try {
      const d = await cargarFincas(token)
      frescos.current = true
      setDatos(d); setSinSenal(false); setGuardadaEn(null)
      void guardarCargaFincas(session.id, d)
    } catch (e) {
      if (esSinSesion(e)) { guardarLlavePersonal(session.id, null); setToken(null); setDatos(null) }
      else if (esFalloDeRed(e)) {
        // Sin señal: se sigue con lo que hay (en memoria o guardado), sin alarma roja.
        setSinSenal(true)
        if (!frescos.current) {
          const g = await leerCargaFincas(session.id)
          if (g) { setDatos((prev) => prev ?? g.datos); setGuardadaEn(g.guardadaEn) }
          else setError('Sin señal, y este celular todavía no tiene las fincas guardadas: ábralas una vez con señal.')
        }
      }
      else setError(`No se pudieron cargar las fincas. ${mensajeDeError(e)}`)
    } finally { setCargando(false) }
  }, [token, session, setError])
  useEffect(() => { void recargar() }, [recargar])

  // Sin llave: primero se intenta entrar sin PIN (lo permite la base mientras el
  // PIN esté apagado). Si la base lo vuelve a exigir, se pide como antes. Sin
  // señal NO se pide el PIN (tampoco serviría): se espera a que vuelva.
  useEffect(() => {
    if (token || !session || pedirPin || esperandoSenal) return
    let vivo = true
    abrirSesionSinPin(session.id)
      .then((t) => { if (!vivo) return; guardarLlavePersonal(session.id, t); setCargando(true); setToken(t) })
      .catch((e) => {
        if (!vivo) return
        if (esFalloDeRed(e)) setEsperandoSenal(true)
        else if (esPinRequerido(e)) setPedirPin(true)
        else { setPedirPin(true); setError(mensajeDeError(e)) }
      })
    return () => { vivo = false }
  }, [token, session, pedirPin, esperandoSenal, setError])

  // 🔴 Lo pendiente sale SOLO al abrir Fincas con señal, no únicamente cuando el
  // celular cambia de estado: el caso normal es reportar en el campo sin
  // cobertura y abrir la app al llegar a donde sí hay. Si solo se enviara con el
  // evento «volvió la señal», el reporte se quedaría esperando sin que nadie lo
  // supiera.
  useEffect(() => {
    const contar = () => {
      void reportesPendientes().then((p) => {
        setPorEnviar(p.filter((x) => !esRechazo(x)).length)
        setNoSalieron(p.filter((x) => esRechazo(x)).length)
      })
      if (session) setAtendidos(leerRechazosAtendidos(session.id))
    }
    const intentar = () => {
      void (async () => {
        const p = await reportesPendientes()
        if (p.length > 0 && navigator.onLine && (await sincronizarReportes()) > 0) await recargar()
        contar()
      })()
    }
    // Volvió la señal: sale lo pendiente y se trae lo último, aunque no hubiera
    // nada en cola (la pantalla venía de la copia guardada).
    const alVolver = () => {
      setEsperandoSenal(false)
      void (async () => {
        if ((await reportesPendientes()).length > 0) await sincronizarReportes()
        await recargar()
        contar()
      })()
    }
    intentar()
    window.addEventListener(EVENTO_PENDIENTES, contar)
    window.addEventListener('online', alVolver)
    return () => {
      window.removeEventListener(EVENTO_PENDIENTES, contar)
      window.removeEventListener('online', alVolver)
    }
  }, [recargar, session])

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
  // Lo que Julio tiene que corregir: lo rechazado en la cola + lo que le rechazaron.
  const porCorregir = noSalieron + (datos ? rechazosPorAtender(datos, session.id, atendidos).length : 0)
  const TABS: { id: TabFincas; label: string; solo?: boolean }[] = [
    { id: 'inicio', label: 'Inicio' },
    { id: 'fincas', label: 'Fincas' },
    { id: 'aceptar', label: porAceptar ? `Por aceptar (${porAceptar})` : 'Por aceptar' },
    { id: 'reportar', label: `Reportar labor${porEnviar ? ` · ${porEnviar} por enviar` : ''}${porCorregir ? ` · ⚠ ${porCorregir} por corregir` : ''}` },
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
          <a className="inline-button" href="/manuales/manual-fincas.html" target="_blank" rel="noopener" aria-label="Manual" title="Manual">📖 <span className="af-texto-manual">Manual</span></a>
          <button type="button" className="inline-button" onClick={onLogout}>Salir</button>
        </div>
      </header>

      {token && (
        <nav className="af-nav" aria-label="Secciones de fincas">
          {TABS.filter((t) => !t.solo || esAdmin).map((t) => (
            <button key={t.id} type="button" aria-pressed={tab === t.id}
                    className={(t.id === 'aceptar' && porAceptar) || (t.id === 'reportar' && (porEnviar || porCorregir)) ? 'af-nav__pend' : ''}
                    onClick={() => ctx?.ir(t.id)}>
              {t.label}
            </button>
          ))}
        </nav>
      )}

      {error && <div className="sync-error-banner" role="alert"><span>{error}</span></div>}
      {info && <div className="af-info" role="status">{info}</div>}
      {sinSenal && token && datos && (
        <div className="af-info" role="status">
          📵 Sin señal: está viendo {guardadaEn ? `los datos guardados el ${fmtFechaHora(guardadaEn)}` : 'los datos de cuando hubo señal'}.
          Lo que reporte queda guardado en el celular y sale solo cuando vuelva la señal.
        </div>
      )}

      <section className="af-cuerpo">
        {!token && esperandoSenal ? (
          <p className="subtle-copy">📵 Sin señal. Para entrar a Fincas hace falta señal esta vez (su acceso de 30 días se renueva). Apenas haya cobertura, se abre solo.</p>
        ) : !token && !pedirPin ? <p className="subtle-copy">Entrando a Fincas…</p> : !token ? (
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
