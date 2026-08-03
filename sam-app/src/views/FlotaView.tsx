import { useAppData } from '../context/AppDataContext'
import logoAgromorales from '../assets/logo-agromorales.jpeg'
import { ThemeToggle } from '../components/ThemeToggle'
import { FlotaTab } from './FlotaTab'
import { BotonManual } from '../components/BotonManual'

/**
 * Vista del rol "Conductor" (módulo Flota / Escolta). El conductor registra sus
 * servicios de escolta desde el celular y ve su propio historial.
 */
export function FlotaView({ onLogout }: { onLogout: () => void }) {
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
              <span>Flota · Escolta</span>
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
        <div role="status" style={{ background: 'var(--color-bg-soft, #eef6ec)', color: 'var(--color-brand, #2e7d32)', padding: '8px 14px', fontSize: '0.9rem', textAlign: 'center' }}>
          {info}
        </div>
      )}

      <div style={{ padding: '12px 0' }}>
        <FlotaTab conductorScope={{ id: session.id, nombre: session.name }} />
      </div>
    </main>
  )
}

export default FlotaView
