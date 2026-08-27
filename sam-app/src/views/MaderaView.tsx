import { useAppData } from '../context/AppDataContext'
import logoAgromorales from '../assets/logo-agromorales.jpeg'
import { ThemeToggle } from '../components/ThemeToggle'
import { BotonManual } from '../components/BotonManual'
import { MaderaTab } from './MaderaTab'

/**
 * Vista del rol `conductor_madera`: el que maneja el camión de trozas.
 *
 * Es un rol aparte de `conductor` (el escolta, que llena el CDA-F-68) porque el
 * trabajo es otro: abre el viaje con los kilómetros y la foto del tablero, y lo
 * cierra al llegar. Meterlos en el mismo rol le daría a cada uno la pantalla del
 * otro.
 *
 * Ve **solo sus propios viajes**. No es por desconfianza sino por utilidad: un
 * conductor con la lista de toda la flota encima tiene que buscar el suyo entre
 * los ajenos cada vez que llega a descargar.
 */
export function MaderaView({ onLogout }: { onLogout: () => void }) {
  const { session, error, info } = useAppData()
  if (!session) return null

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-info">
            <img src={logoAgromorales} alt="AgroMorales" className="header-logo" />
            <div>
              <strong>AgroMorales</strong>
              <span>Madera · Transporte</span>
            </div>
          </div>
        </div>
        <div className="topbar-actions">
          <ThemeToggle />
          <BotonManual className="inline-button" />
          <button type="button" className="inline-button" onClick={onLogout}>Salir</button>
        </div>
      </header>

      {error && <div className="sync-error-banner" role="alert"><span>{error}</span></div>}
      {info && (
        <div role="status" className="info-banner-simple">{info}</div>
      )}

      <div style={{ padding: '12px 0' }}>
        <MaderaTab conductorScope={{ id: session.id, nombre: session.name }} />
      </div>
    </main>
  )
}

export default MaderaView
