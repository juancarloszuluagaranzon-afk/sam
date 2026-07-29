import { useMemo, useState } from 'react'
import { useAppData } from '../context/AppDataContext'
import { InsumosInventarioTab } from './InsumosInventarioTab'
import { BandejaInsumosTab } from './BandejaInsumosTab'
import { ConsumoEquiposTab } from './ConsumoEquiposTab'
import { MiBodegaTab } from './MiBodegaTab'
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
export type InsumosTab = 'bandeja' | 'mibodega' | 'inventario' | 'equipos' | 'mapa'

const TABS: { key: InsumosTab; icon: string; label: string; desc: string }[] = [
  { key: 'bandeja', icon: '📥', label: 'Bandeja', desc: 'Solicitudes y entregas' },
  { key: 'mibodega', icon: '🚚', label: 'Mi bodega', desc: 'Mi carro · recibir · tanquear' },
  { key: 'inventario', icon: '📦', label: 'Inventario', desc: 'Stock y kardex' },
  { key: 'equipos', icon: '📊', label: 'Reportes', desc: 'Consumo + Excel' },
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
    () => (session?.role === 'supervisor_insumos' ? TABS.filter((t) => t.key !== 'inventario') : TABS),
    [session?.role],
  )
  const tabPedida = tabExterno ?? tabInterno
  // Si el rol no puede ver la pestaña pedida, cae a la primera que sí puede.
  const tab = tabsVisibles.some((t) => t.key === tabPedida) ? tabPedida : tabsVisibles[0].key
  const setTab = onTabChange ?? setTabInterno
  return (
    <div>
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
      {tab === 'bandeja' ? <BandejaInsumosTab />
        : tab === 'mibodega' ? <MiBodegaTab />
        : tab === 'inventario' ? <InsumosInventarioTab />
        : tab === 'equipos' ? <ConsumoEquiposTab />
        : <MapaView onBack={() => setTab('bandeja')} />}
    </div>
  )
}

export default InsumosModule
