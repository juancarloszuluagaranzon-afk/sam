import { useCallback, useEffect, useState } from 'react'
import logoAgromorales from '../../assets/logo-agromorales.jpeg'
import { ThemeToggle } from '../../components/ThemeToggle'
import { PantallaSegura } from '../../components/PantallaSegura'
import { cargarFincas, esSinSesion, guardarLlaveDueno, type CargaFincas } from '../../services/fincasApi'
import { hoyBogota } from '../../lib/periodos'
import { fmtFechaHora } from '../../lib/fechas'
import { FincaDetalle } from './FincaDetalle'
import type { CtxFincas } from './FincasView'

/**
 * La vista del DUEÑO DE LA TIERRA (22-sep-2026): entra con su enlace personal,
 * sin usuario ni PIN, y ve SOLO su finca — lo decide la base con la llave del
 * enlace, no esta pantalla. Es la misma «Lo que ve el dueño» de la administración,
 * en solo lectura: las mismas cifras que usa ASM, no una versión preparada.
 */

type Estado = 'cargando' | 'listo' | 'cancelado' | 'sin-red'

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
    // Al volver a la app (la tenía en segundo plano) se trae lo último.
    const alVolver = () => { if (document.visibilityState === 'visible') traer() }
    document.addEventListener('visibilitychange', alVolver)
    return () => document.removeEventListener('visibilitychange', alVolver)
  }, [recargar])

  const finca = datos?.fincas[0] ?? null
  const ctx: CtxFincas | null = datos && finca ? {
    datos, recargar, token: llave, usuario: '', esAdmin: false, puedeReportar: false, modoDueno: true,
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
