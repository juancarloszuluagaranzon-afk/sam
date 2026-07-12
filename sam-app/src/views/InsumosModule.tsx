import { useState } from 'react'
import { InsumosInventarioTab } from './InsumosInventarioTab'
import { BandejaInsumosTab } from './BandejaInsumosTab'
import { ConsumoEquiposTab } from './ConsumoEquiposTab'

/**
 * Contenedor del módulo Insumos con pestañas. Lo usan tanto la vista del rol
 * "Supervisor de insumos" (InsumosView) como owner/admin (SupervisorView).
 * Fase 2: Bandeja (solicitudes) + Inventario (catálogo/kardex).
 */
type InsumosTab = 'bandeja' | 'inventario' | 'equipos'

const TABS: { key: InsumosTab; icon: string; label: string; desc: string }[] = [
  { key: 'bandeja', icon: '📥', label: 'Bandeja', desc: 'Solicitudes y entregas' },
  { key: 'inventario', icon: '📦', label: 'Inventario', desc: 'Stock y kardex' },
  { key: 'equipos', icon: '🚜', label: 'Por máquina', desc: 'Consumo por equipo' },
]

export function InsumosModule() {
  const [tab, setTab] = useState<InsumosTab>('bandeja')
  return (
    <div>
      <div className="insumos-tabs" role="tablist" aria-label="Secciones de insumos">
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
      {tab === 'bandeja' ? <BandejaInsumosTab /> : tab === 'inventario' ? <InsumosInventarioTab /> : <ConsumoEquiposTab />}
    </div>
  )
}

export default InsumosModule
