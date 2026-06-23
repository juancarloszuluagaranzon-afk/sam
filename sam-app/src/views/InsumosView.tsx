import { useAppData } from '../context/AppDataContext'
import logoAgromorales from '../assets/logo-agromorales.jpeg'
import { ThemeToggle } from '../components/ThemeToggle'
import { InsumosModule } from './InsumosModule'

/**
 * Vista del rol "Supervisor de insumos" (módulo Insumos y Combustible).
 *
 * Fase 1: solo Inventario (catálogo + stock + kardex). En fases siguientes se
 * sumarán pestañas: Bandeja de solicitudes y Despachos.
 */
export function InsumosView({ onLogout }: { onLogout: () => void }) {
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
              <span>Insumos y combustible</span>
            </div>
          </div>
        </div>
        <div className="topbar-actions">
          <ThemeToggle />
          <button type="button" className="inline-button" onClick={onLogout}>Salir</button>
        </div>
      </header>

      {error && <div className="sync-error-banner" role="alert"><span>{error}</span></div>}
      {info && (
        <div
          role="status"
          style={{ background: 'var(--color-bg-soft, #eef6ec)', color: 'var(--color-brand, #2e7d32)', padding: '8px 14px', fontSize: '0.9rem', textAlign: 'center' }}
        >
          {info}
        </div>
      )}

      <div style={{ padding: '12px 0' }}>
        <InsumosModule />
      </div>
    </main>
  )
}

export default InsumosView
