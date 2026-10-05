import { useState } from 'react'
import { useAppData } from '../context/AppDataContext'
import logoAgromorales from '../assets/logo-agromorales.jpeg'
import { ThemeToggle } from '../components/ThemeToggle'
import { MapButton } from '../components/MapButton'
import { AvalesCombustibleTab } from './AvalesCombustibleTab'
import { CatalogosInsumosTab } from './CatalogosInsumosTab'
import { InsumosInventarioTab } from './InsumosInventarioTab'
import { InventarioResumenTab } from './InventarioResumenTab'
import { BandejaInsumosTab } from './BandejaInsumosTab'
import { InformeSemanalTab } from './InformeSemanalTab'
import { BodegasTab } from './BodegasTab'
import { ConsumoEquiposTab } from './ConsumoEquiposTab'
import { MaquinasCrudTab } from './MaquinasCrudTab'
import { FacturacionTab } from './FacturacionTab'
import { CarteraTab } from './CarteraTab'
// Import ESTÁTICO (regla 17-jul: nada de lazy chunks nuevos en esta app).
import { MapaView } from './MapaView'
import { BotonManual } from '../components/BotonManual'
import { ConsumoDashboardTab } from './ConsumoDashboardTab'
import { MovimientosTab } from './MovimientosTab'
import { PantallaSegura } from '../components/PantallaSegura'

function AnalistaTablerosView() {
  const [cara, setCara] = useState<'maquinaria' | 'insumos'>('maquinaria')
  return (
    <>
      <div className="tablero-caras-tabs" style={{ marginBottom: 16 }}>
        <button type="button" className={`tablero-cara-tab ${cara === 'maquinaria' ? 'is-sel' : ''}`}
                onClick={() => setCara('maquinaria')}>
          ⛽ Eficiencia maquinaria
        </button>
        <button type="button" className={`tablero-cara-tab ${cara === 'insumos' ? 'is-sel' : ''}`}
                onClick={() => setCara('insumos')}>
          📦 Insumos y materiales
        </button>
      </div>
      {cara === 'maquinaria' ? (
        <PantallaSegura nombre="Eficiencia maquinaria"><ConsumoDashboardTab /></PantallaSegura>
      ) : (
        <PantallaSegura nombre="Insumos y materiales"><MovimientosTab /></PantallaSegura>
      )}
    </>
  )
}

/**
 * Vista del rol "Analista de insumos y materiales".
 *
 * Es el administrador del proceso de insumos, no solo el que firma. Todo
 * tanqueo que registra un operario o un supervisor —en estación o en la sede—
 * le llega aquí pendiente de aprobación; además ve el inventario con su kardex, el
 * stock de cada bodega (la principal y el carro de cada supervisor) y mantiene
 * los catálogos —estaciones, placas, motivos— para que los formularios sugieran
 * una lista y no dependan del teclado de cada quien.
 *
 * TAMBIÉN ENTREGA. Despacha solicitudes y hace entregas directas desde la
 * bodega principal, igual que un supervisor, y registra tanqueos a máquina o
 * vehículo. Lo que entrega a un operario le pide la aprobación de ese operario, como
 * cualquier otra entrega.
 *
 * ⚠️ Lo que él registra NO lo puede aprobar él: eso lo firma el dueño o
 * administración. La aprobación es el segundo par de ojos; si firma lo suyo, no hay
 * control.
 */
type AnalistaTab = 'resumen' | 'bandeja' | 'semanal' | 'avales' | 'inventario' | 'bodegas' | 'catalogos' | 'maquinas' | 'reportes' | 'facturacion' | 'cartera' | 'mapa' | 'tableros'

const TABS: { key: AnalistaTab; icon: string; label: string; desc: string }[] = [
  { key: 'resumen', icon: '📊', label: 'Resumen', desc: 'Qué hay y dónde está' },
  { key: 'bandeja', icon: '📥', label: 'Bandeja', desc: 'Entregar y despachar' },
  { key: 'avales', icon: '✅', label: 'Aprobaciones', desc: 'Tanqueos por aprobar' },
  { key: 'inventario', icon: '📦', label: 'Inventario', desc: 'Stock y kardex' },
  { key: 'tableros', icon: '📈', label: 'Tableros', desc: 'Eficiencia e insumos' },
  { key: 'bodegas', icon: '🏢', label: 'Bodegas', desc: 'Principal y carros' },
  { key: 'catalogos', icon: '📚', label: 'Catálogos', desc: 'Estaciones, placas, motivos' },
  { key: 'maquinas', icon: '🚜', label: 'Máquinas', desc: 'Crear, editar y dar de baja' },
  { key: 'semanal', icon: '📅', label: 'Semanal', desc: 'Horas y gal/hora' },
  { key: 'reportes', icon: '📊', label: 'Reportes', desc: 'Consumo + Excel' },
  // Pedido de Iván (2-oct-2026): Diego Urdinola (analista) lleva facturación y cartera.
  { key: 'facturacion', icon: '🧾', label: 'Facturación', desc: 'Soporte, factura y valor' },
  { key: 'cartera', icon: '💰', label: 'Cartera', desc: 'Por cobrar y mora' },
  { key: 'mapa', icon: '🗺️', label: 'Mapa', desc: 'Plano · sin señal' },
]

const PRIMARY_TABS = TABS.slice(0, 4)
const SECONDARY_TABS = TABS.slice(4)

export function AnalistaView({ onLogout }: { onLogout: () => void }) {
  const { session, error, info } = useAppData()
  const [tab, setTab] = useState<AnalistaTab>('resumen')
  const [showMore, setShowMore] = useState(false)
  if (!session) return null

  const isSecondaryActive = SECONDARY_TABS.some((t) => t.key === tab)
  const displayMore = showMore || isSecondaryActive

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
          <BotonManual className="inline-button" />
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
          {PRIMARY_TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              className={`insumos-tab${tab === t.key ? ' is-active' : ''}`}
              onClick={() => {
                setTab(t.key)
                setShowMore(false)
              }}
            >
              <span className="insumos-tab__icon" aria-hidden>{t.icon}</span>
              <span className="insumos-tab__text">
                <span className="insumos-tab__label">{t.label}</span>
                <span className="insumos-tab__desc">{t.desc}</span>
              </span>
            </button>
          ))}
          
          {!displayMore && (
            <button
              type="button"
              className="insumos-tab"
              onClick={() => setShowMore(true)}
            >
              <span className="insumos-tab__icon" aria-hidden>⋯</span>
              <span className="insumos-tab__text">
                <span className="insumos-tab__label">Más módulos</span>
                <span className="insumos-tab__desc">Bodegas, reportes...</span>
              </span>
            </button>
          )}

          {displayMore && SECONDARY_TABS.map((t) => (
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

          {displayMore && !isSecondaryActive && (
            <button
              type="button"
              className="insumos-tab"
              onClick={() => setShowMore(false)}
            >
              <span className="insumos-tab__icon" aria-hidden>⌃</span>
              <span className="insumos-tab__text">
                <span className="insumos-tab__label">Ocultar</span>
                <span className="insumos-tab__desc">Ver principales</span>
              </span>
            </button>
          )}
        </div>

        {tab === 'resumen' ? <InventarioResumenTab />
          : tab === 'bandeja' ? <BandejaInsumosTab />
          : tab === 'avales' ? <AvalesCombustibleTab />
          : tab === 'inventario' ? <InsumosInventarioTab />
          : tab === 'bodegas' ? <BodegasTab />
          : tab === 'catalogos' ? <CatalogosInsumosTab />
          : tab === 'maquinas' ? <MaquinasCrudTab />
          : tab === 'semanal' ? <InformeSemanalTab />
          : tab === 'reportes' ? <ConsumoEquiposTab />
          : tab === 'facturacion' ? <FacturacionTab />
          : tab === 'cartera' ? <CarteraTab />
          : tab === 'tableros' ? <AnalistaTablerosView />
          : <MapaView onBack={() => setTab('avales')} />}
      </div>
    </main>
  )
}

export default AnalistaView
