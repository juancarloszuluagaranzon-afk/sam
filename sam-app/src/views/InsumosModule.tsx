import { useState } from 'react'
import { InsumosInventarioTab } from './InsumosInventarioTab'
import { BandejaInsumosTab } from './BandejaInsumosTab'

/**
 * Contenedor del módulo Insumos con pestañas. Lo usan tanto la vista del rol
 * "Supervisor de insumos" (InsumosView) como owner/admin (SupervisorView).
 * Fase 2: Bandeja (solicitudes) + Inventario (catálogo/kardex).
 */
type InsumosTab = 'bandeja' | 'inventario'

export function InsumosModule() {
  const [tab, setTab] = useState<InsumosTab>('bandeja')
  return (
    <div>
      <div className="realizadas-seg" style={{ marginBottom: 12 }}>
        <button type="button" className={tab === 'bandeja' ? 'is-active' : ''} onClick={() => setTab('bandeja')}>📥 Bandeja</button>
        <button type="button" className={tab === 'inventario' ? 'is-active' : ''} onClick={() => setTab('inventario')}>📦 Inventario</button>
      </div>
      {tab === 'bandeja' ? <BandejaInsumosTab /> : <InsumosInventarioTab />}
    </div>
  )
}

export default InsumosModule
