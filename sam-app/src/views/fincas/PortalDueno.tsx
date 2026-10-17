import { useCallback, useEffect, useMemo, useState } from 'react'
import logoAgromorales from '../../assets/logo-agromorales.jpeg'
import { ThemeToggle } from '../../components/ThemeToggle'
import { PantallaSegura } from '../../components/PantallaSegura'
import {
  abrirSesionSinPin, cargarFincas, esSinSesion, guardarLlaveDueno, guardarLlavePersonal, leerLlavePersonal,
  mensajeDeError, type CargaFincas,
} from '../../services/fincasApi'
import { esFalloDeRed } from '../../lib/outboxInsumos'
import { hoyBogota } from '../../lib/periodos'
import { fmtFechaHora } from '../../lib/fechas'
import { FincaDetalle } from './FincaDetalle'
import type { CtxFincas } from './FincasView'
import { InstalarApp } from './InstalarApp'
import { AvisosFinca } from './AvisosFinca'
import {
  evidenciaDeLabor, hechosDeFinca, fmtCant, fmtPesosCorto, macroDueno, nombreLabor, VER_PLATA,
  type MacroFinca,
} from '../../lib/fincas'
import { prepararInstalacionDueno } from './llaveDueno'
import type { UserProfile } from '../../domain/sam'

/**
 * La vista del DUEÑO DE LA TIERRA: ve SOLO sus fincas, en solo lectura, con las
 * mismas cifras que usa ASM (no una versión preparada). Entra por dos caminos:
 *
 * - **Con su enlace personal** (22-sep-2026, `llave`): sin usuario ni PIN, una
 *   finca. Lo decide la base con la llave del enlace, no esta pantalla.
 * - **Con usuario y PIN** (17-oct-2026, `usuario`, rol `dueno_finca`): como otra
 *   vista de AgroMorales, segmentada por las fincas que administración le ligó
 *   (`af_finca_duenos`). Arranca con el TABLERO MACRO de su negocio —fincas,
 *   área, edad y ciclo de la caña, labores atrasadas, su cuenta— y de ahí baja a
 *   cada finca. Pedido de Iván: «una data macro de lo que es su negocio».
 */

type Estado = 'cargando' | 'listo' | 'cancelado' | 'sin-red'

/**
 * La visita anterior del dueño en ESTE celular, leída una sola vez por carga de la
 * app (y ahí mismo se anota la de ahora). Con eso se arma «novedades desde su
 * última visita». Módulo y no estado de React: en desarrollo React monta dos veces
 * y la segunda leería la hora que acaba de escribir la primera.
 */
const visitas = new Map<string, string | null>()
function visitaAnterior(clave: string): string | null {
  if (!visitas.has(clave)) {
    const k = `sam:af-visto:${clave.slice(0, 12)}`
    let antes: string | null = null
    try { antes = window.localStorage.getItem(k); window.localStorage.setItem(k, new Date().toISOString()) } catch { /* sin almacenamiento */ }
    visitas.set(clave, antes)
  }
  return visitas.get(clave) ?? null
}

/** Cada cuánto se trae lo último mientras la tiene abierta (y a la vista). */
const CADA_MS = 2 * 60 * 1000

export function PortalDueno({ llave, usuario, onSalir }: { llave?: string; usuario?: UserProfile; onSalir: () => void }) {
  const porUsuario = !!usuario
  const [token, setToken] = useState<string | null>(() => (usuario ? leerLlavePersonal(usuario.id) : llave ?? null))
  const [datos, setDatos] = useState<CargaFincas | null>(null)
  const [estado, setEstado] = useState<Estado>('cargando')
  const [motivo, setMotivo] = useState('')
  const [actualizado, setActualizado] = useState<string | null>(null)
  const [fincaSel, setFincaSel] = useState<string | null>(null)

  // Dueño con usuario y sin llave del módulo: se abre con su usuario (el PIN está
  // apagado «de momento»; si la base lo vuelve a exigir, App.tsx ya la abrió con el
  // PIN del ingreso). Si la base lo rechaza, se dice por qué.
  useEffect(() => {
    if (!usuario || token) return
    let vivo = true
    abrirSesionSinPin(usuario.id)
      .then((t) => { if (!vivo) return; guardarLlavePersonal(usuario.id, t); setToken(t) })
      .catch((e) => { if (!vivo) return; setMotivo(mensajeDeError(e)); setEstado(esFalloDeRed(e) ? 'sin-red' : 'cancelado') })
    return () => { vivo = false }
  }, [usuario, token])

  const recargar = useCallback(async () => {
    if (!token) return
    try {
      const d = await cargarFincas(token)
      setDatos(d); setEstado('listo'); setActualizado(new Date().toISOString())
    } catch (e) {
      if (esSinSesion(e)) {
        // Con usuario, la llave vencida se renueva sola; con enlace, se acabó.
        if (usuario) { guardarLlavePersonal(usuario.id, null); setToken(null) }
        else { guardarLlaveDueno(null); setDatos(null); setEstado('cancelado') }
      } else setEstado((s) => (s === 'listo' ? 'listo' : 'sin-red'))
    }
  }, [token, usuario])

  useEffect(() => {
    if (!token) return
    const traer = () => { void recargar() }
    traer()
    // Al volver a la app (la tenía en segundo plano) se trae lo último…
    const alVolver = () => { if (document.visibilityState === 'visible') traer() }
    document.addEventListener('visibilitychange', alVolver)
    // …y mientras la tiene abierta y a la vista, cada 2 minutos.
    const reloj = window.setInterval(() => {
      if (document.visibilityState === 'visible' && navigator.onLine) traer()
    }, CADA_MS)
    return () => { document.removeEventListener('visibilitychange', alVolver); window.clearInterval(reloj) }
  }, [recargar, token])

  const hoy = hoyBogota()
  const fincas = useMemo(() => datos?.fincas ?? [], [datos])
  // Enlace: su única finca. Usuario: la que escogió; con una sola, esa de una vez.
  const finca = porUsuario
    ? (fincas.find((f) => f.id === fincaSel) ?? (fincas.length === 1 ? fincas[0] : null))
    : (fincas[0] ?? null)
  const macro = useMemo(() => (porUsuario && datos ? macroDueno(datos, hoy) : null), [porUsuario, datos, hoy])

  // Novedades desde la última visita (lo que entró al sistema después), en todas sus fincas.
  const claveVisita = usuario ? `u:${usuario.id}` : (llave ?? '')
  const antes = useMemo(() => visitaAnterior(claveVisita), [claveVisita])
  const [novedadesVistas, setNovedadesVistas] = useState(false)
  const novedades = useMemo(() => {
    if (!datos || !antes) return []
    return fincas
      .flatMap((f) => hechosDeFinca(f.id, datos, (id) => datos.nombres[id] ?? 'AgroServicios Morales'))
      .filter((h) => h.registradoEn > antes)
  }, [datos, fincas, antes])
  const resaltar = useMemo(
    () => (novedadesVistas ? undefined : new Set(novedades.map((h) => h.suerteCodigo))),
    [novedades, novedadesVistas])
  // Con enlace: el ícono que instale lleva el nombre de SU finca (y en iPhone, su enlace).
  const nombreFinca = finca?.nombre ?? null
  useEffect(() => { if (!porUsuario && llave && nombreFinca) prepararInstalacionDueno(llave, nombreFinca) }, [porUsuario, llave, nombreFinca])

  const ctx: CtxFincas | null = datos && token ? {
    datos, recargar, token, usuario: usuario?.id ?? '', esAdmin: false, puedeReportar: false, modoDueno: true, resaltar,
    nombre: (id: string) => datos.nombres[id] ?? 'AgroServicios Morales',
    hoy, abrirFinca: (id: string) => setFincaSel(id), ir: () => {},
  } : null

  function salir() {
    if (porUsuario) { onSalir(); return }
    if (!window.confirm('¿Quitar la vista de la finca de este celular? Para volver a entrar necesitará el enlace otra vez.')) return
    guardarLlaveDueno(null)
    onSalir()
  }

  return (
    <main className="app-shell af af-portal">
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-info">
            <img src={logoAgromorales} alt="AgroMorales" className="header-logo" />
            <div>
              <strong>{porUsuario ? (finca && fincaSel ? finca.nombre : 'Sus fincas') : (finca ? finca.nombre : 'AgroMorales')}</strong>
              <span>{porUsuario ? `${usuario!.name} · AgroServicios Morales` : 'Su finca a la vista · AgroServicios Morales'}</span>
            </div>
          </div>
        </div>
        <div className="topbar-actions">
          <ThemeToggle />
          {porUsuario && <a className="inline-button" href="/manuales/manual-fincas.html" target="_blank" rel="noopener">📖 Manual</a>}
          {porUsuario && <button type="button" className="inline-button" onClick={salir}>Salir</button>}
        </div>
      </header>

      <section className="af-cuerpo">
        {!porUsuario && finca && estado === 'listo' && <InstalarApp nombreFinca={finca.nombre} />}
        {!porUsuario && llave && finca && estado === 'listo' && <AvisosFinca llave={llave} nombreFinca={finca.nombre} />}
        {!novedadesVistas && novedades.length > 0 && antes && (
          <div className="af-novedades" role="status">
            <div>
              <b>🆕 {novedades.length} novedad{novedades.length === 1 ? '' : 'es'} desde su última visita</b>
              <small> ({fmtFechaHora(antes)})</small>
              <ul>
                {novedades.slice(0, 6).map((h) => (
                  <li key={h.id}>
                    {nombreLabor(h.labor)} · suerte {h.suerteCodigo.replace(/^0+/, '')} · {fmtCant(h.cantidad)} {h.unidad}
                    {h.estado === 'por aceptar' ? ' (por aceptar)' : ''}
                  </li>
                ))}
                {novedades.length > 6 && <li>y {novedades.length - 6} más…</li>}
              </ul>
              <p>Las suertes con novedades están resaltadas en amarillo en el mapa.</p>
            </div>
            <button type="button" className="inline-button" onClick={() => setNovedadesVistas(true)}>Entendido</button>
          </div>
        )}

        {estado === 'cancelado' ? (
          <div className="af-card af-vacio">
            <h3>{porUsuario ? 'Su usuario todavía no tiene acceso a sus fincas' : 'Este enlace ya no está activo'}</h3>
            <p>{porUsuario ? `${motivo ? `${motivo}. ` : ''}Pídale a AgroServicios Morales que le asigne su finca.` : 'Pida uno nuevo a AgroServicios Morales.'}</p>
            <button type="button" className="inline-button" onClick={onSalir}>{porUsuario ? 'Salir' : 'Ir al inicio de la app'}</button>
          </div>
        ) : estado === 'sin-red' && !datos ? (
          <div className="af-card af-vacio">
            <h3>No hay conexión</h3>
            <p>La información de sus fincas se trae en vivo. Revise la señal e intente otra vez.</p>
            <button type="button" className="primary-button" onClick={() => { setEstado('cargando'); void recargar() }}>Intentar otra vez</button>
          </div>
        ) : !ctx ? (
          <p className="subtle-copy">Cargando sus fincas…</p>
        ) : porUsuario && fincas.length === 0 ? (
          <div className="af-card af-vacio">
            <h3>Todavía no tiene fincas asignadas</h3>
            <p>Su usuario está creado, pero AgroServicios Morales aún no le ha ligado ninguna finca. Apenas lo haga, las verá aquí.</p>
          </div>
        ) : (
          <>
            {macro && <TableroDueno macro={macro} sel={finca?.id ?? null} onAbrir={(id) => setFincaSel(id)} />}
            {finca ? (
              <PantallaSegura nombre="Su finca">
                <FincaDetalle ctx={ctx} fincaId={finca.id}
                              onVolver={() => setFincaSel(null)} onEditar={() => {}} />
              </PantallaSegura>
            ) : !porUsuario ? (
              <p className="subtle-copy">Este enlace no tiene una finca asignada.</p>
            ) : null}
          </>
        )}

        {datos && (
          <footer className="af-portal__pie">
            <p className="af-nota">
              Información en vivo: cada labor lleva {evidenciaDeLabor() ? `${evidenciaDeLabor()} y ` : ''}quién la aceptó; nada se borra.
              {actualizado ? ` Actualizado ${fmtFechaHora(actualizado)}.` : ''}
            </p>
            <div className="af-acciones">
              <button type="button" className="inline-button" onClick={() => void recargar()}>Actualizar</button>
              {!porUsuario && <button type="button" className="af-link" onClick={salir}>Quitar de este celular</button>}
            </div>
          </footer>
        )}
      </section>
    </main>
  )
}

/** La «data macro» del negocio del dueño: el total y una línea por finca. */
function TableroDueno({ macro, sel, onAbrir }: { macro: ReturnType<typeof macroDueno>; sel: string | null; onAbrir: (id: string) => void }) {
  const t = macro.total
  const linea = (m: MacroFinca) => [
    m.finca.municipio, `${m.suertes} suerte${m.suertes === 1 ? '' : 's'}`, `${fmtCant(m.areaHa)} ha`,
    m.edadMeses != null ? `caña de ${m.edadMeses} meses` : null,
    m.cicloMeses != null ? `corte a corte ${m.cicloMeses} meses` : null,
    m.tch != null ? `TCH ${m.tch}` : null,
    m.ultimoCorte ? `último corte ${m.ultimoCorte}` : null,
    `${m.laboresHechas} labor${m.laboresHechas === 1 ? '' : 'es'} hecha${m.laboresHechas === 1 ? '' : 's'}`,
    m.laboresEnCurso ? `${m.laboresEnCurso} en curso` : null,
    m.laboresTardias ? `⚠ ${m.laboresTardias} atrasada${m.laboresTardias === 1 ? '' : 's'}` : null,
    m.porAceptar ? `${m.porAceptar} por aceptar` : null,
    VER_PLATA && m.saldo != null ? `saldo ${fmtPesosCorto(m.saldo)}` : null,
  ].filter(Boolean).join(' · ')
  return (
    <div className="af-card af-card--ancha">
      <div className="af-cab af-cab--chica">
        <div><p className="eyebrow">Su negocio</p><h2>{t.fincas === 1 ? '1 finca' : `${t.fincas} fincas`} · {fmtCant(t.areaHa)} ha</h2></div>
      </div>
      <div className="af-ficha__datos">
        <div><b>{t.suertes}</b><span>suertes</span></div>
        <div><b>{fmtCant(t.areaHa)} ha</b><span>área total</span></div>
        <div><b>{t.edadMeses ?? '—'}</b><span>meses de edad de la caña</span></div>
        <div><b className={t.laboresTardias ? 'af-rojo' : ''}>{t.laboresTardias}</b><span>labores atrasadas</span></div>
        <div><b>{t.porAceptar}</b><span>reportes por aceptar</span></div>
        {VER_PLATA && t.saldo != null && <div><b>{fmtPesosCorto(t.saldo)}</b><span>saldo de su cuenta</span></div>}
      </div>
      <ul className="af-lista">
        {macro.fincas.map((m) => (
          <li key={m.finca.id} className="af-mov" style={sel === m.finca.id ? { outline: '2px solid #16a34a', borderRadius: 10 } : undefined}>
            <span className="af-foto af-foto--vacia">🌱</span>
            <span><b>{m.finca.nombre}</b><small>{linea(m)}</small></span>
            {macro.fincas.length > 1 && (
              <button type="button" className="inline-button" onClick={() => onAbrir(m.finca.id)}>{sel === m.finca.id ? 'Viendo' : 'Ver finca'}</button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
