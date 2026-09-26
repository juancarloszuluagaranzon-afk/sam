import { useCallback, useEffect, useMemo, useState } from 'react'
import logoAgromorales from '../../assets/logo-agromorales.jpeg'
import { ThemeToggle } from '../../components/ThemeToggle'
import { PantallaSegura } from '../../components/PantallaSegura'
import { cargarFincas, esSinSesion, guardarLlaveDueno, type CargaFincas } from '../../services/fincasApi'
import { hoyBogota } from '../../lib/periodos'
import { fmtFechaHora } from '../../lib/fechas'
import { FincaDetalle } from './FincaDetalle'
import type { CtxFincas } from './FincasView'
import { InstalarApp } from './InstalarApp'
import { AvisosFinca } from './AvisosFinca'
import { hechosDeFinca, fmtCant, nombreLabor } from '../../lib/fincas'
import { prepararInstalacionDueno } from './llaveDueno'

/**
 * La vista del DUEÑO DE LA TIERRA (22-sep-2026): entra con su enlace personal,
 * sin usuario ni PIN, y ve SOLO su finca — lo decide la base con la llave del
 * enlace, no esta pantalla. Es la misma «Lo que ve el dueño» de la administración,
 * en solo lectura: las mismas cifras que usa ASM, no una versión preparada.
 */

type Estado = 'cargando' | 'listo' | 'cancelado' | 'sin-red'

/**
 * La visita anterior del dueño en ESTE celular, leída una sola vez por carga de la
 * app (y ahí mismo se anota la de ahora). Con eso se arma «novedades desde su
 * última visita». Módulo y no estado de React: en desarrollo React monta dos veces
 * y la segunda leería la hora que acaba de escribir la primera.
 */
const visitas = new Map<string, string | null>()
function visitaAnterior(llave: string): string | null {
  if (!visitas.has(llave)) {
    const clave = `sam:af-visto:${llave.slice(0, 12)}`
    let antes: string | null = null
    try { antes = window.localStorage.getItem(clave); window.localStorage.setItem(clave, new Date().toISOString()) } catch { /* sin almacenamiento */ }
    visitas.set(llave, antes)
  }
  return visitas.get(llave) ?? null
}

/** Cada cuánto se trae lo último mientras la tiene abierta (y a la vista). */
const CADA_MS = 2 * 60 * 1000

export function PortalDueno({ llave, onSalir }: { llave: string; onSalir: () => void }) {
  const [datos, setDatos] = useState<CargaFincas | null>(null)
  const [estado, setEstado] = useState<Estado>('cargando')
  const [actualizado, setActualizado] = useState<string | null>(null)

  const recargar = useCallback(async () => {
    try {
      const d = await cargarFincas(llave)
      setDatos(d); setEstado('listo'); setActualizado(new Date().toISOString())
    } catch (e) {
      if (esSinSesion(e)) { guardarLlaveDueno(null); setDatos(null); setEstado('cancelado') }
      else setEstado((s) => (s === 'listo' ? 'listo' : 'sin-red'))
    }
  }, [llave])

  useEffect(() => {
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
  }, [recargar])

  // Novedades desde la última visita (lo que entró al sistema después).
  const antes = useMemo(() => visitaAnterior(llave), [llave])
  const [novedadesVistas, setNovedadesVistas] = useState(false)

  const finca = datos?.fincas[0] ?? null
  const novedades = useMemo(() => {
    if (!datos || !finca || !antes) return []
    return hechosDeFinca(finca.id, datos, (id) => datos.nombres[id] ?? 'AgroServicios Morales')
      .filter((h) => h.registradoEn > antes)
  }, [datos, finca, antes])
  const resaltar = useMemo(
    () => (novedadesVistas ? undefined : new Set(novedades.map((h) => h.suerteCodigo))),
    [novedades, novedadesVistas])
  // El ícono que ella instale lleva el nombre de SU finca (y en iPhone, su enlace).
  const nombreFinca = finca?.nombre ?? null
  useEffect(() => { if (nombreFinca) prepararInstalacionDueno(llave, nombreFinca) }, [llave, nombreFinca])
  const ctx: CtxFincas | null = datos && finca ? {
    datos, recargar, token: llave, usuario: '', esAdmin: false, puedeReportar: false, modoDueno: true, resaltar,
    nombre: (id: string) => datos.nombres[id] ?? 'AgroServicios Morales',
    hoy: hoyBogota(), abrirFinca: () => {}, ir: () => {},
  } : null

  function salir() {
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
              <strong>{finca ? finca.nombre : 'AgroMorales'}</strong>
              <span>Su finca a la vista · AgroServicios Morales</span>
            </div>
          </div>
        </div>
        <div className="topbar-actions">
          <ThemeToggle />
        </div>
      </header>

      <section className="af-cuerpo">
        {finca && estado === 'listo' && <InstalarApp nombreFinca={finca.nombre} />}
        {finca && estado === 'listo' && <AvisosFinca llave={llave} nombreFinca={finca.nombre} />}
        {finca && !novedadesVistas && novedades.length > 0 && antes && (
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
            <h3>Este enlace ya no está activo</h3>
            <p>Pida uno nuevo a AgroServicios Morales.</p>
            <button type="button" className="inline-button" onClick={onSalir}>Ir al inicio de la app</button>
          </div>
        ) : estado === 'sin-red' && !datos ? (
          <div className="af-card af-vacio">
            <h3>No hay conexión</h3>
            <p>La información de su finca se trae en vivo. Revise la señal e intente otra vez.</p>
            <button type="button" className="primary-button" onClick={() => { setEstado('cargando'); void recargar() }}>Intentar otra vez</button>
          </div>
        ) : !ctx ? (
          <p className="subtle-copy">{estado === 'listo' ? 'Este enlace no tiene una finca asignada.' : 'Cargando su finca…'}</p>
        ) : (
          <PantallaSegura nombre="Su finca">
            <FincaDetalle ctx={ctx} fincaId={finca!.id} onVolver={() => {}} onEditar={() => {}} />
          </PantallaSegura>
        )}

        {datos && (
          <footer className="af-portal__pie">
            <p className="af-nota">
              Información en vivo: cada labor lleva su foto, su ubicación y quién la aceptó; nada se borra.
              {actualizado ? ` Actualizado ${fmtFechaHora(actualizado)}.` : ''}
            </p>
            <div className="af-acciones">
              <button type="button" className="inline-button" onClick={() => void recargar()}>Actualizar</button>
              <button type="button" className="af-link" onClick={salir}>Quitar de este celular</button>
            </div>
          </footer>
        )}
      </section>
    </main>
  )
}
