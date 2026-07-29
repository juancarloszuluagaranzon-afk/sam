import { useState } from 'react'
import { useAppData } from '../context/AppDataContext'
import logoAgromorales from '../assets/logo-agromorales.jpeg'
import { ThemeToggle } from '../components/ThemeToggle'
import { MapButton } from '../components/MapButton'
import { AvalesCombustibleTab } from './AvalesCombustibleTab'
import { VehiculosTab } from './VehiculosTab'
import { ConsumoEquiposTab } from './ConsumoEquiposTab'
// Import ESTÁTICO (regla 17-jul: nada de lazy chunks nuevos en esta app).
import { MapaView } from './MapaView'

/**
 * Vista del rol "Analista de insumos y materiales".
 *
 * Su trabajo es uno: avalar el combustible. Todo tanqueo que registra un
 * operario o un supervisor de insumos —en estación o en la sede— le llega aquí
 * pendiente. También mantiene el catálogo de placas para que los registros de
 * vehículo salgan de una lista y no del teclado de cada quien.
 */
type AnalistaTab = 'avales' | 'placas' | 'reportes' | 'mapa'

const TABS: { key: AnalistaTab; icon: string; label: string; desc: string }[] = [
  { key: 'avales', icon: '✅', label: 'Avales', desc: 'Tanqueos por aprobar' },
  { key: 'placas', icon: '🚗', label: 'Placas', desc: 'Catálogo de vehículos' },
  { key: 'reportes', icon: '📊', label: 'Reportes', desc: 'Consumo + Excel' },
  { key: 'mapa', icon: '🗺️', label: 'Mapa', desc: 'Plano · sin señal' },
]

export function AnalistaView({ onLogout }: { onLogout: () => void }) {
  const { session, error, info } = useAppData()
  const [tab, setTab] = useState<AnalistaTab>('avales')
  if (!session) return null

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-info">
            <img src={logoAgromorales} alt="AgroMorales" className="header-logo" />
            <div>
              <strong>AgroMorales</strong>
              <span>Insumos y materiales</span>
            </div>
          </div>
        </div>
        <div className="topbar-actions">
          <MapButton onClick={() => setTab('mapa')} />
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
        <div className="insumos-tabs" role="tablist" aria-label="Secciones del analista">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              className={`insumos-tab${tab === t.key ? ' is-active' : ''}`}
              onClick={() => setTab(t.key)}
            >
              <span className="insumos-tab__icon" aria-hidden>{t.icon}</span>
              <span className="insumos-tab__text">
                <span className="insumos-tab__label">{t.label}</span>
                <span className="insumos-tab__desc">{t.desc}</span>
              </span>
            </button>
          ))}
        </div>

        {tab === 'avales' ? <AvalesCombustibleTab />
          : tab === 'placas' ? <VehiculosTab />
          : tab === 'reportes' ? <ConsumoEquiposTab />
          : <MapaView onBack={() => setTab('avales')} />}
      </div>
    </main>
  )
}

export default AnalistaView
