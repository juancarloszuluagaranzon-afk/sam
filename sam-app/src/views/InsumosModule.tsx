import { useMemo, useState } from 'react'
import { useAppData } from '../context/AppDataContext'
import { AvisoPendientes } from '../components/AvisoPendientes'
import { InsumosInventarioTab } from './InsumosInventarioTab'
import { BandejaInsumosTab } from './BandejaInsumosTab'
import { ConsumoEquiposTab } from './ConsumoEquiposTab'
import { MiBodegaTab } from './MiBodegaTab'
import { CatalogosInsumosTab } from './CatalogosInsumosTab'
import { InventarioResumenTab } from './InventarioResumenTab'
import { InformeSemanalTab } from './InformeSemanalTab'
import { ConsumoDashboardTab } from './ConsumoDashboardTab'
// Import ESTÁTICO (regla 17-jul: nada de lazy chunks nuevos en esta app).
import { MapaView } from './MapaView'

/**
 * Contenedor del módulo Insumos con pestañas. Lo usan tanto la vista del rol
 * "Supervisor de insumos" (InsumosView) como owner/admin (SupervisorView).
 * Incluye el Mapa offline para que TODOS los roles lo tengan (el supervisor de
 * insumos no pasa por SupervisorView/OperatorView).
 *
 * INVENTARIO ES SOLO DE ADMINISTRACIÓN. El supervisor de insumos no lo ve: si
 * pudiera meterse una "+ Entrada" a mano, el combustible aparecería de la nada
 * y se acabó la trazabilidad. Lo que entra a su carro entra por un traslado
 * avalado o por un tanqueo avalado — nunca a dedo.
 */
export type InsumosTab = 'resumen' | 'bandeja' | 'mibodega' | 'inventario' | 'equipos' | 'consumo' | 'semanal' | 'catalogos' | 'mapa'

const TABS: { key: InsumosTab; icon: string; label: string; desc: string }[] = [
  { key: 'resumen', icon: '📊', label: 'Resumen', desc: 'Qué hay y dónde está' },
  { key: 'bandeja', icon: '📥', label: 'Bandeja', desc: 'Solicitudes y entregas' },
  { key: 'mibodega', icon: '🚚', label: 'Mi bodega', desc: 'Mi carro · recibir · tanquear' },
  { key: 'inventario', icon: '📦', label: 'Inventario', desc: 'Stock y kardex' },
  { key: 'equipos', icon: '📊', label: 'Reportes', desc: 'Consumo + Excel' },
  { key: 'consumo', icon: '⛽', label: 'Consumo', desc: 'Historia y gal/hora' },
  { key: 'semanal', icon: '📅', label: 'Semanal', desc: 'Horas y gal/hora' },
  { key: 'catalogos', icon: '📚', label: 'Catálogos', desc: 'Estaciones, placas, motivos' },
  { key: 'mapa', icon: '🗺️', label: 'Mapa', desc: 'Plano · sin señal' },
]

export function InsumosModule({
  tab: tabExterno,
  onTabChange,
}: {
  /** Opcional: control externo de la pestaña (ej. el botón de mapa del topbar). */
  tab?: InsumosTab
  onTabChange?: (t: InsumosTab) => void
} = {}) {
  const { session } = useAppData()
  const [tabInterno, setTabInterno] = useState<InsumosTab>('bandeja')
  const tabsVisibles = useMemo(
    // Los catálogos los maneja administración, igual que Inventario: si cada
    // supervisor pudiera editarlos, cada carro tendría su propia lista.
    () => (session?.role === 'supervisor_insumos'
      ? TABS.filter((t) => !['inventario', 'catalogos', 'resumen', 'semanal', 'consumo'].includes(t.key))
      : TABS),
    [session?.role],
  )
  const tabPedida = tabExterno ?? tabInterno
  // Si el rol no puede ver la pestaña pedida, cae a la primera que sí puede.
  const tab = tabsVisibles.some((t) => t.key === tabPedida) ? tabPedida : tabsVisibles[0].key
  const setTab = onTabChange ?? setTabInterno
  return (
    <div>
      {/* Lo registrado sin senal, visible arriba de todo: si no se ve, el
          supervisor cree que se perdio. */}
      <AvisoPendientes />
      <div className="insumos-tabs" role="tablist" aria-label="Secciones de insumos">
        {tabsVisibles.map((t) => (
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
      {tab === 'resumen' ? <InventarioResumenTab />
        : tab === 'bandeja' ? <BandejaInsumosTab />
        : tab === 'mibodega' ? <MiBodegaTab />
        : tab === 'inventario' ? <InsumosInventarioTab />
        : tab === 'equipos' ? <ConsumoEquiposTab />
        : tab === 'consumo' ? <ConsumoDashboardTab />
        : tab === 'semanal' ? <InformeSemanalTab />
        : tab === 'catalogos' ? <CatalogosInsumosTab />
        : <MapaView onBack={() => setTab('bandeja')} />}
    </div>
  )
}

export default InsumosModule
